import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PassThrough } from 'node:stream';
import { MusicPlayer } from '../../src/music.js';
import { STEREO_SAMPLES_PER_FRAME_48K } from '../../src/audio.js';

// The track lookup runs through normalize() (src/text.js), which folds Turkish letters whatever the
// interface language is, so the Turkish query in the last test is deliberate input rather than a
// leftover: it has to find a file whose name was written without Turkish characters.

/** Fake ffmpeg/yt-dlp: a process that writes the given PCM to stdout. */
function fakeSpawn(pcmByTitle) {
	const spawned = [];
	return {
		spawned,
		spawn: (binary, args) => {
			const child = new EventEmitter();
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.stdin = new PassThrough();
			child.kill = () => {
				child.killed = true;
				child.stdout.end();
				setImmediate(() => child.emit('close', 0));
			};
			spawned.push({ binary, args, child });
			const isFfmpeg = args.includes('pipe:1');
			if (isFfmpeg) {
				const input = args[args.indexOf('-i') + 1];
				const pcm = pcmByTitle[input] ?? Buffer.alloc(0);
				setImmediate(() => {
					child.stdout.write(pcm);
					child.stdout.end();
					child.emit('close', 0);
				});
			} else if (args.includes('--version')) {
				setImmediate(() => child.emit('exit', 1));
			}
			return child;
		},
	};
}

/**
 * Waits until there is a whole frame in the player's buffer.
 * The fake ffmpeg writes its PCM on the next tick of the event loop, and a fixed sleep is a guess
 * about how quickly the machine gets round to it: on a loaded runner the guess is wrong and the test
 * fails for no reason at all. Waiting for the condition itself is the same test without the dice.
 */
async function waitForFrame(player, timeoutMs = 2000) {
	const deadline = Date.now() + timeoutMs;
	while (player.ring.length < STEREO_SAMPLES_PER_FRAME_48K) {
		if (Date.now() > deadline) throw new Error('the player never buffered a frame');
		await new Promise((r) => setTimeout(r, 2));
	}
}

const pcmSeconds = (seconds, value = 1234) => {
	const samples = new Int16Array(48_000 * 2 * seconds).fill(value);
	return Buffer.from(samples.buffer);
};

describe('MusicPlayer', () => {
	it('finds a local file, plays it and moves on to the next track when it runs out', async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), 'music-'));
		writeFileSync(path.join(dir, 'Nova Rae - Skyline.mp3'), 'x');
		writeFileSync(path.join(dir, 'Halcyon - Sunrise.mp3'), 'x');
		const fake = fakeSpawn({
			[path.join(dir, 'Nova Rae - Skyline.mp3')]: pcmSeconds(0.1, 100),
			[path.join(dir, 'Halcyon - Sunrise.mp3')]: pcmSeconds(1, 200),
		});
		const started = [];
		const player = new MusicPlayer({ musicDir: dir, spawnImpl: fake.spawn, onTrackStart: (t) => started.push(t.title), log: () => {} });

		const first = await player.enqueue('nova rae skyline');
		assert.equal(first.startedNow, true);
		assert.equal(first.track.kind, 'file');
		const second = await player.enqueue('sunrise');
		assert.equal(second.startedNow, false);
		assert.equal(second.position, 1);
		assert.equal(player.state().queue.length, 1);

		await waitForFrame(player);
		const dst = new Int16Array(STEREO_SAMPLES_PER_FRAME_48K);
		const n = player.readFrame(dst);
		assert.equal(n, STEREO_SAMPLES_PER_FRAME_48K);
		assert.equal(dst[0], 100, 'the samples of the first track');

		// 0.1 s = 5 frames; once it runs dry the second track (1 s) takes over
		for (let i = 0; i < 12; i++) {
			player.readFrame(dst);
			await new Promise((r) => setTimeout(r, 5));
		}
		assert.deepEqual(started, ['Nova Rae - Skyline', 'Halcyon - Sunrise']);
		assert.equal(player.current?.title, 'Halcyon - Sunrise');

		player.stop();
		assert.equal(player.active, false);
		assert.equal(player.readFrame(dst), 0);
	});

	// Seen live: the bot's profile kept saying "listening to Rammstein - Puppe" after the music was
	// stopped, because the only thing that ever took it back off was a track ENDING.
	it('reports the end of the music when it is stopped, not only when it runs out', async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), 'music-'));
		writeFileSync(path.join(dir, 'a.wav'), 'x');
		const fake = fakeSpawn({ [path.join(dir, 'a.wav')]: pcmSeconds(1) });
		const ends = [];
		const player = new MusicPlayer({
			musicDir: dir,
			spawnImpl: fake.spawn,
			log: () => {},
			onTrackEnd: (track, info) => ends.push({ title: track.title, ...info }),
		});
		await player.enqueue('a');
		await waitForFrame(player);
		player.stop();
		assert.deepEqual(ends, [{ title: 'a', queueEmpty: true, stopped: true }]);
	});

	// Seen live: the model answered "sure, changing it" by both skipping to a track AND queueing it, so
	// the song came back round on its own when it finished and the music appeared never to end.
	it('does not queue a second copy of what is already playing', async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), 'music-'));
		writeFileSync(path.join(dir, 'Puppe.mp3'), 'x');
		const fake = fakeSpawn({ [path.join(dir, 'Puppe.mp3')]: pcmSeconds(1) });
		const player = new MusicPlayer({ musicDir: dir, spawnImpl: fake.spawn, log: () => {} });
		const first = await player.enqueue('puppe');
		assert.equal(first.startedNow, true);
		const again = await player.enqueue('puppe');
		assert.equal(again.duplicate, true, 'the same track is not added twice');
		assert.equal(player.state().queue.length, 0, 'and the queue is left alone');
		player.stop();
	});

	it('pauses, resumes, clamps the volume and keeps the duck ratio relative to it', async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), 'music-'));
		writeFileSync(path.join(dir, 'a.wav'), 'x');
		const fake = fakeSpawn({ [path.join(dir, 'a.wav')]: pcmSeconds(1) });
		const player = new MusicPlayer({ musicDir: dir, spawnImpl: fake.spawn, volume: 0.5, duckVolume: 0.1, log: () => {} });
		await player.enqueue('a');
		await waitForFrame(player);
		const dst = new Int16Array(STEREO_SAMPLES_PER_FRAME_48K);
		assert.ok(player.readFrame(dst) > 0);
		player.pause();
		assert.equal(player.readFrame(dst), 0, 'a paused player hands out no frames');
		player.resume();
		assert.ok(player.readFrame(dst) > 0);
		assert.equal(player.duckRatio, 0.2);
		player.setVolume(0.2);
		assert.equal(player.duckRatio, 0.5);
		player.setVolume(5);
		assert.equal(player.volume, 1, 'the volume is clamped');
		player.stop();
	});

	it('skip: goes idle when there is nothing else in the queue', async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), 'music-'));
		writeFileSync(path.join(dir, 'a.wav'), 'x');
		const fake = fakeSpawn({ [path.join(dir, 'a.wav')]: pcmSeconds(1) });
		const player = new MusicPlayer({ musicDir: dir, spawnImpl: fake.spawn, log: () => {} });
		await player.enqueue('a');
		const skipped = player.skip();
		assert.equal(skipped.title, 'a');
		assert.equal(player.current, null);
		assert.equal(player.nowPlayingText(), 'Nothing is playing right now.');
	});

	it('refuses an empty query, and removes a queued track by title or by position', async () => {
		const player = new MusicPlayer({ spawnImpl: fakeSpawn({}).spawn, log: () => {} });
		await assert.rejects(() => player.enqueue('   '), /could not work out what to play/);
		player.queue.push({ id: 1, title: 'One', kind: 'url' }, { id: 2, title: 'Two', kind: 'url' });
		assert.equal(player.remove('two')?.title, 'Two');
		assert.equal(player.remove(1)?.title, 'One');
		assert.equal(player.remove(5), null);
	});

	it('normalises Turkish characters when matching a track', async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), 'music-'));
		writeFileSync(path.join(dir, 'Tarkan - Simarik.mp3'), 'x');
		const fake = fakeSpawn({ [path.join(dir, 'Tarkan - Simarik.mp3')]: pcmSeconds(0.1) });
		const player = new MusicPlayer({ musicDir: dir, spawnImpl: fake.spawn, log: () => {} });
		// Heard in Turkish, stored on disk without the Turkish letters.
		const first = await player.enqueue('tarkan şımarık');
		assert.equal(first.track.kind, 'file');
		assert.equal(first.track.title, 'Tarkan - Simarik');
		player.queue.push({ id: 9, title: 'İki', kind: 'url' });
		assert.equal(player.remove('iki')?.title, 'İki', 'the queue is searched through the same folding');
		player.stop();
	});
});
