import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LocalBrain, toChatTools } from '../../src/localbrain.js';
import { LocalStt, SpeechSegmenter } from '../../src/localstt.js';
import { describeLiveError } from '../../src/live.js';

function fakeProvider(script) {
	const calls = [];
	let i = 0;
	return {
		calls,
		provider: {
			available: true,
			textModel: 'deepseek-chat',
			textClient: {
				chat: {
					completions: {
						create: async (payload) => {
							calls.push(payload);
							const step = script[Math.min(i, script.length - 1)];
							i++;
							return { choices: [{ message: step }] };
						},
					},
				},
			},
		},
	};
}

describe('LocalBrain', () => {
	it('converts the Responses tool schema into the chat format and drops the built-in tools', () => {
		const tools = toChatTools([{ type: 'function', name: 'x', description: 'd', parameters: { type: 'object', properties: {} } }, { type: 'web_search' }]);
		assert.equal(tools.length, 1);
		assert.equal(tools[0].function.name, 'x');
	});

	it('answers when it is addressed, when it is alone, mid-conversation or asked a question', () => {
		let now = 100_000;
		let people = 3;
		const brain = new LocalBrain({ provider: fakeProvider([]).provider, persona: () => ({ name: 'Aria', instructions: '' }), participants: () => people, now: () => now });
		assert.equal(brain.shouldRespond('aria how are you'), true, 'called by name');
		assert.equal(brain.shouldRespond('arla how are you'), true, 'the transcript mangled the name (similarity)');
		assert.equal(brain.shouldRespond('ariaa come over here'), true, 'the name with a suffix glued on (prefix)');
		assert.equal(brain.shouldRespond('the weather is nice today'), false, 'a plain sentence in a crowded channel, addressed to nobody');
		assert.equal(brain.shouldRespond('do you think this is worth it?'), true, 'a question');
		people = 1;
		assert.equal(brain.shouldRespond('the weather is nice today'), true, 'one-on-one');
		people = 3;
		brain.lastReplyAt = now - 5000;
		assert.equal(brain.shouldRespond('the weather is nice today'), true, 'the conversation is still running');
		brain.respondPolicy = 'addressed';
		assert.equal(brain.shouldRespond('the weather is nice today'), false);
		brain.respondPolicy = 'always';
		assert.equal(brain.shouldRespond('the weather is nice today'), true);
	});

	it('runs the tool loop: tool_calls -> callTool -> result -> spoken answer', async () => {
		const { provider, calls } = fakeProvider([
			{ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'play_music', arguments: '{"query":"daft punk"}' } }] },
			{ role: 'assistant', content: 'All right, Daft Punk is playing.' },
		]);
		const toolCalls = [];
		const brain = new LocalBrain({
			provider,
			persona: () => ({ name: 'Aria', instructions: 'You are Aria.' }),
			tools: [{ type: 'function', name: 'play_music', description: 'play', parameters: { type: 'object', properties: { query: { type: 'string' } } } }],
			callTool: async (name, args) => (toolCalls.push([name, args]), { ok: true, spoken: 'Playing: Daft Punk' }),
			toolOutput: (r) => JSON.stringify(r),
			participants: () => 1,
		});
		const events = [];
		brain.on('tool', (e) => events.push(e));
		const reply = await brain.handleUtterance({ userName: 'Alice', text: 'aria play daft punk' });
		assert.equal(reply.responded, true);
		assert.equal(reply.text, 'All right, Daft Punk is playing.');
		assert.deepEqual(toolCalls, [['play_music', { query: 'daft punk' }]]);
		assert.equal(events.length, 1);
		assert.equal(calls.length, 2);
		assert.equal(calls[1].messages.at(-1).role, 'tool');
		assert.ok(calls[0].messages[0].content.includes('You are Aria.'), 'the persona belongs in the system instructions');
		assert.equal(brain.history.at(-1).content, 'All right, Daft Punk is playing.');
	});

	it('puts an utterance that arrives mid-generation into the context instead of a reply queue', async () => {
		let resolveFirst;
		const provider = {
			available: true,
			textModel: 'm',
			textClient: { chat: { completions: { create: () => new Promise((r) => (resolveFirst = r)) } } },
		};
		const brain = new LocalBrain({ provider, participants: () => 1 });
		const first = brain.handleUtterance({ userName: 'Alice', text: 'hello' });
		await new Promise((r) => setImmediate(r));
		const second = await brain.handleUtterance({ userName: 'Bob', text: 'I am here too' });
		assert.equal(second.queued, true);
		resolveFirst({ choices: [{ message: { content: 'hello!' } }] });
		assert.equal((await first).text, 'hello!');
		assert.equal(brain.history.filter((m) => m.role === 'user').length, 2);
	});
});

describe('SpeechSegmenter', () => {
	it('closes a segment on silence, keeps the pre-roll and throws away short noise', () => {
		let now = 0;
		const seg = new SpeechSegmenter({ silenceMs: 300, minMs: 100, preRollMs: 40, now: () => now });
		const segments = [];
		const starts = [];
		seg.on('segment', (s) => segments.push(s));
		seg.on('start', (s) => starts.push(s.userId));
		const quiet = new Int16Array(480).fill(10);
		const loud = new Int16Array(480).fill(3000);
		seg.push('u1', quiet); // pre-roll
		seg.push('u1', quiet);
		for (let i = 0; i < 10; i++) {
			now += 20;
			seg.push('u1', loud);
		}
		assert.deepEqual(starts, ['u1']);
		assert.equal(segments.length, 0, 'it does not close before the silence arrives');
		now += 350;
		seg.poll();
		assert.equal(segments.length, 1);
		assert.equal(segments[0].userId, 'u1');
		assert.equal(segments[0].pcm.length, 480 * 12, '2 pre-roll packets + 10 speech packets');

		// 2 packets (40 ms) of noise stay under minMs and are dropped.
		now += 1000;
		seg.push('u2', loud);
		seg.push('u2', loud);
		now += 400;
		seg.poll();
		assert.equal(segments.length, 1);
	});

	it('force-closes a segment once maxMs is reached', () => {
		let now = 0;
		const seg = new SpeechSegmenter({ maxMs: 200, minMs: 50, now: () => now });
		const segments = [];
		seg.on('segment', (s) => segments.push(s));
		const loud = new Int16Array(480).fill(3000);
		for (let i = 0; i < 25; i++) {
			now += 20;
			seg.push('u1', loud);
		}
		assert.ok(segments.length >= 2, `a long speech must be split: ${segments.length}`);
	});
});

describe('LocalStt', () => {
	it('downsamples to 16 kHz and tidies up the server answer', async () => {
		const original = globalThis.fetch;
		let received = null;
		globalThis.fetch = async (url, options) => {
			received = { url: String(url), options };
			return { ok: true, json: async () => ({ ok: true, text: '  hello   world ', language: 'en' }) };
		};
		try {
			const stt = new LocalStt({ url: 'http://127.0.0.1:8020/', language: 'en' });
			const result = await stt.transcribe(new Int16Array(24_000).fill(100), { prompt: 'Aria, Alice' });
			assert.equal(result.text, 'hello world');
			assert.equal(result.durationMs, 1000);
			assert.equal(received.options.body.length, 16_000 * 2, '16 kHz int16');
			assert.ok(received.url.includes('/stt?language=en'), received.url);
			assert.ok(received.url.includes('prompt=Aria%2C+Alice'), 'the name hint has to reach whisper');
		} finally {
			globalThis.fetch = original;
		}
	});
});

describe('describeLiveError', () => {
	it('treats a credit or key error as permanent and a timeout as temporary', () => {
		const raw = '{"type":"error","error":{"type":"invalid_request_error","code":"credit_balance_exhausted","message":"no credits"}}';
		const info = describeLiveError(new Error(raw));
		assert.equal(info.fatal, true);
		assert.equal(info.code, 'credit_balance_exhausted');
		assert.ok(info.hint.includes('run out of credit'), info.hint);
		assert.equal(describeLiveError(new Error('session.started timed out')).fatal, false);
		assert.equal(describeLiveError({ error: { type: 'authentication_error', message: 'x' } }).fatal, true);
	});
});
