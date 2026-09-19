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

// The low-pass in front of the 48 kHz -> 24 kHz decimation: 15 taps, a Hamming-windowed sinc cut off at
// 12 kHz, unity gain in Q15. The two-tap average it replaces took 3 dB off at the new Nyquist and let
// everything between 12 and 24 kHz -- the hiss of "s", "ş" and "f" in a fullband Opus stream -- fold
// down into the band the transcriber listens to, which is one of the ways "adamsın" can come back as
// "ağlar mısın". This one: -6 dB at 12 kHz, -26 dB at 16 kHz, -47 dB at 20 kHz.
const HALF_BAND = Int32Array.from([-120, 0, 530, 0, -2242, 0, 9993, 16446, 9993, 0, -2242, 0, 530, 0, -120]);
const HALF_BAND_HISTORY = HALF_BAND.length - 1;

/** The filter's memory between frames, one per stream: the last few mono samples of the previous frame. */
export function downsampleState() {
	return { history: new Int32Array(HALF_BAND_HISTORY), scratch: null };
}

/**
 * Buffer(s16le stereo 48k) -> Int16Array(mono 24k): channel downmix, half-band low-pass, decimate by 2.
 * `state` (downsampleState) carries the filter across frames so a frame boundary is not a click; without
 * one each call starts from silence, which is fine for a buffer on its own.
 */
export function stereo48kToMono24k(pcm, state = null) {
	const frames = pcm.length >> 2; // stereo frames
	const out = new Int16Array(frames >> 1);
	const own = state ?? downsampleState();
	if (!own.scratch || own.scratch.length < frames + HALF_BAND_HISTORY) own.scratch = new Int32Array(frames + HALF_BAND_HISTORY);
	const x = own.scratch;
	x.set(own.history, 0);
	for (let i = 0; i < frames; i++) {
		const at = i * 4;
		x[HALF_BAND_HISTORY + i] = (pcm.readInt16LE(at) + pcm.readInt16LE(at + 2)) >> 1;
	}
	for (let i = 0; i < out.length; i++) {
		// Output i is the filter centred on input sample 2i - 7: a constant delay of a third of a
		// millisecond, and no drift.
		const base = 2 * i;
		let acc = 0;
		for (let k = 0; k < HALF_BAND.length; k++) acc += HALF_BAND[k] * x[base + k];
		const y = acc >> 15;
		out[i] = y > 32767 ? 32767 : y < -32768 ? -32768 : y;
	}
	own.history.set(x.subarray(frames, frames + HALF_BAND_HISTORY));
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
// Floor control: one voice at a time. The model hears a SUM and cannot pull it apart, so two people at
// once is the one thing every downstream step is worst at -- the transcript comes back garbled, the line
// is nobody's, the gate refuses, the command is not run. The owner's priority path proves the cure: while
// one voice is sent, everything about that stretch is exact. With floor control that is the rule for
// everybody: the person holding the floor is the only one sent, the floor passes at their pause to
// whoever has been waiting longest, and a monologue this long can be taken from them by somebody who has
// been talking over it for this long. What is lost is the interrupter's first seconds, which the model
// was not understanding anyway.
const FLOOR_MAX_FRAMES = 400;
const BARGE_FRAMES = 75;
// While somebody holds the floor, everybody else's frames are discarded -- including the first frames of
// whoever speaks next, until the holder pauses. To a transcriber the onset of a word is the word:
// "adamsın" without its "a" is anybody's guess. So the last few frames of every speaker are kept, and
// when the floor passes to somebody whose frames were being discarded, those frames go out first and
// the live ones queue behind them until they pause. Nothing is lost, and the stream stays one frame
// per tick. 240 ms: the holder's hold after their last loud frame, and the onset on top of it.
const PREROLL_FRAMES = 12;
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
		floorControl = false,
		floorMaxFrames = FLOOR_MAX_FRAMES,
		bargeFrames = BARGE_FRAMES,
		prerollFrames = PREROLL_FRAMES,
	} = {}) {
		this.floorControl = floorControl;
		this.floorMaxFrames = floorMaxFrames;
		this.bargeFrames = bargeFrames;
		this.prerollFrames = prerollFrames;
		this.floorId = null; // who holds the floor under floor control (or the priority speaker)
		this.floorSince = 0;
		this.floorTakeovers = 0; // how often the floor was taken from somebody still speaking
		this.frameBufs = new Map();
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
			voice = { loud: 0, speechAt: LONG_AGO, audioAt: LONG_AGO, energy: 0, runStart: LONG_AGO, wasSpeaking: false, recent: [], pending: [] };
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

	/** This speaker's own frame buffer, so that every ring can be read before anything is summed. */
	_buf(id) {
		let buf = this.frameBufs.get(id);
		if (!buf) {
			buf = new Int16Array(this.frameSamples);
			this.frameBufs.set(id, buf);
		}
		return buf;
	}

	/** The floor changes hands. A takeover is the floor taken from somebody still speaking; a pause is not one. */
	_takeFloor(id, takeover = false) {
		if (this.floorId === id) return;
		if (takeover) this.floorTakeovers++;
		// Their first frames were discarded while the previous holder had the floor: those go out first, and
		// the frame read this tick goes out in its turn behind them. From a free floor nothing was lost, and
		// whatever an earlier turn left queued is not theirs to say now.
		const voice = this._voice(id);
		voice.pending = this.floorId !== null ? voice.recent.slice(0, -1) : [];
		this.floorId = id;
		this.floorSince = this.frames;
	}

	/** The floor holder's audio for this tick: queued frames first, then the live one. */
	_emitFloor(out, f) {
		const voice = f.voice;
		if (voice.pending.length) {
			if (f.n > 0) voice.pending.push(voice.recent[voice.recent.length - 1] ?? f.buf.slice(0, f.n)); // this tick, already kept
			const frame = voice.pending.shift();
			out.set(frame.subarray(0, Math.min(frame.length, this.frameSamples)));
			return;
		}
		if (f.n > 0) out.set(f.buf.subarray(0, f.n));
	}

	/**
	 * One 20 ms frame. Returns { pcm, active, present, priority, others }: active = who the frame's audio
	 * belongs to, present = whose voice is in the sound, others = who was speaking but was NOT sent (floor
	 * control). The returned `pcm` is a shared buffer: the next tick overwrites it, so the caller must
	 * consume it right away.
	 */
	tick() {
		const out = this.out;
		out.fill(0);
		this.frames++;
		// Every speaker's frame is read first, whatever is then done with it: who is speaking has to be
		// known before anything is summed, and a ring that is not read piles up 200 ms of stale audio.
		const frames = [];
		for (const [id, ring] of this.rings) {
			const buf = this._buf(id);
			const n = ring.length > 0 ? ring.read(buf, this.frameSamples) : 0;
			const peak = n > 0 ? peakOf(buf, n) : 0;
			const voice = this._note(id, peak);
			const speaking = this._speaking(voice);
			if (speaking && !voice.wasSpeaking) voice.runStart = this.frames; // the queue for the floor is by this
			voice.wasSpeaking = speaking;
			if (n > 0) {
				// Kept whether or not it is sent: the pre-roll if the floor passes to them (see _takeFloor).
				voice.recent.push(buf.slice(0, n));
				if (voice.recent.length > this.prerollFrames) voice.recent.shift();
			} else if (!speaking) {
				voice.recent.length = 0; // gone quiet: what they said minutes ago is no onset of anything
			}
			frames.push({ id, buf, n, peak, voice, speaking });
		}
		const speakingBut = (holder) => frames.filter((f) => f.speaking && f.id !== holder).map((f) => f.id);

		// 1) The priority speaker: while they talk only their audio goes out, at once, whoever else is
		//    talking. Nobody else's samples reach `out`, so the frame really does hold one voice.
		if (this.priorityId) {
			const own = frames.find((f) => f.id === this.priorityId);
			if (own && this._holdsFloor(own.voice)) {
				this._takeFloor(this.priorityId, speakingBut(this.priorityId).length > 0);
				this._emitFloor(out, own);
				return { pcm: out, active: [this.priorityId], present: [this.priorityId], priority: true, others: speakingBut(this.priorityId) };
			}
		}

		// 2) Floor control: one voice at a time. The holder keeps the floor while they are mid-sentence; at
		//    their pause it goes to whoever has been speaking longest; a monologue past FLOOR_MAX_FRAMES can
		//    be taken by somebody who has been talking over it for BARGE_FRAMES.
		const speaking = frames.filter((f) => f.speaking).sort((a, b) => a.voice.runStart - b.voice.runStart || b.voice.energy - a.voice.energy);
		if (this.floorControl) {
			let holder = speaking.find((f) => f.id === this.floorId) ?? null;
			let takeover = false;
			if (holder && this.frames - this.floorSince >= this.floorMaxFrames) {
				const barger = speaking.find((f) => f.id !== holder.id && this.frames - f.voice.runStart >= this.bargeFrames);
				if (barger) {
					holder = barger;
					takeover = true;
				}
			}
			if (!holder && this.floorId !== null) {
				// The holder has stopped, but frames of theirs are still queued: they keep the floor until the
				// queue is empty, so nothing of theirs is lost to the handover.
				const draining = frames.find((f) => f.id === this.floorId);
				if (draining?.voice.pending.length) holder = draining;
			}
			if (!holder && speaking.length) holder = speaking[0];
			if (holder) {
				this._takeFloor(holder.id, takeover);
				this._emitFloor(out, holder);
				return { pcm: out, active: [holder.id], present: [holder.id], priority: false, others: speakingBut(holder.id) };
			}
		}

		// 3) Nobody is speaking (under floor control), or the plain sum: everybody's audio, loudest first.
		//    Somebody murmuring under the speech bar is still in the sound and still listed as present.
		this.floorId = null;
		const present = [];
		const heard = [];
		for (const f of frames) {
			if (f.n > 0) mixInto(out, f.buf, f.n, 1);
			if (f.peak > this.presencePeak) present.push(f.id);
			if (f.speaking) heard.push({ id: f.id, energy: f.voice.energy });
		}
		heard.sort((a, b) => b.energy - a.energy);
		return { pcm: out, active: heard.map((entry) => entry.id), present, priority: false, others: [] };
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
