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

	// An adversarial review found this one: tokens come out of normalize(), which keeps only a-z0-9, so a
	// sentence in Cyrillic tokenises to nothing. The check that catches somebody cutting in between the
	// owner's command and the answer skipped it on the token count, walked past it, and found the owner's
	// own earlier words instead -- a way to get a ban past the gate by talking over the owner in another
	// alphabet.
	it('sees an interjection written in another alphabet', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		frames(a, ['owner'], 40, true);
		a.noteTranscript('ban dana', { startMs: 0, endMs: 800 });
		frames(a, ['attacker'], 20);
		a.noteTranscript('забань Дану', { startMs: 800, endMs: 1200 });

		const last = a.lastUtterance({});
		assert.equal(last?.owner, false, 'the last thing said was not the owner');
		assert.equal(last?.id, 'attacker');
		assert.equal(last?.tokens, 0, 'and it counts even though not one letter of it survives normalising');
	});

	// Live failure: the bot was telling people "two voices at once" on nearly every short line, and the
	// log gave it away by naming no candidates at all. There was no overlap. Discord sends no packets while
	// somebody draws breath, so nothing is tracked there, and a fragment landing in that pause had no audio
	// under it. The answer is written on either side of the pause.
	it('answers a fragment that lands in one person s own pause', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		frames(a, ['guest'], 30); // 0 - 600 ms
		frames(a, [], 20); // a pause: no packets, so nothing is tracked
		frames(a, ['guest'], 30); // 1000 - 1600 ms
		const hit = a.resolveSpeaker(620, 980);
		assert.equal(hit.id, 'guest', 'the pause between two of their words is theirs');
		assert.equal(hit.reason, 'nearby');
		assert.equal(hit.confidence, 'leaning', 'inferred from around it, so never certain');
		// And inference is never evidence about a command.
		assert.equal(a.speakerAt(620, 980), null, 'the gate has nothing to go on here');
	});

	it('names nobody for a pause between two different people, but says who they were', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		frames(a, ['x'], 30);
		frames(a, [], 20);
		frames(a, ['y'], 30);
		const hit = a.resolveSpeaker(620, 980);
		assert.equal(hit.id, null, 'the handover could have been either of them');
		assert.deepEqual(hit.ids.sort(), ['x', 'y'], 'and both are named, rather than "somebody"');
	});

	// Measured live: a fragment could sit two seconds past the last thing we had recorded while the person
	// had never stopped talking. They were simply too quiet to clear our speech bar, and the model
	// transcribes what it hears whether our own ear called it speech or not.
	it('records somebody talking quietly, and never treats it as evidence', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		for (let i = 0; i < 60; i++) a.onFrame({ active: [], present: ['guest'], sent: true });
		const hit = a.resolveSpeaker(200, 900);
		assert.equal(hit.id, 'guest', 'the line carries their name');
		assert.equal(hit.reason, 'quiet');
		assert.equal(hit.confidence, 'leaning', 'and never certainty');
		assert.equal(a.speakerAt(200, 900), null, 'a murmur cannot open the gate');
	});

	it('leaves two quiet voices at once unrecorded, because that really is a guess', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		for (let i = 0; i < 60; i++) a.onFrame({ active: [], present: ['x', 'y'], sent: true });
		assert.equal(a.resolveSpeaker(200, 900).reason, 'silence');
	});

	it('says there is nothing to go on when there really is nothing', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		const hit = a.resolveSpeaker(0, 400);
		assert.equal(hit.reason, 'silence');
		assert.deepEqual(hit.ids, []);
		assert.equal(a.speakerAt(0, 400), null);
	});

	it('an overlap answers no rather than answering nothing', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		frames(a, ['owner', 'guest'], 30);
		// There WAS audio here, so the gate gets a definite answer. Falling back to the frame-level test
		// would hand the owner's authority to whoever talked over them.
		assert.equal(a.speakerAt(0, 600), false);
	});

	it('opens on the priority path, where the mixer has already thrown the other voices away', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		// The owner holds the floor: the mixer discarded everybody else's audio before summing this frame.
		frames(a, ['owner'], 30, true);
		assert.equal(a.speakerAt(0, 600), true);
		assert.equal(a.track[0].solo, true);
	});
});

describe('a fragment in the hand-off between two people', () => {
	// One voice at a time is sent, so two voices either side of a pause is not an overlap: the words are
	// the tail of the one who stopped or the first word of the one who started. Heard live: "Melis sus"
	// fell in such a pause, was given to nobody, and the owner had to say it again.
	it('goes to whoever is nearer the pause, and to nobody from the middle of it', () => {
		const a = new SpeakerAttribution({ ownerId: 'owner' });
		frames(a, ['x'], 30); // 0 - 600 ms
		frames(a, [], 20); // 600 - 1000 ms: the pause
		frames(a, ['y'], 30); // 1000 - 1600 ms
		const tail = a.resolveSpeaker(620, 720);
		assert.equal(tail.id, 'x', 'right after x stopped: x s tail');
		assert.equal(tail.confidence, 'leaning');
		assert.equal(a.resolveSpeaker(900, 980).id, 'y', 'right before y started: y s first word');
		assert.equal(a.resolveSpeaker(620, 980).id, null, 'the whole pause could be either');
		assert.equal(a.speakerAt(620, 720), null, 'and none of it is evidence for the gate');
	});
});
