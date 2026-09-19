import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SessionHealth } from '../../src/health.js';

// The session's own account of itself. Nine minutes of one live session went by with every line
// nobody's before anybody could see it in the log; the report is there to say so at the second minute.

describe('the session health report', () => {
	it('counts what the session decided and says it in a few lines', () => {
		let now = 0;
		const health = new SessionHealth({ now: () => now });
		for (let i = 0; i < 6; i++) health.fragment({ confidence: 'sure', reason: 'direct' });
		for (let i = 0; i < 3; i++) health.fragment({ confidence: 'leaning', reason: 'nearby' });
		health.fragment({ confidence: 'unsure', reason: 'silence' });
		health.line({ id: 'a', mixed: false });
		health.line({ id: 'a', mixed: true });
		health.line({ id: null, mixed: false });
		health.gateResult('allowed');
		health.gateResult('denied', 'the owner did not say the keyword');
		health.gateResult('denied', 'the owner did not say the keyword');
		health.jevVerdict({ addressed: 0.1, kind: 'chat', kindP: 0.8 }, 400, { notForBot: true });
		health.jevVerdict({ addressed: 0.9, kind: 'banter', kindP: 0.9 }, 600, { banter: true });
		health.jevVerdict(null, 2500);
		health.jevSuppressed();
		health.tool('play_music', 5500);
		health.tool('play_music', 6100);
		health.tool('send_message', 300);
		health.driftNow(1200);
		health.driftNow(900);
		now = 5 * 60_000;

		const s = health.snapshot();
		assert.equal(s.fragments, 10);
		assert.equal(s.surePct, 60);
		assert.equal(s.silentPct, 10);
		assert.equal(s.lines, 3);
		assert.equal(s.unknownPct, 33);
		assert.deepEqual([s.gateAllowed, s.gateDenied], [1, 2]);
		assert.deepEqual(s.gateReasons, [{ reason: 'the owner did not say the keyword', count: 2 }]);
		assert.deepEqual([s.jevCalls, s.jevFailed, s.jevBanter, s.jevNotForBot, s.jevSuppressed, s.jevMedianMs], [3, 1, 1, 1, 1, 600]);
		assert.deepEqual([s.driftMs, s.driftMaxMs], [900, 1200]);
		assert.deepEqual(s.slowTools, [{ name: 'play_music', count: 2, slow: 2, avgMs: 5800 }]);
		assert.equal(s.minutes, 5);

		const lines = health.report({ why: 'test', latency: 'P50 1.0 s' });
		assert.equal(lines.length, 4, lines.join('\n'));
		assert.match(lines[0], /10/);
		assert.match(lines[0], /60/);
		assert.match(lines[1], /×2/);
		assert.match(lines[2], /600/);
		assert.match(lines[3], /play_music ×2/);
		assert.match(lines[3], /5\.8/);
	});

	it('warns when the drift is large and when most lines belong to nobody', () => {
		const health = new SessionHealth();
		health.driftNow(7660);
		for (let i = 0; i < 12; i++) health.line({ id: null, mixed: false });
		const lines = health.report();
		assert.equal(lines.length, 4, lines.join('\n'));
		assert.match(lines[2], /7660/);
		assert.match(lines[3], /100/);
	});

	it('has nothing to warn about on a healthy session', () => {
		const health = new SessionHealth();
		health.driftNow(400);
		for (let i = 0; i < 12; i++) health.line({ id: 'a', mixed: false });
		assert.equal(health.report().length, 2);
	});
});
