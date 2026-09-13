// Local speech recognition (the ears): per-user speech segmentation (VAD) plus posting to the
// /stt (faster-whisper) endpoint on the Chatterbox server. Provides the input side of the voice
// conversation when GPT-Live is unavailable (out of credit / local mode).

import { EventEmitter } from 'node:events';
import { peakOf } from './audio.js';
import { t } from './i18n/index.js';
import { resampleLinear } from './localtts.js';

const STT_RATE = 16_000;

/**
 * Per-user, energy based speech segmenter.
 * Discord only sends packets while someone is speaking; silence does not arrive as packets. That is
 * why the "speech ended" decision is made on a timer: a segment closes `silenceMs` after the last
 * packet (poll()).
 * Events: 'start' { userId } (for barge-in), 'segment' { userId, pcm (24 kHz mono), durationMs }.
 */
export class SpeechSegmenter extends EventEmitter {
	constructor({
		sampleRate = 24_000,
		activityPeak = 400,
		silenceMs = 700,
		minMs = 350,
		maxMs = 15_000,
		preRollMs = 240,
		now = Date.now,
	} = {}) {
		super();
		this.sampleRate = sampleRate;
		this.activityPeak = activityPeak;
		this.silenceMs = silenceMs;
		this.minMs = minMs;
		this.maxMs = maxMs;
		this.preRollSamples = Math.round((preRollMs / 1000) * sampleRate);
		this.now = now;
		this.users = new Map(); // userId -> state
		this.enabled = true;
	}

	_state(userId) {
		let state = this.users.get(userId);
		if (!state) {
			state = { speaking: false, chunks: [], samples: 0, activeSamples: 0, preRoll: [], preRollSamples: 0, lastPacketAt: 0, startedAt: 0 };
			this.users.set(userId, state);
		}
		return state;
	}

	/** A user's decoded 24 kHz mono packet (voice.js -> decoder). */
	push(userId, samples) {
		if (!this.enabled || !samples?.length) return;
		const state = this._state(userId);
		const now = this.now();
		const loud = peakOf(samples) > this.activityPeak;
		state.lastPacketAt = now;
		if (!state.speaking) {
			if (!loud) {
				// Silent pre-roll buffer, so the first syllable of the speech is not lost.
				state.preRoll.push(samples);
				state.preRollSamples += samples.length;
				while (state.preRollSamples > this.preRollSamples && state.preRoll.length > 1) {
					state.preRollSamples -= state.preRoll.shift().length;
				}
				return;
			}
			state.speaking = true;
			state.startedAt = now;
			state.chunks = [...state.preRoll];
			state.samples = state.preRollSamples;
			state.activeSamples = 0;
			state.preRoll = [];
			state.preRollSamples = 0;
			this.emit('start', { userId });
		}
		state.chunks.push(samples);
		state.samples += samples.length;
		if (loud) state.activeSamples += samples.length;
		if ((state.samples / this.sampleRate) * 1000 >= this.maxMs) this._finish(userId, state);
	}

	/** Segments that close on a timer: must be called about every 100 ms. */
	poll() {
		const now = this.now();
		for (const [userId, state] of this.users) {
			if (state.speaking && now - state.lastPacketAt >= this.silenceMs) this._finish(userId, state);
		}
	}

	_finish(userId, state) {
		const chunks = state.chunks;
		const total = state.samples;
		const activeMs = (state.activeSamples / this.sampleRate) * 1000;
		const startedAt = state.startedAt;
		state.speaking = false;
		state.chunks = [];
		state.samples = 0;
		state.activeSamples = 0;
		if (activeMs < this.minMs || !total) return;
		const pcm = new Int16Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			pcm.set(chunk, offset);
			offset += chunk.length;
		}
		this.emit('segment', { userId, pcm, durationMs: Math.round((total / this.sampleRate) * 1000), startedAt, endedAt: this.now() });
	}

	/** Drop everything that is pending (when the mode changes). */
	reset() {
		this.users.clear();
	}

	get speakingUsers() {
		return [...this.users.entries()].filter(([, s]) => s.speaking).map(([id]) => id);
	}
}

/** HTTP client for the /stt (faster-whisper) endpoint on the Chatterbox server. */
export class LocalStt {
	constructor({ url = 'http://127.0.0.1:8020', language = 'auto', timeoutMs = 30_000, log = () => {} } = {}) {
		this.url = String(url).replace(/\/$/, '');
		this.language = language;
		this.timeoutMs = timeoutMs;
		this.log = log;
		this.busy = 0;
	}

	/** Is the server up and the STT model loaded? */
	async health() {
		try {
			const response = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(5000) });
			if (!response.ok) return null;
			const info = await response.json();
			return { ...info, sttReady: Boolean(info?.stt) };
		} catch (err) {
			this.log(t('brain.stt_health_failed', { error: err?.message ?? err }));
			return null;
		}
	}

	/**
	 * 24 kHz mono int16 -> text. The server is sent 16 kHz.
	 * @returns {Promise<{ text: string, language: string|null, durationMs: number }>}
	 */
	async transcribe(pcm24k, { language = this.language, prompt = null, signal = null } = {}) {
		const pcm = resampleLinear(pcm24k, 24_000, STT_RATE);
		const body = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
		const params = new URLSearchParams();
		if (language && language !== 'auto') params.set('language', language);
		if (prompt) params.set('prompt', String(prompt).slice(0, 200)); // whisper initial_prompt: names
		const timeout = AbortSignal.timeout(this.timeoutMs);
		this.busy++;
		try {
			const response = await fetch(`${this.url}/stt${params.size ? `?${params}` : ''}`, {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream', 'x-sample-rate': String(STT_RATE) },
				body,
				signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
			});
			if (!response.ok) {
				const detail = await response.text().catch(() => '');
				const status = response.status;
				throw new Error(detail ? t('brain.stt_error_detail', { status, detail: detail.slice(0, 200) }) : t('brain.stt_error', { status }));
			}
			const info = await response.json();
			return {
				text: String(info?.text ?? '').replace(/\s+/g, ' ').trim(),
				language: info?.language ?? null,
				durationMs: Math.round((pcm.length / STT_RATE) * 1000),
			};
		} finally {
			this.busy--;
		}
	}
}
