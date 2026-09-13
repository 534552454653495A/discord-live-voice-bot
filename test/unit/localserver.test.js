import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PassThrough } from 'node:stream';
import { LocalServerManager, detectVenvPython } from '../../src/localserver.js';

function fakeSpawn() {
	const calls = [];
	return {
		calls,
		spawn: (bin, args, opts) => {
			const child = new EventEmitter();
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = () => {
				child.killed = true;
				setImmediate(() => child.emit('exit', null, 'SIGTERM'));
			};
			calls.push({ bin, args, opts, child });
			return child;
		},
	};
}

describe('LocalServerManager', () => {
	it('starts the server once, filters the noisy output, counts the exits and gives up at the limit', async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), 'srv-'));
		const python = path.join(dir, 'python.exe');
		const script = path.join(dir, 'server.py');
		writeFileSync(python, '');
		writeFileSync(script, '');
		const logs = [];
		const fake = fakeSpawn();
		const manager = new LocalServerManager({ python, script, args: ['--stt', 'small'], log: (m) => logs.push(m), spawnImpl: fake.spawn, maxRestarts: 2 });
		assert.equal(manager.status, 'off');
		assert.equal(manager.ensureRunning(), true);
		assert.equal(manager.ensureRunning(), true, 'a second call must not spawn another process');
		assert.equal(fake.calls.length, 1);
		assert.deepEqual(fake.calls[0].args.slice(-2), ['--stt', 'small']);
		assert.equal(fake.calls[0].opts.env.PYTHONUTF8, '1');

		const { child } = fake.calls[0];
		child.stdout.write('[chatterbox] ready — sr=24000\n');
		child.stdout.write('Sampling:  8%|▊ | 76/1000 [00:12<02:31,  6.08it/s]\n');
		child.stderr.write('Traceback: error\n');
		await new Promise((r) => setImmediate(r));
		assert.ok(logs.some((m) => m === '[chatterbox] ready — sr=24000'), logs.join(' | '));
		assert.ok(!logs.some((m) => m.includes('Sampling')), 'the progress bar must be filtered out');
		assert.ok(logs.some((m) => m.includes('Traceback')));

		child.emit('exit', 1, null);
		assert.equal(manager.running, false);
		assert.equal(manager.exits, 1);
		assert.equal(manager.ensureRunning(), true, 'it tries one more time');
		fake.calls[1].child.emit('exit', 1, null);
		assert.equal(manager.ensureRunning(), false, 'it gives up once the limit is reached');
		assert.ok(manager.status.includes('stopped 2 times'), manager.status);
	});

	it('refuses to start without a virtual environment, and finds no python in a missing directory', () => {
		const fake = fakeSpawn();
		const manager = new LocalServerManager({ python: null, script: 'x.py', spawnImpl: fake.spawn });
		assert.equal(manager.ensureRunning(), false);
		assert.ok(manager.status.includes('no virtual environment'), manager.status);
		assert.equal(detectVenvPython(path.join(os.tmpdir(), 'no-such-directory')), null);
	});
});
