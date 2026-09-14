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

// "There is audio here" and "this person is speaking" are two different questions, and answering the
// second with the first is what puts one person's sentence in somebody else's mouth. A peak of 50 out
// of 32767 is a quiet room through an open microphone: breathing, a fan, a keyboard. The bar for
// speech is the one the per-user transcriber already uses.
const SPEECH_PEAK = 400;
// Speech has to clear that bar for two frames (40 ms) before it counts, so one click is not a speaker.
const SPEECH_ONSET_FRAMES = 2;
// It then stays that person's turn for 200 ms after their last loud frame, which covers the gaps
// between words and the jitter Discord delivers packets with.
//
// This number was half a second at first, borrowed from where a recording bot stops calling a gap
// jitter. That was the wrong thing to borrow: a gap is EXCLUDED from the audible time downstream, so a
// long hold buys nothing there, while it does put two people who merely take turns in the same frame.
// Measured in a real channel, a quarter of a second between turns was enough to have the whole room
// reading as "everybody talking at once", and every voice command in the session was refused for it.
const SPEECH_HOLD_FRAMES = 10;
// The priority speaker keeps the channel to themselves for the same half second of quiet, but only
// while their packets are still arriving...
const FLOOR_HOLD_FRAMES = 25;
// ...where "still arriving" tolerates 100 ms, which is where Craig stops calling a gap jitter. The old
// code gave the floor away on a single missing packet, so a sentence was cut into pieces that were
// then shared out between the people who happened to be breathing at the time.
const FLOOR_JITTER_FRAMES = 5;
// "Somebody else's voice is in this frame" is a third question, and it needs its own bar. Not the
// speech bar: a voice below that is still summed into the frame the model transcribes, so treating it
// as absent let somebody speak quietly and have their words land under another person's name. Not the
// audio bar either, which is a fan or a keyboard. This is the level the barge-in check already uses
// for "there is real sound here".
const PRESENCE_PEAK = 200;
const LONG_AGO = -1e9;

/**
 * Per-speaker buffers summed into one 20 ms frame per tick.
 * Keeps each speaker's audio separate until the very last step so that
 * per-user features (solo listening, speaker announcements) stay possible.
 *
 * Each speaker also gets a small voice-activity state machine. The model is sent ONE mixed stream, so
 * the `active` list returned here is the only record of who said what: it is what later decides whose
 * sentence a transcript line was. It therefore has to answer "who is speaking", not "whose microphone
 * is open".
 */
export class SpeakerMixer {
	constructor({
		frameSamples = SAMPLES_PER_FRAME_24K,
		bufferFrames = 10,
		activityPeak = 50,
		presencePeak = PRESENCE_PEAK,
		speechPeak = SPEECH_PEAK,
		onsetFrames = SPEECH_ONSET_FRAMES,
		holdFrames = SPEECH_HOLD_FRAMES,
		floorHoldFrames = FLOOR_HOLD_FRAMES,
		jitterFrames = FLOOR_JITTER_FRAMES,
	} = {}) {
		this.frameSamples = frameSamples;
		this.bufferSamples = frameSamples * bufferFrames;
		this.activityPeak = activityPeak;
		this.presencePeak = presencePeak;
		this.speechPeak = speechPeak;
		this.onsetFrames = onsetFrames;
		this.holdFrames = holdFrames;
		this.floorHoldFrames = floorHoldFrames;
		this.jitterFrames = jitterFrames;
		this.rings = new Map();
		this.voices = new Map(); // id -> { loud, speechAt, audioAt, energy }
		this.frames = 0;
		this.priorityId = null;
		this.tmp = new Int16Array(frameSamples);
		this.out = new Int16Array(frameSamples);
	}

	addUser(id) {
		if (!this.rings.has(id)) this.rings.set(id, new Ring(this.bufferSamples));
	}

	removeUser(id) {
		this.rings.delete(id);
		this.voices.delete(id);
	}

	_voice(id) {
		let voice = this.voices.get(id);
		if (!voice) {
			voice = { loud: 0, speechAt: LONG_AGO, audioAt: LONG_AGO, energy: 0 };
			this.voices.set(id, voice);
		}
		return voice;
	}

	/**
	 * One frame of this speaker's audio, loud or not. Every known speaker is noted on every tick, so
	 * that a hold runs out on its own when somebody simply stops sending packets.
	 */
	_note(id, peak) {
		const voice = this._voice(id);
		// A smoothed level, so that "the loudest person" is the one holding the floor and not whoever
		// produced the sharpest transient inside these 20 ms.
		voice.energy = voice.energy * 0.7 + peak * 0.3;
		if (peak >= this.speechPeak) {
			voice.loud++;
			if (voice.loud >= this.onsetFrames) voice.speechAt = this.frames;
		} else {
			voice.loud = 0;
		}
		if (peak > this.activityPeak) voice.audioAt = this.frames;
		return voice;
	}

	/**
	 * Is this person mid-sentence (the gaps between their words included)?
	 *
	 * Two conditions, not one. They must have spoken recently, AND their packets must still be arriving:
	 * somebody who has stopped transmitting altogether has stopped talking, and holding them in the list
	 * on the strength of the first condition alone is what wrote a stale second name onto the first
	 * fragment of the next person's turn. While the level merely dips, through a quiet syllable, the
	 * packets keep coming and the turn is still theirs.
	 */
	_speaking(voice) {
		return this.frames - voice.speechAt <= this.holdFrames && this.frames - voice.audioAt <= this.jitterFrames;
	}

	/** Does the priority speaker still own the channel: spoke recently AND is still sending packets. */
	_holdsFloor(voice) {
		return this.frames - voice.speechAt <= this.floorHoldFrames && this.frames - voice.audioAt <= this.jitterFrames;
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
		this.frames++;
		// Everybody whose voice is really in this frame, at a lower bar than "speaking". What goes out is
		// the SUM of these, and the model cannot pull a sum apart, so this is the list that decides whether
		// anybody's words can be said to be theirs alone.
		const present = [];

		// 1) If the priority speaker is talking, only their audio goes out.
		if (this.priorityId) {
			const ring = this.rings.get(this.priorityId);
			const n = ring && ring.length > 0 ? ring.read(this.tmp, this.frameSamples) : 0;
			const peak = n > 0 ? peakOf(this.tmp, n) : 0;
			const voice = this._note(this.priorityId, peak);
			if (this._holdsFloor(voice)) {
				if (n > 0) out.set(this.tmp.subarray(0, n));
				// Keep the other rings from piling up: their audio for this frame is discarded (it is not
				// sent while the owner speaks anyway), otherwise 200 ms of stale audio arrives once the
				// owner goes quiet. Their state is still noted, so that somebody who was mid-sentence does
				// not come out of the pause looking like a brand new speaker.
				for (const [id, other] of this.rings) {
					if (id === this.priorityId) continue;
					const m = other.length > 0 ? other.read(this.tmp, this.frameSamples) : 0;
					this._note(id, m > 0 ? peakOf(this.tmp, m) : 0);
				}
				// Nobody else's samples reached `out`, so the frame really does hold one voice.
				return { pcm: out, active: [this.priorityId], present: [this.priorityId], priority: true };
			}
			if (n > 0) this._addToOut(out, this.tmp, n); // the owner is quiet: fold them into the normal mix
			if (peak > this.presencePeak) present.push(this.priorityId);
		}

		const heard = [];
		for (const [id, ring] of this.rings) {
			if (id === this.priorityId) continue;
			const n = ring.length > 0 ? ring.read(this.tmp, this.frameSamples) : 0;
			const peak = n > 0 ? this._addToOut(out, this.tmp, n) : 0;
			const voice = this._note(id, peak);
			if (peak > this.presencePeak) present.push(id);
			if (this._speaking(voice)) heard.push({ id, energy: voice.energy });
		}
		// The priority speaker can be mid-sentence without owning the floor (they went quiet for longer
		// than the hold, so the room was given back): they are still one of the people speaking here, and
		// the line still has to carry their name.
		const priorityVoice = this.priorityId ? this.voices.get(this.priorityId) : null;
		if (priorityVoice && this._speaking(priorityVoice)) heard.push({ id: this.priorityId, energy: priorityVoice.energy });
		// Loudest person first: the "dominant speaker" (the speaking notification) is read from here.
		heard.sort((a, b) => b.energy - a.energy);
		return { pcm: out, active: heard.map((entry) => entry.id), present, priority: false };
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
