// Daily GPT-Live quota (in seconds). Session time is fed in from the 'usage' event; once the quota is
// used up index.js closes the session and does not reopen it until the day rolls over. It is written to
// data/quota.json so that a restart does not reset the quota.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

export class DailyQuota {
	constructor({ limitSeconds = 0, file = null, now = Date.now } = {}) {
		this.limitSeconds = Math.max(0, Number(limitSeconds) || 0);
		this.file = file;
		this.now = now;
		this.day = dayKey(now());
		this.usedSeconds = 0;
		this.sessionBase = 0; // the part of the active session already added to the quota
		this.pending = Promise.resolve();
		this.warnedAt = null;
	}

	async load() {
		if (!this.file) return this;
		try {
			const parsed = JSON.parse(await readFile(this.file, 'utf8'));
			if (parsed?.day === this.day && Number.isFinite(parsed.usedSeconds)) this.usedSeconds = parsed.usedSeconds;
		} catch {
			/* no file: start from zero */
		}
		return this;
	}

	get enabled() {
		return this.limitSeconds > 0;
	}

	_rollover() {
		const today = dayKey(this.now());
		if (today !== this.day) {
			this.day = today;
			this.usedSeconds = 0;
			this.sessionBase = 0;
			this.warnedAt = null;
		}
	}

	/** A new session was opened: the session counter starts from zero. */
	sessionStarted() {
		this._rollover();
		this.sessionBase = 0;
	}

	/**
	 * The session's total duration was reported (cumulative seconds). The difference is added to the quota.
	 * @returns {{ used: number, limit: number, exceeded: boolean, remaining: number }}
	 */
	report(sessionSeconds) {
		this._rollover();
		const total = Math.max(0, Number(sessionSeconds) || 0);
		const delta = Math.max(0, total - this.sessionBase);
		this.sessionBase = total;
		this.usedSeconds += delta;
		if (delta > 0) void this.save();
		return this.status();
	}

	status() {
		this._rollover();
		const remaining = this.enabled ? Math.max(0, this.limitSeconds - this.usedSeconds) : Infinity;
		return {
			day: this.day,
			used: Math.round(this.usedSeconds),
			limit: this.limitSeconds,
			remaining,
			exceeded: this.enabled && this.usedSeconds >= this.limitSeconds,
		};
	}

	/** True when 90% of the quota has been passed and no warning was issued yet (one-shot). */
	shouldWarn() {
		if (!this.enabled || this.warnedAt) return false;
		if (this.usedSeconds < this.limitSeconds * 0.9) return false;
		this.warnedAt = this.now();
		return true;
	}

	save() {
		if (!this.file) return Promise.resolve();
		const snapshot = { day: this.day, usedSeconds: Math.round(this.usedSeconds) };
		this.pending = this.pending
			.then(async () => {
				await mkdir(dirname(this.file), { recursive: true });
				const tmp = `${this.file}.${process.pid}.tmp`;
				await writeFile(tmp, JSON.stringify(snapshot), 'utf8');
				await rename(tmp, this.file);
			})
			.catch(() => {});
		return this.pending;
	}
}
