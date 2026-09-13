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
		this.dropped = 0;
		this.nextAt = 0;
		this.timer = null;
		this.lastActive = '';
	}

	get running() {
		return this.timer !== null;
	}

	/** Runs exactly one 20 ms step. Returns what happened (used by tests). */
	tick() {
		const { pcm, active, priority } = this.mixer.tick();
		const live = this.getLive();
		const sent = Boolean(live?.ready && live.sendAudio(pcm));
		this.onFrame?.({ priority, active, sent });
		if (this.debug && active.length > 0) {
			const key = active.join(',');
			if (key !== this.lastActive) this.log(t('voice.speaking', { ids: key }));
			this.lastActive = key;
		} else if (this.debug) {
			this.lastActive = '';
		}

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
			if (this.dropped % 250 === 1) this.log(t('voice.output_blocked', { count: this.dropped }));
		} else {
			// PassThrough keeps a view onto the buffer it is given: hand it a copy of the shared buffer.
			const ok = this.output.write(frame ? Buffer.from(frame) : SILENCE);
			if (!ok) {
				this.backpressure = true;
				this.output.once('drain', () => {
					this.backpressure = false;
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
			// Long pause (GC, sleep, a blocked event loop): do not burst out the missed frames, realign instead.
			if (now - this.nextAt > 1000) this.nextAt = now;
			while (this.nextAt <= now) {
				this.tick();
				this.nextAt += FRAME_MS;
			}
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
