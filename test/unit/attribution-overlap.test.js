import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SpeakerAttribution } from '../../src/attribution.js';

// Two people talking at the same time. The model is sent ONE summed frame, so inside an overlap it
// transcribes both voices together and nothing downstream can pull them apart again. The track has to
// record that honestly: who was audible, and how much of the stretch each of them held ALONE.

const frames = (attribution, active, count, priority = false) => {
	for (let i = 0; i < count; i++) attribution.onFrame({ priority, active, sent: true });
};

describe('the track when more than one person is talking', () => {
	it('keeps every voice in the frame, not just the loudest', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		frames(a, ['x', 'y'], 20);
		assert.equal(a.track.length, 1, 'one unbroken stretch');
		assert.deepEqual(a.track[0].ids, ['x', 'y']);
		assert.equal(a.track[0].solo, false);
		assert.equal(a.track[0].endMs, 400);
	});

	it('does not start a new segment every time the louder of the two changes', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		// The mixer orders by loudness and two people trade the lead several times a second. Comparing the
		// raw list instead of a canonical key produced a new segment on every swap.
		for (let i = 0; i < 50; i++) a.onFrame({ active: i % 2 ? ['x', 'y'] : ['y', 'x'], sent: true });
		assert.equal(a.track.length, 1, 'the same two people are the same stretch of audio');
	});

	it('reports both as present and neither as certain while they overlap', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		frames(a, ['x', 'y'], 25); // 500 ms, both throughout
		const share = a.speakerShareAt(0, 500);
		assert.equal(share.speakers, 2);
		assert.equal(share.heardMs, 500, 'the audible time is the union, not the sum of the two');
		for (const entry of share.ranked) {
			assert.equal(entry.share, 1, `${entry.id} was in all of it`);
			assert.equal(entry.solo, 0, `${entry.id} was alone in none of it`);
		}
		assert.equal(a.resolveSpeaker(0, 500).confidence, 'unsure', 'nobody may be named');
	});

	it('measures the part one voice had to itself', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		frames(a, ['x'], 15); // 300 ms alone
		frames(a, ['x', 'y'], 35); // 700 ms together
		const share = a.speakerShareAt(0, 1000);
		const x = share.ranked.find((entry) => entry.id === 'x');
		const y = share.ranked.find((entry) => entry.id === 'y');
		assert.equal(x.share, 1);
		assert.equal(Math.round(x.solo * 100), 30, 'x held 300 of the 1000 ms on its own');
		assert.equal(y.solo, 0);
		assert.equal(a.resolveSpeaker(0, 1000).confidence, 'leaning', 'named on a line, never acted on');
	});

	it('breaks an exact tie the same way whichever order the frames arrived in', () => {
		const first = new SpeakerAttribution({ ownerId: 'owner' });
		frames(first, ['x', 'y'], 10);
		const second = new SpeakerAttribution({ ownerId: 'owner' });
		frames(second, ['y', 'x'], 10);
		assert.equal(first.speakerShareAt(0, 200).id, second.speakerShareAt(0, 200).id);
	});
});

describe('the gate in front of the admin tools', () => {
	it('opens on the owner speaking alone', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		frames(a, ['owner'], 30);
		assert.equal(a.speakerAt(0, 600), true);
		assert.equal(a.noteTranscript('ban melis', { startMs: 0, endMs: 600 }).owner, true);
	});

	it('stays shut when somebody talks over the owner', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		frames(a, ['owner', 'guest'], 30);
		assert.equal(a.speakerAt(0, 600), false, 'a summed frame cannot say whose word it was');
		const hit = a.noteTranscript('ban melis', { startMs: 0, endMs: 600 });
		assert.equal(hit.owner, false, 'and so the word is not the owner’s word');
		const said = a.commandSpeaker(['ban']);
		assert.equal(said.owner, false);
		assert.equal(said.ownerOverlap, true, 'the refusal can say why');
	});

	it('still opens when the owner holds the floor and somebody only chips in', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		frames(a, ['owner'], 45); // 900 ms alone
		frames(a, ['owner', 'guest'], 5); // 100 ms of somebody cutting in
		assert.equal(a.speakerAt(0, 1000), true, 'nine tenths of it was the owner alone');
	});

	it('opens on the priority path, where the mixer has already thrown the other voices away', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		// The owner holds the floor: the mixer discarded everybody else's audio before summing this frame.
		frames(a, ['owner'], 30, true);
		assert.equal(a.speakerAt(0, 600), true);
		assert.equal(a.track[0].solo, true);
	});
});
