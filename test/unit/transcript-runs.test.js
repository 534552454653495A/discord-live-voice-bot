import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRuns, runCandidates, runText } from '../../src/runs.js';

// buildRuns is where one flush of transcript deltas becomes one line per speaker. Everything here is
// pure: no Discord, no audio, no clock.

const part = (text, id, startMs, endMs, extra = {}) => ({
	text,
	startMs,
	endMs,
	id,
	sure: extra.sure ?? id !== null,
	confidence: extra.confidence ?? (id === null ? 'unsure' : 'sure'),
	ids: extra.ids ?? (id ? [id] : []),
});

const shape = (runs) => runs.map((run) => ({ id: run.id, text: runText(run), mixed: run.mixed }));

describe('one flush, one line per speaker', () => {
	it('leaves one person talking as one line', () => {
		const runs = buildRuns([part('merhaba ', 'a', 0, 400), part('nasilsin', 'a', 400, 900)]);
		assert.deepEqual(shape(runs), [{ id: 'a', text: 'merhaba nasilsin', mixed: false }]);
	});

	it('splits two people who take turns inside one flush', () => {
		const runs = buildRuns([
			part('selam ben kaan ', 'a', 0, 900),
			part('ben de adem ', 'b', 900, 1800),
			part('ne yapiyorsunuz', 'a', 1800, 2700),
		]);
		assert.deepEqual(shape(runs), [
			{ id: 'a', text: 'selam ben kaan', mixed: false },
			{ id: 'b', text: 'ben de adem', mixed: false },
			{ id: 'a', text: 'ne yapiyorsunuz', mixed: false },
		]);
	});

	it('never cuts inside a word, even when the speaker changes there', () => {
		// The handover lands mid-word. Two mangled lines would be a worse answer than one line that admits
		// it holds two voices, and a cut there also stops the command parser seeing "ban Dana".
		const runs = buildRuns([part('ban Da', 'a', 0, 500), part('na', 'b', 500, 700)]);
		assert.equal(runs.length, 1);
		assert.equal(runText(runs[0]), 'ban Dana');
		assert.equal(runs[0].mixed, true, 'and it may not be acted on');
	});

	it('folds a fragment too short to be a turn into its neighbour, keeping the text', () => {
		const runs = buildRuns([part('bunu ', 'a', 0, 600), part('he ', 'b', 600, 700), part('yapalim', 'a', 700, 1400)]);
		assert.equal(runs.length, 1, 'a 100 ms interjection is not a turn');
		assert.equal(runText(runs[0]), 'bunu he yapalim', 'but not one letter of it is lost');
		assert.equal(runs[0].mixed, true);
	});

	it('keeps a real turn even when it is short in words', () => {
		const runs = buildRuns([part('sence ne olur ', 'a', 0, 900), part('bilmiyorum', 'b', 900, 1800)]);
		assert.deepEqual(
			shape(runs).map((run) => run.id),
			['a', 'b'],
		);
	});

	it('folds away a hole too short to be anything', () => {
		// 120 ms: this never reaches the bridging rule, it is folded as a run too short to be a turn. Kept
		// as its own case because the two rules produce the same answer here for different reasons.
		const runs = buildRuns([part('bu sarkiyi ', 'a', 0, 800), part('hmm ', null, 800, 920), part('acsana', 'a', 920, 1600)]);
		assert.equal(runs.length, 1);
		assert.equal(runs[0].id, 'a');
		assert.equal(runText(runs[0]), 'bu sarkiyi hmm acsana');
	});

	it('carries one voice across a hole long enough to be a run of its own', () => {
		// 350 ms is past the "too short to be a turn" floor and inside the bridge, so this is the only case
		// that actually exercises the bridging pass.
		const runs = buildRuns([part('bu sarkiyi ', 'a', 0, 800), part('hmmm ', null, 800, 1150), part('acsana', 'a', 1150, 1900)]);
		assert.equal(runs.length, 1, 'one person talking through a noise nobody could place');
		assert.equal(runs[0].id, 'a');
		assert.equal(runText(runs[0]), 'bu sarkiyi hmmm acsana');
		assert.equal(runs[0].mixed, true, 'and it carries something that was not provably theirs');
	});

	it('does not carry a voice across a hole longer than the bridge', () => {
		const runs = buildRuns([part('bu sarkiyi ', 'a', 0, 800), part('hmmmmm ', null, 800, 1300), part('acsana', 'a', 1300, 2100)]);
		assert.equal(runs.length, 3, 'half a second of nobody-knows-who stands on its own');
	});

	it('does not carry a voice across a long unidentified stretch', () => {
		const runs = buildRuns([part('bu sarkiyi ', 'a', 0, 800), part('bilmiyorum ki ya ', null, 800, 2200), part('acsana', 'a', 2200, 2900)]);
		assert.equal(runs.length, 3, '1.4 s of nobody-knows-who is its own piece of the conversation');
		assert.equal(runs[1].id, null);
	});

	it('names nobody when the voices are tangled, and says who the candidates were', () => {
		const runs = buildRuns([
			part('ayni anda ', null, 0, 600, { ids: ['a', 'b'] }),
			part('konusuyoruz', null, 600, 1400, { ids: ['a', 'b'] }),
		]);
		assert.equal(runs.length, 1);
		assert.equal(runs[0].id, null);
		assert.deepEqual(runCandidates(runs[0]).sort(), ['a', 'b']);
	});

	// Live failure: in a busy room the last fragment of nearly every turn is "leaning", because the next
	// person is already starting -- and that one edge fragment used to make the WHOLE run mixed, which
	// hedged every line to the model and refused the owner's own commands. A same-speaker fragment that
	// merely leans is still that speaker's text; whether the bleed matters is decided over the whole line
	// (resolveLine, aggregate solo), not by the worst single fragment.
	it('does not let one leaning edge fragment of the same speaker make the run mixed', () => {
		const leaning = { sure: false, confidence: 'leaning', ids: ['a', 'b'] };
		const trailing = buildRuns([part('bunu ', 'a', 0, 500), part('yap', 'a', 500, 1000, leaning)]);
		assert.equal(trailing[0].id, 'a');
		assert.equal(trailing[0].mixed, false, 'the last word leaning is not somebody else s word');
		const leading = buildRuns([part('sanirim ', 'a', 0, 500, leaning), part('oyle', 'a', 500, 1000)]);
		assert.equal(leading[0].id, 'a', 'the line still carries the likeliest name');
		assert.equal(leading[0].mixed, false, 'and a leaning first fragment is no different');
	});

	it('still marks a run mixed when it really holds somebody else s fragment', () => {
		// The structural cases are untouched: a different speaker glued in mid-word stays mixed.
		const runs = buildRuns([part('ban Da', 'a', 0, 500), part('na', 'b', 500, 700, { sure: false, confidence: 'leaning', ids: ['a', 'b'] })]);
		assert.equal(runs.length, 1);
		assert.equal(runs[0].mixed, true);
	});

	it('cuts where the next fragment starts with punctuation, even without a space before it', () => {
		// The other half of the "never cut inside a word" rule: a fragment opening with punctuation is a
		// safe place to cut however the previous one ended.
		const runs = buildRuns([part('evet', 'a', 0, 500), part(', tamam', 'b', 500, 1000)]);
		assert.deepEqual(shape(runs), [
			{ id: 'a', text: 'evet', mixed: false },
			{ id: 'b', text: ', tamam', mixed: false },
		]);
		// The twin: a letter instead of punctuation, and the two stay glued.
		const glued = buildRuns([part('evet', 'a', 0, 500), part('tamam', 'b', 500, 1000)]);
		assert.equal(glued.length, 1);
		assert.equal(glued[0].mixed, true);
	});

	it('does not let a whitespace delta open a run or change the speaker', () => {
		const runs = buildRuns([part('bir ', 'a', 0, 400), part(' ', null, 400, 420), part('iki', 'a', 420, 900)]);
		assert.equal(runs.length, 1);
		assert.equal(runText(runs[0]), 'bir iki');
		assert.equal(runs[0].mixed, false, 'a gap between words is not evidence of anything');
	});

	it('keeps a single short line rather than dropping it', () => {
		const runs = buildRuns([part('atla', 'a', 0, 200)]);
		assert.deepEqual(shape(runs), [{ id: 'a', text: 'atla', mixed: false }]);
	});

	// The one that guards all the rest: every fold, bridge and coalesce is an array splice, and a splice
	// is exactly where text gets dropped, duplicated or reordered without anybody noticing.
	it('never loses, duplicates or reorders a delta, over five hundred random inputs', () => {
		// The generator matters as much as the property. A plain `seed * 1103515245` loses its low bits to
		// floating point, which made rnd(2) return 1 once in two hundred draws instead of once in two: the
		// inputs almost never had a trailing space, so almost nothing was ever cut into two runs and the
		// splices this test exists to guard were never executed. imul keeps the arithmetic exact and the
		// high bits are the ones that are actually random.
		let seed = 12345;
		const rnd = (n) => {
			seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
			return Math.floor(((seed >>> 16) / 65536) * n);
		};
		const ids = ['a', 'b', null];
		let multiRun = 0;
		for (let round = 0; round < 500; round++) {
			const parts = [];
			let clock = 0;
			const count = 1 + rnd(9);
			for (let i = 0; i < count; i++) {
				const span = 40 + rnd(900);
				const id = ids[rnd(3)];
				const text = rnd(5) === 0 ? ' ' : `w${round}_${i}${rnd(2) ? ' ' : ''}`;
				parts.push(part(text, id, clock, clock + span));
				clock += span;
			}
			const runs = buildRuns(parts);
			if (runs.length > 1) multiRun++;
			const flat = runs.flatMap((run) => run.parts);
			assert.deepEqual(
				flat.map((entry) => entry.text),
				parts.map((entry) => entry.text),
				`round ${round}: every delta survives exactly once, in order`,
			);
		}
		// Without this the test could pass on five hundred single-run inputs and prove nothing about the
		// folding, bridging and coalescing it is here to cover.
		assert.ok(multiRun > 100, `the inputs have to reach the interesting shapes: only ${multiRun} of 500 produced more than one run`);
	});
});
