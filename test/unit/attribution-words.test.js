import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SpeakerAttribution } from '../../src/attribution.js';
import { setLocale, tList } from '../../src/i18n/index.js';

// The words the gate reads. The transcript arrives in pieces shorter than a word, and the owner's
// command has to survive that.

const ownerTalks = (a, frames = 50) => {
	for (let i = 0; i < frames; i++) a.onFrame({ priority: true, active: ['o'], present: ['o'], sent: true });
};
const words = (a) => a.words.map((entry) => entry.word);

describe('a word that arrives in two pieces', () => {
	// Live failure: the owner said "konusmaya devam edebilirsin" and the transcript delivered the last
	// word as "edebilirs" then "in". Each piece became a word of its own, "edebilirsin" never existed,
	// and the gate walked past the owner's command to an older "sus" of somebody else's -- "the owner
	// did not say it" while the audio said, on every piece, that only the owner was talking.
	it('is one word to the gate, and one word in the record', () => {
		setLocale('tr'); // the stem takes a Turkish suffix, so the Turkish inflection pattern has to be the one read
		try {
			const a = new SpeakerAttribution({ ownerId: 'o' });
			ownerTalks(a);
			a.noteTranscript(' konusmaya devam edebilirs', { startMs: 0, endMs: 800 });
			a.noteTranscript('in', { startMs: 800, endMs: 1000 });
			assert.deepEqual(words(a), ['konusmaya', 'devam', 'edebilirsin']);
			const hit = a.commandSpeaker(['=edebilir']);
			assert.ok(hit, 'the stem matches the whole word');
			assert.equal(hit.owner, true);
			assert.match(a.lastUtterance().text, /edebilirsin$/);
		} finally {
			setLocale('en');
		}
	});

	it('does not glue across a space, a hole in the audio, a change of speaker, or on the local path', () => {
		const spaced = new SpeakerAttribution({ ownerId: 'o' });
		ownerTalks(spaced);
		spaced.noteTranscript('ban', { startMs: 0, endMs: 300 });
		spaced.noteTranscript(' la', { startMs: 300, endMs: 500 });
		assert.deepEqual(words(spaced), ['ban', 'la'], 'a space starts a new word');

		const hole = new SpeakerAttribution({ ownerId: 'o' });
		ownerTalks(hole);
		hole.noteTranscript('sil', { startMs: 0, endMs: 300 });
		hole.noteTranscript('me', { startMs: 500, endMs: 700 });
		assert.deepEqual(words(hole), ['sil', 'me'], 'a piece that does not start where the last one ended is not its rest');

		const handover = new SpeakerAttribution({ ownerId: 'o' });
		ownerTalks(handover); // 0 - 1000 ms, the owner alone
		for (let i = 0; i < 20; i++) handover.onFrame({ active: ['x'], present: ['x'], sent: true }); // 1000 - 1400 ms, x
		handover.noteTranscript('sil', { startMs: 800, endMs: 1000 });
		handover.noteTranscript('me', { startMs: 1000, endMs: 1200 });
		assert.deepEqual(words(handover), ['sil', 'me'], 'somebody else cannot finish the owner s word');
		assert.equal(handover.words[0].owner, true, 'and the owner s piece stays the owner s');

		const local = new SpeakerAttribution({ ownerId: 'o' });
		local.noteTranscript('sil', { owner: true });
		local.noteTranscript('me', { owner: true });
		assert.deepEqual(words(local), ['sil', 'me'], 'local STT hands over whole utterances, never pieces');
	});

	it('does not let the rest of a word launder a sure piece into a whole sure word', () => {
		const a = new SpeakerAttribution({ ownerId: 'o' });
		ownerTalks(a); // 0 - 1000 ms alone
		for (let i = 0; i < 10; i++) a.onFrame({ active: ['o', 'x'], present: ['o', 'x'], sent: true }); // 1000 - 1200 ms tangled
		a.noteTranscript('konus', { startMs: 800, endMs: 1000 });
		// The rest lands in the tangle: not the owner alone, so the two pieces are two words.
		a.noteTranscript('mayacak', { startMs: 1000, endMs: 1200 });
		assert.deepEqual(words(a), ['konus', 'mayacak']);
	});
});

describe('what the owner said last, for the gate', () => {
	it('joins the owner s pieces into their words, and knows when somebody else cut in', () => {
		const a = new SpeakerAttribution({ ownerId: 'o' });
		ownerTalks(a); // 0 - 1000 ms
		a.noteTranscript(' melis artik', { startMs: 0, endMs: 400 });
		a.noteTranscript(' konusmaya devam edebilirs', { startMs: 400, endMs: 800 });
		a.noteTranscript('in', { startMs: 800, endMs: 1000 });
		const said = a.ownerUtterance();
		assert.equal(said?.text, 'melis artik konusmaya devam edebilirsin');
		assert.equal(said?.sure, true);
		// Somebody else, cleanly, after it: no answer, because the command may be theirs.
		for (let i = 0; i < 30; i++) a.onFrame({ active: ['x'], present: ['x'], sent: true }); // 1000 - 1600 ms
		a.noteTranscript(' ben de istiyorum', { startMs: 1000, endMs: 1600 });
		assert.equal(a.ownerUtterance(), null);
	});

	it('skips a voice merely bleeding into the owner s words', () => {
		const a = new SpeakerAttribution({ ownerId: 'o' });
		ownerTalks(a); // 0 - 1000 ms alone
		a.noteTranscript(' melis konus', { startMs: 0, endMs: 1000 });
		for (let i = 0; i < 5; i++) a.onFrame({ active: ['o', 'x'], present: ['o', 'x'], sent: true }); // 1000 - 1100 ms tangled
		a.noteTranscript('ha', { startMs: 1000, endMs: 1100 });
		assert.equal(a.ownerUtterance()?.text, 'melis konus');
	});

	it('has nothing when the owner has not spoken', () => {
		const a = new SpeakerAttribution({ ownerId: 'o' });
		for (let i = 0; i < 30; i++) a.onFrame({ active: ['x'], present: ['x'], sent: true });
		a.noteTranscript(' selam', { startMs: 0, endMs: 600 });
		assert.equal(a.ownerUtterance(), null);
	});
});

describe('the words that give the voice back (tr)', () => {
	// Every one of these was said live, one after another, to a bot the owner had told to be quiet,
	// and none of them opened the gate.
	it('open the setting gate', () => {
		setLocale('tr');
		try {
			const setting = tList('keywords.words.setting');
			for (const text of ['melis konusmaya devam et', 'melis konus', 'melis konusma yasagini kaldir', 'quiet ayarini kapat', 'sesini ac', 'susmayi birak']) {
				const a = new SpeakerAttribution({ ownerId: 'o' });
				ownerTalks(a);
				a.noteTranscript(text, { startMs: 0, endMs: 900 });
				assert.ok(a.commandSpeaker(setting)?.owner, text);
			}
		} finally {
			setLocale('en');
		}
	});
});
