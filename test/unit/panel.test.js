import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';
import { ActivityLog, startPanel } from '../../src/panel.js';
import { transcriptFromEvents } from '../../src/summary.js';

describe('panel', () => {
	it('serves the page, validates the Host header and answers healthz, metrics, export and the date filter', async () => {
		const activity = new ActivityLog();
		activity.push({ kind: 'dm', direction: 'in', who: 'u1', whoName: '<img src=x onerror=alert(1)>', text: 'how is it going' });
		activity.push({ kind: 'voice', direction: 'in', who: 'u1', text: 'hello' });
		const panel = await startPanel({
			activity,
			port: 0,
			log: () => {},
			state: () => ({ status: 's', metrics: [] }),
			metrics: () => ({ up: 1, response_p50_ms: 420, 'bad name!': 3 }),
			health: () => ({ ok: true, voice: false }),
		});
		try {
			const page = await fetch(panel.url);
			const html = await page.text();
			assert.ok(html.includes('Local panel'), 'the panel heading comes from the English bundle');
			assert.ok(!html.includes('innerHTML'), 'user data must not be written through innerHTML');

			const events = await (await fetch(`${panel.url}/api/events`)).json();
			assert.equal(
				events.events[0].whoName,
				'<img src=x onerror=alert(1)>',
				'the data comes back untouched; the escaping happens on the client through textContent',
			);

			const rebindingStatus = await new Promise((resolve, reject) => {
				const req = http.request(`${panel.url}/api/events`, { headers: { host: 'evil.example.com' } }, (res) => {
					res.resume();
					res.on('end', () => resolve(res.statusCode));
				});
				req.on('error', reject);
				req.end();
			});
			assert.equal(rebindingStatus, 403, 'a foreign Host header must be rejected');

			const health = await (await fetch(`${panel.url}/healthz`)).json();
			assert.equal(health.ok, true);

			const metrics = await (await fetch(`${panel.url}/metrics`)).text();
			assert.ok(metrics.includes('voicebot_response_p50_ms 420'));
			assert.ok(metrics.includes('voicebot_bad_name_ 3'));

			const exported = await (await fetch(`${panel.url}/api/export?kinds=voice`)).text();
			assert.equal(exported.split('\n').length, 1);

			const future = await (await fetch(`${panel.url}/api/events?from=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`)).json();
			assert.equal(future.events.length, 0, 'the date filter drops everything older than "from"');

			const negative = await (await fetch(`${panel.url}/api/events?limit=-5`)).json();
			assert.ok(negative.events.length >= 1, 'a negative limit must not turn the query inside out');
		} finally {
			await panel.close();
		}
	});

	it('still returns and counts an event that is pushed with persist:false', async () => {
		const activity = new ActivityLog();
		const entry = activity.push({ kind: 'voice', text: 'x', persist: false });
		assert.equal(entry.kind, 'voice');
		assert.equal(activity.stats().voice, 1);
	});
});

describe('summary.transcriptFromEvents', () => {
	it('takes only the spoken kinds, leaves DMs out unless asked, and trims to length', () => {
		const now = new Date().toISOString();
		const events = [
			{ kind: 'voice', direction: 'in', whoName: 'Alice', text: 'hello', at: now },
			{ kind: 'dm', direction: 'in', whoName: 'Bob', text: 'secret', at: now },
			{ kind: 'tool', text: 'send_message', at: now },
			{ kind: 'voice', direction: 'out', text: 'hi there', at: now },
		];
		const { text, count } = transcriptFromEvents(events);
		assert.equal(count, 2);
		assert.ok(text.includes('Alice: hello') && text.includes('bot: hi there'));
		assert.ok(!text.includes('secret'));
		assert.equal(transcriptFromEvents(events, { includeDm: true }).count, 3);
		assert.ok(transcriptFromEvents(events, { maxChars: 10 }).text.startsWith('…'));
	});
});
