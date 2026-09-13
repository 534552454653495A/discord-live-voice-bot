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

	it('carries one voice across a short hole nobody could identify', () => {
		const runs = buildRuns([part('bu sarkiyi ', 'a', 0, 800), part('hmm ', null, 800, 920), part('acsana', 'a', 920, 1600)]);
		assert.equal(runs.length, 1);
		assert.equal(runs[0].id, 'a');
		assert.equal(runText(runs[0]), 'bu sarkiyi hmm acsana');
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

	it('marks a run that leans rather than knows', () => {
		const runs = buildRuns([part('sanirim ', 'a', 0, 500, { sure: false, confidence: 'leaning', ids: ['a', 'b'] }), part('oyle', 'a', 500, 1000)]);
		assert.equal(runs[0].id, 'a', 'the line still carries the likeliest name');
		assert.equal(runs[0].mixed, true, 'and still may not be acted on');
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
		let seed = 12345;
		const rnd = (n) => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed % n;
		};
		const ids = ['a', 'b', null];
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
			const flat = runs.flatMap((run) => run.parts);
			assert.deepEqual(
				flat.map((entry) => entry.text),
				parts.map((entry) => entry.text),
				`round ${round}: every delta survives exactly once, in order`,
			);
		}
	});
});
