import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toolCallFor } from '../../src/agent.js';
import { isPrivileged } from '../../src/auth.js';
import { setLocale } from '../../src/i18n/index.js';

// src/commands.js compiles the grammar of the ACTIVE locale into RegExp constants at import time,
// so calling setLocale() from inside a test no longer changes the parser. The module is therefore
// evaluated once per language: the query string only makes the specifier unique, so Node hands back
// a second, independently evaluated instance instead of the cached one. Both instances share
// src/i18n, which is why the locale is selected right before each import.
setLocale('tr');
const turkish = await import('../../src/commands.js?locale=tr');
setLocale('en');
const english = await import('../../src/commands.js?locale=en');

const { actionSignature, extractMusic, parseVoiceCommand } = english;

const channels = {
	text: [
		{ id: 't1', name: 'general' },
		{ id: 't2', name: 'general-chat' },
		{ id: 't3', name: 'reading' },
	],
	voice: [{ id: 'v1', name: 'General' }, { id: 'v2', name: 'lounge' }],
};

// Turkish fixtures: the channel names and the spoken lines below are deliberately Turkish, because
// they feed the Turkish grammar.
const trChannels = {
	text: [
		{ id: 't1', name: 'genel' },
		{ id: 't2', name: 'genel-sohbet' },
		{ id: 't3', name: 'okul' },
	],
	voice: [{ id: 'v1', name: 'Genel' }, { id: 'v2', name: 'gece kuşları' }],
};

describe('parseVoiceCommand (en): false positives', () => {
	it('does not take the "say" inside "essay" or the "type" inside "prototype" for a verb', () => {
		assert.equal(parseVoiceCommand('that essay in the general channel', [], channels), null);
		assert.equal(parseVoiceCommand('the prototype in the general channel', [], channels), null);
		assert.equal(parseVoiceCommand('what time is it in the general channel', [], channels), null);
	});
	it('treats "reading" as an ordinary word, not as a request to read a channel', () => {
		assert.equal(parseVoiceCommand('the reading room is quiet', [], channels), null);
		assert.equal(parseVoiceCommand('read the general channel', [], channels)?.type, 'read');
		assert.equal(parseVoiceCommand("what's new in the general channel", [], channels)?.type, 'read');
		assert.equal(parseVoiceCommand('what was said in the general channel', [], channels)?.type, 'read');
	});
	it('needs a whole join verb, so "welcome" does not count as "come"', () => {
		assert.equal(parseVoiceCommand('welcome everyone to the voice channel', [], channels), null);
		assert.equal(parseVoiceCommand('join the lounge channel', [], channels)?.type, 'join');
		assert.equal(parseVoiceCommand('come to the general room', [], channels)?.type, 'join');
	});
});

describe('parseVoiceCommand (en): channel commands', () => {
	it('matches a hyphenated channel name in the raw text and prefers the longer name', () => {
		const command = parseVoiceCommand('write hello in the general-chat channel', [], channels);
		assert.equal(command?.type, 'send');
		assert.equal(command?.channel?.id, 't2');
		assert.equal(command?.text, 'hello');
	});
	it('keeps filler words out of a spoken channel name', () => {
		const command = parseVoiceCommand('write hello in our announcements channel', [], channels);
		assert.equal(command?.type, 'send');
		assert.equal(command?.name, 'announcements');
		assert.equal(command?.text, 'hello');
	});
	it('joins a named voice channel and leaves on a bare "leave"', () => {
		const join = parseVoiceCommand('join the lounge channel', [], channels);
		assert.equal(join?.type, 'join');
		assert.equal(join?.channel?.id, 'v2');
		assert.deepEqual(parseVoiceCommand('leave the channel', [], channels), { type: 'leave' });
		assert.deepEqual(parseVoiceCommand('leave', [], channels), { type: 'leave' });
	});
});

describe('parseVoiceCommand (tr): false positives', () => {
	it('does not take the "at" inside "saat" or the "yaz" inside "beyaz" for a verb', () => {
		assert.equal(turkish.parseVoiceCommand('genel kanalında saat kaç', [], trChannels), null);
		assert.equal(turkish.parseVoiceCommand('beyaz kanalı falan', [], trChannels), null);
	});
	it('treats "okul" as an ordinary word, not as a request to read a channel', () => {
		assert.equal(turkish.parseVoiceCommand('okul kanalında ne var', [], trChannels), null);
		assert.equal(turkish.parseVoiceCommand('genel kanalını oku', [], trChannels)?.type, 'read');
		assert.equal(turkish.parseVoiceCommand('genel kanalında ne yazıyor', [], trChannels)?.type, 'read');
	});
	it('needs a whole join verb, so "gece" does not count while "gelsene" and "geçer misin" do', () => {
		assert.equal(turkish.parseVoiceCommand('bu gece ses kanalında kimler var', [], trChannels), null);
		assert.equal(turkish.parseVoiceCommand('genel kanalına gelsene', [], trChannels)?.type, 'join');
		assert.equal(turkish.parseVoiceCommand('genel odasına geçer misin', [], trChannels)?.type, 'join');
	});
});

describe('parseVoiceCommand (tr): channel commands', () => {
	it('matches a hyphenated channel name in the raw text and prefers the longer name', () => {
		const command = turkish.parseVoiceCommand('genel-sohbet kanalına selam yaz', [], trChannels);
		assert.equal(command?.type, 'send');
		assert.equal(command?.channel?.id, 't2');
		assert.equal(command?.text, 'selam');
	});
	it('keeps filler words out of a spoken channel name', () => {
		const command = turkish.parseVoiceCommand('lütfen duyurular kanalına toplantı var yaz', [], trChannels);
		assert.equal(command?.type, 'send');
		assert.equal(command?.name, 'duyurular');
		assert.equal(command?.text, 'toplantı var');
	});
	it('reads "kanaldan ayrıl" as leaving, not as a music command', () => {
		assert.deepEqual(turkish.parseVoiceCommand('kanaldan ayrıl', [], trChannels), { type: 'leave' });
	});
});

describe('music voice commands (en)', () => {
	it('recognises the play phrasings and rejects a query that means "anything"', () => {
		assert.deepEqual(parseVoiceCommand('play Daft Punk Around the World', [], channels), {
			type: 'music',
			action: 'play',
			query: 'Daft Punk Around the World',
		});
		assert.deepEqual(extractMusic('queue up some jazz'), { type: 'music', action: 'play', query: 'some jazz' });
		assert.deepEqual(extractMusic('put on some jazz'), { type: 'music', action: 'play', query: 'some jazz' });
		assert.equal(extractMusic('play something'), null, 'a query that names nothing is rejected');
	});
	it('recognises the playback controls', () => {
		assert.equal(extractMusic('stop the music')?.action, 'stop');
		assert.equal(extractMusic('pause the song')?.action, 'pause');
		assert.equal(extractMusic('resume the music')?.action, 'resume');
		assert.equal(extractMusic('skip the song')?.action, 'skip');
		assert.equal(extractMusic('next song')?.action, 'skip');
		assert.equal(extractMusic("what's playing")?.action, 'status');
		assert.deepEqual(extractMusic('set the music volume to 20 percent'), { type: 'music', action: 'volume', percent: 20 });
		assert.deepEqual(extractMusic('turn the music down'), { type: 'music', action: 'volume', delta: -15 });
		assert.deepEqual(extractMusic('turn the music up'), { type: 'music', action: 'volume', delta: 15 });
	});
});

describe('music voice commands (tr)', () => {
	it('recognises the play phrasings and rejects a query that means "anything"', () => {
		assert.deepEqual(turkish.parseVoiceCommand('Tarkan şımarık şarkısını çal', [], trChannels), {
			type: 'music',
			action: 'play',
			query: 'Tarkan şımarık',
		});
		assert.deepEqual(turkish.extractMusic('müzik aç: sezen aksu gülümse'), { type: 'music', action: 'play', query: 'sezen aksu gülümse' });
		assert.deepEqual(turkish.extractMusic('bana sezen aksu gülümse çalsana'), { type: 'music', action: 'play', query: 'sezen aksu gülümse' });
		assert.equal(turkish.extractMusic('bir şey çal'), null, 'a query that names nothing is rejected');
	});
	it('recognises the playback controls', () => {
		assert.equal(turkish.extractMusic('müziği durdur')?.action, 'stop');
		assert.equal(turkish.extractMusic('şarkıyı duraklat')?.action, 'pause');
		assert.equal(turkish.extractMusic('müziğe devam et')?.action, 'resume');
		assert.equal(turkish.extractMusic('şarkıyı atla')?.action, 'skip');
		assert.equal(turkish.extractMusic('sonraki şarkıya geç')?.action, 'skip');
		assert.equal(turkish.extractMusic('ne çalıyor')?.action, 'status');
		assert.deepEqual(turkish.extractMusic('müziğin sesini yüzde 20 yap'), { type: 'music', action: 'volume', percent: 20 });
		assert.deepEqual(turkish.extractMusic('müziği biraz kıs'), { type: 'music', action: 'volume', delta: -15 });
		assert.deepEqual(turkish.extractMusic('müziği aç'), { type: 'music', action: 'volume', delta: 15 });
	});
});

describe('actionSignature', () => {
	it('deduplicates a play request over 30 s and a skip only within a 5 s window', () => {
		const play = { type: 'music', action: 'play', query: 'Daft Punk' };
		assert.equal(actionSignature(play, 0), actionSignature(play, 20_000));
		const skip = { type: 'music', action: 'skip' };
		assert.notEqual(actionSignature(skip, 0), actionSignature(skip, 6_000));
	});
});

describe('toolCallFor', () => {
	it('turns a voice command into the matching tool call', () => {
		const deps = { music: { volume: 0.5 }, cfg: { readLimit: 5 } };
		assert.deepEqual(toolCallFor({ type: 'music', action: 'play', query: 'x' }, deps), { name: 'play_music', args: { query: 'x' } });
		assert.deepEqual(toolCallFor({ type: 'music', action: 'volume', percent: 20 }, deps), { name: 'set_music_volume', args: { percent: 20 } });
		assert.deepEqual(toolCallFor({ type: 'join', channel: { id: 'v1', name: 'General' } }, deps), { name: 'join_voice', args: { channel: 'General' } });
		assert.deepEqual(toolCallFor({ type: 'read', channel: { id: 't1', name: 'general' } }, deps), {
			name: 'read_messages',
			args: { channel: 'general', count: 5 },
		});
		assert.deepEqual(toolCallFor({ type: 'quiet', value: 'on' }, deps), { name: 'set_setting', args: { name: 'quiet', value: 'on' } });
	});
});

describe('auth.isPrivileged', () => {
	it('accepts the owner, an admin user, an admin role and the ManageGuild permission', () => {
		const cfg = { ownerId: 'o', adminUserIds: ['a'], adminRoleIds: ['r'] };
		assert.equal(isPrivileged({ userId: 'o', cfg }), true);
		assert.equal(isPrivileged({ userId: 'a', cfg }), true);
		assert.equal(isPrivileged({ userId: 'x', member: { roles: { cache: new Map([['r', {}]]) } }, cfg }), true);
		assert.equal(isPrivileged({ userId: 'x', member: { permissions: { has: () => true } }, cfg }), true);
		assert.equal(isPrivileged({ userId: 'x', member: { permissions: { has: () => false } }, cfg }), false);
		assert.equal(isPrivileged({ userId: null, cfg }), false);
	});
});

describe('parseVoiceCommand: quiet', () => {
	it('hears what asks for silence (tr)', () => {
		for (const line of ['melis sus', 'sus', 'sussana', 'susun', 'sessiz ol', 'kes sesini', 'sesini kes', 'kapa çeneni']) {
			assert.deepEqual(turkish.parseVoiceCommand(line, [], trChannels), { type: 'quiet', value: 'on' }, line);
		}
	});
	it('does not take a word that merely contains "sus" for the command (tr)', () => {
		for (const line of ['susma', 'susmuyorum', 'susam', 'çok susadım', 'okuma odası sessiz']) {
			assert.equal(turkish.parseVoiceCommand(line, [], trChannels), null, line);
		}
	});
	// The suffix matters: "konuşabilir" takes -sin/-siniz, and a pattern that demanded the longer one
	// would silently lose the plainest way to ask for the voice back.
	it('hears the way back with the suffix the word actually takes (tr)', () => {
		for (const line of ['konuşabilirsin', 'konuşabilirsiniz', 'konuşabilir', 'devam edebilirsin']) {
			assert.deepEqual(turkish.parseVoiceCommand(line, [], trChannels), { type: 'quiet', value: 'off' }, line);
		}
	});
	it('hears the English phrasings, and leaves a statement alone (en)', () => {
		for (const line of ['be quiet', 'quiet down', 'shut up', 'hush']) {
			assert.deepEqual(parseVoiceCommand(line, [], channels), { type: 'quiet', value: 'on' }, line);
		}
		assert.equal(parseVoiceCommand('the reading room is quiet', [], channels), null);
		for (const line of ['you can speak again', 'speak again', 'you can talk']) {
			assert.deepEqual(parseVoiceCommand(line, [], channels), { type: 'quiet', value: 'off' }, line);
		}
	});
});

describe('parseVoiceCommand: the ways the owner asks for the voice back (tr)', () => {
	// Live failure: "melis konus", "konusmaya devam et", "konusma yasagini kaldir" and "quiet ayarini
	// kapat" were said one after another to a bot the owner had told to be quiet, and none of them was
	// a phrase the grammar knew -- so the deterministic route never fired and the bot stayed mute.
	it('hears them all', () => {
		const melis = [{ name: 'Melis' }];
		for (const line of [
			'melis konuş',
			'melis konuşun',
			'konuşmaya devam et',
			'melis artık konuşmaya devam edebilirsin',
			'melis artık konuşabilirs',
			'konuşma yasağını kaldır',
			'sessizliği kaldır',
			'quiet ayarını kapat',
			'quiet kapat',
			'sessiz modu kapat',
			'quiet off',
			'sesini aç',
			'susmayı bırak',
		]) {
			assert.deepEqual(turkish.parseVoiceCommand(line, melis, trChannels), { type: 'quiet', value: 'off' }, line);
		}
	});
	// Heard live: the owner said "artık konuşma" (do not talk any more), the transcript delivered "Artık
	// konuş", and the bot, told to be quiet six seconds earlier, spoke again. Giving the voice back is the
	// direction the owner minds, so the bare word needs the bot's name next to it.
	it('does not give the voice back on a bare "konuş" without the bot s name', () => {
		for (const line of ['konuş', 'konuşun', 'artık konuş']) {
			assert.equal(turkish.parseVoiceCommand(line, [{ name: 'Melis' }], trChannels), null, line);
		}
		assert.deepEqual(turkish.parseVoiceCommand('bot konuş', [], trChannels), { type: 'quiet', value: 'off' }, 'a generic name counts');
		assert.deepEqual(turkish.parseVoiceCommand('konuşabilirsin', [], trChannels), { type: 'quiet', value: 'off' }, 'the longer forms need no name');
	});
	it('and the ways to switch it on by its name', () => {
		for (const line of ['quiet ayarını aç', 'quiet aç', 'sessiz moda geç', 'sessiz modu aç', 'quiet on']) {
			assert.deepEqual(turkish.parseVoiceCommand(line, [], trChannels), { type: 'quiet', value: 'on' }, line);
		}
	});
	it('leaves alone what merely contains the word', () => {
		for (const line of ['konuşma', 'konuşuyor musun', 'devam et', 'okuma odası sessiz']) {
			assert.notEqual(turkish.parseVoiceCommand(line, [], trChannels)?.type, 'quiet', line);
		}
	});
});
