// Voice session manager: join/leave a channel, receive audio per speaker, run the 20 ms bridge and
// push the bot's voice (and music) into the channel.
//
// DAVE/E2EE is handled automatically by @discordjs/voice 0.19+.

import { PassThrough } from 'node:stream';
import {
	EndBehaviorType,
	NoSubscriberBehavior,
	StreamType,
	VoiceConnectionStatus,
	createAudioPlayer,
	createAudioResource,
	joinVoiceChannel,
} from '@discordjs/voice';
import prism from 'prism-media';
import { SAMPLES_PER_FRAME_48K, stereo48kToMono24k } from './audio.js';
import { AudioBridge } from './bridge.js';
import { t } from './i18n/index.js';

const READY_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

/**
 * Resolves once the connection reaches `status`; if it goes Destroyed instead (and that is not the
 * target state) it rejects right away, so the 15 s timeout is not waited out for nothing.
 */
function waitForState(connection, status, timeoutMs) {
	if (connection.state.status === status) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			connection.off('stateChange', onState);
		};
		const onState = (_oldState, newState) => {
			if (newState.status === status) {
				cleanup();
				resolve();
			} else if (newState.status === VoiceConnectionStatus.Destroyed) {
				cleanup();
				reject(new Error(t('voice.connection_destroyed')));
			}
		};
		const timer = setTimeout(() => {
			connection.off('stateChange', onState);
			reject(new Error(t('voice.state_timeout', { status, current: connection.state.status })));
		}, timeoutMs);
		connection.on('stateChange', onState);
	});
}

export class VoiceSession {
	constructor({
		getClient = null,
		client = null,
		mixer,
		playback,
		getLive,
		music = null,
		ducker = null,
		log,
		debug = false,
		soloUserId = null,
		onSpeaking = null,
		onLost = null,
		onFrame = null,
		onUserPcm = null,
	}) {
		this._client = client;
		this.getClient = getClient ?? (() => this._client);
		this.mixer = mixer;
		this.playback = playback;
		this.getLive = getLive;
		this.music = music;
		this.ducker = ducker;
		this.log = log;
		this.debug = debug;
		this.soloUserId = soloUserId;
		this.onSpeaking = onSpeaking;
		this.onLost = onLost;
		this.onFrame = onFrame;
		this.onUserPcm = onUserPcm; // local STT: decoded 24 kHz mono packet per user

		this.connection = null;
		this.player = null;
		this.pcmStream = null;
		this.bridge = null;
		this.subscriptions = new Map(); // userId -> { opusStream, decoder }
		this._joining = null;
		this._joiningChannel = null;
		this._joinSeq = 0;
	}

	get client() {
		return this.getClient();
	}

	set client(value) {
		this._client = value;
	}

	get connected() {
		return this.connection?.state?.status === VoiceConnectionStatus.Ready;
	}

	get channelId() {
		return this.connection?.joinConfig?.channelId ?? null;
	}

	/**
	 * Joins a channel. Does nothing when we are already solidly connected to it; waits for an in-flight
	 * join to the same channel; an in-flight join to a DIFFERENT channel is cancelled.
	 */
	async join(guild, channel) {
		const current = this.connection?.joinConfig;
		if (current?.channelId === channel.id && this.connected) return; // already solidly connected
		if (this._joining && this._joiningChannel === channel.id) return this._joining; // a join is in flight: wait for it
		const seq = ++this._joinSeq; // another in-flight join sees this number change and gives up
		this._joiningChannel = channel.id;
		this._joining = this._join(guild, channel, seq);
		try {
			await this._joining;
		} finally {
			if (this._joinSeq === seq) {
				this._joining = null;
				this._joiningChannel = null;
			}
		}
	}

	async _join(guild, channel, seq) {
		this.leave();
		let attempt = 0;
		for (;;) {
			if (seq !== this._joinSeq) throw new Error(t('voice.join_cancelled'));
			const connection = joinVoiceChannel({
				channelId: channel.id,
				guildId: guild.id,
				adapterCreator: guild.voiceAdapterCreator,
				selfDeaf: false, // a deafened client receives no audio
				selfMute: false,
				group: `${this.client.user.id}:${attempt}`,
			});
			this.connection = connection;
			try {
				await waitForState(connection, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
				if (seq !== this._joinSeq || this.connection !== connection) {
					try {
						connection.destroy();
					} catch {
						/* ignore */
					}
					throw new Error(t('voice.join_cancelled'));
				}
				break;
			} catch (err) {
				if (seq !== this._joinSeq || this.connection !== connection) throw err;
				if (attempt + 1 >= MAX_ATTEMPTS) {
					this.leave();
					throw err;
				}
				attempt++;
				// After a stale voice state Discord can leave the join request unanswered; leaving and
				// rejoining forces a real state change.
				this.log(t('voice.join_retry'));
				try {
					connection.destroy();
				} catch {
					/* ignore */
				}
				await new Promise((resolve) => setTimeout(resolve, 1500));
			}
		}
		this.setupRuntime();
	}

	setupRuntime() {
		const connection = this.connection;
		const isCurrent = () => this.connection === connection;

		connection.on('stateChange', (oldState, newState) => {
			if (!isCurrent()) return;
			if (this.debug) this.log(t('voice.state_change', { from: oldState.status, to: newState.status }));
			if (newState.status === VoiceConnectionStatus.Disconnected) {
				// Pushing audio into a broken transport after a drop produces robotic/choppy sound; pause the
				// stream and start it again if the connection comes back.
				this.bridge?.stop();
			} else if (newState.status === VoiceConnectionStatus.Ready && this.bridge && !this.bridge.running) {
				this.bridge.start();
			}
		});
		connection.on('error', (err) => {
			if (!isCurrent()) return;
			this.log(t('voice.connection_error'), err.message);
		});
		connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
			// While switching channels the old connection still emits its closing events; ignore them.
			if (!isCurrent()) return;
			const code = newState.closeCode ? t('voice.disconnect_code', { code: newState.closeCode }) : '';
			this.log(t('voice.disconnected', { reason: newState.reason ?? '?', code }));
			try {
				await waitForState(connection, VoiceConnectionStatus.Ready, 15_000);
			} catch {
				if (!isCurrent()) return;
				this.onLost?.();
			}
		});

		this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
		this.player.on('error', (err) => this.log(t('voice.player_error'), err.message));
		// A 20 ms stereo frame is 3840 bytes, so the stream's default 16 KB cushion is about 85 ms: one
		// garbage collection or one slow tick of the event loop overflows it, and an overflowing output
		// drops the bot's own speech rather than delaying it. 64 KB is around a third of a second, enough
		// to ride out a hiccup while still far too small to let stale audio pile up behind a real stall.
		this.pcmStream = new PassThrough({ highWaterMark: 64 * 1024 });
		this.pcmStream.on('error', (err) => this.log(t('voice.stream_error'), err.message));
		this.player.play(createAudioResource(this.pcmStream, { inputType: StreamType.Raw }));
		connection.subscribe(this.player);

		connection.receiver.speaking.on('start', (userId) => {
			if (!isCurrent()) return;
			if (userId === this.client.user.id) return;
			this.onSpeaking?.(userId);
			this.ensureSubscription(userId);
		});

		this.bridge = new AudioBridge({
			mixer: this.mixer,
			playback: this.playback,
			output: this.pcmStream,
			getLive: this.getLive,
			music: this.music,
			ducker: this.ducker,
			debug: this.debug,
			log: this.log,
			onFrame: this.onFrame,
		});
		this.bridge.start();
	}

	ensureSubscription(userId) {
		if (this.subscriptions.has(userId)) return;
		if (this.soloUserId && userId !== this.soloUserId) return;
		if (!this.connection) return;

		const opusStream = this.connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
		const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: SAMPLES_PER_FRAME_48K });
		decoder.on('data', (pcm) => {
			const mono = stereo48kToMono24k(pcm);
			this.mixer.push(userId, mono);
			this.onUserPcm?.(userId, mono);
		});
		let failed = false;
		const fail = (label, err) => {
			if (failed) return;
			failed = true;
			this.log(`${label} (${userId}):`, err.message);
			try {
				opusStream.destroy();
			} catch {
				/* ignore */
			}
		};
		opusStream.on('error', (err) => fail(t('voice.receive_error'), err));
		// A corrupt packet (e.g. after a DAVE transition) can lock the decoder up; drop the subscription so
		// that the next time the user speaks we resubscribe with a fresh decoder.
		decoder.on('error', (err) => fail(t('voice.opus_decode_error'), err));
		opusStream.pipe(decoder);

		let done = false;
		const cleanup = () => {
			if (done) return;
			done = true;
			this.subscriptions.delete(userId);
			this.mixer.removeUser(userId);
			try {
				decoder.destroy();
			} catch {
				/* ignore */
			}
		};
		opusStream.once('close', cleanup);
		opusStream.once('end', cleanup);

		this.subscriptions.set(userId, { opusStream, decoder });
	}

	/** The user left the channel: drop their subscription and buffer so nothing leaks. */
	dropUser(userId) {
		const sub = this.subscriptions.get(userId);
		if (!sub) return;
		try {
			sub.opusStream.destroy();
		} catch {
			/* ignore */
		}
	}

	leave() {
		this.bridge?.stop();
		this.bridge = null;
		for (const [userId, sub] of this.subscriptions) {
			try {
				sub.opusStream.destroy();
			} catch {
				/* ignore */
			}
			this.mixer.removeUser(userId);
		}
		this.subscriptions.clear();
		// Do not let stale model audio play on the next join.
		this.playback?.clear?.();

		try {
			this.player?.stop();
		} catch {
			/* ignore */
		}
		this.player = null;

		try {
			this.pcmStream?.end();
		} catch {
			/* ignore */
		}
		this.pcmStream = null;

		const connection = this.connection;
		this.connection = null;
		if (connection) {
			try {
				connection.destroy();
			} catch {
				/* ignore */
			}
		}
	}

	/** While leaving, waits for the "I left" notice to reach the gateway. */
	async destroy() {
		const connection = this.connection;
		this.leave();
		if (connection) await waitForState(connection, VoiceConnectionStatus.Destroyed, 2000).catch(() => {});
	}
}
