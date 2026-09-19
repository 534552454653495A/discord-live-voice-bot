// The 20 ms audio bridge between Discord and the Live session.
//
// One tick does three things:
//   1. mixer -> model : every tick sends one 20 ms frame (silence included) so the
//                       Live input stream stays continuous, as the API expects.
//   2. model -> Discord: drains the playback queue (model voice or local TTS) into 48 kHz stereo.
//   3. music -> Discord: mixes the music player's frame underneath, ducked while the bot speaks.

import {
	FRAME_MS,
	SAMPLES_PER_FRAME_24K,
	STEREO_SAMPLES_PER_FRAME_48K,
	mixInto,
	upsampleMono24kToStereo48k,
} from './audio.js';
import { t } from './i18n/index.js';
import { Ducker } from './music.js';

const JITTER_FRAMES = 4; // ~80 ms of pre-buffered model audio before playback starts
const SILENCE = Buffer.alloc(STEREO_SAMPLES_PER_FRAME_48K * 2); // shared; the stream never mutates it

export class AudioBridge {
	constructor({
		mixer,
		playback,
		output,
		getLive,
		music = null,
		ducker = null,
		debug = false,
		log = () => {},
		onFrame = null,
	}) {
		this.mixer = mixer;
		this.playback = playback;
		this.output = output;
		this.getLive = getLive;
		this.music = music;
		this.ducker = ducker ?? new Ducker();
		this.debug = debug;
		this.log = log;
		this.onFrame = onFrame;

		this.frameBuf = new Int16Array(SAMPLES_PER_FRAME_24K);
		this.voiceOut = new Int16Array(STEREO_SAMPLES_PER_FRAME_48K);
		this.musicOut = new Int16Array(STEREO_SAMPLES_PER_FRAME_48K);
		this.upState = { last: 0 };
		this.primed = false;
		this.backpressure = false;
		this.dropped = 0; // every frame ever dropped (the panel reads this)
		this.dropRun = 0; // frames dropped in the stall going on right now
		this.nextAt = 0;
		this.timer = null;
		this.lastActive = '';
		// How the 20 ms loop is keeping time: frames the model took, the wall clock those spanned (gaps
		// of a second or more, a reconnect, left out), the latest a tick ever ran, and how often the loop
		// had to run more than one tick to catch up. sent * 20 ms against sentSpanMs is the test of whether
		// this side sends audio at the rate of the clock; the transcript's drift is measured against it.
		this.stats = { ticks: 0, sent: 0, sentSpanMs: 0, lastSentAt: 0, maxLateMs: 0, bursts: 0, realigns: 0 };
	}

	/** Audio sent per wall-clock second, as a ratio (1 = exactly real time); null until there is enough of it. */
	get sentRatio() {
		if (this.stats.sentSpanMs < 1000) return null;
		return (this.stats.sent * FRAME_MS) / this.stats.sentSpanMs;
	}

	get running() {
		return this.timer !== null;
	}

	/**
	 * Point at a fresh output. The old one is gone -- a voice reconnect destroys it -- and everything the
	 * bridge remembered about it (that it was blocked, how much had been dropped while it was) belongs to
	 * that dead stream, not to this one.
	 */
	setOutput(output) {
		this.output = output;
		this.backpressure = false;
		this.dropRun = 0;
	}

	/** Runs exactly one 20 ms step. Returns what happened (used by tests). */
	tick() {
		const { pcm, active, present, priority, others } = this.mixer.tick();
		const live = this.getLive();
		const sent = Boolean(live?.ready && live.sendAudio(pcm));
		this.stats.ticks++;
		if (sent) {
			const now = Date.now();
			const gap = now - this.stats.lastSentAt;
			if (this.stats.lastSentAt && gap < 1000) this.stats.sentSpanMs += gap;
			this.stats.lastSentAt = now;
			this.stats.sent++;
		}
		this.onFrame?.({ priority, active, present, others, sent, pcm });
		// The "who is speaking" debug line is printed by the session (GuildSession.logSpeaking), which can
		// turn an id into a name; the bridge cannot, and printing raw ids here was most of the debug log.

		// --- bot voice (model or local TTS) ---
		if (!this.primed && this.playback.length >= SAMPLES_PER_FRAME_24K * JITTER_FRAMES) this.primed = true;
		let voice = false;
		if (this.primed) {
			const n = this.playback.read(this.frameBuf, SAMPLES_PER_FRAME_24K);
			if (n > 0) {
				// Partial frame (the queue is running dry): pad it with zeros and play it so the last ~19 ms is not lost.
				if (n < SAMPLES_PER_FRAME_24K) this.frameBuf.fill(0, n);
				upsampleMono24kToStereo48k(this.frameBuf, this.upState, this.voiceOut);
				voice = true;
				if (n < SAMPLES_PER_FRAME_24K) this.primed = false;
			} else {
				this.primed = false;
			}
		}

		// --- music (ducked while the bot is speaking) ---
		let musicPlayed = false;
		let gain = 1;
		if (this.music?.active) {
			const n = this.music.readFrame(this.musicOut, STEREO_SAMPLES_PER_FRAME_48K);
			if (typeof this.music.duckRatio === 'number') this.ducker.duck = this.music.duckRatio;
			gain = this.ducker.tick(voice);
			if (n > 0) {
				musicPlayed = true;
				if (!voice) this.voiceOut.fill(0);
				mixInto(this.voiceOut, this.musicOut, STEREO_SAMPLES_PER_FRAME_48K, gain * this.music.volume);
			}
		} else if (this.ducker.gain !== 1) {
			this.ducker.reset();
		}

		const frame = voice || musicPlayed ? Buffer.from(this.voiceOut.buffer, this.voiceOut.byteOffset, this.voiceOut.byteLength) : null;

		// If the consumer stalled (Discord reconnecting, player idle) drop frames instead of
		// buffering stale audio forever; 'drain' resumes the flow.
		if (this.backpressure) {
			this.dropped++;
			this.dropRun++;
		} else {
			// PassThrough keeps a view onto the buffer it is given: hand it a copy of the shared buffer.
			const ok = this.output.write(frame ? Buffer.from(frame) : SILENCE);
			if (!ok) {
				this.backpressure = true;
				this.output.once('drain', () => {
					this.backpressure = false;
					// Reported per stall, with how much speech it cost. A running total said "501 frames
					// dropped" hours into a session and read as a ten second outage that had never happened.
					if (this.dropRun > 0) {
						this.log(t('voice.output_blocked', { count: this.dropRun, ms: this.dropRun * FRAME_MS }));
						this.dropRun = 0;
					}
				});
			}
		}
		return { active, sent, played: voice, music: musicPlayed, gain, dropped: this.dropped, priority };
	}

	start() {
		if (this.timer) return;
		this.nextAt = Date.now();
		const loop = () => {
			const now = Date.now();
			const late = now - this.nextAt;
			if (late > this.stats.maxLateMs) this.stats.maxLateMs = late;
			// Long pause (GC, sleep, a blocked event loop): do not burst out the missed frames, realign instead.
			if (late > 1000) {
				this.nextAt = now;
				this.stats.realigns++;
			}
			let ran = 0;
			while (this.nextAt <= now) {
				this.tick();
				this.nextAt += FRAME_MS;
				ran++;
			}
			if (ran > 1) this.stats.bursts++;
			this.timer = setTimeout(loop, Math.max(0, this.nextAt - Date.now()));
		};
		loop();
	}

	stop() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.primed = false;
		this.backpressure = false;
	}
}
