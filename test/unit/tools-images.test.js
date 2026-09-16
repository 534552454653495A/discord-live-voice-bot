import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { describe, it } from 'node:test';
import { resetImageLimiter } from '../../src/tools/images.js';
import { callTool } from '../../src/tools/index.js';

function makeDeps({ mode = 'b64', fail = false } = {}) {
	const sent = [];
	const calls = [];
	const channel = {
		id: '10',
		name: 'chat',
		type: ChannelType.GuildText,
		send: async (payload) => {
			sent.push(payload);
			return { id: 'm1', attachments: { first: () => ({ url: 'https://cdn.discordapp.com/attachments/1/2/image.png' }) } };
		},
	};
	const guild = { channels: { cache: new Map([[channel.id, channel]]) } };
	const generate = async (args) => {
		calls.push(args);
		if (fail) throw new Error('no credit');
		if (mode === 'url') return { data: [{ url: 'https://example.test/image.png' }] };
		return { data: [{ b64_json: Buffer.from('PNGDATA').toString('base64') }] };
	};
	const deps = {
		guild,
		cfg: { textChannelId: null, imageModel: 'gpt-image-1', imageSize: '1024x1024' },
		openai: { images: { generate } },
		currentSpeakerId: () => 'u1',
		currentSpeakerName: () => 'Ali',
		personaName: () => 'Aria',
		activity: () => {},
		log: () => {},
	};
	return { deps, sent, calls };
}

describe('generate_image', () => {
	it('draws a picture, posts it as a file and hands back its Discord link', async () => {
		resetImageLimiter();
		const { deps, sent, calls } = makeDeps();
		const result = await callTool('generate_image', { prompt: 'a cat in a spacesuit', channel: 'chat' }, deps);
		assert.equal(result.ok, true, result.spoken);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].prompt, 'a cat in a spacesuit');
		assert.equal(sent.length, 1);
		assert.equal(sent[0].files.length, 1, 'the picture goes out as a file');
		assert.equal(sent[0].files[0].name, 'image.png');
		assert.deepEqual(sent[0].allowedMentions, { parse: [] }, 'a caption must not ping anybody');
		assert.match(result.data.url, /^https:\/\/cdn\.discordapp\.com\//, 'the link is the one set_bot_appearance takes');
	});

	it('downloads a picture that comes back as a link instead of bytes', async () => {
		resetImageLimiter();
		const { deps, sent } = makeDeps({ mode: 'url' });
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.from('PNGDATA') });
		try {
			const result = await callTool('generate_image', { prompt: 'x', channel: 'chat' }, deps);
			assert.equal(result.ok, true, result.spoken);
			assert.equal(sent.length, 1);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('answers instead of failing when there is no model, no prompt, or the drawing fails', async () => {
		const off = makeDeps();
		off.deps.openai = null;
		assert.equal((await callTool('generate_image', { prompt: 'x' }, off.deps)).ok, false);
		assert.equal((await callTool('generate_image', { prompt: '   ' }, makeDeps().deps)).ok, false);
		const failing = makeDeps({ fail: true });
		assert.equal((await callTool('generate_image', { prompt: 'x' }, failing.deps)).ok, false);
		assert.equal(failing.sent.length, 0, 'nothing is posted when the drawing failed');
	});

	it('holds one person to a few pictures a minute', async () => {
		resetImageLimiter();
		const { deps, sent } = makeDeps();
		for (let i = 0; i < 3; i++) {
			assert.equal((await callTool('generate_image', { prompt: `x${i}`, channel: 'chat' }, deps)).ok, true);
		}
		const fourth = await callTool('generate_image', { prompt: 'x4', channel: 'chat' }, deps);
		assert.equal(fourth.ok, false, 'the fourth inside the same minute is refused');
		assert.equal(sent.length, 3, 'and nothing else was posted');
	});
});
