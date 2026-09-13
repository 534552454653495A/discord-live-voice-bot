// Discord voice bot: joins a channel, listens to whoever is speaking, holds a spoken conversation
// over GPT-Live, and is driven from slash commands and the panel; voice commands (switch character,
// send a message to a channel, join a channel, play music) let it operate Discord.
//
//   channel -> per-user Opus -> decode -> mono 24k -> mixer -> GPT-Live (gpt-live-1)
//   channel <- Opus encode <- 48k stereo <- [bot audio + ducked music] <- playback / music
//
// Slash commands: join, leave, panel, character, send, read, status, music, summary, record, help

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, ChannelType, Events, GatewayIntentBits, Partials } from 'discord.js';
import { OpenAI } from 'openai';
import { createTaskRunner, executeAction } from './agent.js';
import { FRAME_MS, PlaybackQueue, SpeakerMixer, peakOf } from './audio.js';
import { SpeakerAttribution } from './attribution.js';
import { handleInteraction, parseVoiceCommand, RecentActions, registerCommands } from './commands.js';
import { loadConfig } from './config.js';
import { t, tList, tRaw } from './i18n/index.js';
import { IdleGovernor } from './idle.js';
import { LatencyMeter } from './latency.js';
import { LiveSession, describeLiveError } from './live.js';
import { LocalBrain } from './localbrain.js';
import { LocalServerManager, detectVenvPython } from './localserver.js';
import { LocalStt, SpeechSegmenter } from './localstt.js';
import { LocalTts, splitSentences } from './localtts.js';
import { MemberIndex } from './matcher.js';
import { MemoryStore } from './memory.js';
import { ReplyLimiter, handleMessage } from './messages.js';
import { Ducker, MusicPlayer } from './music.js';
import { ActivityLog, startPanel } from './panel.js';
import { createTextProvider } from './provider.js';
import { DailyQuota } from './quota.js';
import { ChannelReader } from './reader.js';
import { CharacterStore } from './store.js';
import { summarizeConversation } from './summary.js';
import { normalize, parseBool, stripDictationTail } from './text.js';
import { callTool, toolDefinitions, toolOutput } from './tools.js';
import { VoiceSession } from './voice.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');

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

const startedAt = Date.now();

let cfg;
try {
	cfg = loadConfig();
} catch (err) {
	console.error(t('boot.config_failed', { error: err.message }));
	process.exit(1);
}

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...args) => console.log(`[${stamp()}]`, ...args);

const store = await new CharacterStore(path.join(dataDir, 'characters.json'), { log }).load();
const memory = cfg.memoryEnabled ? await new MemoryStore(path.join(dataDir, 'memory.json')).load() : null;
const quota = await new DailyQuota({ limitSeconds: cfg.dailyLiveSeconds, file: path.join(dataDir, 'quota.json') }).load();
const mixer = new SpeakerMixer();
if (cfg.ownerPriority && cfg.ownerId) mixer.setPriority(cfg.ownerId);
const playback = new PlaybackQueue();
const idle = new IdleGovernor({ idleMs: cfg.idleCloseMs });
const recentActions = new RecentActions();
const reader = new ChannelReader({ defaultLimit: cfg.readLimit });
const memberIndex = new MemberIndex();
const attribution = new SpeakerAttribution({ ownerId: cfg.ownerId, frameMs: FRAME_MS });
const latency = new LatencyMeter();
const replyLimiter = new ReplyLimiter({ perMinute: 6 });
// The event stream the panel shows: voice transcripts, DM/channel messages, tool calls, gate decisions.
const activity = new ActivityLog({ file: path.join(dataDir, 'activity.jsonl'), log });

/** Privacy: while recording is off, personal text (voice transcript, DM, channel message) is counted, not stored. */
function record(event) {
	if (!cfg.recordTranscripts && ['voice', 'dm', 'channel'].includes(event.kind) && event.text) {
		return activity.push({ ...event, text: t('runtime.record_off_placeholder', { count: String(event.text).length }), meta: null, persist: false });
	}
	return activity.push(event);
}

// ---------------------------------------------------------------- music
const music = cfg.musicEnabled
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
const ducker = new Ducker({ duck: music ? music.duckRatio : 0.12, holdMs: cfg.musicDuckHoldMs, frameMs: FRAME_MS });

// ---------------------------------------------------------------- local TTS
// Local TTS (Chatterbox): while it is on the GPT-Live audio is not pushed to Discord; the text is
// turned into speech locally instead.
const localTts = new LocalTts({
	url: cfg.localTtsUrl,
	voiceRef: cfg.localTtsVoice,
	languageId: cfg.localTtsLang,
	log: (message) => cfg.debug && log(message),
});
let localMode = cfg.localTtsOn;
let ttsPending = '';
let ttsFlushTimer = null;
const ttsQueue = [];
let ttsBusy = false;
let ttsAbort = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Empties the local audio queue and cancels the generation in flight: the bot goes quiet when cut off. */
function interruptLocalSpeech() {
	ttsPending = '';
	ttsQueue.length = 0;
	if (ttsFlushTimer) {
		clearTimeout(ttsFlushTimer);
		ttsFlushTimer = null;
	}
	if (ttsAbort) {
		ttsAbort.abort();
		ttsAbort = null;
	}
	if (localMode) playback.clear();
}

/** Splits the model's spoken text into sentences and turns them into audio (local mode). */
function enqueueLocalSpeech(text) {
	ttsPending += text;
	const { sentences, rest } = splitSentences(ttsPending);
	ttsPending = rest;
	for (const sentence of sentences) if (sentence) ttsQueue.push(sentence);
	if (ttsFlushTimer) clearTimeout(ttsFlushTimer);
	ttsFlushTimer = null;
	if (ttsPending.trim()) {
		// A tail left without punctuation: speak it as it is after a short silence.
		ttsFlushTimer = setTimeout(() => {
			ttsFlushTimer = null;
			const tail = ttsPending.trim();
			ttsPending = '';
			if (tail) {
				ttsQueue.push(tail);
				if (!ttsBusy) void runTtsQueue();
			}
		}, TTS_FLUSH_MS);
	}
	if (ttsQueue.length && !ttsBusy) void runTtsQueue();
}

async function runTtsQueue() {
	if (ttsBusy) return;
	ttsBusy = true;
	try {
		while (ttsQueue.length) {
			const sentence = ttsQueue.shift();
			const controller = new AbortController();
			ttsAbort = controller;
			try {
				const { pcm, language } = await localTts.speak(sentence, { signal: controller.signal });
				if (controller.signal.aborted || !pcm.length) continue;
				// Back pressure: wait until the queue has room (the old 2 s buffer swallowed the start of a sentence).
				let offset = 0;
				while (offset < pcm.length && !controller.signal.aborted && localMode) {
					const room = playback.free;
					if (room < playback.frameSamples) {
						await sleep(100);
						continue;
					}
					const chunk = pcm.subarray(offset, Math.min(pcm.length, offset + room));
					playback.push(chunk);
					offset += chunk.length;
				}
				if (controller.signal.aborted) continue;
				lastAssistantSpokeAt = Date.now();
				record({
					kind: 'voice',
					direction: 'out',
					whoName: persona().name ?? 'bot',
					text: sentence,
					meta: { source: t('runtime.meta_voice_local'), language },
				});
			} catch (err) {
				if (!controller.signal.aborted) log(t('runtime.local_tts_failed', { error: err.message }));
			} finally {
				if (ttsAbort === controller) ttsAbort = null;
			}
		}
	} finally {
		ttsBusy = false;
	}
}

// ---------------------------------------------------------------- text provider
const openai = new OpenAI({ apiKey: cfg.openaiApiKey, ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}) });
const provider = createTextProvider({
	openai,
	textModel: cfg.textModel,
	deepseek: cfg.deepseekApiKey
		? { client: new OpenAI({ apiKey: cfg.deepseekApiKey, baseURL: cfg.deepseekBaseUrl }), model: cfg.deepseekModel }
		: null,
	log,
});

// ---------------------------------------------------------------- local brain (voice chat without OpenAI)
// ears = whisper (/stt on the Chatterbox server), brain = DeepSeek/OpenAI chat + tools, mouth = Chatterbox.
let brain = 'live'; // 'live' | 'local'
let sttPollTimer = null;
let localModeBeforeBrain = null;
let localBrainWarnedAt = 0;
let localBrainRetryTimer = null;
let localBrainRetryCount = 0;
// The Chatterbox server (TTS + whisper): the bot starts it itself when it is needed.
const localServer = cfg.localTtsAutostart
	? new LocalServerManager({
			python: cfg.localTtsPython ?? detectVenvPython(path.join(here, '..')),
			script: path.join(here, '..', 'tools', 'chatterbox_server.py'),
			args: ['--port', String(safePort(cfg.localTtsUrl, 8020)), '--model', cfg.localTtsModel, '--stt', cfg.localSttModel],
			cwd: path.join(here, '..'),
			log,
		})
	: null;

function safePort(url, fallback) {
	try {
		return Number(new URL(url).port) || fallback;
	} catch {
		return fallback;
	}
}
const localStt = new LocalStt({ url: cfg.localSttUrl, language: cfg.localSttLang, log: (message) => cfg.debug && log(message) });
const segmenter = new SpeechSegmenter();
const localBrain = new LocalBrain({
	provider,
	persona: () => ({ name: persona().name, instructions: persona().instructions }),
	tools: toolDefinitions(),
	// context = the dependencies specific to this utterance (the owner-gate turn); the shared taskDeps otherwise.
	callTool: (name, args, context) => callTool(name, args, context ? { ...taskDeps, ...context } : taskDeps),
	toolOutput,
	respondPolicy: cfg.localBrainRespond,
	participants: () => humansInVoice(),
	log,
});

let recentUserText = '';
let recentUserTextAt = 0;
let lastAssistantSpokeAt = 0;
let lastWakeNudgeAt = 0;

let client = null;
let guild = null;
let live = null;
let panel = null;
let memberNameMap = null;

/** Used to show who is speaking in the panel: the live cache first, then the member index. */
function nameFor(userId) {
	if (!userId) return null;
	const cached = guild?.members.cache.get(userId)?.displayName;
	if (cached) return cached;
	if (!memberNameMap) {
		memberNameMap = new Map((memberIndex.list?.() ?? []).map((entry) => [entry.id, entry.display]));
	}
	return memberNameMap.get(userId) ?? memory?.nameFor(userId) ?? `id:${userId}`;
}
let liveReconnectTimer = null;
let liveFailures = 0;
let lastFatalCode = null; // tell the owner about the same permanent error only once
let lastLiveError = null; // the reason for the 'closed' that follows an 'error' event
let lastAnnouncedUser = null;
let lastVoiceChannelId = null;
let lastSpeakerId = null;
let lastUsageMinute = -1;
let greeted = false;
let pendingIntro = false;
let idleTimer = null;
let paused = false;
let quotaBlocked = false;
let shuttingDown = false;
const rejoinTimers = new Set();
const memoryHinted = new Set();

function scheduleTimer(fn, delayMs) {
	const timer = setTimeout(() => {
		rejoinTimers.delete(timer);
		fn();
	}, delayMs);
	if (typeof timer.unref === 'function') timer.unref();
	rejoinTimers.add(timer);
	return timer;
}

function clearRejoinTimers() {
	for (const timer of rejoinTimers) clearTimeout(timer);
	rejoinTimers.clear();
}

// ---------------------------------------------------------------- character / session

function persona() {
	const character = store.getActive();
	return {
		name: character?.name ?? null,
		instructions: character?.prompt?.trim() || cfg.instructions,
		voice: character?.voice || cfg.liveVoice,
	};
}

/** How many humans are in the bot's voice channel (for the local brain's "who do I answer" decision). */
function humansInVoice() {
	const channelId = voice.channelId;
	if (!channelId || !guild) return 1;
	let count = 0;
	for (const state of guild.voiceStates.cache.values()) {
		if (state.channelId !== channelId) continue;
		const member = state.member ?? guild.members.cache.get(state.id);
		if (member?.user?.bot) continue;
		count++;
	}
	return Math.max(1, count);
}

/** Writes a tool event to the panel/log (the GPT-Live backend and the local brain share this path). */
function onToolEvent({ name, args, output, ms }, source = 'backend') {
	latency.toolDone(ms);
	let ok = true;
	try {
		ok = JSON.parse(output).ok !== false;
	} catch {
		/* ignore */
	}
	activity.push({
		kind: 'tool',
		whoName: persona().name ?? 'bot',
		text:
			`${name} ${ok ? t('runtime.tool_ok') : t('runtime.tool_failed')}` +
			`${Number.isFinite(ms) ? t('runtime.tool_timing', { seconds: (ms / 1000).toFixed(1) }) : ''}`,
		meta: { tool: name, ok, ms, source, args: JSON.stringify(args ?? {}).slice(0, 300), result: String(output).slice(0, 200) },
	});
	// A message a tool wrote to a channel/DM should show up in the panel as a conversation line too.
	if (ok && (name === 'send_message' || name === 'send_dm') && args?.text) {
		record({
			kind: name === 'send_dm' ? 'dm' : 'channel',
			direction: 'out',
			whoName: persona().name ?? 'bot',
			text: stripDictationTail(String(args.text)),
			meta: name === 'send_dm' ? { to: args.to ?? null } : { channel: args.channel ? `#${args.channel}` : null },
		});
	}
	const timing = Number.isFinite(ms) ? t('runtime.tool_timing', { seconds: (ms / 1000).toFixed(1) }) : '';
	if (!ok) log(t('runtime.log_tool_failed', { name, timing, output: String(output).slice(0, 160) }));
	else if (ms > 1500) log(t('runtime.log_tool_slow', { name, timing }));
}

/**
 * Switches over to the local brain, if Chatterbox (TTS + /stt) and a text model are ready. When it cannot,
 * it says why -- once.
 * @returns {Promise<boolean>}
 */
async function enterLocalBrain(reason, { quiet = false } = {}) {
	if (brain === 'local') return true;
	const [tts, stt] = await Promise.all([localTts.health(), localStt.health()]);
	const problems = [];
	if (!localBrain.available) problems.push(t('runtime.local_brain_no_text_model'));
	const serverProblem = !tts?.ok || !stt?.sttReady;
	if (!tts) problems.push(t('runtime.local_brain_server_down'));
	else if (!tts.ok) problems.push(t('runtime.local_brain_server_loading', { status: tts.status ?? '…' }));
	if (tts && !stt?.sttReady) problems.push(t('runtime.local_brain_no_stt'));
	if (problems.length) {
		if (serverProblem && localBrain.available) scheduleLocalBrainRetry(reason);
		if (!quiet && Date.now() - localBrainWarnedAt > 10 * 60_000) {
			localBrainWarnedAt = Date.now();
			const hint = localServer
				? localServer.running
					? t('runtime.local_brain_hint_started')
					: t('runtime.local_brain_hint_status', { status: localServer.status })
				: t('runtime.local_brain_hint_manual');
			log(t('runtime.local_brain_not_yet', { reason, problems: problems.join('; '), hint }));
			activity.push({ kind: 'session', text: t('runtime.local_brain_failed', { problems: problems.join('; ') }) });
		}
		return false;
	}
	stopLocalBrainRetry();
	brain = 'local';
	localModeBeforeBrain = localMode;
	localMode = true; // the mouth is Chatterbox
	localBrain.reset();
	segmenter.reset();
	if (sttPollTimer) clearInterval(sttPollTimer);
	sttPollTimer = setInterval(() => segmenter.poll(), 100);
	if (typeof sttPollTimer.unref === 'function') sttPollTimer.unref();
	const text = t('runtime.local_brain_active', { reason, stt: stt.stt, brain: provider.describe().split(' —')[0], tts: tts.model });
	log(text);
	activity.push({ kind: 'session', text });
	return true;
}

/**
 * While Chatterbox is not ready: start the server (when there is one) and retry every 15 s until it is
 * (at most 40 attempts, about 10 min; loading the model takes 1-2 min).
 */
function scheduleLocalBrainRetry(reason) {
	if (localServer && !localServer.running) {
		if (localServer.ensureRunning()) activity.push({ kind: 'session', text: t('runtime.chatterbox_started') });
	}
	if (localBrainRetryTimer) return;
	localBrainRetryCount = 0;
	localBrainRetryTimer = setInterval(() => {
		void (async () => {
			if (brain === 'local' || shuttingDown || !voice.connected || (cfg.brainMode === 'auto' && live?.ready)) {
				stopLocalBrainRetry();
				return;
			}
			if (++localBrainRetryCount > 40) {
				stopLocalBrainRetry();
				log(t('runtime.local_brain_gave_up'));
				return;
			}
			if (await enterLocalBrain(reason, { quiet: true })) stopLocalBrainRetry();
		})();
	}, 15_000);
	if (typeof localBrainRetryTimer.unref === 'function') localBrainRetryTimer.unref();
}

function stopLocalBrainRetry() {
	if (localBrainRetryTimer) clearInterval(localBrainRetryTimer);
	localBrainRetryTimer = null;
}

function exitLocalBrain(reason) {
	if (brain !== 'local') return;
	brain = 'live';
	if (sttPollTimer) clearInterval(sttPollTimer);
	sttPollTimer = null;
	segmenter.reset();
	interruptLocalSpeech();
	localMode = localModeBeforeBrain ?? cfg.localTtsOn;
	localModeBeforeBrain = null;
	log(t('runtime.local_brain_off_log', { reason }));
	activity.push({ kind: 'session', text: t('runtime.local_brain_off', { reason }) });
}

/** An utterance from the local ear: transcript -> record -> voice command -> local brain -> Chatterbox. */
async function onLocalSegment({ userId, pcm, durationMs }) {
	if (brain !== 'local') return;
	if (cfg.soloUserId && userId !== cfg.soloUserId) return;
	let result;
	try {
		result = await localStt.transcribe(pcm, { prompt: sttPrompt() });
	} catch (err) {
		log(t('runtime.local_stt_error', { error: err.message }));
		return;
	}
	const line = result.text;
	if (!line || line.length < 2) return;
	const name = nameFor(userId) ?? t('runtime.someone');
	const isOwner = Boolean(cfg.ownerId && String(userId) === String(cfg.ownerId));
	attribution.noteTranscript(line, { owner: isOwner, id: userId });
	// The turn of this utterance: whoever speaks afterwards does not change this request's owner-gate decision.
	const turn = attribution.markTurn();
	const turnDeps = { currentTurn: () => turn };
	latency.userSpeechEnd(Date.now());
	if (cfg.transcripts) log(t('runtime.transcript_user_line', { name, line }));
	record({ kind: 'voice', direction: 'in', who: userId, text: line, meta: { source: 'whisper', language: result.language, durationMs } });
	recentUserText = `${recentUserText} ${line}`.slice(-700).trim();
	recentUserTextAt = Date.now();

	// Unambiguous voice commands run here; the brain is only told about it so it does not do the work twice.
	const command = parseVoiceCommand(line, store.list(), channelLists());
	if (command) {
		try {
			const outcome = await executeAction(command, { ...taskDeps, ...turnDeps });
			if (outcome) {
				localBrain.note(t('runtime.note_action', { name, text: outcome.text }));
				if (outcome.speak && outcome.text && !outcome.reused) enqueueLocalSpeech(outcome.text);
				return;
			}
		} catch (err) {
			log(t('runtime.command_error', { error: err.message }));
		}
	}
	const reply = await localBrain.handleUtterance({ userName: name, text: line, context: turnDeps });
	if (reply.error) log(t('runtime.local_brain_no_reply', { error: reply.error }));
	if (reply.responded && reply.text) enqueueLocalSpeech(reply.text);
}

// Barge-in with the local brain: only while the bot is REALLY speaking (audio is playing) and the user
// has been talking for about 0.8 s without a break. Nothing is cancelled while generation is still under
// way (no audio yet); otherwise a 15 s Chatterbox render is thrown away on every interruption and the
// bot never gets to speak at all.
const BARGE_IN_MS = 1200;
segmenter.on('start', ({ userId }) => {
	lastSpeakerId = userId;
	idle.touch();
	if (playback.length === 0) return; // the bot is not playing: let any generation carry on
	setTimeout(() => {
		if (!segmenter.speakingUsers.includes(userId)) return; // a short noise (a cough, a click)
		if (playback.length === 0) return;
		log(t('runtime.barge_in'));
		interruptLocalSpeech();
	}, BARGE_IN_MS);
});

/** A hint for whisper: the character name and the names in the channel (so the transcript gets "Aria" right). */
function sttPrompt() {
	const names = new Set();
	const active = persona().name;
	if (active) names.add(active);
	const channelId = voice.channelId;
	if (channelId && guild) {
		for (const state of guild.voiceStates.cache.values()) {
			if (state.channelId !== channelId) continue;
			const member = state.member ?? guild.members.cache.get(state.id);
			if (member && !member.user?.bot) names.add(member.displayName);
			if (names.size >= 8) break;
		}
	}
	return [...names].join(', ').slice(0, 200);
}
segmenter.on('segment', (segment) => void onLocalSegment(segment));
localBrain.on('tool', (event) => onToolEvent(event, t('runtime.source_local_brain')));

function startLive() {
	if (shuttingDown || live || paused) return;
	if (cfg.brainMode === 'local') return; // GPT-Live is never used
	if (quotaBlocked && quota.status().exceeded) return;
	quotaBlocked = false;
	if (liveReconnectTimer) {
		clearTimeout(liveReconnectTimer);
		liveReconnectTimer = null;
	}
	const current = persona();
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
			const turn = turnFor(meta.delegationId);
			return toolOutput(await callTool(name, args, turn ? { ...taskDeps, currentTurn: () => turn } : taskDeps));
		},
	});
	live = session;

	session.on('ready', ({ sessionId }) => {
		liveFailures = 0;
		lastFatalCode = null;
		idle.touch();
		quota.sessionStarted();
		exitLocalBrain(t('runtime.reason_live_back'));
		attribution.resetSession(); // in a new session the audio position starts from 0
		activity.push({ kind: 'session', text: t('runtime.live_session_open', { sessionId: sessionId ?? '?' }), meta: { sessionId } });
		log(
			t('runtime.live_ready', {
				sessionId,
				model: cfg.liveModel,
				voice: current.voice,
				character: current.name ? t('runtime.live_ready_character', { name: current.name }) : '',
				tools: cfg.useResponsesDelegation ? t('runtime.tools_backend') : t('runtime.tools_client'),
			}),
		);
		if (pendingIntro) {
			pendingIntro = false;
			session.appendContext('commentary', t('runtime.intro_prompt'));
		} else if (cfg.greetText && !greeted) {
			greeted = true;
			session.appendContext('instructions', t('runtime.greet_prompt', { text: cfg.greetText }));
			// A nudge: after the instruction a short commentary gets the model talking.
			session.appendContext('commentary', t('runtime.greet_nudge'));
		}
		if (music?.playing) session.appendContext('thinking', t('runtime.music_context', { title: music.current?.title ?? '' }));
		lastAnnouncedUser = null; // a new session: announce the speaker again
		memoryHinted.clear();
		announceRoster();
	});
	session.on('audio', (buffer) => {
		// In local mode the GPT-Live audio is not used: the text is turned into speech locally.
		if (localMode) return;
		const usable = buffer.length & ~1;
		if (usable === 0) return;
		if (buffer.byteOffset % 2 !== 0) buffer = Buffer.from(buffer.subarray(0, usable));
		const samples = new Int16Array(buffer.buffer, buffer.byteOffset, usable >> 1);

		// The model can send audio frames during silence too; real audio is required before it counts as
		// "speaking", otherwise the latency measurement (and the 5 s rule) fires constantly and means nothing.
		if (peakOf(samples) > AUDIO_PEAK_MIN) {
			// The measurement only makes sense for a reply that starts after a silence (full-duplex stream).
			if (Date.now() - lastAssistantSpokeAt > SILENCE_GAP_MS) {
				const responseMs = latency.assistantAudio();
				if (responseMs !== null && responseMs >= MIN_LOGGED_MS) {
					activity.push({
						kind: 'latency',
						whoName: persona().name ?? 'bot',
						text: t('runtime.seconds_value', { seconds: (responseMs / 1000).toFixed(1) }),
						meta: { type: t('runtime.latency_kind_response'), note: t('runtime.latency_note_response') },
					});
					log(t('runtime.log_latency_response', { seconds: (responseMs / 1000).toFixed(1) }));
				}
			}
			lastAssistantSpokeAt = Date.now();
			idle.touch(); // while the bot is speaking the session must not count as "idle"
		}
		playback.push(samples);
	});
	session.on('transcript', onTranscript);
	session.on('tool', (event) => onToolEvent(event, 'backend'));
	session.on('backend', ({ ms }) => {
		activity.push({
			kind: 'latency',
			whoName: 'backend',
			text: t('runtime.seconds_value', { seconds: (ms / 1000).toFixed(1) }),
			meta: { type: t('runtime.latency_kind_backend') },
		});
		log(t('runtime.log_latency_backend', { seconds: (ms / 1000).toFixed(1) }));
	});
	session.on('turn', ({ delegationId = null } = {}) => {
		// The model started replying: from here on, people cutting in do not affect this turn's owner gate.
		rememberTurn(delegationId, attribution.markTurn());
	});
	session.on('delegation', (delegation) => {
		void handleDelegation(delegation);
	});
	session.on('usage', ({ seconds }) => {
		const status = quota.report(seconds);
		const minute = Math.floor(seconds / 60);
		if (minute !== lastUsageMinute) {
			lastUsageMinute = minute;
			log(
				t('runtime.live_session_seconds', {
					seconds: Math.round(seconds),
					quota: quota.enabled
						? t('runtime.live_session_quota_suffix', { used: Math.round(status.used / 60), limit: Math.round(status.limit / 60) })
						: '',
				}),
			);
		}
		if (quota.shouldWarn()) notifyOwner(t('runtime.quota_warning', { used: Math.round(status.used / 60), limit: Math.round(status.limit / 60) }));
		if (status.exceeded && !quotaBlocked) {
			quotaBlocked = true;
			activity.push({ kind: 'session', text: t('runtime.quota_exceeded_activity', { limit: Math.round(status.limit / 60) }) });
			notifyOwner(t('runtime.quota_exceeded_dm'));
			pauseLive(t('runtime.reason_quota_exceeded'));
		}
	});
	session.on('error', (err) => {
		const info = describeLiveError(err);
		lastLiveError = err; // if the connection closes next, the retry plan should know the reason
		// Permanent errors are written as one line when the retry is planned; they are not printed again here.
		if (!info.fatal) log(t('runtime.live_error', { code: info.code ? ` (${info.code})` : '', message: info.message }));
	});
	session.on('warning', (message) => log(t('runtime.live_warning', { message })));
	if (cfg.debug) session.on('debug', (event) => log('live>', event.type));

	session.on('closed', ({ code, reason, expected }) => {
		if (live !== session) return;
		live = null;
		if (expected || shuttingDown || paused) return;
		scheduleLiveRetry(t('runtime.retry_why_closed', { detail: `${code}${reason ? ` ${reason}` : ''}` }), lastLiveError);
		lastLiveError = null;
	});

	session.connect().catch((err) => {
		if (live === session) live = null;
		if (shuttingDown || paused) return;
		scheduleLiveRetry(t('runtime.retry_why_connect_failed'), err);
		session.close().catch(() => {});
	});
}

/**
 * The reconnection plan. Temporary errors back off exponentially (1 s -> 30 s); permanent ones (credit,
 * key) use a 10 min interval, one readable log line and a single DM to the owner (so the log stays clean).
 */
function scheduleLiveRetry(why, err = null) {
	const info = err ? describeLiveError(err) : null;
	let delay;
	if (info?.fatal) {
		delay = FATAL_RETRY_MS;
		const detail = `${info.code ?? info.type}: ${info.message}`;
		log(
			t('runtime.live_retry_fatal', {
				why,
				detail,
				hint: info.hint ? `\n            ${info.hint}` : '',
				minutes: Math.round(delay / 60_000),
			}),
		);
		if (lastFatalCode !== info.code) {
			lastFatalCode = info.code;
			activity.push({ kind: 'session', text: t('runtime.live_fatal_activity', { detail }), meta: { code: info.code, hint: info.hint } });
			notifyOwner(t('runtime.live_fatal_dm', { code: info.code ?? info.type, message: info.message, hint: info.hint ? `\n${info.hint}` : '' }));
		}
		// Voice chat without OpenAI: fall back to the local brain (whisper + DeepSeek + Chatterbox) when it is ready.
		if (cfg.brainMode === 'auto' && voice.connected) void enterLocalBrain(info.code ?? t('runtime.reason_live_down'));
	} else {
		lastFatalCode = null;
		delay = Math.min(30_000, 1000 * 2 ** Math.min(liveFailures++, 5));
		const detail = info ? ` (${info.code ? `${info.code}: ` : ''}${info.message})` : '';
		log(t('runtime.live_retry_soon', { why, detail, seconds: Math.round(delay / 1000) }));
	}
	if (liveReconnectTimer) clearTimeout(liveReconnectTimer);
	liveReconnectTimer = setTimeout(() => {
		liveReconnectTimer = null;
		if (!paused) startLive();
	}, delay);
	if (info?.fatal && typeof liveReconnectTimer.unref === 'function') liveReconnectTimer.unref();
}

function pauseLive(reason) {
	paused = true;
	if (liveReconnectTimer) {
		clearTimeout(liveReconnectTimer);
		liveReconnectTimer = null;
	}
	if (!live) return;
	const session = live;
	live = null;
	session.close().catch(() => {});
	activity.push({ kind: 'session', text: t('runtime.live_paused', { reason }) });
	log(t('runtime.live_paused_log', { reason }));
}

function resumeLive() {
	if (live) return;
	if (quotaBlocked) {
		if (quota.status().exceeded) return; // stays closed until the day rolls over
		quotaBlocked = false;
	}
	paused = false;
	startLive();
}

/** When the bot left the channel on its own it tries to come back shortly after (no one-way door). */
function scheduleRejoin(targetId, delays, label) {
	for (const delayMs of delays) {
		scheduleTimer(() => {
			void (async () => {
				if (shuttingDown || voice.connected || lastVoiceChannelId !== targetId) return;
				const channel = guild?.channels.cache.get(targetId);
				if (!channel) return;
				log(`${label} (${channel.name}).`);
				try {
					await ctx.joinVoice(channel);
				} catch (err) {
					log(t('runtime.rejoin_failed', { error: err.message }));
				}
			})();
		}, delayMs);
	}
}

/** The character changed: the live session is rebuilt with the new instructions. */
async function refreshPersona(reason) {
	const current = persona();
	log(t('runtime.persona_updated', { reason, name: current.name ?? t('runtime.persona_default') }));
	if (!live) {
		if (!paused) startLive();
		return;
	}
	pendingIntro = true;
	const session = live;
	live = null;
	try {
		await session.close();
	} catch {
		/* ignore */
	}
	if (!paused && !shuttingDown) startLive();
}

/** Tells the model to "say this" (it comes out in the channel); with the local brain Chatterbox reads it. */
function say(text) {
	if (brain === 'local') {
		enqueueLocalSpeech(String(text ?? ''));
		localBrain.note(t('runtime.note_self_said', { text }));
		return;
	}
	if (!live?.ready) return;
	live.appendContext('commentary', text);
}

/** A DM to the owner (quota warnings and so on); with no owner set it is only logged. */
function notifyOwner(text) {
	log(t('runtime.owner_log', { text }));
	if (!cfg.ownerId || !client) return;
	client.users
		.fetch(cfg.ownerId)
		.then((user) => user.send(text))
		.catch((err) => log(t('runtime.owner_dm_failed', { error: err.message })));
}

// ---------------------------------------------------------------- transcript + voice commands

const transcriptBuffers = new Map();
let lastUserDeltaAt = 0;

/**
 * The transcript arrives late: when the gate cannot find the word it waits at most `maxMs`. It returns
 * about 300 ms after the newest transcript chunk (once the chunks settle) or when the time is up.
 */
function awaitTranscript(maxMs = 1500) {
	const startedAt = Date.now();
	return new Promise((resolve) => {
		const poll = () => {
			const now = Date.now();
			if (now - startedAt >= maxMs) return resolve();
			if (lastUserDeltaAt > startedAt && now - lastUserDeltaAt >= 300) return resolve();
			setTimeout(poll, 100);
		};
		setTimeout(poll, 100);
	});
}

function onTranscript({ speaker, text, startMs, endMs }) {
	let spokenId = null;
	if (speaker === 'user') {
		attribution.noteTranscript(text, { startMs, endMs });
		lastUserDeltaAt = Date.now();
		// Who said it: resolved from the audio position (the arrival time misleads in a busy channel).
		spokenId = attribution.speakerIdAt(startMs, endMs);
		// From the audio position to the wall clock: when did the user actually stop speaking?
		const lag = Number.isFinite(endMs) ? Math.max(0, attribution.audioMs - endMs) : 0;
		latency.userSpeechEnd(Date.now() - lag);
		if (cfg.debug) {
			const st = attribution.state();
			log(
				t('runtime.log_attribution', {
					start: startMs,
					end: endMs,
					audio: attribution.audioMs,
					ownerActive: st.ownerActive,
					ownerText: st.ownerText,
				}),
			);
		}
	}
	let buf = transcriptBuffers.get(speaker);
	if (!buf) {
		buf = { text: '', timer: null, speakerId: null, endMs: null };
		transcriptBuffers.set(speaker, buf);
	}
	if (spokenId) buf.speakerId = spokenId;
	if (Number.isFinite(endMs)) buf.endMs = endMs;
	buf.text += text;
	if (buf.timer) clearTimeout(buf.timer);
	buf.timer = setTimeout(() => {
		buf.timer = null;
		const line = buf.text.replace(/\s+/g, ' ').trim();
		const speakerId = buf.speakerId ?? lastSpeakerId;
		const lineEndMs = buf.endMs;
		buf.text = '';
		buf.speakerId = null; // let the next line work out its own identity
		buf.endMs = null;
		if (!line) return;
		if (cfg.transcripts) log(speaker === 'user' ? t('runtime.transcript_in', { line }) : t('runtime.transcript_out', { line }));
		if (speaker === 'user') {
			record({ kind: 'voice', direction: 'in', who: speakerId, text: line });
			// If the audio position says the transcript belongs to someone else, send the model a short correction.
			if (cfg.announceSpeaker && speakerId && lastAnnouncedUser && String(speakerId) !== String(lastAnnouncedUser) && live?.ready) {
				const name = nameFor(speakerId);
				lastAnnouncedUser = String(speakerId);
				live.appendContext(
					'instructions',
					t('runtime.speaker_correction', { line: line.slice(0, 80), name, owner: isOwnerId(speakerId) ? t('runtime.owner_suffix') : '' }),
				);
				if (cfg.transcripts) log(t('runtime.log_context_correction', { line: line.slice(0, 40), name }));
			}
			// The user started talking: empty the local audio queue (barge-in).
			interruptLocalSpeech();
		} else if (localMode) {
			// Local mode: this text is turned into speech by Chatterbox and pushed to Discord.
			enqueueLocalSpeech(line);
		} else {
			record({ kind: 'voice', direction: 'out', whoName: persona().name ?? 'bot', text: line });
		}
		if (speaker !== 'user') return;
		recentUserText = `${recentUserText} ${line}`.slice(-700).trim();
		recentUserTextAt = Date.now();
		maybeWakeByVoiceName(line);
		// Unambiguous commands run here even when the model does not delegate; the signature cache stops doubles.
		const command = parseVoiceCommand(line, store.list(), channelLists());
		if (!command) return;
		// This line's own turn: once the line is over, people cutting in do not affect the gate decision.
		const lineTurn = { at: Date.now(), audioMs: Number.isFinite(lineEndMs) ? lineEndMs : attribution.audioMs };
		void executeAction(command, { ...taskDeps, currentTurn: () => lineTurn })
			.then((result) => {
				if (result?.speak && result.text && !result.reused) say(result.text);
			})
			.catch((err) => log(t('runtime.command_error', { error: err.message })));
	}, 1200);
}

// Names the bot answers to on top of the active character's name, and the filler words dropped when
// deciding whether the name was called on its own or together with a request.
const WAKE_WORDS = tList('runtime.wake_words');
const WAKE_FILLER_WORDS = tList('runtime.wake_filler_words');

/** When the bot is called by name in the channel and the model stayed silent, tells it to answer. */
function maybeWakeByVoiceName(line) {
	if (!live?.ready) return;
	const now = Date.now();
	if (now - lastAssistantSpokeAt < 5000) return; // the model already spoke, or is speaking
	if (now - lastWakeNudgeAt < 15_000) return; // do not nudge too often
	const active = store.getActive();
	const wakeWords = new Set([active?.name, ...WAKE_WORDS].filter(Boolean).map((word) => normalize(word)).filter(Boolean));
	const tokens = normalize(line).split(' ').filter(Boolean);
	if (!tokens.some((token) => wakeWords.has(token))) return;
	lastWakeNudgeAt = now;
	// "Aria?" -> a short answer; "ban Dana, Aria" -> there is a real request, so do not fob it off.
	const rest = tokens.filter((token) => !wakeWords.has(token) && !WAKE_FILLER_WORDS.includes(token));
	if (rest.length <= 1) {
		log(t('runtime.log_wake_name_only'));
		live.appendContext('instructions', t('runtime.wake_nudge'));
		return;
	}
	log(t('runtime.log_wake_request'));
	live.appendContext('instructions', t('runtime.wake_nudge_request', { line: line.slice(0, 200) }));
}

function channelLists() {
	const text = [];
	const voice = [];
	for (const channel of guild?.channels.cache.values() ?? []) {
		if (channel.type === ChannelType.GuildText) text.push(channel);
		else if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) voice.push(channel);
	}
	return { text, voice };
}

const SETTING_NAMES = ['transcripts', 'announce_speaker', 'owner_priority', 'idle_close_minutes', 'local_tts', 'record', 'brain'];

// Spoken aliases -> canonical setting name; the switch below only knows the canonical names.
const SETTING_ALIASES = tRaw('runtime.setting_aliases') ?? {};

/**
 * The settings the owner is allowed to change (in memory; a restart brings the .env values back).
 * Returns: the new value, null (unknown setting) or { ok:false, spoken } (could not be applied).
 */
async function applySetting(name, value) {
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
			mixer.setPriority(cfg.ownerPriority ? cfg.ownerId : null);
			return cfg.ownerPriority;
		case 'idle_close_minutes':
			cfg.idleCloseMs = Math.max(0, Number(value) || 0) * 60_000;
			idle.idleMs = cfg.idleCloseMs;
			return Math.round(cfg.idleCloseMs / 60_000);
		case 'record':
			cfg.recordTranscripts = asBool(value, cfg.recordTranscripts);
			activity.push({ kind: 'session', text: cfg.recordTranscripts ? t('runtime.record_on') : t('runtime.record_off') });
			return cfg.recordTranscripts;
		case 'local_tts': {
			if (brain === 'local') return { ok: false, spoken: t('runtime.local_brain_busy') };
			const enabled = asBool(value, !localMode);
			const result = await setLocalMode(enabled);
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
				const ok = await enterLocalBrain(t('runtime.reason_setting'));
				if (!ok) return { ok: false, spoken: t('runtime.brain_local_failed') };
				pauseLive(t('runtime.reason_local_brain_selected'));
				return t('runtime.brain_value_local');
			}
			exitLocalBrain(wanted === 'auto' ? t('runtime.reason_auto_mode') : t('runtime.reason_live_selected'));
			if (!live) resumeLive();
			return wanted === 'auto' ? t('runtime.brain_value_auto') : t('runtime.brain_value_live');
		}
		default:
			return null;
	}
}

/**
 * Local TTS mode: the GPT-Live audio is not pushed to Discord; the spoken text is turned into audio by
 * Chatterbox and played from the local machine (no cloud voice is used).
 * @returns {Promise<{ ok: boolean, value: boolean, reason?: string }>}
 */
async function setLocalMode(enabled) {
	if (enabled && !cfg.localTtsEnabled) {
		log(t('runtime.local_tts_disabled_log'));
		return { ok: false, value: localMode, reason: t('runtime.local_tts_disabled') };
	}
	if (enabled) {
		const info = await localTts.health();
		if (!info) {
			if (localServer?.ensureRunning()) {
				log(t('runtime.local_tts_server_started_log'));
				return { ok: false, value: localMode, reason: t('runtime.local_tts_server_started') };
			}
			log(t('runtime.local_tts_server_down_log'));
			return { ok: false, value: localMode, reason: t('runtime.local_tts_server_down') };
		}
		if (!info.ok) {
			log(
				t('runtime.local_tts_not_ready_log', {
					status: info.status ?? t('runtime.local_tts_status_unknown'),
					error: info.error ? `: ${info.error}` : '',
				}),
			);
			const reason = t('runtime.local_tts_not_ready', { status: info.status ?? t('runtime.local_tts_status_loading') });
			return { ok: false, value: localMode, reason };
		}
		log(t('runtime.local_tts_on_log', { model: info.model, device: info.device, rate: info.sr }));
	} else if (localMode) {
		log(t('runtime.local_tts_off_log'));
	}
	localMode = enabled;
	interruptLocalSpeech();
	activity.push({ kind: 'session', text: enabled ? t('runtime.local_tts_mode_on') : t('runtime.local_tts_mode_off') });
	return { ok: true, value: localMode };
}

/**
 * Task dependencies: the voice-command path, the delegation path and the slash commands all use these.
 * Values assigned later (guild, voice session) are read through a getter/closure.
 */
const taskDeps = {
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
	recentActions,
	reader,
	memberIndex,
	memory,
	music,
	quota,
	now: Date.now,
	nameFor,
	personaName: () => persona().name ?? 'bot',
	summarize: (options = {}) => summarizeConversation(taskDeps, { events: activity.events, ...options }),
	get presenceEnabled() {
		return usePresence;
	},
	get selfId() {
		return client?.user?.id ?? null;
	},
	get guild() {
		return guild;
	},
	getUserText: () => (Date.now() - recentUserTextAt < 60_000 ? recentUserText.trim() : ''),
	channelLists,
	joinVoice: (channel) => ctx.joinVoice(channel),
	leaveVoice: (options) => ctx.leaveVoice(options),
	currentSpeakerChannel: () => guild?.voiceStates.cache.get(lastSpeakerId ?? '')?.channel ?? null,
	currentSpeakerId: () => lastSpeakerId,
	currentSpeakerName: () => (lastSpeakerId ? nameFor(lastSpeakerId) : null),
	currentVoiceChannel: () => (voice.channelId ? (guild?.channels.cache.get(voice.channelId) ?? null) : null),
	// Did the bot owner speak just now? Admin commands go through this gate.
	// The audio path can tell the owner's speech apart, so the gate rests on "was the last voice heard the owner's".
	isOwnerActive: () => attribution.isOwnerActive(),
	ownerSaidRecently: (words, ms) => attribution.ownerSaidRecently(words, ms),
	ownerMatch: (words, ms) => attribution.ownerMatch(words, ms),
	ownerTextTail: () => attribution.state().ownerText,
	// The gate's real question: who said the command word LAST, and did anyone speak after the owner (before
	// the turn started)? Default turn: the last turn read when entering the gate (a turn pinned per request wins).
	currentTurn: () => attribution.turn,
	commandSpeaker: (words, opts) => attribution.commandSpeaker(words, opts),
	lastUtterance: (opts) => attribution.lastUtterance(opts),
	transcriptLagging: (opts) => attribution.transcriptLagging(opts),
	awaitTranscript,
	activity: (event) => activity.push(event),
	setDefaultVoice: (voiceName) => {
		cfg.liveVoice = voiceName;
	},
	applySetting,
	settingNames: () => SETTING_NAMES,
	refreshPersona,
};

const runTask = createTaskRunner(taskDeps);

/** Runs when the model asks for help: local Discord work or web research, with the result going back. */
async function handleDelegation(delegation) {
	const question = taskDeps.getUserText();
	log(t('runtime.delegation_requested', { id: delegation.id, question: question.slice(0, 140) }));
	latency.delegationStart();
	try {
		const answer = await runTask();
		const ms = latency.delegationDone();
		if (answer.mode !== 'none' && answer.text) live?.replyDelegation(delegation.id, answer.text, { mode: answer.mode });
		log(
			t('runtime.delegation_answered', {
				id: delegation.id,
				timing: ms === null ? '' : t('runtime.delegation_timing', { seconds: (ms / 1000).toFixed(1) }),
			}),
		);
	} catch (err) {
		latency.delegationDone();
		log(t('runtime.delegation_error', { error: err.message }));
		live?.replyDelegation(delegation.id, t('runtime.delegation_failed_spoken'), { mode: 'commentary' });
	}
}

// ---------------------------------------------------------------- voice channel

async function memberName(userId) {
	const cached = guild?.members.cache.get(userId);
	if (cached) return cached.displayName;
	try {
		const member = await guild.members.fetch(userId);
		return member.displayName;
	} catch {
		return nameFor(userId);
	}
}

const isOwnerId = (userId) => Boolean(cfg.ownerId && String(userId) === String(cfg.ownerId));

// Delegation id -> that turn's audio/clock marker. When a tool call arrives the gate looks at the moment the
// request was born; voices cutting in while the backend runs do not change it. Kept small (a few turns is enough).
const TURN_MEMORY = 8;
const turnsByDelegation = new Map();
let lastTurn = null;

function rememberTurn(delegationId, turn) {
	lastTurn = turn;
	if (!delegationId) return;
	turnsByDelegation.set(String(delegationId), turn);
	while (turnsByDelegation.size > TURN_MEMORY) turnsByDelegation.delete(turnsByDelegation.keys().next().value);
}

function turnFor(delegationId) {
	if (delegationId && turnsByDelegation.has(String(delegationId))) return turnsByDelegation.get(String(delegationId));
	return lastTurn;
}

/** Tells the model who is speaking: name, whether they are the owner, and (the first time) memory notes.
 * It is not repeated while the same person keeps talking. */
async function announceSpeaker(userId) {
	if (!live?.ready || lastAnnouncedUser === userId) return;
	lastAnnouncedUser = userId;
	const name = await memberName(userId);
	const owner = isOwnerId(userId);
	// An "instructions" note: the model takes it as hard fact ("thinking" notes are too weak in conversation).
	const lines = [
		t('runtime.speaker_context', {
			name,
			ownerNote: owner ? t('runtime.speaker_context_owner') : '',
			ownerAnswer: owner ? t('runtime.speaker_context_owner_answer') : '',
		}),
	];
	if (memory && !memoryHinted.has(userId)) {
		const summary = memory.summaryFor(userId);
		if (summary) {
			memoryHinted.add(userId);
			lines.push(t('runtime.memory_notes', { name, summary }));
		}
	}
	live.appendContext('instructions', lines.join('\n'));
	if (cfg.transcripts) log(t('runtime.log_context_speaker', { name, owner: owner ? t('runtime.owner_tag') : '' }));
}

/** If memory holds notes about the speaker, tell the model once, quietly (even when announce is off). */
async function hintMemory(userId) {
	if (!memory || !live?.ready || memoryHinted.has(userId)) return;
	const summary = memory.summaryFor(userId);
	if (!summary) return;
	memoryHinted.add(userId);
	const name = await memberName(userId);
	live.appendContext('thinking', t('runtime.memory_notes', { name, summary }));
}

// Who owns the audio that is REALLY sent to the model: with owner priority the owner, otherwise the loudest
// person in the mix. This is used instead of Discord's "started speaking" event; short noises cutting in do
// not steal the announcement.
const SPEAKER_STABLE_FRAMES = 8; // stable for 160 ms
const SPEAKER_GAP_FRAMES = 15; // a silent frame gap of up to 300 ms (packet jitter, a breath) does not reset the counter
let sentCandidate = null;
let sentCandidateFrames = 0;
let sentSilentFrames = 0;

function trackSentSpeaker({ priority, active, sent }) {
	if (!sent || !cfg.announceSpeaker) return;
	const id = priority ? (cfg.ownerId ?? active[0] ?? null) : (active[0] ?? null);
	if (!id) {
		// Discord packets arrive with jitter: if a single empty frame reset the counter, the owner would never be "stable".
		if (++sentSilentFrames > SPEAKER_GAP_FRAMES) {
			sentCandidate = null;
			sentCandidateFrames = 0;
		}
		return;
	}
	sentSilentFrames = 0;
	if (String(id) === sentCandidate) sentCandidateFrames++;
	else {
		sentCandidate = String(id);
		sentCandidateFrames = 1;
	}
	if (sentCandidateFrames === SPEAKER_STABLE_FRAMES && sentCandidate !== lastAnnouncedUser) void announceSpeaker(sentCandidate);
}

/** Tells the model who is in the channel (when the session opens and on joins/leaves). */
function announceRoster(prefix = t('runtime.roster_prefix')) {
	if (!live?.ready || !voice.channelId || !guild) return;
	const names = [];
	for (const state of guild.voiceStates.cache.values()) {
		if (state.channelId !== voice.channelId) continue;
		const member = state.member ?? guild.members.cache.get(state.id);
		if (!member || member.user?.bot) continue;
		names.push(`${member.displayName}${isOwnerId(member.id) ? t('runtime.owner_suffix') : ''}`);
	}
	if (!names.length) return;
	live.appendContext('instructions', t('runtime.roster_context', { prefix, names: names.join(', ') }));
	if (cfg.transcripts) log(t('runtime.log_context_roster', { names: names.join(', ') }));
}

const voice = new VoiceSession({
	getClient: () => client,
	mixer,
	playback,
	music,
	ducker,
	getLive: () => live,
	log,
	debug: cfg.debug,
	soloUserId: cfg.soloUserId,
	onFrame: (frame) => {
		attribution.onFrame(frame);
		trackSentSpeaker(frame);
	},
	onUserPcm: (userId, pcm) => {
		if (brain === 'local') segmenter.push(userId, pcm);
	},
	onSpeaking: (userId) => {
		lastSpeakerId = userId;
		idle.touch();
		if (paused && brain !== 'local') {
			if (quotaBlocked && quota.status().exceeded) return;
			log(t('runtime.speech_detected'));
			resumeLive();
		}
		// The speaker announcement now follows the audio that is sent (trackSentSpeaker); only the memory hint here.
		void hintMemory(userId);
	},
	onLost: () => {
		// The voice connection could not be recovered: instead of killing the whole bot, leave the channel,
		// pause the session, and try to rejoin the same channel with growing delays.
		log(t('runtime.voice_lost'));
		void (async () => {
			try {
				await voice.destroy();
			} catch {
				/* ignore */
			}
			pauseLive(t('runtime.reason_voice_lost'));
			const targetId = lastVoiceChannelId;
			if (!targetId || shuttingDown) return;
			scheduleRejoin(targetId, RECOVERY_DELAYS_MS, t('runtime.rejoin_label_recover'));
		})();
	},
});

// ---------------------------------------------------------------- command context

const ctx = {
	store,
	voice,
	config: cfg,
	log,
	latency,
	music,
	quota,
	memory,
	localMode: () => localMode,
	brain: () => brain,
	chatterbox: () => localServer?.status ?? null,
	getLive: () => live,
	refreshPersona,
	say,
	applySetting,
	summarize: taskDeps.summarize,
	activity: (event) => activity.push(event),
	callTool: (name, args) => callTool(name, args, taskDeps),
	joinVoice: async (channel) => {
		clearRejoinTimers();
		await voice.join(guild, channel);
		lastVoiceChannelId = channel.id;
		memoryHinted.clear();
		if (cfg.brainMode === 'local') void enterLocalBrain('BRAIN_MODE=local');
		else resumeLive();
		activity.push({ kind: 'session', text: t('runtime.joined_voice', { channel: channel.name }), meta: { channel: channel.name } });
		if (cfg.joinNotice && cfg.textChannelId) {
			const textChannel = guild?.channels.cache.get(cfg.textChannelId);
			textChannel
				?.send({
					content: t('runtime.join_notice', {
						channel: channel.name,
						recording: cfg.recordTranscripts ? t('runtime.join_notice_recording_on') : t('runtime.join_notice_recording_off'),
					}),
					allowedMentions: { parse: [] },
				})
				.catch(() => {});
		}
	},
	leaveVoice: async ({ permanent = false } = {}) => {
		clearRejoinTimers();
		music?.stop();
		exitLocalBrain(t('runtime.reason_left_voice'));
		await voice.destroy();
		pauseLive(t('runtime.reason_left_voice'));
		activity.push({ kind: 'session', text: permanent ? t('runtime.left_voice_permanent') : t('runtime.left_voice_temporary') });
		// If the owner did not throw it out (the model left on its own) it comes back; a permanent exit sets no timer.
		if (permanent) lastVoiceChannelId = null;
		else if (lastVoiceChannelId) scheduleRejoin(lastVoiceChannelId, REJOIN_DELAYS_MS, t('runtime.rejoin_label_return'));
	},
};

// ---------------------------------------------------------------- lifecycle

async function shutdown(code = 0) {
	if (shuttingDown) return;
	shuttingDown = true;
	log(t('runtime.shutting_down'));
	if (liveReconnectTimer) clearTimeout(liveReconnectTimer);
	if (idleTimer) clearInterval(idleTimer);
	if (sttPollTimer) clearInterval(sttPollTimer);
	stopLocalBrainRetry();
	clearRejoinTimers();
	interruptLocalSpeech();
	try {
		music?.destroy();
	} catch {
		/* ignore */
	}
	try {
		localServer?.stop();
	} catch {
		/* ignore */
	}
	await panel?.close().catch(() => {});
	try {
		await voice.destroy();
	} catch {
		/* ignore */
	}
	try {
		if (live) await live.close();
	} catch {
		/* ignore */
	}
	try {
		client?.destroy();
	} catch {
		/* ignore */
	}
	process.exitCode = code;
	setTimeout(() => process.exit(code), 2000).unref();
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('unhandledRejection', (reason) =>
	log(t('runtime.unhandled_rejection'), reason instanceof Error ? (cfg.debug ? reason.stack : reason.message) : reason),
);
process.on('uncaughtException', (err) => {
	console.error(t('runtime.uncaught_exception'), err?.stack ?? err);
	void shutdown(1);
});

/**
 * Reads from the application flags which privileged intents are switched on in the portal.
 * (Flags: 12/13 presence, 14/15 members, 18/19 message content — "…_LIMITED" = on for <100 servers.)
 */
async function detectPrivilegedIntents() {
	try {
		const response = await fetch('https://discord.com/api/v10/applications/@me', {
			headers: { Authorization: `Bot ${cfg.discordToken}` },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) return null;
		const app = await response.json();
		const flags = BigInt(app.flags_new ?? app.flags ?? 0);
		return {
			presence: (flags & ((1n << 12n) | (1n << 13n))) !== 0n,
			guildMembers: (flags & ((1n << 14n) | (1n << 15n))) !== 0n,
			messageContent: (flags & ((1n << 18n) | (1n << 19n))) !== 0n,
		};
	} catch {
		return null;
	}
}

/** With 'auto' it takes the detected value, otherwise the on/off spelling that was written. */
function triState(raw, detected) {
	const value = String(raw ?? 'auto').trim().toLowerCase();
	if (tList('runtime.enabled_words').includes(value)) return true;
	if (tList('runtime.disabled_words').includes(value)) return false;
	return Boolean(detected);
}

const detectedIntents = await detectPrivilegedIntents();
const usePresence = triState(cfg.presence, detectedIntents?.presence);
const useGuildMembers = triState(cfg.guildMembers, detectedIntents?.guildMembers);
const useMessageContent = triState(cfg.messageContent, detectedIntents?.messageContent);

const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages];
if (useMessageContent) intents.push(GatewayIntentBits.MessageContent);
if (useGuildMembers) intents.push(GatewayIntentBits.GuildMembers);
if (usePresence) intents.push(GatewayIntentBits.GuildPresences);
client = new Client({ intents, partials: [Partials.Channel] });
client.on(Events.Error, (err) => log(t('runtime.discord_error', { error: err.message })));

client.on(Events.InteractionCreate, (interaction) => {
	if (interaction.guildId && interaction.guildId !== cfg.guildId) return; // only the configured server
	handleInteraction(interaction, ctx).catch((err) => log(t('runtime.interaction_error', { error: err.message })));
});

client.on(Events.MessageCreate, (message) => {
	const isDm = !message.guild;
	// Only the configured server and DMs; the other servers the bot is in do not reach the log.
	if (!isDm && message.guild.id !== cfg.guildId) return;
	if (message.member) memberIndex.upsert(message.member);
	const where = isDm ? null : { channel: `#${message.channel?.name ?? '?'}` };
	if (!message.author?.bot) {
		const text = String(message.content ?? '').trim() || (message.attachments?.size ? t('runtime.image_placeholder') : '');
		if (text) {
			record({
				kind: isDm ? 'dm' : 'channel',
				direction: 'in',
				who: message.author?.id ?? null,
				whoName: message.member?.displayName ?? message.author?.displayName ?? message.author?.username ?? null,
				text,
				meta: where,
			});
		}
	}
	handleMessage(message, {
		client,
		store,
		provider,
		visionClient: openai,
		cfg,
		log,
		memory,
		replyLimiter,
		activity: (event) => activity.push(event),
		persona: () => {
			const active = store.getActive();
			return { name: active?.name ?? null, prompt: active?.prompt?.trim() || cfg.instructions };
		},
		getLive: () => live,
	})
		.then((reply) => {
			if (!reply) return;
			record({
				kind: isDm ? 'dm' : 'channel',
				direction: 'out',
				whoName: persona().name ?? 'bot',
				text: reply,
				meta: where,
			});
		})
		.catch((err) => log(t('runtime.message_error', { error: err.message })));
});

client.on(Events.GuildMemberRemove, (member) => {
	if (member.guild?.id !== cfg.guildId) return;
	memberIndex.remove(member.id);
	memberNameMap = null;
});
client.on(Events.GuildMemberUpdate, (_old, member) => {
	if (member.guild?.id !== cfg.guildId) return;
	memberIndex.upsert(member);
	memberNameMap = null;
});
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
	const botChannelId = voice.channelId;
	if (!botChannelId || !oldState?.id) return;
	const member = newState.member ?? oldState.member ?? guild?.members.cache.get(oldState.id);
	if (member?.user?.bot) return;
	const name = member?.displayName ?? nameFor(oldState.id);
	// The user left the bot's channel: drop the audio subscription and buffer (no leak), and tell the model.
	if (oldState.channelId === botChannelId && newState.channelId !== botChannelId) {
		voice.dropUser(oldState.id);
		if (lastAnnouncedUser === oldState.id) lastAnnouncedUser = null;
		live?.appendContext('thinking', t('runtime.member_left_voice', { name }));
	} else if (newState.channelId === botChannelId && oldState.channelId !== botChannelId) {
		live?.appendContext('thinking', t('runtime.member_joined_voice', { name, owner: isOwnerId(oldState.id) ? t('runtime.owner_suffix') : '' }));
	}
});

client.once(Events.ClientReady, async () => {
	try {
		guild = await client.guilds.fetch(cfg.guildId);
		if (cfg.panelEnabled) {
			const past = await activity.load(500);
			if (past) log(t('boot.panel_history', { count: past }));
		}
		await registerCommands(client, cfg.guildId, log);

		if (cfg.channelId) {
			const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
			if (channel?.isVoiceBased()) {
				await ctx.joinVoice(channel);
				log(t('boot.joined_channel', { channel: channel.name }));
			} else {
				log(t('boot.voice_channel_missing', { channel: cfg.channelId }));
			}
		}

		const textChannels = [...guild.channels.cache.values()].filter((channel) => channel.type === ChannelType.GuildText);
		await reader.warmUp(textChannels);
		log(t('boot.message_baseline', { count: textChannels.length }));
		log(
			t('boot.intents', {
				presence: usePresence ? t('boot.on') : t('boot.off'),
				members: useGuildMembers ? t('boot.on') : t('boot.off'),
				messageContent: useMessageContent ? t('boot.on') : t('boot.off'),
			}),
		);
		log(t('boot.text_generation', { provider: provider.describe() }));
		log(cfg.useResponsesDelegation ? t('boot.tools_backend', { model: cfg.researchModel, count: toolDefinitions().length }) : t('boot.tools_client'));
		if (cfg.ownerPriority && cfg.ownerId) log(t('boot.owner_priority', { owner: cfg.ownerId }));
		if (!cfg.ownerId) log(t('boot.no_owner_id'));
		if (music) {
			log(
				t('boot.music_on', {
					volume: Math.round(music.volume * 100),
					duck: Math.round(cfg.musicDuckVolume * 100),
					folder: cfg.musicDir ? t('boot.music_folder', { dir: cfg.musicDir }) : '',
				}),
			);
		}
		log(cfg.brainMode === 'local' ? t('boot.brain_local') : cfg.brainMode === 'auto' ? t('boot.brain_auto') : t('boot.brain_live'));
		if (localServer) {
			log(
				localServer.python
					? t('boot.chatterbox_autostart', { model: cfg.localTtsModel, stt: cfg.localSttModel })
					: t('boot.chatterbox_missing_venv'),
			);
		}
		if (quota.enabled) log(t('boot.daily_quota', { limit: Math.round(cfg.dailyLiveSeconds / 60), used: Math.round(quota.status().used / 60) }));
		if (!cfg.recordTranscripts) log(t('boot.record_off'));
		if (memory) log(t('boot.memory_on', { users: memory.stats().users, notes: memory.stats().notes }));

		memberIndex.selfId = client.user.id;
		try {
			await memberIndex.load({ token: cfg.discordToken, guildId: cfg.guildId, log });
		} catch (err) {
			log(t('boot.member_index_failed', { error: err.message }));
		}
		const memberRefresh = setInterval(() => {
			void memberIndex
				.load({ token: cfg.discordToken, guildId: cfg.guildId })
				.then(() => {
					memberNameMap = null;
				})
				.catch(() => {});
		}, 30 * 60_000);
		if (typeof memberRefresh.unref === 'function') memberRefresh.unref();

		if (cfg.idleCloseMs > 0) {
			idleTimer = setInterval(() => {
				if (paused || !idle.shouldPause(Boolean(live))) return;
				log(t('runtime.idle_close'));
				pauseLive(t('runtime.reason_idle'));
			}, 30_000);
		}

		// The local admin panel: DM/channel messages, voice transcripts, tool and gate records, health/metric endpoints.
		if (cfg.panelEnabled) {
			try {
				panel = await startPanel({
					activity,
					port: cfg.panelPort,
					log,
					nameFor,
					state: () => {
						const stats = latency.summary();
						const counts = activity.stats();
						const quotaStatus = quota.status();
						return {
							title: t('runtime.panel_title', { name: persona().name ?? t('runtime.panel_default_name') }),
							status:
								t('runtime.panel_status_voice', {
									channel: voice.connected ? `#${guild?.channels.cache.get(voice.channelId)?.name ?? '?'}` : t('runtime.panel_off'),
								}) +
								t('runtime.panel_status_brain', { brain: brain === 'local' ? t('runtime.panel_local') : 'GPT-Live' }) +
								(localServer ? t('runtime.panel_status_chatterbox', { status: localServer.status }) : '') +
								t('runtime.panel_status_live', { state: live?.ready ? t('runtime.panel_on') : t('runtime.panel_off') }) +
								t('runtime.panel_status_record', { state: cfg.recordTranscripts ? t('runtime.panel_on') : t('runtime.panel_off') }) +
								t('runtime.panel_status_events', { count: counts.total ?? 0 }),
							metrics: [
								{ label: t('runtime.panel_metric_dm'), value: counts.dm ?? 0 },
								{ label: t('runtime.panel_metric_channel'), value: counts.channel ?? 0 },
								{ label: t('runtime.panel_metric_voice'), value: counts.voice ?? 0 },
								{ label: t('runtime.panel_metric_tool'), value: counts.tool ?? 0 },
								{ label: t('runtime.panel_metric_gate'), value: counts.gate ?? 0 },
								{
									label: t('runtime.panel_metric_response_p50'),
									value: stats.responseP50 === null ? '—' : t('runtime.seconds_value', { seconds: (stats.responseP50 / 1000).toFixed(1) }),
								},
								{ label: t('runtime.panel_metric_voice_source'), value: localMode ? t('runtime.panel_local') : 'GPT-Live' },
								{ label: t('runtime.panel_metric_member_index'), value: memberIndex.size ?? 0 },
								{ label: t('runtime.panel_metric_memory_notes'), value: memory?.stats().notes ?? 0 },
								{
									label: t('runtime.panel_metric_daily_live'),
									value: quota.enabled
										? t('runtime.minutes_pair', { used: Math.round(quotaStatus.used / 60), limit: Math.round(quotaStatus.limit / 60) })
										: t('runtime.minutes_value', { used: Math.round(quotaStatus.used / 60) }),
								},
							],
							music: music ? t('runtime.panel_music', { now: music.nowPlayingText(), volume: Math.round(music.volume * 100) }) : '',
						};
					},
					metrics: () => {
						const stats = latency.summary();
						const counts = activity.stats();
						const quotaStatus = quota.status();
						return {
							up: 1,
							uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
							voice_connected: voice.connected ? 1 : 0,
							live_ready: live?.ready ? 1 : 0,
							events_total: counts.total ?? 0,
							events_voice: counts.voice ?? 0,
							events_dm: counts.dm ?? 0,
							events_channel: counts.channel ?? 0,
							events_tool: counts.tool ?? 0,
							events_gate: counts.gate ?? 0,
							response_p50_ms: stats.responseP50 ?? 0,
							response_p90_ms: stats.responseP90 ?? 0,
							delegation_p50_ms: stats.delegationP50 ?? 0,
							tool_p50_ms: stats.toolP50 ?? 0,
							live_seconds_today: quotaStatus.used,
							live_quota_seconds: quotaStatus.limit,
							music_playing: music?.playing ? 1 : 0,
							music_queue: music?.queue.length ?? 0,
							member_index_size: memberIndex.size ?? 0,
							memory_notes: memory?.stats().notes ?? 0,
						};
					},
					health: () => ({
						ok: Boolean(client?.isReady?.()),
						discord: Boolean(client?.isReady?.()),
						voice: voice.connected,
						brain,
						chatterbox: localServer?.status ?? null,
						live: Boolean(live?.ready),
						paused,
						quotaExceeded: quota.status().exceeded,
						uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
					}),
				});
			} catch (err) {
				log(t('boot.panel_failed', { error: err.message }));
			}
		}
	} catch (err) {
		console.error(t('boot.setup_failed', { error: err.message }));
		void shutdown(1);
	}
});

client.login(cfg.discordToken).catch((err) => {
	console.error(t('boot.login_failed', { error: err.message }));
	process.exitCode = 1;
	client.destroy();
});
