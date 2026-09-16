// Reminders: something somebody asked the bot to say later. They live in a JSON file so a restart
// does not lose them, and the ticker in src/index.js reads them back and speaks them in the server
// they were set in. A reminder whose time passed while the process was down is announced late, not
// swallowed.
//
// Schema: { items: [{ id, guildId, userId, userName, text, dueAt, createdAt }] }

import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { t } from './i18n/index.js';

const MAX_TEXT = 300;
// After this much lateness the reminder says why it is late (the process was not running).
const LATE_MS = 60_000;
// A queue nobody can cap is a way for one speaker to keep the bot talking indefinitely.
export const MAX_PENDING_PER_GUILD = 50;

/** "HH:MM" (local time) -> the next moment the clock shows it: today, or tomorrow when it has passed. */
export function parseClock(text, now = Date.now()) {
	const match = /^(\d{1,2})\s*[:.]\s*(\d{2})$/u.exec(String(text ?? '').trim());
	if (!match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) return null;
	const at = new Date(now);
	at.setHours(hours, minutes, 0, 0);
	const due = at.getTime();
	return due > now ? due : due + 24 * 60 * 60 * 1000;
}

/**
 * When a reminder is for: minutes is a delay, a clock time is the next time the clock shows it.
 * Returns a timestamp, or null when neither was given or the value makes no sense.
 */
export function parseWhen({ minutes = null, at = null } = {}, now = Date.now()) {
	const delay = Number(minutes);
	if (Number.isFinite(delay) && delay > 0) return now + Math.round(delay * 60_000);
	return parseClock(at, now);
}

export class ReminderStore {
	constructor(file, { log = null, now = Date.now } = {}) {
		this.file = file;
		this.log = log;
		this.now = now;
		this.items = [];
		this.pending = Promise.resolve();
	}

	async load() {
		let raw = null;
		try {
			raw = await readFile(this.file, 'utf8');
		} catch (err) {
			if (err.code !== 'ENOENT') throw err;
		}
		if (raw !== null) {
			let parsed = null;
			try {
				parsed = JSON.parse(raw);
			} catch (err) {
				// Corrupt file: keep a copy next to it and start empty; the bot must still come up.
				const backup = `${this.file}.${t('store.backup_suffix')}-${Date.now()}.json`;
				await copyFile(this.file, backup).catch(() => {});
				this.log?.(t('store.load_failed', { error: err.message, backup }));
			}
			if (parsed && Array.isArray(parsed.items)) {
				const valid = parsed.items.filter(
					(item) =>
						item &&
						typeof item.id === 'string' &&
						typeof item.guildId === 'string' &&
						typeof item.text === 'string' &&
						Number.isFinite(item.dueAt),
				);
				const dropped = parsed.items.length - valid.length;
				if (dropped > 0) this.log?.(t('store.dropped_entries', { count: dropped }));
				this.items = valid.map((item) => ({
					id: item.id,
					guildId: String(item.guildId),
					userId: item.userId ? String(item.userId) : null,
					userName: item.userName ? String(item.userName) : null,
					text: String(item.text).slice(0, MAX_TEXT),
					dueAt: item.dueAt,
					createdAt: Number.isFinite(item.createdAt) ? item.createdAt : item.dueAt,
				}));
			}
		}
		return this;
	}

	/** Pending reminders, soonest first; one server's when a guild id is given. */
	list(guildId = null) {
		return this.items
			.filter((item) => guildId === null || String(item.guildId) === String(guildId))
			.sort((a, b) => a.dueAt - b.dueAt)
			.map((item) => ({ ...item }));
	}

	/** What is due now. Nothing is removed here: the caller removes what it manages to speak. */
	due(now = this.now(), guildId = null) {
		return this.list(guildId).filter((item) => item.dueAt <= now);
	}

	/** Adds one, or null when this server already holds its fill (or the values make no sense). */
	add({ guildId, userId = null, userName = null, text, dueAt }) {
		const line = String(text ?? '').trim().slice(0, MAX_TEXT);
		if (!line || !Number.isFinite(dueAt)) return null;
		if (this.list(guildId).length >= MAX_PENDING_PER_GUILD) return null;
		const item = {
			id: randomUUID(),
			guildId: String(guildId ?? ''),
			userId: userId ? String(userId) : null,
			userName: userName ? String(userName) : null,
			text: line,
			dueAt,
			createdAt: this.now(),
		};
		this.items.push(item);
		return { ...item };
	}

	remove(id) {
		const index = this.items.findIndex((item) => item.id === id);
		if (index < 0) return null;
		const [removed] = this.items.splice(index, 1);
		return { ...removed };
	}

	/**
	 * Hands every due reminder to the session that should say it. A reminder whose session cannot speak
	 * right now (the bot is not in that server, or the owner has silenced it) is left in the store and
	 * tried again on the next tick — the one thing that must not happen is one disappearing unsaid.
	 * @returns {{ spoken: object[], kept: object[] }}
	 */
	deliverDue({ sessionFor, now = this.now() } = {}) {
		const spoken = [];
		const kept = [];
		for (const item of this.due(now)) {
			const session = typeof sessionFor === 'function' ? sessionFor(item.guildId) : null;
			const late = now - item.dueAt > LATE_MS;
			const line = t(late ? 'runtime.reminder_late' : 'runtime.reminder_due', {
				name: item.userName ?? t('runtime.someone'),
				text: item.text,
			});
			const handedOver = Boolean(session?.sayNow?.(line));
			if (!handedOver) {
				kept.push(item);
				continue;
			}
			session.record?.({ kind: 'voice', direction: 'out', whoName: session.persona?.().name ?? 'bot', text: line });
			this.remove(item.id);
			spoken.push(item);
		}
		return { spoken, kept };
	}

	/** Queued write: two saves never collide on the same .tmp file. */
	save() {
		const snapshot = `${JSON.stringify({ items: this.items }, null, '\t')}\n`;
		const run = this.pending.then(async () => {
			await mkdir(dirname(this.file), { recursive: true });
			const tmp = `${this.file}.${process.pid}.tmp`;
			await writeFile(tmp, snapshot, 'utf8');
			await rename(tmp, this.file);
		});
		this.pending = run.catch(() => {});
		return run;
	}
}
