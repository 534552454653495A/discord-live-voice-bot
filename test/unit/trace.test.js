import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { AudioTrace, SessionTrace, replayTrace } from '../../src/trace.js';

// The flight recorder and its replay: what was recorded live must reproduce the same decisions when
// run through the attribution again, so that a live failure can become a test.

const frames = (trace, attribution, active, count, priority = false) => {
	for (let i = 0; i < count; i++) {
		const frame = { active, present: [], priority, sent: true };
		trace.frame(frame, attribution.audioMs);
		attribution.onFrame(frame);
	}
};

describe('the flight recorder', () => {
	it('writes one record per change of voices, every fragment with its decision, and replays to the same answers', async () => {
		const { SpeakerAttribution } = await import('../../src/attribution.js');
		const dir = await mkdtemp(path.join(tmpdir(), 'trace-'));
		let now = 1_000_000;
		const trace = new SessionTrace({ dir, name: 'g', owner: 'o', now: () => now });
		const a = new SpeakerAttribution({ ownerId: 'o' });

		frames(trace, a, ['o'], 50, true); // 0 - 1000 ms, the owner alone
		frames(trace, a, ['x'], 30); // 1000 - 1600 ms, x
		// The transcript's clock has run 200 ms ahead; the recorder keeps the raw positions and the mapped ones.
		const record = (rawStart, rawEnd, text) => {
			const drift = a.observeTranscript(rawEnd);
			const start = a.mapTranscriptMs(rawStart);
			const end = a.mapTranscriptMs(rawEnd);
			const hit = a.noteTranscript(text, { startMs: start, endMs: end });
			trace.delta({ audio: a.audioMs, rawStart, rawEnd, start, end, drift, text, hit });
			return hit;
		};
		assert.equal(record(200, 1000, ' melis sus').id, 'o');
		assert.equal(record(1400, 1800, ' ben de').id, 'x');
		trace.line({ line: 'melis sus', id: 'o', mixed: false, candidates: ['o'] });
		trace.gate({ meta: { tool: 'set_setting', result: 'allowed', reason: null } });
		trace.assistant('tamam', false);
		now += 1000;
		await trace.close();

		const [file] = await readdir(dir);
		assert.match(file, /^g-/);
		const records = (await readFile(path.join(dir, file), 'utf8'))
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		assert.equal(records[0].t, 'm');
		assert.equal(records[0].owner, 'o');
		assert.equal(records.filter((entry) => entry.t === 'a').length, 2, 'eighty frames, two changes of voice');
		const deltas = records.filter((entry) => entry.t === 'd');
		assert.equal(deltas.length, 2);
		assert.deepEqual(deltas.map((entry) => entry.id), ['o', 'x']);
		assert.equal(deltas[1].drift, 200);
		assert.deepEqual(records.map((entry) => entry.t).slice(-3), ['l', 'g', 'o']);

		const result = replayTrace(records);
		assert.equal(result.total, 2);
		assert.equal(result.matched, 2, JSON.stringify(result.decisions));
	});

	it('keeps the words out of the file when transcripts may not be recorded', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'trace-'));
		const trace = new SessionTrace({ dir, text: false });
		trace.delta({ audio: 100, rawStart: 0, rawEnd: 100, start: 0, end: 100, drift: 0, text: 'secret', hit: null });
		trace.line({ line: 'secret', id: null, mixed: false, candidates: [] });
		await trace.close();
		const [file] = await readdir(dir);
		const body = await readFile(path.join(dir, file), 'utf8');
		assert.ok(!body.includes('secret'));
	});
});

describe('the sent audio on file', () => {
	it('writes a WAV of exactly what was sent, with its sizes filled in on close', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'trace-'));
		const trace = new AudioTrace({ dir, now: () => 1_000_000 });
		trace.write(new Int16Array(480).fill(7));
		trace.write(new Int16Array(480).fill(-7));
		await trace.close();
		const [file] = await readdir(dir);
		assert.match(file, /^sent-.*\.wav$/);
		const body = await readFile(path.join(dir, file));
		assert.equal(body.length, 44 + 2 * 480 * 2);
		assert.equal(body.toString('ascii', 0, 4), 'RIFF');
		assert.equal(body.readUInt32LE(24), 24_000, 'sample rate');
		assert.equal(body.readUInt32LE(40), 2 * 480 * 2, 'data size, filled in on close');
		assert.equal(body.readInt16LE(44), 7, 'the first sample sent');
		assert.equal(body.readInt16LE(44 + 480 * 2), -7);
	});
});
