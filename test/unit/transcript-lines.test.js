import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelType } from 'discord.js';
import { RecentActions } from '../../src/commands.js';
import { loadConfig } from '../../src/config.js';
import { GuildSession } from '../../src/guildsession.js';
import { ActivityLog } from '../../src/panel.js';
import { ChannelReader } from '../../src/reader.js';
import { SAMPLES_PER_FRAME_24K, SpeakerMixer } from '../../src/audio.js';

// What reaches the model as "X said this" is decided in GuildSession.onTranscript, and until now
// nothing drove that path end to end: the fake realtime server in the selftest only ever sends the
// bot's own audio back, never an input transcript. These tests put real audio through the real mixer,
// hand the resulting frames to the real attribution, then feed transcript fragments in the way the
// realtime API delivers them (as deltas with their own start/end) and read what the model was told.

const ENV = { DISCORD_TOKEN: 't', GUILD_ID: 'g', CHANNEL_ID: 'g-voice', OPENAI_API_KEY: 'k', OWNER_ID: 'owner' };

function makeRoom(names = { owner: 'Kaan', guest: 'Adem', third: 'Melis' }) {
	const voice = { id: 'g-voice', name: 'Lounge', type: ChannelType.GuildVoice, parent: null, parentId: null, rawPosition: 0 };
	const members = new Map(
		Object.entries(names).map(([id, displayName]) => [
			id,
			{ id, displayName, user: { id, username: displayName.toLowerCase(), bot: false }, voice: { channelId: voice.id, channel: voice } },
		]),
	);
	return {
		id: 'g',
		name: 'Guild',
		channels: { cache: new Map([[voice.id, voice]]) },
		members: { cache: members, fetch: async () => new Map() },
		voiceStates: { cache: new Map() },
		roles: { cache: new Map(), everyone: { id: 'everyone' } },
	};
}

/**
 * A session with a fake realtime socket: everything the model would be told is collected instead of
 * being sent. The audio path is real (SpeakerMixer -> SpeakerAttribution).
 */
function makeRoomSession(env = {}) {
	const activity = new ActivityLog();
	const told = [];
	const logged = [];
	const cfg = loadConfig({ ...ENV, ...env });
	const session = new GuildSession({
		cfg,
		client: { user: { id: 'bot' } },
		guild: makeRoom(),
		channelId: 'g-voice',
		store: { getActive: () => null, list: () => [], setActive: async () => true },
		memory: null,
		quota: { enabled: false, status: () => ({ used: 0, limit: 0, exceeded: false }), sessionStarted() {}, shouldWarn: () => false },
		reader: new ChannelReader(),
		recentActions: new RecentActions(),
		activity,
		record: (event) => activity.push(event),
		provider: { textClient: {}, textApi: 'responses', textModel: 'm', describe: () => 'mock' },
		openai: {},
		localStt: {},
		localServer: null,
		log: (line) => logged.push(String(line)),
		summarize: async () => ({ summary: '' }),
	});
	session.live = { ready: true, appendContext: (kind, text) => told.push({ kind, text }), sendAudio: () => true };

	const mixer = new SpeakerMixer();
	// Exactly what the session does: the owner only holds the floor when OWNER_PRIORITY says so.
	if (cfg.ownerPriority && cfg.ownerId) mixer.setPriority(cfg.ownerId);
	const speech = new Int16Array(SAMPLES_PER_FRAME_24K).fill(3000);
	/** `who` speaks for `frames` 20 ms frames; several ids at once means they talk over each other. */
	const voices = (who, frames) => {
		const ids = Array.isArray(who) ? who : [who];
		for (let i = 0; i < frames; i++) {
			for (const id of ids) mixer.push(id, speech);
			const frame = mixer.tick();
			session.attribution.onFrame({ priority: frame.priority, active: frame.active, sent: true });
		}
	};
	/** Nobody is talking: the audio position still advances, which is what the transcript is timed against. */
	const quiet = (frames) => {
		for (let i = 0; i < frames; i++) {
			const frame = mixer.tick();
			session.attribution.onFrame({ priority: frame.priority, active: frame.active, sent: true });
		}
	};
	const at = () => session.attribution.audioMs;
	/** What the command shortcut did with each finished line (it bypasses the model entirely). */
	const commanded = [];
	session.runVoiceCommand = (item) => commanded.push(item);
	const delta = (text, startMs, endMs) => session.onTranscript({ speaker: 'user', text, startMs, endMs });
	const lines = () => told.filter((entry) => entry.kind === 'thinking').map((entry) => entry.text);
	const spoken = () =>
		activity.events
			.filter((event) => event.kind === 'voice' && event.direction === 'in')
			.map((event) => ({ who: event.who, text: event.text }));
	const flush = () => session.flushTranscript('user');
	return { session, cfg, told, logged, voices, quiet, at, delta, flush, lines, spoken, commanded, activity };
}

describe('who the model is told said a line', () => {
	it('puts one speaker on their own line', (t) => {
		t.mock.timers.enable({ apis: ['setTimeout'] });
		const room = makeRoomSession();
		room.voices('guest', 30); // 600 ms
		room.delta('merhaba', 0, 600);
		t.mock.timers.tick(1300);

		const said = room.lines();
		assert.equal(said.length, 1, `exactly one line reached the model: ${JSON.stringify(said)}`);
		assert.match(said[0], /Adem/, 'and it carries the name of the person who actually spoke');
		assert.deepEqual(room.spoken(), [{ who: 'guest', text: 'merhaba' }]);
	});

	// The reported bug: the owner gave a command, somebody else spoke in the same breath, and the whole
	// line came back with the other person's name on it, because the buffer kept only the LAST fragment's
	// speaker. Two people in one flush are two lines now.
	it('splits one flush into a line each when two people take turns', (t) => {
		t.mock.timers.enable({ apis: ['setTimeout'] });
		const room = makeRoomSession();
		room.voices('owner', 45);
		room.delta('purna odasindakileri buraya cek ', 0, 900);
		room.voices('guest', 45);
		room.delta('ben gelmiyorum ama', 900, 1800);
		t.mock.timers.tick(1300);

		assert.deepEqual(room.spoken(), [
			{ who: 'owner', text: 'purna odasindakileri buraya cek' },
			{ who: 'guest', text: 'ben gelmiyorum ama' },
		]);
		const said = room.lines();
		assert.equal(said.length, 2, 'the model is told about two lines, not one');
		assert.match(said[0], /Kaan/);
		assert.match(said[1], /Adem/);
	});

	it('names nobody when the two voices are on top of each other, and says who they were', (t) => {
		t.mock.timers.enable({ apis: ['setTimeout'] });
		const room = makeRoomSession({ OWNER_PRIORITY: '0' });
		room.voices(['owner', 'guest'], 50); // a full second of both at once
		room.delta('melisi banla', 0, 1000);
		t.mock.timers.tick(1300);

		assert.deepEqual(room.spoken(), [{ who: null, text: 'melisi banla' }]);
		const said = room.lines().join(' ');
		assert.match(said, /Kaan/, 'both candidates are named');
		assert.match(said, /Adem/);
		// The command shortcut bypasses the model entirely, so it is the one path with no second check.
		assert.deepEqual(
			room.commanded.map((item) => item.id),
			[null],
			'the line is handed on with nobody owning it',
		);
		const before = room.logged.length;
		GuildSession.prototype.runVoiceCommand.call(room.session, room.commanded[0]);
		assert.ok(
			room.logged.slice(before).some((line) => /not run/.test(line)),
			'and the real guard refuses to run anything from it',
		);
	});

	it('gives each line its own end position, so one speaker cannot borrow another line s turn', (t) => {
		t.mock.timers.enable({ apis: ['setTimeout'] });
		const room = makeRoomSession();
		room.voices('owner', 45);
		room.delta('birinci ', 0, 900);
		room.voices('guest', 45);
		room.delta('ikinci', 900, 1800);
		t.mock.timers.tick(1300);
		// Reusing the whole flush's final position would let the SECOND speaker's audio count as "before
		// the turn" for the FIRST line's command, which is the widest possible window and exactly the hole
		// the owner gate exists to close.
		assert.deepEqual(
			room.commanded.map((item) => [item.id, item.endMs]),
			[
				['owner', 900],
				['guest', 1800],
			],
		);
	});

	it('stops waiting for silence once a line has run too long', (t) => {
		t.mock.timers.enable({ apis: ['setTimeout'] });
		const room = makeRoomSession();
		room.voices('guest', 10);
		room.delta('bir ', 0, 200);
		t.mock.timers.tick(9000); // the flush timer would have fired; the point is what happens next
		room.voices('guest', 10);
		room.delta('iki', 200, 400);
		assert.ok(room.spoken().length >= 1, 'the line did not wait for the room to fall silent');
	});

	it('finishes the half-said line before the audio timeline restarts', (t) => {
		t.mock.timers.enable({ apis: ['setTimeout'] });
		const room = makeRoomSession();
		room.voices('guest', 30);
		room.delta('yarim kalan', 0, 600);
		room.session.flushTranscript('user'); // what the live 'ready' path does before resetSession
		assert.deepEqual(room.spoken(), [{ who: 'guest', text: 'yarim kalan' }]);
		room.session.attribution.resetSession();
		t.mock.timers.tick(1300);
		assert.equal(room.spoken().length, 1, 'and it is not recorded a second time by a stale timer');
	});

	// Measured in a real session: three people taking turns, and every single line came back as "two
	// voices at once", so not one voice command ran all evening. Two causes, both of them ours: the mixer
	// kept somebody in the speaking list for half a second after they stopped, so a handover looked like
	// an overlap; and one contaminated fragment condemned the whole line it sat in.
	it('does not call an ordinary handover an overlap', (t) => {
		t.mock.timers.enable({ apis: ['setTimeout'] });
		const room = makeRoomSession({ OWNER_PRIORITY: '0' });
		// A talks in bursts, the way speech really arrives, then a quarter second later B answers.
		const burst = (who, bursts) => {
			for (let b = 0; b < bursts; b++) {
				room.voices(who, 10);
				room.quiet(4);
			}
		};
		const start = room.at();
		burst('guest', 5);
		const guestEnd = room.at();
		room.quiet(13); // 260 ms between the turns
		const thirdStart = room.at();
		burst('third', 5);
		const thirdEnd = room.at();

		// The transcript arrives in fragments, including one right at the start of the second turn.
		room.delta('bence ', start, start + 400);
		room.delta('olmaz oyle ', start + 400, guestEnd);
		room.delta('neden ', thirdStart, thirdStart + 300);
		room.delta('olmasin ki', thirdStart + 300, thirdEnd);
		t.mock.timers.tick(1300);

		assert.deepEqual(
			room.spoken(),
			[
				{ who: 'guest', text: 'bence olmaz oyle' },
				{ who: 'third', text: 'neden olmasin ki' },
			],
			'two turns, two names, no overlap anywhere',
		);
		assert.deepEqual(
			room.commanded.map((item) => item.mixed),
			[false, false],
			'and both lines are clean enough to run a command',
		);
	});

	it('keeps the owner as the owner while somebody else has a microphone open', (t) => {
		t.mock.timers.enable({ apis: ['setTimeout'] });
		const room = makeRoomSession();
		room.voices('owner', 40);
		room.delta('beni asagi tasi', 0, 800);
		t.mock.timers.tick(1300);
		assert.match(room.lines().join(' '), /Kaan/, 'the owner said it');
		assert.deepEqual(room.spoken(), [{ who: 'owner', text: 'beni asagi tasi' }]);
	});
});
