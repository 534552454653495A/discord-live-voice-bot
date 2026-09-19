import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Writable } from 'node:stream';
import { PlaybackQueue, Ring, SAMPLES_PER_FRAME_24K, SpeakerMixer, STEREO_SAMPLES_PER_FRAME_48K, downsampleState, mixInto, peakOf, stereo48kToMono24k } from '../../src/audio.js';
import { AudioBridge } from '../../src/bridge.js';
import { Ducker } from '../../src/music.js';
import { SpeakerAttribution } from '../../src/attribution.js';

const sink = () => {
	const written = [];
	const out = new Writable({
		write(chunk, _enc, cb) {
			written.push(chunk);
			cb();
		},
	});
	return { out, written };
};

describe('audio.js', () => {
	it('holds 30 s by default so a local TTS sentence fits in the playback queue', () => {
		const q = new PlaybackQueue();
		assert.equal(q.cap, 1500 * SAMPLES_PER_FRAME_24K);
		const sentence = new Int16Array(24_000 * 12).fill(1); // 12 s
		q.push(sentence);
		assert.equal(q.length, sentence.length, 'no sample may be dropped');
		assert.ok(q.free > 0);
	});

	it('rejects an invalid ring capacity', () => {
		assert.throws(() => new Ring(0));
	});

	it('drains the other speakers while the priority speaker is talking', () => {
		const m = new SpeakerMixer();
		m.setPriority('o');
		for (let i = 0; i < 5; i++) {
			m.push('o', new Int16Array(480).fill(1000));
			m.push('x', new Int16Array(480).fill(900));
			m.tick();
		}
		assert.equal(m.rings.get('x').length, 0, 'the other buffers must be emptied while the priority speaker talks');
	});

	// Live failure: four people in the channel, the owner speaks, and the line came back attributed to
	// whoever else had a microphone open. Two causes, both here: "somebody is speaking" was decided at a
	// peak of 50 (a fan, breathing, a keyboard), and the owner lost the floor on the first missing packet.
	it('does not mistake an open microphone for a speaker', () => {
		const m = new SpeakerMixer();
		const speech = new Int16Array(480).fill(3000);
		const roomNoise = new Int16Array(480).fill(120); // well above the old bar of 50, far below speech
		for (let i = 0; i < 10; i++) {
			m.push('speaker', speech);
			m.push('noisy', roomNoise);
			m.push('quiet', new Int16Array(480).fill(20));
			m.tick();
		}
		const { active } = m.tick();
		assert.deepEqual(active, ['speaker'], 'only the person actually speaking is on the list');
	});

	it('keeps the sentence with its speaker across the gaps between words', () => {
		const m = new SpeakerMixer();
		const speech = new Int16Array(480).fill(3000);
		const roomNoise = new Int16Array(480).fill(120);
		const seen = [];
		for (let i = 0; i < 40; i++) {
			// The speaker's packets arrive in bursts with 60 ms of jitter in between, which is what a
			// sentence really looks like coming out of Discord; the other microphone is open throughout.
			if (i % 6 < 3) m.push('speaker', speech);
			m.push('noisy', roomNoise);
			seen.push(m.tick().active[0] ?? null);
		}
		assert.deepEqual([...new Set(seen.slice(4))], ['speaker'], 'the floor must not change hands inside a sentence');
	});

	// A review finding: holding somebody in the list on "spoke recently" alone wrote a stale second name
	// onto the first fragment of the next person's turn, which is what made a handover read as an overlap.
	it('drops a speaker whose packets have stopped, without waiting out the whole hold', () => {
		const m = new SpeakerMixer();
		const speech = new Int16Array(480).fill(3000);
		for (let i = 0; i < 6; i++) {
			m.push('a', speech);
			m.tick();
		}
		assert.deepEqual(m.tick().active, ['a'], 'one frame without a packet is jitter');
		for (let i = 0; i < 5; i++) m.tick(); // 100 ms of nothing arriving at all
		assert.deepEqual(m.tick().active, [], 'a speaker who has stopped transmitting has stopped talking');
	});

	it('hands the room over once the speaker really stops', () => {
		const m = new SpeakerMixer();
		const speech = new Int16Array(480).fill(3000);
		for (let i = 0; i < 6; i++) {
			m.push('first', speech);
			m.tick();
		}
		for (let i = 0; i < 30; i++) m.tick(); // 600 ms of silence: past the half second that ends a turn
		for (let i = 0; i < 4; i++) {
			m.push('second', speech);
			m.tick();
		}
		assert.deepEqual(m.tick().active, ['second'], 'the next person to speak owns the line');
	});

	it('the priority speaker rides out packet jitter but gives the room back after a real pause', () => {
		const m = new SpeakerMixer();
		m.setPriority('o');
		const speech = new Int16Array(480).fill(3000);
		for (let i = 0; i < 4; i++) {
			m.push('o', speech);
			m.tick();
		}
		m.push('x', speech);
		assert.equal(m.tick().priority, true, '80 ms without a packet is jitter, not the end of the sentence');
		for (let i = 0; i < 30; i++) m.tick(); // the owner really has stopped
		let frame = null;
		for (let i = 0; i < 3; i++) {
			m.push('x', speech);
			frame = m.tick();
		}
		assert.equal(frame.priority, false, 'the room is handed back');
		assert.ok(frame.active.includes('x'), 'and the person now talking is the one on the line');
	});

	// The worst finding of the adversarial review, and it is an attack, not an accident: speak quietly
	// enough to stay under the speech bar and your voice is still summed into the frame the model
	// transcribes, while the frame is recorded as holding one person, alone. Your words then land under
	// their name, with their authority.
	it('counts a voice too quiet to be called speech as being in the frame all the same', () => {
		const m = new SpeakerMixer();
		const speech = new Int16Array(480).fill(3000);
		const murmur = new Int16Array(480).fill(260); // above "there is real sound here", below speech
		let frame = null;
		for (let i = 0; i < 6; i++) {
			m.push('owner', speech);
			m.push('attacker', murmur);
			frame = m.tick();
		}
		assert.deepEqual(frame.active, ['owner'], 'only one of them is speaking');
		assert.deepEqual(frame.present.sort(), ['attacker', 'owner'], 'but both of them are in the sound');
	});

	it('does not let a murmur under the speech bar open the owner gate', () => {
		const m = new SpeakerMixer();
		const attribution = new SpeakerAttribution({ ownerId: 'owner' });
		const speech = new Int16Array(480).fill(3000);
		const murmur = new Int16Array(480).fill(260);
		for (let i = 0; i < 40; i++) {
			m.push('owner', speech);
			m.push('attacker', murmur);
			const frame = m.tick();
			attribution.onFrame({ priority: frame.priority, active: frame.active, present: frame.present, sent: true });
		}
		assert.equal(attribution.speakerAt(0, 800), false, 'a frame with two voices in it cannot say whose word it was');
		assert.equal(attribution.noteTranscript('ban dana', { startMs: 0, endMs: 800 }).owner, false);

		// The same run of frames with nobody murmuring does open it, so the test is about the murmur.
		const clean = new SpeakerMixer();
		const alone = new SpeakerAttribution({ ownerId: 'owner' });
		for (let i = 0; i < 40; i++) {
			clean.push('owner', speech);
			const frame = clean.tick();
			alone.onFrame({ priority: frame.priority, active: frame.active, present: frame.present, sent: true });
		}
		assert.equal(alone.speakerAt(0, 800), true);
	});

	it('reports the absolute peak and clips the mix at the int16 ceiling', () => {
		assert.equal(peakOf(new Int16Array([1, -7, 3])), 7);
		const out = new Int16Array([30000, 0]);
		mixInto(out, new Int16Array([10000, 100]), 2, 1);
		assert.deepEqual([...out], [32767, 100], 'clipped');
	});
});

describe('Ducker', () => {
	it('drops fast while someone speaks and recovers slowly after the hold', () => {
		const d = new Ducker({ duck: 0.1, holdMs: 100, frameMs: 20 });
		d.tick(true);
		d.tick(true);
		const ducked = d.tick(true);
		assert.ok(ducked < 0.5, `should fall fast: ${ducked}`);
		for (let i = 0; i < 5; i++) d.tick(false); // hold
		const held = d.gain;
		assert.ok(held <= 0.25, `should stay low during the hold: ${held}`);
		for (let i = 0; i < 200; i++) d.tick(false);
		assert.equal(d.gain, 1, 'returns to normal in the end');
	});
});

describe('AudioBridge', () => {
	it('mixes music with the bot voice and ducks it while the bot speaks', () => {
		const { out, written } = sink();
		const music = { active: true, volume: 0.5, duckRatio: 0.2, readFrame: (dst, n) => (dst.fill(2000, 0, n), n) };
		const playback = new PlaybackQueue();
		const bridge = new AudioBridge({ mixer: new SpeakerMixer(), playback, output: out, getLive: () => null, music });
		let r = bridge.tick();
		assert.equal(r.music, true);
		assert.equal(r.played, false);
		assert.equal(written.at(-1).readInt16LE(0), 1000, 'music only: 2000 x 0.5');

		playback.push(new Int16Array(SAMPLES_PER_FRAME_24K * 5).fill(10000));
		r = bridge.tick();
		assert.equal(r.played, true);
		assert.ok(r.gain < 1, 'the gain drops while the bot speaks');
		const sample = written.at(-1).readInt16LE(0);
		assert.ok(sample > 5000 && sample < 6000, `voice + ducked music: ${sample}`);
		assert.equal(written.at(-1).length, STEREO_SAMPLES_PER_FRAME_48K * 2);
	});

	it('pads a partial frame with zeros and plays it, so the last 19 ms are not lost', () => {
		const { out } = sink();
		const playback = new PlaybackQueue();
		const bridge = new AudioBridge({ mixer: new SpeakerMixer(), playback, output: out, getLive: () => null });
		playback.push(new Int16Array(SAMPLES_PER_FRAME_24K * 4 + 100).fill(500));
		const results = [];
		for (let i = 0; i < 6; i++) results.push(bridge.tick().played);
		assert.deepEqual(results, [true, true, true, true, true, false], 'the 5th frame is partial but still played');
	});

	// Live failure: the voice connection dropped with code 4014, came back a second later, and the bot was
	// silent for the rest of the session while transcription and speech generation both kept reporting
	// success. A PassThrough that has errored is finished; every later write disappears.
	it('writes to a replacement output after the old one dies', () => {
		const first = sink();
		const playback = new PlaybackQueue();
		const bridge = new AudioBridge({ mixer: new SpeakerMixer(), playback, output: first.out, getLive: () => null });
		playback.push(new Int16Array(SAMPLES_PER_FRAME_24K * 4).fill(500));
		bridge.tick();
		assert.equal(first.written.length, 1);

		const second = sink();
		bridge.setOutput(second.out);
		bridge.tick();
		assert.equal(first.written.length, 1, 'nothing more goes to the dead stream');
		assert.equal(second.written.length, 1, 'and the new one is spoken to');
	});

	it('forgets that the old output was blocked when it is replaced', async () => {
		const blocked = new Writable({
			highWaterMark: 1,
			write(_chunk, _enc, cb) {
				setTimeout(cb, 50);
			},
		});
		const bridge = new AudioBridge({ mixer: new SpeakerMixer(), playback: new PlaybackQueue(), output: blocked, getLive: () => null });
		bridge.tick(); // fills the queue
		assert.equal(bridge.tick().dropped, 1, 'the old stream is blocked');
		const fresh = sink();
		bridge.setOutput(fresh.out);
		bridge.tick();
		assert.equal(fresh.written.length, 1, 'the block belonged to the stream that is gone');
		bridge.stop();
	});

	it('does not burst through ticks after a long pause', () => {
		const { out } = sink();
		const bridge = new AudioBridge({ mixer: new SpeakerMixer(), playback: new PlaybackQueue(), output: out, getLive: () => null });
		let ticks = 0;
		bridge.tick = () => {
			ticks++;
		};
		bridge.nextAt = Date.now() - 10_000; // 10 s behind
		const now = Date.now();
		// Run the loop logic from start() directly.
		if (now - bridge.nextAt > 1000) bridge.nextAt = now;
		while (bridge.nextAt <= now) {
			bridge.tick();
			bridge.nextAt += 20;
		}
		assert.ok(ticks <= 2, `should realign instead of running 500 frames: ${ticks}`);
	});
});

describe('floor control: one voice at a time', () => {
	const speech = (level) => new Int16Array(480).fill(level);

	it('sends only the floor holder while somebody talks over them', () => {
		const m = new SpeakerMixer({ floorControl: true });
		for (let i = 0; i < 10; i++) {
			m.push('a', speech(3000));
			m.tick();
		}
		let frame = null;
		for (let i = 0; i < 10; i++) {
			m.push('a', speech(3000));
			m.push('b', speech(2000));
			frame = m.tick();
		}
		assert.deepEqual(frame.active, ['a'], 'the floor is a s');
		assert.deepEqual(frame.others, ['b'], 'and b is on record as talking over it');
		assert.equal(frame.pcm[0], 3000, 'the frame holds a s audio, not the sum');
		assert.deepEqual(frame.present, ['a'], 'nobody else is in the sound');
	});

	it('passes the floor at the holder s pause to whoever has been waiting', () => {
		const m = new SpeakerMixer({ floorControl: true });
		for (let i = 0; i < 10; i++) {
			m.push('a', speech(3000));
			m.tick();
		}
		for (let i = 0; i < 10; i++) {
			m.push('a', speech(3000));
			m.push('b', speech(2000));
			assert.deepEqual(m.tick().active, ['a']);
		}
		let frame = null;
		for (let i = 0; i < 8; i++) {
			m.push('b', speech(2000)); // a has stopped sending
			frame = m.tick();
		}
		assert.deepEqual(frame.active, ['b'], 'b has been waiting and gets the floor');
		assert.equal(frame.pcm[0], 2000);
		assert.equal(m.floorTakeovers, 0, 'a pause is not a takeover');
	});

	it('lets a persistent interrupter take a long monologue, and never a short one', () => {
		const m = new SpeakerMixer({ floorControl: true });
		let at450 = null;
		let frame = null;
		for (let i = 0; i < 480; i++) {
			m.push('a', speech(3000));
			if (i >= 400) m.push('b', speech(2000));
			frame = m.tick();
			if (i === 450) at450 = frame.active;
		}
		assert.deepEqual(at450, ['a'], 'a second of interruption changes nothing');
		assert.deepEqual(frame.active, ['b'], 'after 1.5 s over an 8 s monologue the floor is taken');
		assert.equal(m.floorTakeovers, 1);

		const short = new SpeakerMixer({ floorControl: true });
		let last = null;
		for (let i = 0; i < 200; i++) {
			short.push('a', speech(3000));
			if (i >= 100) short.push('b', speech(2000));
			last = short.tick();
		}
		assert.deepEqual(last.active, ['a'], 'a four second turn is not a monologue');
	});

	it('gives the owner the floor at once, whoever holds it', () => {
		const m = new SpeakerMixer({ floorControl: true });
		m.setPriority('o');
		for (let i = 0; i < 10; i++) {
			m.push('b', speech(2000));
			m.tick();
		}
		let frame = null;
		for (let i = 0; i < 3; i++) {
			m.push('b', speech(2000));
			m.push('o', speech(3000));
			frame = m.tick();
		}
		assert.equal(frame.priority, true);
		assert.deepEqual(frame.active, ['o']);
		assert.deepEqual(frame.others, ['b']);
	});

	it('keeps a murmur out of the frame entirely, so the holder s words really are theirs alone', () => {
		const m = new SpeakerMixer({ floorControl: true });
		const attribution = new SpeakerAttribution({ ownerId: 'owner' });
		for (let i = 0; i < 40; i++) {
			m.push('owner', speech(3000));
			m.push('attacker', speech(260));
			const frame = m.tick();
			attribution.onFrame({ priority: frame.priority, active: frame.active, present: frame.present, sent: true });
		}
		assert.equal(attribution.speakerAt(0, 800), true, 'the murmur was never in the audio');
	});

	it('still sums everybody when nobody clears the speech bar', () => {
		const m = new SpeakerMixer({ floorControl: true });
		let frame = null;
		for (let i = 0; i < 6; i++) {
			m.push('a', speech(260));
			m.push('b', speech(260));
			frame = m.tick();
		}
		assert.deepEqual(frame.active, []);
		assert.deepEqual(frame.present.sort(), ['a', 'b']);
		assert.equal(frame.pcm[0], 520, 'the sum, as without floor control');
	});
});

describe('the anti-alias filter in front of the downsampler', () => {
	const tone = (hz, frames, amplitude = 10000) => {
		const buf = Buffer.alloc(frames * 4);
		for (let i = 0; i < frames; i++) {
			const v = Math.round(amplitude * Math.sin((2 * Math.PI * hz * i) / 48000));
			buf.writeInt16LE(v, i * 4);
			buf.writeInt16LE(v, i * 4 + 2);
		}
		return buf;
	};
	const rms = (samples) => Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
	const through = (hz) => {
		const state = downsampleState();
		let out = [];
		for (let chunk = 0; chunk < 5; chunk++) out = out.concat(Array.from(stereo48kToMono24k(tone(hz, 960, 10000), state)));
		return rms(out.slice(-1200)); // the last 50 ms, past any transient
	};
	// The two-tap average this replaces let a 16 kHz tone through at half amplitude and folded it down to
	// 8 kHz, into the middle of the band a transcriber listens to.
	it('keeps speech and drops what would fold down into it', () => {
		const speech = through(2000);
		assert.ok(Math.abs(speech - 10000 / Math.SQRT2) < 300, `2 kHz passes at full level: ${speech.toFixed(0)}`);
		const hiss = through(16000);
		assert.ok(hiss < 500, `16 kHz is gone before it can fold down: ${hiss.toFixed(0)}`);
	});
});

describe('the frames a newcomer lost while somebody else held the floor', () => {
	const marker = (v) => new Int16Array(480).fill(v);

	// To a transcriber the onset of a word is the word: "adamsın" without its "a" came back as "ağlar
	// mısın". The frames discarded while the previous holder had the floor go out first, and the live
	// ones queue behind them until the speaker pauses.
	it('are sent first, in order, with nothing lost, and drain after they stop', () => {
		const m = new SpeakerMixer({ floorControl: true });
		for (let i = 0; i < 20; i++) {
			m.push('a', marker(3000));
			if (i >= 12) m.push('b', marker(2000 + i)); // b starts over a at frame 12
			m.tick();
		}
		const after = [];
		for (let i = 20; i < 40; i++) {
			m.push('b', marker(2000 + i)); // a has stopped sending
			const frame = m.tick();
			after.push({ who: frame.active[0] ?? null, v: frame.pcm[0] });
		}
		const first = after.findIndex((entry) => entry.who === 'b');
		assert.ok(first > 0 && first <= 6, `b gets the floor once the frames of a have stopped: ${first}`);
		const values = after.slice(first).map((entry) => entry.v);
		assert.ok(values[0] < 2000 + 20 + first, `the first thing sent is an earlier frame of b: ${values[0]}`);
		for (let i = 1; i < values.length; i++) assert.equal(values[i], values[i - 1] + 1, 'and nothing after it is lost or reordered');

		const drained = [];
		for (let i = 0; i < 16; i++) {
			const frame = m.tick(); // b has stopped too
			drained.push({ who: frame.active[0] ?? null, v: frame.pcm[0] });
		}
		const queued = drained.filter((entry) => entry.who === 'b');
		assert.ok(queued.length >= 5 && queued.length <= 12, `the queue drains while b keeps the floor: ${queued.length}`);
		assert.equal(queued[queued.length - 1].v, 2039, 'down to the last frame they sent');
		for (let i = 1; i < queued.length; i++) assert.equal(queued[i].v, queued[i - 1].v + 1);
		assert.equal(drained[drained.length - 1].who, null, 'and then the floor is free');
	});

	it('are not needed when the floor was free: the live frame goes straight out', () => {
		const m = new SpeakerMixer({ floorControl: true });
		let frame = null;
		for (let i = 0; i < 4; i++) {
			m.push('b', marker(2000 + i));
			frame = m.tick();
		}
		assert.equal(frame.pcm[0], 2003, 'nothing of theirs was ever discarded');
	});
});
