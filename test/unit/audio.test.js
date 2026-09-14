import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Writable } from 'node:stream';
import { PlaybackQueue, Ring, SAMPLES_PER_FRAME_24K, SpeakerMixer, STEREO_SAMPLES_PER_FRAME_48K, mixInto, peakOf } from '../../src/audio.js';
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
