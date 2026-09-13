import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActivityType } from 'discord.js';
import { callTool } from '../../src/tools.js';

function makeDeps({ owner = true } = {}) {
	const calls = [];
	const me = {
		id: 'bot',
		displayName: 'Aria',
		nickname: null,
		setNickname: async (value) => {
			me.nickname = value;
			calls.push({ nickname: value });
		},
	};
	const client = {
		user: {
			id: 'bot',
			username: 'Aria',
			avatar: 'abc',
			banner: null,
			setAvatar: async (value) => calls.push({ avatar: value }),
			setBanner: async (value) => calls.push({ banner: value }),
			setPresence: (value) => calls.push({ presence: value }),
		},
		application: { edit: async (patch) => calls.push({ about: patch.description }) },
	};
	let presence = null;
	const deps = {
		guild: { id: 'g1', members: { me }, client },
		client,
		cfg: {},
		log: () => {},
		activity: () => {},
		setDefaultPresence: (value) => (presence = value),
		defaultPresence: () => presence,
	};
	if (owner) {
		deps.isOwnerActive = () => true;
		deps.ownerSaidRecently = () => true;
		deps.ownerMatch = (words) => words[0];
		deps.ownerTextTail = () => 'avatar';
	}
	return { deps, calls, me, client };
}

describe('the bot changing its own face', () => {
	it('sets and clears its nickname on this server', async () => {
		const { deps, me } = makeDeps();
		const set = await callTool('set_bot_nickname', { nickname: 'Pisi' }, deps);
		assert.equal(set.ok, true, set.spoken);
		assert.equal(me.nickname, 'Pisi');
		const cleared = await callTool('set_bot_nickname', {}, deps);
		assert.equal(cleared.ok, true, cleared.spoken);
		assert.equal(me.nickname, null);
	});

	it('takes a picture only from a Discord link', async () => {
		const { deps, calls } = makeDeps();
		const refused = await callTool('set_bot_appearance', { avatar_url: 'https://evil.example/cat.png' }, deps);
		assert.equal(refused.ok, false);
		assert.ok(!calls.some((entry) => 'avatar' in entry), 'nothing is fetched from another host');
		const accepted = await callTool('set_bot_appearance', { avatar_url: 'https://cdn.discordapp.com/x/cat.png' }, deps);
		assert.equal(accepted.ok, true, accepted.spoken);
		assert.equal(calls.find((entry) => 'avatar' in entry)?.avatar, 'https://cdn.discordapp.com/x/cat.png');
	});

	it('writes the about text through the application', async () => {
		const { deps, calls } = makeDeps();
		const result = await callTool('set_bot_appearance', { about: 'I live in a voice channel.' }, deps);
		assert.equal(result.ok, true, result.spoken);
		assert.equal(calls.find((entry) => 'about' in entry)?.about, 'I live in a voice channel.');
	});

	it('sets the status line, remembers it, and refuses a state it does not know', async () => {
		const { deps, calls } = makeDeps();
		const bad = await callTool('set_bot_status', { text: 'x', status: 'purple' }, deps);
		assert.equal(bad.ok, false, 'an unknown online state is refused rather than guessed');

		const result = await callTool('set_bot_status', { text: 'with the cat', activity_type: 'playing', status: 'idle' }, deps);
		assert.equal(result.ok, true, result.spoken);
		const presence = calls.find((entry) => 'presence' in entry)?.presence;
		assert.deepEqual(presence.activities, [{ name: 'with the cat', type: ActivityType.Playing }]);
		assert.equal(presence.status, 'idle');
		assert.equal(deps.defaultPresence().text, 'with the cat', 'kept so the music can hand it back');
	});

	it('reports the profile, and every changing tool needs the owner', async () => {
		const { deps } = makeDeps();
		const profile = await callTool('bot_profile', {}, deps);
		assert.equal(profile.ok, true, profile.spoken);
		assert.equal(profile.data.username, 'Aria');

		const outsider = makeDeps({ owner: false });
		for (const tool of ['set_bot_nickname', 'set_bot_appearance', 'set_bot_status']) {
			const denied = await callTool(tool, { nickname: 'x', text: 'x', about: 'x' }, outsider.deps);
			assert.equal(denied.denied, true, `${tool} must need the owner`);
		}
	});
});
