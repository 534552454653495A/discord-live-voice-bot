// One guild's whole voice life: the audio path (mixer, playback, ducker, music), the GPT-Live session,
// the local brain (whisper -> text model -> Chatterbox), the speaker attribution the owner gate rests
// on, and every timer that belongs to them. The process holds ONE of these per server instead of one
// set of module-level variables, so a second guild is a second instance and nothing else.
//
//   channel -> per-user Opus -> decode -> mono 24k -> mixer -> GPT-Live (gpt-live-1)
//   channel <- Opus encode <- 48k stereo <- [bot audio + ducked music] <- playback / music
//
// The process-wide services (config, Discord client, character store, memory, quota, activity log,
// text provider, the local Chatterbox server) are handed in by src/index.js; nothing here reaches for
// a singleton of its own.

import { ChannelType } from 'discord.js';
import { createTaskRunner, executeAction } from './agent.js';
import { FRAME_MS, PlaybackQueue, SpeakerMixer, peakOf } from './audio.js';
import { SpeakerAttribution } from './attribution.js';
import { parseVoiceCommand } from './commands.js';
import { t, tList, tRaw } from './i18n/index.js';
import { IdleGovernor } from './idle.js';
import { LatencyMeter } from './latency.js';
import { LiveSession, describeLiveError } from './live.js';
import { LocalBrain } from './localbrain.js';
import { SpeechSegmenter } from './localstt.js';
import { LocalTts, splitSentences } from './localtts.js';
import { MemberIndex } from './matcher.js';
import { Ducker, MusicPlayer } from './music.js';
import { normalize, parseBool, stripDictationTail } from './text.js';
import { callTool, toolDefinitions, toolOutput } from './tools.js';
import { VoiceSession } from './voice.js';

// Retry schedule (ms) for rejoining after the voice connection drops; the rest are skipped once one works.
const RECOVERY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000];

// If the model left the channel on its own (it was thrown out), it tries to come back after these delays.
const REJOIN_DELAYS_MS = [60_000, 180_000];

// Latency measurement: in a full-duplex stream audio keeps arriving, so only replies that start after
// a silence are measured; very short delays are not written out so they do not clutter the log.
const SILENCE_GAP_MS = 600;
const MIN_LOGGED_MS = 300;
// Peak the model's audio has to reach before it counts as "audible" (int16; about -44 dBFS).
const AUDIO_PEAK_MIN = 200;
// Local TTS: speak the tail that never got its punctuation anyway, after this much silence.
const TTS_FLUSH_MS = 1500;
// Retrying every few seconds is pointless for permanent errors (credit, key): this interval is used instead.
const FATAL_RETRY_MS = 10 * 60_000;

// Barge-in with the local brain: only while the bot is REALLY speaking (audio is playing) and the user
// has been talking for about 0.8 s without a break. Nothing is cancelled while generation is still under
// way (no audio yet); otherwise a 15 s Chatterbox render is thrown away on every interruption and the
// bot never gets to speak at all.
const BARGE_IN_MS = 1200;

// Delegation id -> that turn's audio/clock marker. When a tool call arrives the gate looks at the moment the
// request was born; voices cutting in while the backend runs do not change it. Kept small (a few turns is enough).
const TURN_MEMORY = 8;

// Who owns the audio that is REALLY sent to the model: with owner priority the owner, otherwise the loudest
// person in the mix. This is used instead of Discord's "started speaking" event; short noises cutting in do
// not steal the announcement.
const SPEAKER_STABLE_FRAMES = 8; // stable for 160 ms
const SPEAKER_GAP_FRAMES = 15; // a silent frame gap of up to 300 ms (packet jitter, a breath) does not reset the counter

// Names the bot answers to on top of the active character's name, and the filler words dropped when
// deciding whether the name was called on its own or together with a request.
const WAKE_WORDS = tList('runtime.wake_words');
const WAKE_FILLER_WORDS = tList('runtime.wake_filler_words');

const SETTING_NAMES = ['transcripts', 'announce_speaker', 'owner_priority', 'idle_close_minutes', 'local_tts', 'record', 'brain'];

// Spoken aliases -> canonical setting name; the switch below only knows the canonical names.
const SETTING_ALIASES = tRaw('runtime.setting_aliases') ?? {};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class GuildSession {
	/**
	 * @param {object} services the process-wide services; everything that belongs to this one guild is
	 * built right here, in the constructor.
	 */
	constructor({
		cfg,
		client,
		guild,
		store,
		memory,
		quota,
		reader,
		recentActions,
		activity,
		record,
		provider,
		openai,
		localStt,
		localServer,
		log,
		summarize,
		presenceEnabled = false,
	}) {
		this.cfg = cfg;
		this.client = client;
		this.guild = guild;
		this.store = store;
		this.memory = memory;
		this.quota = quota;
		this.reader = reader;
		this.recentActions = recentActions;
		this.activity = activity;
		this.record = record;
		this.provider = provider;
		this.openai = openai;
		this.localStt = localStt;
		this.localServer = localServer;
		this.log = log;
		this.summarizeConversation = summarize;
		this.presenceEnabled = presenceEnabled;

		// ---------------------------------------------------------------- audio path
		this.mixer = new SpeakerMixer();
		if (cfg.ownerPriority && cfg.ownerId) this.mixer.setPriority(cfg.ownerId);
		this.playback = new PlaybackQueue();
		this.idle = new IdleGovernor({ idleMs: cfg.idleCloseMs });
		this.attribution = new SpeakerAttribution({ ownerId: cfg.ownerId, frameMs: FRAME_MS });
		this.latency = new LatencyMeter();
		this.memberIndex = new MemberIndex();

		// ---------------------------------------------------------------- music
		this.music = cfg.musicEnabled
			? new MusicPlayer({
					ffmpegPath: cfg.ffmpegPath,
					ytDlpPath: cfg.ytDlpPath,
					musicDir: cfg.musicDir,
					volume: cfg.musicVolume,
					duckVolume: cfg.musicDuckVolume,
					maxMinutes: cfg.musicMaxMinutes,
					log,
					onTrackStart: (track) =>
						activity.push({
							kind: 'music',
							whoName: track.requestedBy ?? null,
							text: t('runtime.music_playing', { title: track.title }),
							meta: { source: track.kind },
						}),
					onTrackEnd: (track, { queueEmpty }) => {
						if (queueEmpty) activity.push({ kind: 'music', text: t('runtime.music_finished', { title: track.title }) });
					},
					onError: (track, message) => activity.push({ kind: 'music', text: t('runtime.music_failed', { title: track.title, error: message }) }),
				})
			: null;
		this.ducker = new Ducker({ duck: this.music ? this.music.duckRatio : 0.12, holdMs: cfg.musicDuckHoldMs, frameMs: FRAME_MS });

		// ---------------------------------------------------------------- local TTS
		// Local TTS (Chatterbox): while it is on the GPT-Live audio is not pushed to Discord; the text is
		// turned into speech locally instead.
		this.localTts = new LocalTts({
			url: cfg.localTtsUrl,
			voiceRef: cfg.localTtsVoice,
			languageId: cfg.localTtsLang,
			log: (message) => cfg.debug && log(message),
		});
		this.localMode = cfg.localTtsOn;
		this.ttsPending = '';
		this.ttsFlushTimer = null;
		this.ttsQueue = [];
		this.ttsBusy = false;
		this.ttsAbort = null;

		// ---------------------------------------------------------------- local brain (voice chat without OpenAI)
		// ears = whisper (/stt on the Chatterbox server), brain = DeepSeek/OpenAI chat + tools, mouth = Chatterbox.
		this.brain = 'live'; // 'live' | 'local'
		this.sttPollTimer = null;
		this.localModeBeforeBrain = null;
		this.localBrainWarnedAt = 0;
		this.localBrainRetryTimer = null;
		this.localBrainRetryCount = 0;
		this.segmenter = new SpeechSegmenter();
		this.localBrain = new LocalBrain({
			provider,
			persona: () => ({ name: this.persona().name, instructions: this.persona().instructions }),
			tools: toolDefinitions(),
			// context = the dependencies specific to this utterance (the owner-gate turn); the shared taskDeps otherwise.
			callTool: (name, args, context) => callTool(name, args, context ? { ...this.taskDeps, ...context } : this.taskDeps),
			toolOutput,
			respondPolicy: cfg.localBrainRespond,
			participants: () => this.humansInVoice(),
			log,
		});

		// ---------------------------------------------------------------- GPT-Live session and reconnect state
		this.live = null;
		this.liveReconnectTimer = null;
		this.liveFailures = 0;
		this.lastFatalCode = null; // tell the owner about the same permanent error only once
		this.lastLiveError = null; // the reason for the 'closed' that follows an 'error' event
		this.lastUsageMinute = -1;
		this.greeted = false;
		this.pendingIntro = false;
		this.paused = false;
		this.quotaBlocked = false;
		this.shuttingDown = false;
		this.idleTimer = null;
		this.memberRefreshTimer = null;
		this.rejoinTimers = new Set();

		// ---------------------------------------------------------------- turns, speakers, transcripts
		this.turnsByDelegation = new Map();
		this.lastTurn = null;
		this.lastSpeakerId = null;
		this.lastAnnouncedUser = null;
		this.lastVoiceChannelId = null;
		this.memberNameMap = null;
		this.memoryHinted = new Set();
		this.recentUserText = '';
		this.recentUserTextAt = 0;
		this.lastAssistantSpokeAt = 0;
		this.lastWakeNudgeAt = 0;
		this.transcriptBuffers = new Map();
		this.lastUserDeltaAt = 0;
		this.sentCandidate = null;
		this.sentCandidateFrames = 0;
		this.sentSilentFrames = 0;

		this.taskDeps = this.buildDeps();
		this.runTask = createTaskRunner(this.taskDeps);
		this.voice = this.buildVoice();
		this.wireLocalEars();
	}

	// ---------------------------------------------------------------- wiring

	/** The voice session of this guild: the 20 ms bridge, the per-speaker subscriptions and the frame hooks. */
	buildVoice() {
		return new VoiceSession({
			getClient: () => this.client,
			mixer: this.mixer,
			playback: this.playback,
			music: this.music,
			ducker: this.ducker,
			getLive: () => this.live,
			log: this.log,
			debug: this.cfg.debug,
			soloUserId: this.cfg.soloUserId,
			onFrame: (frame) => {
				this.attribution.onFrame(frame);
				this.trackSentSpeaker(frame);
			},
			onUserPcm: (userId, pcm) => {
				if (this.brain === 'local') this.segmenter.push(userId, pcm);
			},
			onSpeaking: (userId) => {
				this.lastSpeakerId = userId;
				this.idle.touch();
				if (this.paused && this.brain !== 'local') {
					if (this.quotaBlocked && this.quota.status().exceeded) return;
					this.log(t('runtime.speech_detected'));
					this.resumeLive();
				}
				// The speaker announcement now follows the audio that is sent (trackSentSpeaker); only the memory hint here.
				void this.hintMemory(userId);
			},
			onLost: () => {
				// The voice connection could not be recovered: instead of killing the whole bot, leave the channel,
				// pause the session, and try to rejoin the same channel with growing delays.
				this.log(t('runtime.voice_lost'));
				void (async () => {
					try {
						await this.voice.destroy();
					} catch {
						/* ignore */
					}
					this.pauseLive(t('runtime.reason_voice_lost'));
					const targetId = this.lastVoiceChannelId;
					if (!targetId || this.shuttingDown) return;
					this.scheduleRejoin(targetId, RECOVERY_DELAYS_MS, t('runtime.rejoin_label_recover'));
				})();
			},
		});
	}

	/** The local ears: barge-in and finished utterances from the segmenter, tool calls from the local brain. */
	wireLocalEars() {
		this.segmenter.on('start', ({ userId }) => {
			this.lastSpeakerId = userId;
			this.idle.touch();
			if (this.playback.length === 0) return; // the bot is not playing: let any generation carry on
			setTimeout(() => {
				if (!this.segmenter.speakingUsers.includes(userId)) return; // a short noise (a cough, a click)
				if (this.playback.length === 0) return;
				this.log(t('runtime.barge_in'));
				this.interruptLocalSpeech();
			}, BARGE_IN_MS);
		});
		this.segmenter.on('segment', (segment) => void this.onLocalSegment(segment));
		this.localBrain.on('tool', (event) => this.onToolEvent(event, t('runtime.source_local_brain')));
	}

	/**
	 * Task dependencies: the voice-command path, the delegation path and the slash commands all use these.
	 * Values that change while the bot runs (the live session, the speaker, the guild) are read through a
	 * getter/closure.
	 */
	buildDeps() {
		const session = this;
		const { cfg, log, openai, provider, store } = this;
		return {
			store,
			cfg,
			log,
			openai,
			provider,
			textClient: provider.textClient,
			textApi: provider.textApi,
			textModel: provider.textModel,
			visionClient: openai,
			visionModel: cfg.textModel,
			model: provider.textModel,
			recentActions: this.recentActions,
			reader: this.reader,
			memberIndex: this.memberIndex,
			memory: this.memory,
			music: this.music,
			quota: this.quota,
			now: Date.now,
			nameFor: (userId) => session.nameFor(userId),
			personaName: () => session.persona().name ?? 'bot',
			summarize: (options = {}) => session.summarizeConversation(session.taskDeps, { events: session.activity.events, ...options }),
			get presenceEnabled() {
				return session.presenceEnabled;
			},
			get selfId() {
				return session.client?.user?.id ?? null;
			},
			get guild() {
				return session.guild;
			},
			getUserText: () => (Date.now() - session.recentUserTextAt < 60_000 ? session.recentUserText.trim() : ''),
			channelLists: () => session.channelLists(),
			joinVoice: (channel) => session.joinVoice(channel),
			leaveVoice: (options) => session.leaveVoice(options),
			currentSpeakerChannel: () => session.guild?.voiceStates.cache.get(session.lastSpeakerId ?? '')?.channel ?? null,
			currentSpeakerId: () => session.lastSpeakerId,
			currentSpeakerName: () => (session.lastSpeakerId ? session.nameFor(session.lastSpeakerId) : null),
			currentVoiceChannel: () => (session.voice.channelId ? (session.guild?.channels.cache.get(session.voice.channelId) ?? null) : null),
			// Did the bot owner speak just now? Admin commands go through this gate.
			// The audio path can tell the owner's speech apart, so the gate rests on "was the last voice heard the owner's".
			isOwnerActive: () => session.attribution.isOwnerActive(),
			ownerSaidRecently: (words, ms) => session.attribution.ownerSaidRecently(words, ms),
			ownerMatch: (words, ms) => session.attribution.ownerMatch(words, ms),
			ownerTextTail: () => session.attribution.state().ownerText,
			// The gate's real question: who said the command word LAST, and did anyone speak after the owner (before
			// the turn started)? Default turn: the last turn read when entering the gate (a turn pinned per request wins).
			currentTurn: () => session.attribution.turn,
			commandSpeaker: (words, opts) => session.attribution.commandSpeaker(words, opts),
			lastUtterance: (opts) => session.attribution.lastUtterance(opts),
			transcriptLagging: (opts) => session.attribution.transcriptLagging(opts),
			awaitTranscript: (maxMs) => session.awaitTranscript(maxMs),
			activity: (event) => session.activity.push(event),
			setDefaultVoice: (voiceName) => {
				cfg.liveVoice = voiceName;
			},
			applySetting: (name, value) => session.applySetting(name, value),
			settingNames: () => SETTING_NAMES,
			refreshPersona: (reason) => session.refreshPersona(reason),
		};
	}

	// ---------------------------------------------------------------- character / people

	persona() {
		const character = this.store.getActive();
		return {
			name: character?.name ?? null,
			instructions: character?.prompt?.trim() || this.cfg.instructions,
			voice: character?.voice || this.cfg.liveVoice,
		};
	}

	isOwnerId(userId) {
		return Boolean(this.cfg.ownerId && String(userId) === String(this.cfg.ownerId));
	}

	/** How many humans are in the bot's voice channel (for the local brain's "who do I answer" decision). */
	humansInVoice() {
		const channelId = this.voice.channelId;
		if (!channelId || !this.guild) return 1;
		let count = 0;
		for (const state of this.guild.voiceStates.cache.values()) {
			if (state.channelId !== channelId) continue;
			const member = state.member ?? this.guild.members.cache.get(state.id);
			if (member?.user?.bot) continue;
			count++;
		}
		return Math.max(1, count);
	}

	/** Used to show who is speaking in the panel: the live cache first, then the member index. */
	nameFor(userId) {
		if (!userId) return null;
		const cached = this.guild?.members.cache.get(userId)?.displayName;
		if (cached) return cached;
		if (!this.memberNameMap) {
			this.memberNameMap = new Map((this.memberIndex.list?.() ?? []).map((entry) => [entry.id, entry.display]));
		}
		return this.memberNameMap.get(userId) ?? this.memory?.nameFor(userId) ?? `id:${userId}`;
	}

	async memberName(userId) {
		const cached = this.guild?.members.cache.get(userId);
		if (cached) return cached.displayName;
		try {
			const member = await this.guild.members.fetch(userId);
			return member.displayName;
		} catch {
			return this.nameFor(userId);
		}
	}

	/** A member showed up or changed: keep the index fresh; `stale` also drops the cached name map. */
	rememberMember(member, { stale = false } = {}) {
		this.memberIndex.upsert(member);
		if (stale) this.memberNameMap = null;
	}

	/** The member left the server: forget them in the index and in the cached name map. */
	forgetMember(userId) {
		this.memberIndex.remove(userId);
		this.memberNameMap = null;
	}

	channelLists() {
		const text = [];
		const voice = [];
		for (const channel of this.guild?.channels.cache.values() ?? []) {
			if (channel.type === ChannelType.GuildText) text.push(channel);
			else if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) voice.push(channel);
		}
		return { text, voice };
	}

	/** Tells the model to "say this" (it comes out in the channel); with the local brain Chatterbox reads it. */
	say(text) {
		if (this.brain === 'local') {
			this.enqueueLocalSpeech(String(text ?? ''));
			this.localBrain.note(t('runtime.note_self_said', { text }));
			return;
		}
		if (!this.live?.ready) return;
		this.live.appendContext('commentary', text);
	}

	/** A DM to the owner (quota warnings and so on); with no owner set it is only logged. */
	notifyOwner(text) {
		this.log(t('runtime.owner_log', { text }));
		if (!this.cfg.ownerId || !this.client) return;
		this.client.users
			.fetch(this.cfg.ownerId)
			.then((user) => user.send(text))
			.catch((err) => this.log(t('runtime.owner_dm_failed', { error: err.message })));
	}

	/** Writes a tool event to the panel/log (the GPT-Live backend and the local brain share this path). */
	onToolEvent({ name, args, output, ms }, source = 'backend') {
		this.latency.toolDone(ms);
		let ok = true;
		try {
			ok = JSON.parse(output).ok !== false;
		} catch {
			/* ignore */
		}
		this.activity.push({
			kind: 'tool',
			whoName: this.persona().name ?? 'bot',
			text:
				`${name} ${ok ? t('runtime.tool_ok') : t('runtime.tool_failed')}` +
				`${Number.isFinite(ms) ? t('runtime.tool_timing', { seconds: (ms / 1000).toFixed(1) }) : ''}`,
			meta: { tool: name, ok, ms, source, args: JSON.stringify(args ?? {}).slice(0, 300), result: String(output).slice(0, 200) },
		});
		// A message a tool wrote to a channel/DM should show up in the panel as a conversation line too.
		if (ok && (name === 'send_message' || name === 'send_dm') && args?.text) {
			this.record({
				kind: name === 'send_dm' ? 'dm' : 'channel',
				direction: 'out',
				whoName: this.persona().name ?? 'bot',
				text: stripDictationTail(String(args.text)),
				meta: name === 'send_dm' ? { to: args.to ?? null } : { channel: args.channel ? `#${args.channel}` : null },
			});
		}
		const timing = Number.isFinite(ms) ? t('runtime.tool_timing', { seconds: (ms / 1000).toFixed(1) }) : '';
		if (!ok) this.log(t('runtime.log_tool_failed', { name, timing, output: String(output).slice(0, 160) }));
		else if (ms > 1500) this.log(t('runtime.log_tool_slow', { name, timing }));
	}

	// ---------------------------------------------------------------- local TTS

	/** Empties the local audio queue and cancels the generation in flight: the bot goes quiet when cut off. */
	interruptLocalSpeech() {
		this.ttsPending = '';
		this.ttsQueue.length = 0;
		if (this.ttsFlushTimer) {
			clearTimeout(this.ttsFlushTimer);
			this.ttsFlushTimer = null;
		}
		if (this.ttsAbort) {
			this.ttsAbort.abort();
			this.ttsAbort = null;
		}
		if (this.localMode) this.playback.clear();
	}

	/** Splits the model's spoken text into sentences and turns them into audio (local mode). */
	enqueueLocalSpeech(text) {
		this.ttsPending += text;
		const { sentences, rest } = splitSentences(this.ttsPending);
		this.ttsPending = rest;
		for (const sentence of sentences) if (sentence) this.ttsQueue.push(sentence);
		if (this.ttsFlushTimer) clearTimeout(this.ttsFlushTimer);
		this.ttsFlushTimer = null;
		if (this.ttsPending.trim()) {
			// A tail left without punctuation: speak it as it is after a short silence.
			this.ttsFlushTimer = setTimeout(() => {
				this.ttsFlushTimer = null;
				const tail = this.ttsPending.trim();
				this.ttsPending = '';
				if (tail) {
					this.ttsQueue.push(tail);
					if (!this.ttsBusy) void this.runTtsQueue();
				}
			}, TTS_FLUSH_MS);
		}
		if (this.ttsQueue.length && !this.ttsBusy) void this.runTtsQueue();
	}

	async runTtsQueue() {
		if (this.ttsBusy) return;
		this.ttsBusy = true;
		try {
			while (this.ttsQueue.length) {
				const sentence = this.ttsQueue.shift();
				const controller = new AbortController();
				this.ttsAbort = controller;
				try {
					const { pcm, language } = await this.localTts.speak(sentence, { signal: controller.signal });
					if (controller.signal.aborted || !pcm.length) continue;
					// Back pressure: wait until the queue has room (the old 2 s buffer swallowed the start of a sentence).
					let offset = 0;
					while (offset < pcm.length && !controller.signal.aborted && this.localMode) {
						const room = this.playback.free;
						if (room < this.playback.frameSamples) {
							await sleep(100);
							continue;
						}
						const chunk = pcm.subarray(offset, Math.min(pcm.length, offset + room));
						this.playback.push(chunk);
						offset += chunk.length;
					}
					if (controller.signal.aborted) continue;
					this.lastAssistantSpokeAt = Date.now();
					this.record({
						kind: 'voice',
						direction: 'out',
						whoName: this.persona().name ?? 'bot',
						text: sentence,
						meta: { source: t('runtime.meta_voice_local'), language },
					});
				} catch (err) {
					if (!controller.signal.aborted) this.log(t('runtime.local_tts_failed', { error: err.message }));
				} finally {
					if (this.ttsAbort === controller) this.ttsAbort = null;
				}
			}
		} finally {
			this.ttsBusy = false;
		}
	}

	/**
	 * Local TTS mode: the GPT-Live audio is not pushed to Discord; the spoken text is turned into audio by
	 * Chatterbox and played from the local machine (no cloud voice is used).
	 * @returns {Promise<{ ok: boolean, value: boolean, reason?: string }>}
	 */
	async setLocalMode(enabled) {
		if (enabled && !this.cfg.localTtsEnabled) {
			this.log(t('runtime.local_tts_disabled_log'));
			return { ok: false, value: this.localMode, reason: t('runtime.local_tts_disabled') };
		}
		if (enabled) {
			const info = await this.localTts.health();
			if (!info) {
				if (this.localServer?.ensureRunning()) {
					this.log(t('runtime.local_tts_server_started_log'));
					return { ok: false, value: this.localMode, reason: t('runtime.local_tts_server_started') };
				}
				this.log(t('runtime.local_tts_server_down_log'));
				return { ok: false, value: this.localMode, reason: t('runtime.local_tts_server_down') };
			}
			if (!info.ok) {
				this.log(
					t('runtime.local_tts_not_ready_log', {
						status: info.status ?? t('runtime.local_tts_status_unknown'),
						error: info.error ? `: ${info.error}` : '',
					}),
				);
				const reason = t('runtime.local_tts_not_ready', { status: info.status ?? t('runtime.local_tts_status_loading') });
				return { ok: false, value: this.localMode, reason };
			}
			this.log(t('runtime.local_tts_on_log', { model: info.model, device: info.device, rate: info.sr }));
		} else if (this.localMode) {
			this.log(t('runtime.local_tts_off_log'));
		}
		this.localMode = enabled;
		this.interruptLocalSpeech();
		this.activity.push({ kind: 'session', text: enabled ? t('runtime.local_tts_mode_on') : t('runtime.local_tts_mode_off') });
		return { ok: true, value: this.localMode };
	}

	// ---------------------------------------------------------------- local brain

	/**
	 * Switches over to the local brain, if Chatterbox (TTS + /stt) and a text model are ready. When it cannot,
	 * it says why -- once.
	 * @returns {Promise<boolean>}
	 */
	async enterLocalBrain(reason, { quiet = false } = {}) {
		if (this.brain === 'local') return true;
		const [tts, stt] = await Promise.all([this.localTts.health(), this.localStt.health()]);
		const problems = [];
		if (!this.localBrain.available) problems.push(t('runtime.local_brain_no_text_model'));
		const serverProblem = !tts?.ok || !stt?.sttReady;
		if (!tts) problems.push(t('runtime.local_brain_server_down'));
		else if (!tts.ok) problems.push(t('runtime.local_brain_server_loading', { status: tts.status ?? '…' }));
		if (tts && !stt?.sttReady) problems.push(t('runtime.local_brain_no_stt'));
		if (problems.length) {
			if (serverProblem && this.localBrain.available) this.scheduleLocalBrainRetry(reason);
			if (!quiet && Date.now() - this.localBrainWarnedAt > 10 * 60_000) {
				this.localBrainWarnedAt = Date.now();
				const hint = this.localServer
					? this.localServer.running
						? t('runtime.local_brain_hint_started')
						: t('runtime.local_brain_hint_status', { status: this.localServer.status })
					: t('runtime.local_brain_hint_manual');
				this.log(t('runtime.local_brain_not_yet', { reason, problems: problems.join('; '), hint }));
				this.activity.push({ kind: 'session', text: t('runtime.local_brain_failed', { problems: problems.join('; ') }) });
			}
			return false;
		}
		this.stopLocalBrainRetry();
		this.brain = 'local';
		this.localModeBeforeBrain = this.localMode;
		this.localMode = true; // the mouth is Chatterbox
		this.localBrain.reset();
		this.segmenter.reset();
		if (this.sttPollTimer) clearInterval(this.sttPollTimer);
		this.sttPollTimer = setInterval(() => this.segmenter.poll(), 100);
		if (typeof this.sttPollTimer.unref === 'function') this.sttPollTimer.unref();
		const text = t('runtime.local_brain_active', {
			reason,
			stt: stt.stt,
			brain: this.provider.describe().split(' —')[0],
			tts: tts.model,
		});
		this.log(text);
		this.activity.push({ kind: 'session', text });
		return true;
	}

	/**
	 * While Chatterbox is not ready: start the server (when there is one) and retry every 15 s until it is
	 * (at most 40 attempts, about 10 min; loading the model takes 1-2 min).
	 */
	scheduleLocalBrainRetry(reason) {
		if (this.localServer && !this.localServer.running) {
			if (this.localServer.ensureRunning()) this.activity.push({ kind: 'session', text: t('runtime.chatterbox_started') });
		}
		if (this.localBrainRetryTimer) return;
		this.localBrainRetryCount = 0;
		this.localBrainRetryTimer = setInterval(() => {
			void (async () => {
				if (this.brain === 'local' || this.shuttingDown || !this.voice.connected || (this.cfg.brainMode === 'auto' && this.live?.ready)) {
					this.stopLocalBrainRetry();
					return;
				}
				if (++this.localBrainRetryCount > 40) {
					this.stopLocalBrainRetry();
					this.log(t('runtime.local_brain_gave_up'));
					return;
				}
				if (await this.enterLocalBrain(reason, { quiet: true })) this.stopLocalBrainRetry();
			})();
		}, 15_000);
		if (typeof this.localBrainRetryTimer.unref === 'function') this.localBrainRetryTimer.unref();
	}

	stopLocalBrainRetry() {
		if (this.localBrainRetryTimer) clearInterval(this.localBrainRetryTimer);
		this.localBrainRetryTimer = null;
	}

	exitLocalBrain(reason) {
		if (this.brain !== 'local') return;
		this.brain = 'live';
		if (this.sttPollTimer) clearInterval(this.sttPollTimer);
		this.sttPollTimer = null;
		this.segmenter.reset();
		this.interruptLocalSpeech();
		this.localMode = this.localModeBeforeBrain ?? this.cfg.localTtsOn;
		this.localModeBeforeBrain = null;
		this.log(t('runtime.local_brain_off_log', { reason }));
		this.activity.push({ kind: 'session', text: t('runtime.local_brain_off', { reason }) });
	}

	/** A hint for whisper: the character name and the names in the channel (so the transcript gets "Aria" right). */
	sttPrompt() {
		const names = new Set();
		const active = this.persona().name;
		if (active) names.add(active);
		const channelId = this.voice.channelId;
		if (channelId && this.guild) {
			for (const state of this.guild.voiceStates.cache.values()) {
				if (state.channelId !== channelId) continue;
				const member = state.member ?? this.guild.members.cache.get(state.id);
				if (member && !member.user?.bot) names.add(member.displayName);
				if (names.size >= 8) break;
			}
		}
		return [...names].join(', ').slice(0, 200);
	}

	/** An utterance from the local ear: transcript -> record -> voice command -> local brain -> Chatterbox. */
	async onLocalSegment({ userId, pcm, durationMs }) {
		if (this.brain !== 'local') return;
		if (this.cfg.soloUserId && userId !== this.cfg.soloUserId) return;
		let result;
		try {
			result = await this.localStt.transcribe(pcm, { prompt: this.sttPrompt() });
		} catch (err) {
			this.log(t('runtime.local_stt_error', { error: err.message }));
			return;
		}
		const line = result.text;
		if (!line || line.length < 2) return;
		const name = this.nameFor(userId) ?? t('runtime.someone');
		const isOwner = this.isOwnerId(userId);
		this.attribution.noteTranscript(line, { owner: isOwner, id: userId });
		// The turn of this utterance: whoever speaks afterwards does not change this request's owner-gate decision.
		const turn = this.attribution.markTurn();
		const turnDeps = { currentTurn: () => turn };
		this.latency.userSpeechEnd(Date.now());
		if (this.cfg.transcripts) this.log(t('runtime.transcript_user_line', { name, line }));
		this.record({ kind: 'voice', direction: 'in', who: userId, text: line, meta: { source: 'whisper', language: result.language, durationMs } });
		this.recentUserText = `${this.recentUserText} ${line}`.slice(-700).trim();
		this.recentUserTextAt = Date.now();

		// Unambiguous voice commands run here; the brain is only told about it so it does not do the work twice.
		const command = parseVoiceCommand(line, this.store.list(), this.channelLists());
		if (command) {
			try {
				const outcome = await executeAction(command, { ...this.taskDeps, ...turnDeps });
				if (outcome) {
					this.localBrain.note(t('runtime.note_action', { name, text: outcome.text }));
					if (outcome.speak && outcome.text && !outcome.reused) this.enqueueLocalSpeech(outcome.text);
					return;
				}
			} catch (err) {
				this.log(t('runtime.command_error', { error: err.message }));
			}
		}
		const reply = await this.localBrain.handleUtterance({ userName: name, text: line, context: turnDeps });
		if (reply.error) this.log(t('runtime.local_brain_no_reply', { error: reply.error }));
		if (reply.responded && reply.text) this.enqueueLocalSpeech(reply.text);
	}

	// ---------------------------------------------------------------- GPT-Live session

	startLive() {
		if (this.shuttingDown || this.live || this.paused) return;
		if (this.cfg.brainMode === 'local') return; // GPT-Live is never used
		if (this.quotaBlocked && this.quota.status().exceeded) return;
		this.quotaBlocked = false;
		if (this.liveReconnectTimer) {
			clearTimeout(this.liveReconnectTimer);
			this.liveReconnectTimer = null;
		}
		const cfg = this.cfg;
		const current = this.persona();
		const session = new LiveSession({
			apiKey: cfg.openaiApiKey,
			baseURL: cfg.baseURL,
			model: cfg.liveModel,
			voice: current.voice,
			instructions: current.instructions,
			debug: cfg.debug,
			name: current.name,
			// Responses delegation: the tools live in the backend model. When it is off (client delegation) only
			// the regex voice commands and research through the provider work.
			delegationModel: cfg.useResponsesDelegation ? cfg.researchModel : null,
			backendEffort: cfg.backendEffort,
			backendTier: cfg.backendTier,
			tools: toolDefinitions(),
			toolExecutor: async (name, args, meta = {}) => {
				// The gate looks at the moment the tool call was born in (so people cutting in cannot change it).
				const turn = this.turnFor(meta.delegationId);
				return toolOutput(await callTool(name, args, turn ? { ...this.taskDeps, currentTurn: () => turn } : this.taskDeps));
			},
		});
		this.live = session;

		session.on('ready', ({ sessionId }) => {
			this.liveFailures = 0;
			this.lastFatalCode = null;
			this.idle.touch();
			this.quota.sessionStarted();
			this.exitLocalBrain(t('runtime.reason_live_back'));
			this.attribution.resetSession(); // in a new session the audio position starts from 0
			this.activity.push({ kind: 'session', text: t('runtime.live_session_open', { sessionId: sessionId ?? '?' }), meta: { sessionId } });
			this.log(
				t('runtime.live_ready', {
					sessionId,
					model: cfg.liveModel,
					voice: current.voice,
					character: current.name ? t('runtime.live_ready_character', { name: current.name }) : '',
					tools: cfg.useResponsesDelegation ? t('runtime.tools_backend') : t('runtime.tools_client'),
				}),
			);
			if (this.pendingIntro) {
				this.pendingIntro = false;
				session.appendContext('commentary', t('runtime.intro_prompt'));
			} else if (cfg.greetText && !this.greeted) {
				this.greeted = true;
				session.appendContext('instructions', t('runtime.greet_prompt', { text: cfg.greetText }));
				// A nudge: after the instruction a short commentary gets the model talking.
				session.appendContext('commentary', t('runtime.greet_nudge'));
			}
			if (this.music?.playing) session.appendContext('thinking', t('runtime.music_context', { title: this.music.current?.title ?? '' }));
			this.lastAnnouncedUser = null; // a new session: announce the speaker again
			this.memoryHinted.clear();
			this.announceRoster();
		});
		session.on('audio', (buffer) => {
			// In local mode the GPT-Live audio is not used: the text is turned into speech locally.
			if (this.localMode) return;
			const usable = buffer.length & ~1;
			if (usable === 0) return;
			if (buffer.byteOffset % 2 !== 0) buffer = Buffer.from(buffer.subarray(0, usable));
			const samples = new Int16Array(buffer.buffer, buffer.byteOffset, usable >> 1);

			// The model can send audio frames during silence too; real audio is required before it counts as
			// "speaking", otherwise the latency measurement (and the 5 s rule) fires constantly and means nothing.
			if (peakOf(samples) > AUDIO_PEAK_MIN) {
				// The measurement only makes sense for a reply that starts after a silence (full-duplex stream).
				if (Date.now() - this.lastAssistantSpokeAt > SILENCE_GAP_MS) {
					const responseMs = this.latency.assistantAudio();
					if (responseMs !== null && responseMs >= MIN_LOGGED_MS) {
						this.activity.push({
							kind: 'latency',
							whoName: this.persona().name ?? 'bot',
							text: t('runtime.seconds_value', { seconds: (responseMs / 1000).toFixed(1) }),
							meta: { type: t('runtime.latency_kind_response'), note: t('runtime.latency_note_response') },
						});
						this.log(t('runtime.log_latency_response', { seconds: (responseMs / 1000).toFixed(1) }));
					}
				}
				this.lastAssistantSpokeAt = Date.now();
				this.idle.touch(); // while the bot is speaking the session must not count as "idle"
			}
			this.playback.push(samples);
		});
		session.on('transcript', (event) => this.onTranscript(event));
		session.on('tool', (event) => this.onToolEvent(event, 'backend'));
		session.on('backend', ({ ms }) => {
			this.activity.push({
				kind: 'latency',
				whoName: 'backend',
				text: t('runtime.seconds_value', { seconds: (ms / 1000).toFixed(1) }),
				meta: { type: t('runtime.latency_kind_backend') },
			});
			this.log(t('runtime.log_latency_backend', { seconds: (ms / 1000).toFixed(1) }));
		});
		session.on('turn', ({ delegationId = null } = {}) => {
			// The model started replying: from here on, people cutting in do not affect this turn's owner gate.
			this.rememberTurn(delegationId, this.attribution.markTurn());
		});
		session.on('delegation', (delegation) => {
			void this.handleDelegation(delegation);
		});
		session.on('usage', ({ seconds }) => {
			const status = this.quota.report(seconds);
			const minute = Math.floor(seconds / 60);
			if (minute !== this.lastUsageMinute) {
				this.lastUsageMinute = minute;
				this.log(
					t('runtime.live_session_seconds', {
						seconds: Math.round(seconds),
						quota: this.quota.enabled
							? t('runtime.live_session_quota_suffix', { used: Math.round(status.used / 60), limit: Math.round(status.limit / 60) })
							: '',
					}),
				);
			}
			if (this.quota.shouldWarn()) {
				this.notifyOwner(t('runtime.quota_warning', { used: Math.round(status.used / 60), limit: Math.round(status.limit / 60) }));
			}
			if (status.exceeded && !this.quotaBlocked) {
				this.quotaBlocked = true;
				this.activity.push({ kind: 'session', text: t('runtime.quota_exceeded_activity', { limit: Math.round(status.limit / 60) }) });
				this.notifyOwner(t('runtime.quota_exceeded_dm'));
				this.pauseLive(t('runtime.reason_quota_exceeded'));
			}
		});
		session.on('error', (err) => {
			const info = describeLiveError(err);
			this.lastLiveError = err; // if the connection closes next, the retry plan should know the reason
			// Permanent errors are written as one line when the retry is planned; they are not printed again here.
			if (!info.fatal) this.log(t('runtime.live_error', { code: info.code ? ` (${info.code})` : '', message: info.message }));
		});
		session.on('warning', (message) => this.log(t('runtime.live_warning', { message })));
		if (cfg.debug) session.on('debug', (event) => this.log('live>', event.type));

		session.on('closed', ({ code, reason, expected }) => {
			if (this.live !== session) return;
			this.live = null;
			if (expected || this.shuttingDown || this.paused) return;
			this.scheduleLiveRetry(t('runtime.retry_why_closed', { detail: `${code}${reason ? ` ${reason}` : ''}` }), this.lastLiveError);
			this.lastLiveError = null;
		});

		session.connect().catch((err) => {
			if (this.live === session) this.live = null;
			if (this.shuttingDown || this.paused) return;
			this.scheduleLiveRetry(t('runtime.retry_why_connect_failed'), err);
			session.close().catch(() => {});
		});
	}

	/**
	 * The reconnection plan. Temporary errors back off exponentially (1 s -> 30 s); permanent ones (credit,
	 * key) use a 10 min interval, one readable log line and a single DM to the owner (so the log stays clean).
	 */
	scheduleLiveRetry(why, err = null) {
		const info = err ? describeLiveError(err) : null;
		let delay;
		if (info?.fatal) {
			delay = FATAL_RETRY_MS;
			const detail = `${info.code ?? info.type}: ${info.message}`;
			this.log(
				t('runtime.live_retry_fatal', {
					why,
					detail,
					hint: info.hint ? `\n            ${info.hint}` : '',
					minutes: Math.round(delay / 60_000),
				}),
			);
			if (this.lastFatalCode !== info.code) {
				this.lastFatalCode = info.code;
				this.activity.push({ kind: 'session', text: t('runtime.live_fatal_activity', { detail }), meta: { code: info.code, hint: info.hint } });
				this.notifyOwner(
					t('runtime.live_fatal_dm', { code: info.code ?? info.type, message: info.message, hint: info.hint ? `\n${info.hint}` : '' }),
				);
			}
			// Voice chat without OpenAI: fall back to the local brain (whisper + DeepSeek + Chatterbox) when it is ready.
			if (this.cfg.brainMode === 'auto' && this.voice.connected) void this.enterLocalBrain(info.code ?? t('runtime.reason_live_down'));
		} else {
			this.lastFatalCode = null;
			delay = Math.min(30_000, 1000 * 2 ** Math.min(this.liveFailures++, 5));
			const detail = info ? ` (${info.code ? `${info.code}: ` : ''}${info.message})` : '';
			this.log(t('runtime.live_retry_soon', { why, detail, seconds: Math.round(delay / 1000) }));
		}
		if (this.liveReconnectTimer) clearTimeout(this.liveReconnectTimer);
		this.liveReconnectTimer = setTimeout(() => {
			this.liveReconnectTimer = null;
			if (!this.paused) this.startLive();
		}, delay);
		if (info?.fatal && typeof this.liveReconnectTimer.unref === 'function') this.liveReconnectTimer.unref();
	}

	pauseLive(reason) {
		this.paused = true;
		if (this.liveReconnectTimer) {
			clearTimeout(this.liveReconnectTimer);
			this.liveReconnectTimer = null;
		}
		if (!this.live) return;
		const session = this.live;
		this.live = null;
		session.close().catch(() => {});
		this.activity.push({ kind: 'session', text: t('runtime.live_paused', { reason }) });
		this.log(t('runtime.live_paused_log', { reason }));
	}

	resumeLive() {
		if (this.live) return;
		if (this.quotaBlocked) {
			if (this.quota.status().exceeded) return; // stays closed until the day rolls over
			this.quotaBlocked = false;
		}
		this.paused = false;
		this.startLive();
	}

	/** The character changed: the live session is rebuilt with the new instructions. */
	async refreshPersona(reason) {
		const current = this.persona();
		this.log(t('runtime.persona_updated', { reason, name: current.name ?? t('runtime.persona_default') }));
		if (!this.live) {
			if (!this.paused) this.startLive();
			return;
		}
		this.pendingIntro = true;
		const session = this.live;
		this.live = null;
		try {
			await session.close();
		} catch {
			/* ignore */
		}
		if (!this.paused && !this.shuttingDown) this.startLive();
	}

	/** Runs when the model asks for help: local Discord work or web research, with the result going back. */
	async handleDelegation(delegation) {
		const question = this.taskDeps.getUserText();
		this.log(t('runtime.delegation_requested', { id: delegation.id, question: question.slice(0, 140) }));
		this.latency.delegationStart();
		try {
			const answer = await this.runTask();
			const ms = this.latency.delegationDone();
			if (answer.mode !== 'none' && answer.text) this.live?.replyDelegation(delegation.id, answer.text, { mode: answer.mode });
			this.log(
				t('runtime.delegation_answered', {
					id: delegation.id,
					timing: ms === null ? '' : t('runtime.delegation_timing', { seconds: (ms / 1000).toFixed(1) }),
				}),
			);
		} catch (err) {
			this.latency.delegationDone();
			this.log(t('runtime.delegation_error', { error: err.message }));
			this.live?.replyDelegation(delegation.id, t('runtime.delegation_failed_spoken'), { mode: 'commentary' });
		}
	}

	// ---------------------------------------------------------------- turn bookkeeping

	rememberTurn(delegationId, turn) {
		this.lastTurn = turn;
		if (!delegationId) return;
		this.turnsByDelegation.set(String(delegationId), turn);
		while (this.turnsByDelegation.size > TURN_MEMORY) this.turnsByDelegation.delete(this.turnsByDelegation.keys().next().value);
	}

	turnFor(delegationId) {
		if (delegationId && this.turnsByDelegation.has(String(delegationId))) return this.turnsByDelegation.get(String(delegationId));
		return this.lastTurn;
	}

	// ---------------------------------------------------------------- transcript + voice commands

	/**
	 * The transcript arrives late: when the gate cannot find the word it waits at most `maxMs`. It returns
	 * about 300 ms after the newest transcript chunk (once the chunks settle) or when the time is up.
	 */
	awaitTranscript(maxMs = 1500) {
		const startedAt = Date.now();
		return new Promise((resolve) => {
			const poll = () => {
				const now = Date.now();
				if (now - startedAt >= maxMs) return resolve();
				if (this.lastUserDeltaAt > startedAt && now - this.lastUserDeltaAt >= 300) return resolve();
				setTimeout(poll, 100);
			};
			setTimeout(poll, 100);
		});
	}

	onTranscript({ speaker, text, startMs, endMs }) {
		const cfg = this.cfg;
		let spokenId = null;
		if (speaker === 'user') {
			this.attribution.noteTranscript(text, { startMs, endMs });
			this.lastUserDeltaAt = Date.now();
			// Who said it: resolved from the audio position (the arrival time misleads in a busy channel).
			spokenId = this.attribution.speakerIdAt(startMs, endMs);
			// From the audio position to the wall clock: when did the user actually stop speaking?
			const lag = Number.isFinite(endMs) ? Math.max(0, this.attribution.audioMs - endMs) : 0;
			this.latency.userSpeechEnd(Date.now() - lag);
			if (cfg.debug) {
				const st = this.attribution.state();
				this.log(
					t('runtime.log_attribution', {
						start: startMs,
						end: endMs,
						audio: this.attribution.audioMs,
						ownerActive: st.ownerActive,
						ownerText: st.ownerText,
					}),
				);
			}
		}
		let buf = this.transcriptBuffers.get(speaker);
		if (!buf) {
			buf = { text: '', timer: null, speakerId: null, endMs: null };
			this.transcriptBuffers.set(speaker, buf);
		}
		if (spokenId) buf.speakerId = spokenId;
		if (Number.isFinite(endMs)) buf.endMs = endMs;
		buf.text += text;
		if (buf.timer) clearTimeout(buf.timer);
		buf.timer = setTimeout(() => {
			buf.timer = null;
			const line = buf.text.replace(/\s+/g, ' ').trim();
			const speakerId = buf.speakerId ?? this.lastSpeakerId;
			const lineEndMs = buf.endMs;
			buf.text = '';
			buf.speakerId = null; // let the next line work out its own identity
			buf.endMs = null;
			if (!line) return;
			if (cfg.transcripts) this.log(speaker === 'user' ? t('runtime.transcript_in', { line }) : t('runtime.transcript_out', { line }));
			if (speaker === 'user') {
				this.record({ kind: 'voice', direction: 'in', who: speakerId, text: line });
				// If the audio position says the transcript belongs to someone else, send the model a short correction.
				if (cfg.announceSpeaker && speakerId && this.lastAnnouncedUser && String(speakerId) !== String(this.lastAnnouncedUser) && this.live?.ready) {
					const name = this.nameFor(speakerId);
					this.lastAnnouncedUser = String(speakerId);
					this.live.appendContext(
						'instructions',
						t('runtime.speaker_correction', {
							line: line.slice(0, 80),
							name,
							owner: this.isOwnerId(speakerId) ? t('runtime.owner_suffix') : '',
						}),
					);
					if (cfg.transcripts) this.log(t('runtime.log_context_correction', { line: line.slice(0, 40), name }));
				}
				// The user started talking: empty the local audio queue (barge-in).
				this.interruptLocalSpeech();
			} else if (this.localMode) {
				// Local mode: this text is turned into speech by Chatterbox and pushed to Discord.
				this.enqueueLocalSpeech(line);
			} else {
				this.record({ kind: 'voice', direction: 'out', whoName: this.persona().name ?? 'bot', text: line });
			}
			if (speaker !== 'user') return;
			this.recentUserText = `${this.recentUserText} ${line}`.slice(-700).trim();
			this.recentUserTextAt = Date.now();
			this.maybeWakeByVoiceName(line);
			// Unambiguous commands run here even when the model does not delegate; the signature cache stops doubles.
			const command = parseVoiceCommand(line, this.store.list(), this.channelLists());
			if (!command) return;
			// This line's own turn: once the line is over, people cutting in do not affect the gate decision.
			const lineTurn = { at: Date.now(), audioMs: Number.isFinite(lineEndMs) ? lineEndMs : this.attribution.audioMs };
			void executeAction(command, { ...this.taskDeps, currentTurn: () => lineTurn })
				.then((result) => {
					if (result?.speak && result.text && !result.reused) this.say(result.text);
				})
				.catch((err) => this.log(t('runtime.command_error', { error: err.message })));
		}, 1200);
	}

	/** When the bot is called by name in the channel and the model stayed silent, tells it to answer. */
	maybeWakeByVoiceName(line) {
		if (!this.live?.ready) return;
		const now = Date.now();
		if (now - this.lastAssistantSpokeAt < 5000) return; // the model already spoke, or is speaking
		if (now - this.lastWakeNudgeAt < 15_000) return; // do not nudge too often
		const active = this.store.getActive();
		const wakeWords = new Set([active?.name, ...WAKE_WORDS].filter(Boolean).map((word) => normalize(word)).filter(Boolean));
		const tokens = normalize(line).split(' ').filter(Boolean);
		if (!tokens.some((token) => wakeWords.has(token))) return;
		this.lastWakeNudgeAt = now;
		// "Aria?" -> a short answer; "ban Dana, Aria" -> there is a real request, so do not fob it off.
		const rest = tokens.filter((token) => !wakeWords.has(token) && !WAKE_FILLER_WORDS.includes(token));
		if (rest.length <= 1) {
			this.log(t('runtime.log_wake_name_only'));
			this.live.appendContext('instructions', t('runtime.wake_nudge'));
			return;
		}
		this.log(t('runtime.log_wake_request'));
		this.live.appendContext('instructions', t('runtime.wake_nudge_request', { line: line.slice(0, 200) }));
	}

	// ---------------------------------------------------------------- speakers

	trackSentSpeaker({ priority, active, sent }) {
		if (!sent || !this.cfg.announceSpeaker) return;
		const id = priority ? (this.cfg.ownerId ?? active[0] ?? null) : (active[0] ?? null);
		if (!id) {
			// Discord packets arrive with jitter: if a single empty frame reset the counter, the owner would never be "stable".
			if (++this.sentSilentFrames > SPEAKER_GAP_FRAMES) {
				this.sentCandidate = null;
				this.sentCandidateFrames = 0;
			}
			return;
		}
		this.sentSilentFrames = 0;
		if (String(id) === this.sentCandidate) this.sentCandidateFrames++;
		else {
			this.sentCandidate = String(id);
			this.sentCandidateFrames = 1;
		}
		if (this.sentCandidateFrames === SPEAKER_STABLE_FRAMES && this.sentCandidate !== this.lastAnnouncedUser) {
			void this.announceSpeaker(this.sentCandidate);
		}
	}

	/** Tells the model who is speaking: name, whether they are the owner, and (the first time) memory notes.
	 * It is not repeated while the same person keeps talking. */
	async announceSpeaker(userId) {
		if (!this.live?.ready || this.lastAnnouncedUser === userId) return;
		this.lastAnnouncedUser = userId;
		const name = await this.memberName(userId);
		const owner = this.isOwnerId(userId);
		// An "instructions" note: the model takes it as hard fact ("thinking" notes are too weak in conversation).
		const lines = [
			t('runtime.speaker_context', {
				name,
				ownerNote: owner ? t('runtime.speaker_context_owner') : '',
				ownerAnswer: owner ? t('runtime.speaker_context_owner_answer') : '',
			}),
		];
		if (this.memory && !this.memoryHinted.has(userId)) {
			const summary = this.memory.summaryFor(userId);
			if (summary) {
				this.memoryHinted.add(userId);
				lines.push(t('runtime.memory_notes', { name, summary }));
			}
		}
		this.live.appendContext('instructions', lines.join('\n'));
		if (this.cfg.transcripts) this.log(t('runtime.log_context_speaker', { name, owner: owner ? t('runtime.owner_tag') : '' }));
	}

	/** Tells the model who is in the channel (when the session opens and on joins/leaves). */
	announceRoster(prefix = t('runtime.roster_prefix')) {
		if (!this.live?.ready || !this.voice.channelId || !this.guild) return;
		const names = [];
		for (const state of this.guild.voiceStates.cache.values()) {
			if (state.channelId !== this.voice.channelId) continue;
			const member = state.member ?? this.guild.members.cache.get(state.id);
			if (!member || member.user?.bot) continue;
			names.push(`${member.displayName}${this.isOwnerId(member.id) ? t('runtime.owner_suffix') : ''}`);
		}
		if (!names.length) return;
		this.live.appendContext('instructions', t('runtime.roster_context', { prefix, names: names.join(', ') }));
		if (this.cfg.transcripts) this.log(t('runtime.log_context_roster', { names: names.join(', ') }));
	}

	/** If memory holds notes about the speaker, tell the model once, quietly (even when announce is off). */
	async hintMemory(userId) {
		if (!this.memory || !this.live?.ready || this.memoryHinted.has(userId)) return;
		const summary = this.memory.summaryFor(userId);
		if (!summary) return;
		this.memoryHinted.add(userId);
		const name = await this.memberName(userId);
		this.live.appendContext('thinking', t('runtime.memory_notes', { name, summary }));
	}

	// ---------------------------------------------------------------- voice channel

	scheduleTimer(fn, delayMs) {
		const timer = setTimeout(() => {
			this.rejoinTimers.delete(timer);
			fn();
		}, delayMs);
		if (typeof timer.unref === 'function') timer.unref();
		this.rejoinTimers.add(timer);
		return timer;
	}

	clearRejoinTimers() {
		for (const timer of this.rejoinTimers) clearTimeout(timer);
		this.rejoinTimers.clear();
	}

	/** When the bot left the channel on its own it tries to come back shortly after (no one-way door). */
	scheduleRejoin(targetId, delays, label) {
		for (const delayMs of delays) {
			this.scheduleTimer(() => {
				void (async () => {
					if (this.shuttingDown || this.voice.connected || this.lastVoiceChannelId !== targetId) return;
					const channel = this.guild?.channels.cache.get(targetId);
					if (!channel) return;
					this.log(`${label} (${channel.name}).`);
					try {
						await this.joinVoice(channel);
					} catch (err) {
						this.log(t('runtime.rejoin_failed', { error: err.message }));
					}
				})();
			}, delayMs);
		}
	}

	async joinVoice(channel) {
		this.clearRejoinTimers();
		await this.voice.join(this.guild, channel);
		this.lastVoiceChannelId = channel.id;
		this.memoryHinted.clear();
		if (this.cfg.brainMode === 'local') void this.enterLocalBrain('BRAIN_MODE=local');
		else this.resumeLive();
		this.activity.push({ kind: 'session', text: t('runtime.joined_voice', { channel: channel.name }), meta: { channel: channel.name } });
		if (this.cfg.joinNotice && this.cfg.textChannelId) {
			const textChannel = this.guild?.channels.cache.get(this.cfg.textChannelId);
			textChannel
				?.send({
					content: t('runtime.join_notice', {
						channel: channel.name,
						recording: this.cfg.recordTranscripts ? t('runtime.join_notice_recording_on') : t('runtime.join_notice_recording_off'),
					}),
					allowedMentions: { parse: [] },
				})
				.catch(() => {});
		}
	}

	async leaveVoice({ permanent = false } = {}) {
		this.clearRejoinTimers();
		this.music?.stop();
		this.exitLocalBrain(t('runtime.reason_left_voice'));
		await this.voice.destroy();
		this.pauseLive(t('runtime.reason_left_voice'));
		this.activity.push({ kind: 'session', text: permanent ? t('runtime.left_voice_permanent') : t('runtime.left_voice_temporary') });
		// If the owner did not throw it out (the model left on its own) it comes back; a permanent exit sets no timer.
		if (permanent) this.lastVoiceChannelId = null;
		else if (this.lastVoiceChannelId) this.scheduleRejoin(this.lastVoiceChannelId, REJOIN_DELAYS_MS, t('runtime.rejoin_label_return'));
	}

	/** Somebody moved in or out of the bot's channel (Discord event): drop their audio and tell the model. */
	onVoiceStateUpdate(oldState, newState) {
		const botChannelId = this.voice.channelId;
		if (!botChannelId || !oldState?.id) return;
		const member = newState.member ?? oldState.member ?? this.guild?.members.cache.get(oldState.id);
		if (member?.user?.bot) return;
		const name = member?.displayName ?? this.nameFor(oldState.id);
		// The user left the bot's channel: drop the audio subscription and buffer (no leak), and tell the model.
		if (oldState.channelId === botChannelId && newState.channelId !== botChannelId) {
			this.voice.dropUser(oldState.id);
			if (this.lastAnnouncedUser === oldState.id) this.lastAnnouncedUser = null;
			this.live?.appendContext('thinking', t('runtime.member_left_voice', { name }));
		} else if (newState.channelId === botChannelId && oldState.channelId !== botChannelId) {
			this.live?.appendContext(
				'thinking',
				t('runtime.member_joined_voice', { name, owner: this.isOwnerId(oldState.id) ? t('runtime.owner_suffix') : '' }),
			);
		}
	}

	// ---------------------------------------------------------------- settings

	/**
	 * The settings the owner is allowed to change (in memory; a restart brings the .env values back).
	 * Returns: the new value, null (unknown setting) or { ok:false, spoken } (could not be applied).
	 */
	async applySetting(name, value) {
		const cfg = this.cfg;
		const alias = normalize(String(name ?? '')).replace(/ /g, '_');
		const key = SETTING_ALIASES[alias] ?? alias;
		const asBool = (input, fallback) => parseBool(input, fallback);
		switch (key) {
			case 'transcripts':
				cfg.transcripts = asBool(value, cfg.transcripts);
				return cfg.transcripts;
			case 'announce_speaker':
				cfg.announceSpeaker = asBool(value, cfg.announceSpeaker);
				return cfg.announceSpeaker;
			case 'owner_priority':
				cfg.ownerPriority = asBool(value, cfg.ownerPriority);
				this.mixer.setPriority(cfg.ownerPriority ? cfg.ownerId : null);
				return cfg.ownerPriority;
			case 'idle_close_minutes':
				cfg.idleCloseMs = Math.max(0, Number(value) || 0) * 60_000;
				this.idle.idleMs = cfg.idleCloseMs;
				return Math.round(cfg.idleCloseMs / 60_000);
			case 'record':
				cfg.recordTranscripts = asBool(value, cfg.recordTranscripts);
				this.activity.push({ kind: 'session', text: cfg.recordTranscripts ? t('runtime.record_on') : t('runtime.record_off') });
				return cfg.recordTranscripts;
			case 'local_tts': {
				if (this.brain === 'local') return { ok: false, spoken: t('runtime.local_brain_busy') };
				const enabled = asBool(value, !this.localMode);
				const result = await this.setLocalMode(enabled);
				return result.ok ? result.value : { ok: false, spoken: result.reason };
			}
			case 'brain': {
				const raw = normalize(String(value ?? ''));
				const wanted = tList('runtime.brain_local_words').includes(raw)
					? 'local'
					: tList('runtime.brain_live_words').includes(raw)
						? 'live'
						: tList('runtime.brain_auto_words').includes(raw)
							? 'auto'
							: null;
				if (!wanted) return { ok: false, spoken: t('runtime.brain_setting_help') };
				cfg.brainMode = wanted;
				if (wanted === 'local') {
					const ok = await this.enterLocalBrain(t('runtime.reason_setting'));
					if (!ok) return { ok: false, spoken: t('runtime.brain_local_failed') };
					this.pauseLive(t('runtime.reason_local_brain_selected'));
					return t('runtime.brain_value_local');
				}
				this.exitLocalBrain(wanted === 'auto' ? t('runtime.reason_auto_mode') : t('runtime.reason_live_selected'));
				if (!this.live) this.resumeLive();
				return wanted === 'auto' ? t('runtime.brain_value_auto') : t('runtime.brain_value_live');
			}
			default:
				return null;
		}
	}

	// ---------------------------------------------------------------- lifecycle

	/**
	 * Brings this guild up: join the configured voice channel, warm the message baseline, load the member
	 * index (and keep it fresh), and watch for an idle live session.
	 */
	async start() {
		const cfg = this.cfg;
		if (cfg.channelId) {
			const channel = await this.guild.channels.fetch(cfg.channelId).catch(() => null);
			if (channel?.isVoiceBased()) {
				await this.joinVoice(channel);
				this.log(t('boot.joined_channel', { channel: channel.name }));
			} else {
				this.log(t('boot.voice_channel_missing', { channel: cfg.channelId }));
			}
		}

		const textChannels = [...this.guild.channels.cache.values()].filter((channel) => channel.type === ChannelType.GuildText);
		await this.reader.warmUp(textChannels);
		this.log(t('boot.message_baseline', { count: textChannels.length }));

		this.memberIndex.selfId = this.client.user.id;
		try {
			await this.memberIndex.load({ token: cfg.discordToken, guildId: this.guild.id, log: this.log });
		} catch (err) {
			this.log(t('boot.member_index_failed', { error: err.message }));
		}
		this.memberRefreshTimer = setInterval(
			() => {
				void this.memberIndex
					.load({ token: cfg.discordToken, guildId: this.guild.id })
					.then(() => {
						this.memberNameMap = null;
					})
					.catch(() => {});
			},
			30 * 60_000,
		);
		if (typeof this.memberRefreshTimer.unref === 'function') this.memberRefreshTimer.unref();

		if (cfg.idleCloseMs > 0) {
			this.idleTimer = setInterval(() => {
				if (this.paused || !this.idle.shouldPause(Boolean(this.live))) return;
				this.log(t('runtime.idle_close'));
				this.pauseLive(t('runtime.reason_idle'));
			}, 30_000);
		}
	}

	/** The per-guild dependencies handed to callTool / executeAction / the task runner. */
	deps() {
		return this.taskDeps;
	}

	/** What /status and the panel read: one snapshot of this guild's session. */
	status() {
		return {
			personaName: this.persona().name,
			voiceConnected: this.voice.connected,
			voiceChannelName: this.voice.channelId ? (this.guild?.channels.cache.get(this.voice.channelId)?.name ?? null) : null,
			brain: this.brain,
			liveReady: Boolean(this.live?.ready),
			localMode: this.localMode,
			paused: this.paused,
			latency: this.latency.summary(),
			memberIndexSize: this.memberIndex.size ?? 0,
			music: this.music
				? { playing: this.music.playing, queue: this.music.queue.length, text: this.music.nowPlayingText(), volume: this.music.volume }
				: null,
		};
	}

	/** Stops every timer this guild owns and silences it; safe to call more than once. */
	stop() {
		this.shuttingDown = true;
		if (this.liveReconnectTimer) clearTimeout(this.liveReconnectTimer);
		this.liveReconnectTimer = null;
		if (this.idleTimer) clearInterval(this.idleTimer);
		this.idleTimer = null;
		if (this.memberRefreshTimer) clearInterval(this.memberRefreshTimer);
		this.memberRefreshTimer = null;
		if (this.sttPollTimer) clearInterval(this.sttPollTimer);
		this.sttPollTimer = null;
		this.stopLocalBrainRetry();
		this.clearRejoinTimers();
		this.interruptLocalSpeech();
		try {
			this.music?.destroy();
		} catch {
			/* ignore */
		}
	}

	/** stop(), and then leave the voice channel and close the live session. */
	async dispose() {
		this.stop();
		try {
			await this.voice.destroy();
		} catch {
			/* ignore */
		}
		try {
			if (this.live) await this.live.close();
		} catch {
			/* ignore */
		}
	}
}
