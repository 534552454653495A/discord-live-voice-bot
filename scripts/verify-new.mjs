// One-off verification: image moderation + image vision (against the real API) and the read-only
// management tools working with real Discord objects.
import { ChannelType } from 'discord.js';
import { Client, GatewayIntentBits } from 'discord.js';
import { OpenAI } from 'openai';
import { containsBlockedImage, fetchImageAsDataUrl, imageAttachments } from '../src/messages.js';
import { loadConfig } from '../src/config.js';
import { MemberIndex } from '../src/matcher.js';
import { callTool } from '../src/tools.js';

const cfg = loadConfig();
const openai = new OpenAI({ apiKey: cfg.openaiApiKey, ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}) });

// 0) Our own download path: remote image -> base64 data URL
const dataUrl = await fetchImageAsDataUrl('https://picsum.photos/id/237/300/200.jpg');
console.log('download: data URL produced =', dataUrl.startsWith('data:image/'), `(${dataUrl.length} characters)`);

// 1) Does moderation accept a data URL? (a clean image must not be blocked)
const blocked = await containsBlockedImage(openai, [{ dataUrl }], (line) => console.log(line));
console.log('moderation (data URL): blocked =', blocked, '(expected: false)');

// 2) Vision: does the Responses API understand the image behind a data URL?
const reply = await openai.responses.create(
	{
		model: cfg.textModel,
		instructions: 'Say briefly what you see (a single sentence).',
		input: [
			{
				role: 'user',
				content: [
					{ type: 'input_text', text: 'What is in this image?' },
					{ type: 'input_image', image_url: dataUrl },
				],
			},
		],
	},
	{ timeout: 45_000 },
);
console.log('image description (data URL):', JSON.stringify(String(reply.output_text ?? '').slice(0, 160)));

// 3) Notification attachment parsing
const fake = { attachments: new Map([['a', { contentType: 'image/png', url: 'https://cdn/x.png', size: 123 }]]) };
console.log('attachment parsing:', JSON.stringify(imageAttachments(fake).map((i) => i.url)));

// 4) Read-only tools against the real server
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
await client.login(cfg.discordToken);
await new Promise((resolve) => client.once('clientReady', resolve));
const guild = await client.guilds.fetch(cfg.guildId);
await guild.channels.fetch();

const index = new MemberIndex();
await index.load({ token: cfg.discordToken, guildId: cfg.guildId });
const deps = {
	guild,
	cfg: { ...cfg, textChannelId: null },
	log: (line) => console.log('  [log]', line),
	memberIndex: index,
	isOwnerActive: () => true,
	ownerSaidRecently: () => true,
	ownerMatch: (words) => words[0],
	cls: ChannelType,
};

const info = await callTool('server_info', {}, deps);
console.log('server_info:', info.ok, '|', info.spoken);

const userInfo = await callTool('user_info', { member: process.argv[2] ?? 'Ali' }, deps);
console.log('user_info:', userInfo.ok, '|', userInfo.spoken);

const channels = await callTool('list_channels', {}, deps);
console.log('list_channels: first 120 characters ->', String(channels.spoken).slice(0, 120));

const audit = await callTool('audit_log', { limit: 3 }, deps);
console.log('audit_log:', audit.ok, '|', audit.spoken);

await client.destroy();
