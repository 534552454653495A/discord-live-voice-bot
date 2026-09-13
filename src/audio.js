// Audio DSP + buffering for the Discord <-> GPT-Live bridge.
//
// Formats involved:
//   Discord receive : Opus -> PCM s16le, 48000 Hz, stereo (we decode with prism-media)
//   GPT-Live        : PCM s16le, 24000 Hz, mono  (session.audio.format = audio/pcm @ 24000)
//   Discord playback: PCM s16le, 48000 Hz, stereo (StreamType.Raw)
//
// No ffmpeg is used on the voice path; all conversions are the small integer routines below.
// (Music playback decodes through ffmpeg separately, see music.js.)

import { t } from './i18n/index.js';

export const FRAME_MS = 20;
export const SAMPLES_PER_FRAME_24K = 480; // 20 ms @ 24 kHz
export const SAMPLES_PER_FRAME_48K = 960; // 20 ms @ 48 kHz
export const STEREO_SAMPLES_PER_FRAME_48K = SAMPLES_PER_FRAME_48K * 2; // interleaved L/R

/** Peak value (absolute int16). The loop that would otherwise be repeated everywhere, kept in one place. */
export function peakOf(samples, count = samples.length) {
	let peak = 0;
	for (let i = 0; i < count; i++) {
		const value = samples[i];
		const abs = value < 0 ? -value : value;
		if (abs > peak) peak = abs;
	}
	return peak;
}

/** out[i] += src[i] * gain (clamped to the int16 range). */
export function mixInto(out, src, count = src.length, gain = 1) {
	for (let i = 0; i < count; i++) {
		const sum = out[i] + src[i] * gain;
		out[i] = sum > 32767 ? 32767 : sum < -32768 ? -32768 : sum | 0;
	}
}

/**
 * Buffer(s16le stereo 48k) -> Int16Array(mono 24k).
 * Channel downmix + 2-tap box filter + decimate by 2 (cheap anti-aliasing before
 * the 24 kHz rate that GPT-Live expects).
 */
export function stereo48kToMono24k(pcm) {
	const frames = pcm.length >> 2; // stereo frames
	const out = new Int16Array(frames >> 1);
	for (let i = 0; i < out.length; i++) {
		const a = i * 8; // byte offset of the even frame of the pair
		const b = a + 4; // byte offset of the odd frame of the pair
		const monoA = (pcm.readInt16LE(a) + pcm.readInt16LE(a + 2)) >> 1;
		const monoB = (pcm.readInt16LE(b) + pcm.readInt16LE(b + 2)) >> 1;
		out[i] = (monoA + monoB) >> 1;
	}
	return out;
}

/**
 * Int16Array(mono 24k) -> Int16Array(stereo 48k, interleaved) with linear interpolation.
 * `state.last` carries the previous sample across calls so interpolation is continuous.
 * If `out` is given it is reused, so no allocation happens.
 */
export function upsampleMono24kToStereo48k(src, state = { last: 0 }, out = null) {
	const n = src.length;
	const target = out && out.length >= n * 4 ? out : new Int16Array(n * 4);
	let prev = state.last ?? (n > 0 ? src[0] : 0);
	for (let i = 0; i < n; i++) {
		const b = src[i];
		const mid = (prev + b) >> 1;
		const o = i * 4;
		target[o] = mid;
		target[o + 1] = mid;
		target[o + 2] = b;
		target[o + 3] = b;
		prev = b;
	}
	state.last = prev;
	return target;
}

/** Int16Array(mono 24k) -> Buffer(s16le stereo 48k). */
export function mono24kToStereo48k(src, state = { last: 0 }) {
	const out = upsampleMono24kToStereo48k(src, state);
	return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

/** Silence frame for Discord playback (20 ms worth by default). */
export function silenceStereo48k(samples = SAMPLES_PER_FRAME_48K) {
	return Buffer.alloc(samples * 4);
}

/** Fixed-capacity sample ring. Overflows drop the OLDEST samples (keeps audio fresh). */
export class Ring {
	constructor(capacity) {
		if (!Number.isInteger(capacity) || capacity <= 0) throw new Error(t('voice.ring_capacity', { capacity }));
		this.cap = capacity;
		this.buf = new Int16Array(capacity);
		this.r = 0;
		this.size = 0;
	}

	get length() {
		return this.size;
	}

	get free() {
		return this.cap - this.size;
	}

	push(src) {
		const n = src.length;
		if (n <= 0) return;
		if (n >= this.cap) {
			this.buf.set(src.subarray(n - this.cap), 0);
			this.r = 0;
			this.size = this.cap;
			return;
		}
		const w = (this.r + this.size) % this.cap;
		const first = Math.min(n, this.cap - w);
		this.buf.set(src.subarray(0, first), w);
		if (n > first) this.buf.set(src.subarray(first), 0);
		this.size += n;
		if (this.size > this.cap) {
			const drop = this.size - this.cap;
			this.r = (this.r + drop) % this.cap;
			this.size = this.cap;
		}
	}

	/** Read up to `max` samples into `dst`; returns how many were written. */
	read(dst, max = dst.length) {
		const n = Math.min(max, this.size, dst.length);
		if (n <= 0) return 0;
		const first = Math.min(n, this.cap - this.r);
		dst.set(this.buf.subarray(this.r, this.r + first), 0);
		if (n > first) dst.set(this.buf.subarray(0, n - first), first);
		this.r = (this.r + n) % this.cap;
		this.size -= n;
		return n;
	}

	clear() {
		this.r = 0;
		this.size = 0;
	}
}

/**
 * Per-speaker buffers summed into one 20 ms frame per tick.
 * Keeps each speaker's audio separate until the very last step so that
 * per-user features (solo listening, speaker announcements) stay possible.
 */
export class SpeakerMixer {
	constructor({ frameSamples = SAMPLES_PER_FRAME_24K, bufferFrames = 10, activityPeak = 50 } = {}) {
		this.frameSamples = frameSamples;
		this.bufferSamples = frameSamples * bufferFrames;
		this.activityPeak = activityPeak;
		this.rings = new Map();
		this.priorityId = null;
		this.tmp = new Int16Array(frameSamples);
		this.out = new Int16Array(frameSamples);
	}

	addUser(id) {
		if (!this.rings.has(id)) this.rings.set(id, new Ring(this.bufferSamples));
	}

	removeUser(id) {
		this.rings.delete(id);
	}

	push(id, samples) {
		let ring = this.rings.get(id);
		if (!ring) {
			ring = new Ring(this.bufferSamples);
			this.rings.set(id, ring);
		}
		ring.push(samples);
	}

	/**
	 * Priority speaker (e.g. the bot owner): while they talk only their audio is sent, and once they
	 * go quiet the normal mix comes back.
	 */
	setPriority(userId) {
		this.priorityId = userId;
	}

	/** Adds the samples to the output frame and returns their peak value. */
	_addToOut(out, samples, count) {
		mixInto(out, samples, count, 1);
		return peakOf(samples, count);
	}

	/**
	 * Sums one 20 ms frame. Returns { pcm, active, priority } (active = peaks above threshold).
	 * The returned `pcm` is a shared buffer: the next tick overwrites it, so the caller must consume it right away.
	 */
	tick() {
		const out = this.out;
		out.fill(0);
		const active = [];

		// 1) If the priority speaker is talking, only their audio goes out.
		if (this.priorityId) {
			const ring = this.rings.get(this.priorityId);
			if (ring && ring.length > 0) {
				const n = ring.read(this.tmp, this.frameSamples);
				const peak = peakOf(this.tmp, n);
				if (peak > this.activityPeak) {
					out.set(this.tmp.subarray(0, n));
					// Keep the other rings from piling up: their audio for this frame is discarded (it is not
					// sent while the owner speaks anyway), otherwise 200 ms of stale audio arrives once the
					// owner goes quiet.
					for (const [id, other] of this.rings) {
						if (id !== this.priorityId && other.length > 0) other.read(this.tmp, this.frameSamples);
					}
					return { pcm: out, active: [this.priorityId], priority: true };
				}
				this._addToOut(out, this.tmp, n); // the owner is quiet: fold them into the normal mix
			}
		}

		const peaks = [];
		for (const [id, ring] of this.rings) {
			if (id === this.priorityId) continue;
			if (ring.length === 0) continue;
			const n = ring.read(this.tmp, this.frameSamples);
			if (n === 0) continue;
			const peak = this._addToOut(out, this.tmp, n);
			if (peak > this.activityPeak) peaks.push({ id, peak });
		}
		// Loudest person first: the "dominant speaker" (the speaking notification) is read from here.
		peaks.sort((a, b) => b.peak - a.peak);
		for (const entry of peaks) active.push(entry.id);
		return { pcm: out, active, priority: false };
	}
}

/**
 * Output buffer for the model / local TTS voice. The default is 30 s: local TTS pushes a whole
 * sentence in one go, so the old 2 s capacity swallowed the start of sentences. On overflow the
 * oldest samples are still the ones dropped.
 */
export class PlaybackQueue {
	constructor({ maxFrames = 1500, frameSamples = SAMPLES_PER_FRAME_24K } = {}) {
		this.frameSamples = frameSamples;
		this.cap = maxFrames * frameSamples;
		this.ring = new Ring(this.cap);
	}

	push(samples) {
		this.ring.push(samples);
	}

	read(dst, max = dst.length) {
		return this.ring.read(dst, max);
	}

	get length() {
		return this.ring.length;
	}

	/** How many more samples fit in the queue (used for local TTS backpressure). */
	get free() {
		return this.ring.free;
	}

	/** Duration of the audio sitting in the queue (ms). */
	get durationMs() {
		return (this.ring.length / this.frameSamples) * FRAME_MS;
	}

	clear() {
		this.ring.clear();
	}
}
