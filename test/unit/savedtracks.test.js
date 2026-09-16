import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { MAX_SAVED_PER_USER, SavedTracks, pickSaved } from '../../src/savedtracks.js';
import { callTool } from '../../src/tools/index.js';

const dir = mkdtempSync(path.join(tmpdir(), 'saved-'));
const fileFor = (name) => path.join(dir, name);

describe('SavedTracks', () => {
	it('keeps one list per person, and the same track is one entry', () => {
		const store = new SavedTracks(fileFor('basic.json'));
		assert.ok(store.add({ userId: 'u1', userName: 'Ali', title: 'Puppe', ref: 'https://youtu.be/x', kind: 'url' }));
		assert.deepEqual(store.list('u2'), [], "somebody else's list is empty");
		const again = store.add({ userId: 'u1', title: 'Puppe', ref: 'https://youtu.be/x' });
		assert.equal(again.duplicate, true, 'the same track comes back as a duplicate');
		assert.equal(store.list('u1').length, 1);
		assert.equal(store.add({ userId: 'u1', title: 'nameless', ref: '   ' }), null, 'no reference, no entry');
	});

	it('caps a person, and takes out only its own', () => {
		const store = new SavedTracks(fileFor('cap.json'));
		let last = null;
		for (let i = 0; i < MAX_SAVED_PER_USER; i++) last = store.add({ userId: 'u1', title: `T${i}`, ref: `ref-${i}` });
		assert.equal(store.add({ userId: 'u1', title: 'one too many', ref: 'ref-x' }), null);
		assert.equal(store.remove('u2', last.id), null, "somebody else's id does nothing");
		assert.equal(store.remove('u1', last.id).title, `T${MAX_SAVED_PER_USER - 1}`);
	});

	it('survives a restart', async () => {
		const file = fileFor('reload.json');
		const first = new SavedTracks(file);
		const item = first.add({ userId: 'u1', userName: 'Ali', title: 'Puppe', ref: 'ref-1', kind: 'url' });
		await first.save();
		assert.deepEqual((await new SavedTracks(file).load()).list('u1'), [item]);
	});

	it('finds a track by its number or by a few words, however they are written', () => {
		const items = [
			{ id: 'a', title: 'Rammstein — Puppe' },
			{ id: 'b', title: 'Sezen Aksu — Gülümse' },
		];
		assert.equal(pickSaved(items, '2').id, 'b');
		assert.equal(pickSaved(items, 'puppe').id, 'a');
		assert.equal(pickSaved(items, 'gulumse').id, 'b', 'Turkish letters are normalised');
		assert.equal(pickSaved(items, '9'), null);
		assert.equal(pickSaved(items, ''), null);
	});
});

function toolDeps(store, { id = 'u1', name = 'Ali', queueFull = false } = {}) {
	const calls = [];
	return {
		calls,
		deps: {
			savedTracks: store,
			music: {
				current: { title: 'Puppe', kind: 'url', url: 'https://youtu.be/x', uploader: 'Rammstein' },
				resolve: async (query) => ({ title: `T:${query}`, kind: 'url', url: `https://youtu.be/${query}` }),
				enqueue: async (ref, options) => {
					if (queueFull) throw new Error('queue-full');
					calls.push({ ref, requestedBy: options?.requestedBy });
					return { track: { title: ref }, position: calls.length, startedNow: calls.length === 1 };
				},
			},
			currentSpeakerId: () => id,
			currentSpeakerName: () => name,
			personaName: () => 'Aria',
			activity: () => {},
			log: () => {},
		},
	};
}

describe('saved track tools', () => {
	it('saves what is playing, lists it, plays it back and takes it out', async () => {
		const store = new SavedTracks(fileFor('tools.json'));
		const { deps, calls } = toolDeps(store);
		const saved = await callTool('save_track', {}, deps);
		assert.equal(saved.ok, true, saved.spoken);
		assert.match(saved.spoken, /Puppe/);
		assert.equal(store.list('u1').length, 1);

		const listed = await callTool('list_saved', {}, deps);
		assert.equal(listed.ok, true);
		assert.match(listed.spoken, /Puppe/);

		const played = await callTool('play_saved', { query: '1' }, deps);
		assert.equal(played.ok, true, played.spoken);
		assert.deepEqual(calls, [{ ref: 'https://youtu.be/x', requestedBy: 'Ali' }]);

		const removed = await callTool('remove_saved', { query: 'puppe' }, deps);
		assert.equal(removed.ok, true, removed.spoken);
		assert.equal(store.list('u1').length, 0);
	});

	it('saves by a name it looks up first, and says so when the queue will take nothing', async () => {
		const store = new SavedTracks(fileFor('tools2.json'));
		const { deps } = toolDeps(store);
		const saved = await callTool('save_track', { query: 'sezen aksu' }, deps);
		assert.equal(saved.ok, true);
		assert.match(saved.spoken, /T:sezen aksu/);

		const full = toolDeps(store, { queueFull: true });
		const played = await callTool('play_saved', { all: true }, full.deps);
		assert.equal(played.ok, false, 'a full queue is reported, not swallowed');
		assert.equal(full.calls.length, 0);
	});
});
