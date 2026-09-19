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

describe('the transcript s clock against ours', () => {
	// Live failure, nine minutes into a session: every fragment "unsure/silence, heard: -", every line
	// nobody's, the owner's "Ester'i kalıcı banla" refused three times and "Melis sus" never run. The
	// transcript's positions had run 7.7 s ahead of the audio we had sent (+0.2 s at 40 s, +1.3 s at two
	// minutes), so every fragment landed where the track had no audio at all.
	it('measures the offset from the fragments and takes it off', () => {
		const a = new SpeakerAttribution({ ownerId: 'o' });
		ownerTalks(a, 100); // 0 - 2000 ms of the owner alone
		// The transcript says this fragment sits at 2300-2500: 500 ms ahead of everything we have sent.
		assert.equal(a.observeTranscript(2500), 500);
		assert.equal(a.mapTranscriptMs(2300), 1800);
		const hit = a.resolveSpeaker(a.mapTranscriptMs(2300), a.mapTranscriptMs(2500));
		assert.equal(hit.id, 'o');
		assert.equal(hit.reason, 'direct', 'looked up where the audio actually is');
		// A transcript that merely lags (its end behind our position) is no offset at all.
		const b = new SpeakerAttribution({ ownerId: 'o' });
		ownerTalks(b, 100);
		assert.equal(b.observeTranscript(1400), 0);
		assert.equal(b.mapTranscriptMs(1200), 1200);
	});

	it('follows the offset as it grows, and forgets it with the session', () => {
		const a = new SpeakerAttribution({ ownerId: 'o' });
		ownerTalks(a, 50);
		assert.equal(a.observeTranscript(1100), 100);
		ownerTalks(a, 50);
		assert.equal(a.observeTranscript(2300), 300, 'the larger, more recent offset wins');
		assert.equal(a.observeTranscript(2100), 300, 'a smaller one does not pull it back inside the window');
		assert.equal(a.observeTranscript(500_000), 300, 'nonsense is not a clock');
		a.resetSession();
		assert.equal(a.transcriptDrift, 0);
	});
});

describe('the drift model', () => {
	it('predicts the offset through a silence from the rate it measured', () => {
		const a = new SpeakerAttribution({ ownerId: 'o' });
		const rate = 0.013;
		for (let k = 1; k <= 12; k++) {
			ownerTalks(a, 250); // five seconds
			const end = a.audioMs;
			a.observeTranscript(end + Math.round(end * rate));
		}
		assert.ok(Math.abs(a.transcriptDrift - 780) < 60, `sixty seconds in: ${a.transcriptDrift}`);
		assert.ok(Math.abs(a.driftRate - 13) < 3, `ms per second: ${a.driftRate}`);
		for (let i = 0; i < 2000; i++) a.onFrame({ active: [], present: [], sent: true }); // forty seconds of nobody talking
		assert.ok(Math.abs(a.transcriptDrift - 1300) < 100, `predicted at a hundred seconds: ${a.transcriptDrift}`);
	});
});
