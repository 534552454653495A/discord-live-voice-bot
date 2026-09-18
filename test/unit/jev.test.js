import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createJev } from '../../src/jev.js';

// The wrapper around Jev: what is sent, what comes back, and what happens when nothing comes back.
// The network is a fake client with systemOne(); nothing here talks to typesafe.ai.

const cfg = (extra = {}) => ({ jev: true, jevApiKey: 'k', jevModel: 'jev-latest', ...extra });
const answers = (addressed, kind, p = 0.9) => ({
	answers: { addressed: { type: 'noul', noul: addressed }, kind: { type: 'choice', choice: kind, confidence: p, probabilities: { [kind]: p } } },
});

describe('Jev: typed judgments about a line', () => {
	it('is off without a key, and off when JEV=0 even with one', async () => {
		assert.equal(createJev(cfg({ jevApiKey: null })).enabled, false);
		assert.equal(createJev(cfg({ jev: false })).enabled, false);
		assert.equal(await createJev(cfg({ jevApiKey: null })).judge({ line: 'x' }), null);
	});

	it('asks both questions in one round trip and hands back the probabilities', async () => {
		const calls = [];
		const client = {
			systemOne: async (request) => {
				calls.push(request);
				return answers(0.12, 'banter', 0.88);
			},
		};
		const jev = createJev(cfg(), { client });
		const hit = await jev.judge({ line: 'melis bana miyavla', speaker: 'adam', botName: 'Melis', recent: 'x' });
		assert.equal(calls.length, 1, 'one round trip, not one per question');
		assert.deepEqual(Object.keys(calls[0].questions).sort(), ['addressed', 'kind']);
		assert.equal(calls[0].model, 'jev-latest');
		assert.equal(calls[0].state.assistant, 'Melis');
		assert.equal(calls[0].state.line, 'melis bana miyavla');
		assert.deepEqual(hit, { addressed: 0.12, kind: 'banter', kindP: 0.88, confidence: 0.88 });
	});

	it('answers null on a failure, logs the first one, and stops asking after repeated failures', async () => {
		const logged = [];
		let calls = 0;
		const client = {
			systemOne: async () => {
				calls++;
				throw new Error('boom');
			},
		};
		const jev = createJev(cfg(), { client, log: (line) => logged.push(line) });
		for (let i = 0; i < 8; i++) assert.equal(await jev.judge({ line: 'x' }), null);
		assert.equal(calls, 5, 'five failures in a row and it stops asking');
		assert.equal(logged.length, 2, 'the first and the last failure are logged, not every one');
		assert.match(logged[0], /boom/);
	});

	it('never returns a half answer', async () => {
		const client = { systemOne: async () => ({ answers: { addressed: { noul: 0.5 } } }) };
		assert.equal(await createJev(cfg(), { client }).judge({ line: 'x' }), null);
	});
});

describe('Jev: does the owner s line ask for this tool', () => {
	it('returns the probability, and null when it cannot answer', async () => {
		const sent = [];
		const client = {
			systemOne: async (request) => {
				sent.push(request);
				return { answers: { asks: { type: 'noul', noul: 0.91 } } };
			},
		};
		const jev = createJev(cfg(), { client });
		assert.equal(await jev.asks({ line: 'melis konusmaya devam edebilirsin', tool: 'set_setting', description: 'turns a setting on or off' }), 0.91);
		assert.equal(sent[0].state.tool, 'set_setting');
		assert.equal(Object.keys(sent[0].questions).join(), 'asks');
		assert.equal(await createJev(cfg({ jevApiKey: null })).asks({ line: 'x', tool: 't' }), null);
		const broken = createJev(cfg(), {
			client: {
				systemOne: async () => {
					throw new Error('down');
				},
			},
		});
		assert.equal(await broken.asks({ line: 'x', tool: 't' }), null);
	});
});
