// Discord voice bot: joins a channel, listens to whoever is speaking, holds a spoken conversation
// over GPT-Live, and is driven from slash commands and the panel; voice commands (switch character,
// send a message to a channel, join a channel, play music) let it operate Discord.
//
//   channel -> per-user Opus -> decode -> mono 24k -> mixer -> GPT-Live (gpt-live-1)
//   channel <- Opus encode <- 48k stereo <- [bot audio + ducked music] <- playback / music
//
// This file keeps the process-wide half only: configuration, the shared services, the Discord client
// and its events, the panel and the shutdown path. Everything that belongs to ONE server lives in the
// GuildSession built from cfg.guildId (src/guildsession.js).
//
// Slash commands: join, leave, panel, character, send, read, status, music, summary, record, help

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { OpenAI } from 'openai';
import { handleInteraction, RecentActions, registerCommands } from './commands.js';
import { loadConfig } from './config.js';
import { GuildSession } from './guildsession.js';
import { t, tList } from './i18n/index.js';
import { LocalServerManager, detectVenvPython } from './localserver.js';
import { LocalStt } from './localstt.js';
import { MemoryStore } from './memory.js';
import { ReplyLimiter, handleMessage } from './messages.js';
import { ActivityLog, startPanel } from './panel.js';
import { createTextProvider } from './provider.js';
import { DailyQuota } from './quota.js';
import { ChannelReader } from './reader.js';
import { CharacterStore } from './store.js';
import { summarizeConversation } from './summary.js';
import { callTool, toolDefinitions } from './tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');

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
const recentActions = new RecentActions();
const reader = new ChannelReader({ defaultLimit: cfg.readLimit });
const replyLimiter = new ReplyLimiter({ perMinute: 6 });
// The event stream the panel shows: voice transcripts, DM/channel messages, tool calls, gate decisions.
const activity = new ActivityLog({ file: path.join(dataDir, 'activity.jsonl'), log, redact: () => !cfg.recordTranscripts });

/** Privacy: while recording is off, personal text (voice transcript, DM, channel message) is counted, not stored. */
function record(event) {
	if (!cfg.recordTranscripts && ['voice', 'dm', 'channel'].includes(event.kind) && event.text) {
		return activity.push({ ...event, text: t('runtime.record_off_placeholder', { count: String(event.text).length }), meta: null, persist: false });
	}
	return activity.push(event);
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

// ---------------------------------------------------------------- local speech server (ears + mouth)

function safePort(url, fallback) {
	try {
		return Number(new URL(url).port) || fallback;
	} catch {
		return fallback;
	}
}

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
const localStt = new LocalStt({ url: cfg.localSttUrl, language: cfg.localSttLang, log: (message) => cfg.debug && log(message) });

let client = null;
let session = null;
let panel = null;
let shuttingDown = false;

// ---------------------------------------------------------------- command context

// What the slash commands and the panel work on is one server's session; with several guilds this is
// the session of the guild the interaction came from.
const ctx = {
	store,
	config: cfg,
	log,
	quota,
	memory,
	get voice() {
		return session.voice;
	},
	get latency() {
		return session.latency;
	},
	get music() {
		return session.music;
	},
	localMode: () => session.localMode,
	brain: () => session.brain,
	chatterbox: () => localServer?.status ?? null,
	getLive: () => session.live,
	refreshPersona: (reason) => session.refreshPersona(reason),
	say: (text) => session.say(text),
	applySetting: (name, value) => session.applySetting(name, value),
	summarize: (options) => session.deps().summarize(options),
	activity: (event) => activity.push(event),
	callTool: (name, args) => callTool(name, args, session.deps()),
	joinVoice: (channel) => session.joinVoice(channel),
	leaveVoice: (options) => session.leaveVoice(options),
};

// ---------------------------------------------------------------- lifecycle

async function shutdown(code = 0) {
	if (shuttingDown) return;
	shuttingDown = true;
	log(t('runtime.shutting_down'));
	session?.stop();
	try {
		localServer?.stop();
	} catch {
		/* ignore */
	}
	await panel?.close().catch(() => {});
	await session?.dispose();
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
	if (message.member) session?.rememberMember(message.member);
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
		getLive: () => session?.live ?? null,
	})
		.then((reply) => {
			if (!reply) return;
			record({
				kind: isDm ? 'dm' : 'channel',
				direction: 'out',
				whoName: session?.persona().name ?? 'bot',
				text: reply,
				meta: where,
			});
		})
		.catch((err) => log(t('runtime.message_error', { error: err.message })));
});

client.on(Events.GuildMemberRemove, (member) => {
	if (member.guild?.id !== cfg.guildId) return;
	session?.forgetMember(member.id);
});
client.on(Events.GuildMemberUpdate, (_old, member) => {
	if (member.guild?.id !== cfg.guildId) return;
	session?.rememberMember(member, { stale: true });
});
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
	session?.onVoiceStateUpdate(oldState, newState);
});

client.once(Events.ClientReady, async () => {
	try {
		const guild = await client.guilds.fetch(cfg.guildId);
		session = new GuildSession({
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
			summarize: summarizeConversation,
			presenceEnabled: usePresence,
		});
		if (cfg.panelEnabled) {
			const past = await activity.load(500);
			if (past) log(t('boot.panel_history', { count: past }));
		}
		await registerCommands(client, cfg.guildId, log);

		await session.start();

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
		if (session.music) {
			log(
				t('boot.music_on', {
					volume: Math.round(session.music.volume * 100),
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

		// The local admin panel: DM/channel messages, voice transcripts, tool and gate records, health/metric endpoints.
		if (cfg.panelEnabled) {
			try {
				panel = await startPanel({
					activity,
					port: cfg.panelPort,
					log,
					nameFor: (userId) => session.nameFor(userId),
					state: () => {
						const snapshot = session.status();
						const stats = snapshot.latency;
						const counts = activity.stats();
						const quotaStatus = quota.status();
						return {
							title: t('runtime.panel_title', { name: snapshot.personaName ?? t('runtime.panel_default_name') }),
							status:
								t('runtime.panel_status_voice', {
									channel: snapshot.voiceConnected ? `#${snapshot.voiceChannelName ?? '?'}` : t('runtime.panel_off'),
								}) +
								t('runtime.panel_status_brain', { brain: snapshot.brain === 'local' ? t('runtime.panel_local') : 'GPT-Live' }) +
								(localServer ? t('runtime.panel_status_chatterbox', { status: localServer.status }) : '') +
								t('runtime.panel_status_live', { state: snapshot.liveReady ? t('runtime.panel_on') : t('runtime.panel_off') }) +
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
								{ label: t('runtime.panel_metric_voice_source'), value: snapshot.localMode ? t('runtime.panel_local') : 'GPT-Live' },
								{ label: t('runtime.panel_metric_member_index'), value: snapshot.memberIndexSize },
								{ label: t('runtime.panel_metric_memory_notes'), value: memory?.stats().notes ?? 0 },
								{
									label: t('runtime.panel_metric_daily_live'),
									value: quota.enabled
										? t('runtime.minutes_pair', { used: Math.round(quotaStatus.used / 60), limit: Math.round(quotaStatus.limit / 60) })
										: t('runtime.minutes_value', { used: Math.round(quotaStatus.used / 60) }),
								},
							],
							music: snapshot.music
								? t('runtime.panel_music', { now: snapshot.music.text, volume: Math.round(snapshot.music.volume * 100) })
								: '',
						};
					},
					metrics: () => {
						const snapshot = session.status();
						const stats = snapshot.latency;
						const counts = activity.stats();
						const quotaStatus = quota.status();
						return {
							up: 1,
							uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
							voice_connected: snapshot.voiceConnected ? 1 : 0,
							live_ready: snapshot.liveReady ? 1 : 0,
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
							music_playing: snapshot.music?.playing ? 1 : 0,
							music_queue: snapshot.music?.queue ?? 0,
							member_index_size: snapshot.memberIndexSize,
							memory_notes: memory?.stats().notes ?? 0,
						};
					},
					health: () => {
						const snapshot = session.status();
						return {
							ok: Boolean(client?.isReady?.()),
							discord: Boolean(client?.isReady?.()),
							voice: snapshot.voiceConnected,
							brain: snapshot.brain,
							chatterbox: localServer?.status ?? null,
							live: snapshot.liveReady,
							paused: snapshot.paused,
							quotaExceeded: quota.status().exceeded,
							uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
						};
					},
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
