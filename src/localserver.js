// The bot itself starts and stops the Chatterbox (TTS + whisper STT) server.
// When it has to switch to the local brain and the server is not up, tools/chatterbox_server.py is
// run with the Python inside .venv-chatterbox; its output lands in the bot log as "[chatterbox] …".

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { t } from './i18n/index.js';

const NOISE = /Sampling:|it\/s\]|Fetching \d+ files|^\s*$|FutureWarning|self\.gen = func|"GET \/health HTTP|unauthenticated requests to the HF Hub|generation flags are not valid/;

/** The Python of the virtual environment in the project root (null when there is none). */
export function detectVenvPython(root) {
	const candidates =
		process.platform === 'win32'
			? [path.join(root, '.venv-chatterbox', 'Scripts', 'python.exe')]
			: [path.join(root, '.venv-chatterbox', 'bin', 'python3'), path.join(root, '.venv-chatterbox', 'bin', 'python')];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export class LocalServerManager {
	constructor({ python, script, args = [], cwd = process.cwd(), log = () => {}, spawnImpl = spawn, maxRestarts = 3, now = Date.now }) {
		this.python = python;
		this.script = script;
		this.args = args;
		this.cwd = cwd;
		this.log = log;
		this.spawn = spawnImpl;
		this.maxRestarts = maxRestarts;
		this.now = now;
		this.child = null;
		this.startedAt = 0;
		this.exits = 0;
		this.lastExit = null;
		this.lastError = null;
		this.stopping = false;
	}

	get running() {
		return Boolean(this.child);
	}

	get status() {
		if (this.child) return t('brain.local_server_running');
		if (this.lastError) return t('brain.local_server_start_failed', { error: this.lastError });
		if (this.lastExit !== null) return t('brain.local_server_exited', { code: this.lastExit });
		return t('brain.local_server_off');
	}

	/** Starts the server when it is not up. Returns false when it cannot be started (no venv, crashed too often). */
	ensureRunning() {
		if (this.child) return true;
		if (!this.python || !existsSync(this.python)) {
			this.lastError = t('brain.local_server_no_venv');
			return false;
		}
		if (!existsSync(this.script)) {
			this.lastError = t('brain.local_server_no_script', { script: this.script });
			return false;
		}
		if (this.exits >= this.maxRestarts) {
			this.lastError = t('brain.local_server_gave_up', { count: this.exits });
			return false;
		}
		this.stopping = false;
		this.lastError = null;
		let child;
		try {
			child = this.spawn(this.python, ['-u', this.script, ...this.args], {
				cwd: this.cwd,
				stdio: ['ignore', 'pipe', 'pipe'],
				windowsHide: true,
				// OPENBLAS: numpy's thread buffers give "allocation failed" on a memory-tight machine; pointless on the GPU path.
				env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '2' },
			});
		} catch (err) {
			this.lastError = err.message;
			return false;
		}
		this.child = child;
		this.startedAt = this.now();
		this.log(
			t('brain.local_server_starting', {
				python: path.basename(this.python),
				script: path.basename(this.script),
				args: this.args.join(' '),
			}),
		);
		for (const stream of [child.stdout, child.stderr]) {
			if (!stream) continue;
			readline.createInterface({ input: stream }).on('line', (line) => {
				if (NOISE.test(line)) return;
				this.log(`[chatterbox] ${line.replace(/^\[chatterbox\]\s*/, '').trim()}`);
			});
		}
		child.once('error', (err) => {
			this.lastError = err.message;
			this.log(t('brain.local_server_spawn_failed', { error: err.message }));
			if (this.child === child) this.child = null;
		});
		child.once('exit', (code, signal) => {
			if (this.child === child) this.child = null;
			this.lastExit = code ?? signal ?? null;
			if (!this.stopping) {
				this.exits++;
				this.log(t('brain.local_server_exit_log', { code: this.lastExit, count: this.exits, max: this.maxRestarts }));
			}
		});
		return true;
	}

	stop() {
		const child = this.child;
		if (!child) return;
		this.stopping = true;
		try {
			child.kill();
		} catch {
			/* ignore */
		}
		this.child = null;
	}
}
