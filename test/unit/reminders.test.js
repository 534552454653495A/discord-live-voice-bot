import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ReminderStore, parseWhen } from '../../src/reminders.js';
import { callTool } from '../../src/tools/index.js';

const dir = mkdtempSync(path.join(tmpdir(), 'reminders-'));
const fileFor = (name) => path.join(dir, name);

describe('parseWhen', () => {
	it('reads a delay in minutes and a clock time', () => {
		const now = new Date('2026-09-16T10:00:00').getTime();
		assert.equal(parseWhen({ minutes: 10 }, now), now + 600_000);
		assert.equal(parseWhen({ at: '21:30' }, now), new Date('2026-09-16T21:30:00').getTime());
		assert.equal(parseWhen({ at: '09:15' }, now), new Date('2026-09-17T09:15:00').getTime(), 'a time already past means tomorrow');
	});

	it('answers nothing instead of guessing', () => {
		const now = Date.now();
		assert.equal(parseWhen({}, now), null);
		assert.equal(parseWhen({ minutes: 0 }, now), null);
		assert.equal(parseWhen({ minutes: -5 }, now), null);
		assert.equal(parseWhen({ at: '25:00' }, now), null);
		assert.equal(parseWhen({ at: 'later' }, now), null);
	});
});

describe('ReminderStore', () => {
	it('hands reminders back soonest first, and only to their own server', () => {
		const store = new ReminderStore(fileFor('basic.json'));
		assert.ok(store.add({ guildId: 'g1', userId: 'u1', userName: 'Ali', text: 'later', dueAt: 2_000 }));
		assert.ok(store.add({ guildId: 'g1', text: 'sooner', dueAt: 1_000 }));
		assert.deepEqual(store.list('g1').map((item) => item.text), ['sooner', 'later']);
		assert.deepEqual(store.list('g2'), [], 'another server hears nothing of them');
		assert.deepEqual(store.due(1_500, 'g1').map((item) => item.text), ['sooner']);
	});

	it('caps a server, and refuses a reminder with no text or no time', () => {
		const store = new ReminderStore(fileFor('cap.json'));
		for (let i = 0; i < 50; i++) store.add({ guildId: 'g1', text: `n${i}`, dueAt: 1_000 + i });
		assert.equal(store.add({ guildId: 'g1', text: 'one too many', dueAt: 9_999 }), null);
		assert.equal(store.add({ guildId: 'g2', text: '   ', dueAt: 1_000 }), null);
		assert.equal(store.add({ guildId: 'g2', text: 'x', dueAt: Number.NaN }), null);
	});

	it('survives a restart: what was saved comes back', async () => {
		const file = fileFor('reload.json');
		const first = new ReminderStore(file);
		const item = first.add({ guildId: 'g1', userId: 'u1', userName: 'Ali', text: 'take the pizza out', dueAt: 5_000 });
		await first.save();
		assert.deepEqual((await new ReminderStore(file).load()).list('g1'), [item]);
		const second = await new ReminderStore(file).load();
		second.remove(item.id);
		await second.save();
		assert.deepEqual((await new ReminderStore(file).load()).list(), []);
	});
});

function toolDeps(store, { id = 'u1', name = 'Ali' } = {}) {
	const events = [];
	return {
		events,
		deps: {
			guild: { id: 'g1' },
			reminders: store,
			currentSpeakerId: () => id,
			currentSpeakerName: () => name,
			personaName: () => 'Aria',
			activity: (event) => events.push(event),
			log: () => {},
		},
	};
}

describe('reminder tools', () => {
	it('sets, lists and cancels a reminder, and only its own', async () => {
		const store = new ReminderStore(fileFor('tools.json'));
		const { deps, events } = toolDeps(store);
		const set = await callTool('set_reminder', { text: 'take the pizza out', minutes: 10 }, deps);
		assert.equal(set.ok, true, set.spoken);
		assert.match(set.spoken, /take the pizza out/, 'the answer repeats what will be said');
		assert.equal(store.list('g1').length, 1);
		assert.equal(events.length, 1, 'the panel is told a reminder was set');

		const list = await callTool('list_reminders', {}, deps);
		assert.equal(list.ok, true);
		assert.match(list.spoken, /take the pizza out/);

		const stranger = await callTool('cancel_reminder', { text: 'pizza' }, { ...deps, currentSpeakerId: () => 'u2' });
		assert.equal(stranger.ok, false, 'somebody else cannot cancel it');
		assert.equal(store.list('g1').length, 1);

		const cancelled = await callTool('cancel_reminder', { text: 'pizza' }, deps);
		assert.equal(cancelled.ok, true, cancelled.spoken);
		assert.equal(store.list('g1').length, 0);
	});

	it('refuses a time it cannot read, and answers when reminders are off', async () => {
		const store = new ReminderStore(fileFor('tools2.json'));
		const { deps } = toolDeps(store);
		assert.equal((await callTool('set_reminder', { text: 'x' }, deps)).ok, false);
		assert.equal((await callTool('set_reminder', { text: 'x', at: '25:99' }, deps)).ok, false);
		assert.equal((await callTool('set_reminder', { text: 'x', minutes: 5 }, { ...deps, reminders: null })).ok, false);
		assert.equal((await callTool('list_reminders', {}, { ...deps, reminders: null })).ok, false);
	});
});
