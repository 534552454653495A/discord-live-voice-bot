// Saved tracks: the songs somebody asked the bot to keep, so they can be played again by name later.
// A plain JSON file under data/ with the same serialised tmp+rename write as the other stores, and one
// list per person: what somebody saved is theirs, not the server's.
//
// Schema: { items: [{ id, userId, userName, title, ref, kind, createdAt }] }

import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalize } from './text.js';

const MAX_TITLE = 200;
const MAX_REF = 500;
// A list nobody can cap is a way to grow a file forever.
export const MAX_SAVED_PER_USER = 50;

export class SavedTracks {
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
			} catch {
				// Corrupt file: a saved list is not worth refusing to start over.
				const backup = `${this.file}.${Date.now()}.json`;
				await copyFile(this.file, backup).catch(() => {});
				this.log?.(`[music] saved tracks file could not be read; kept a copy at ${backup}`);
			}
			if (parsed && Array.isArray(parsed.items)) {
				this.items = parsed.items
					.filter((item) => item && typeof item.id === 'string' && item.userId && typeof item.ref === 'string')
					.map((item) => ({
						id: item.id,
						userId: String(item.userId),
						userName: item.userName ? String(item.userName) : null,
						title: String(item.title ?? '').slice(0, MAX_TITLE),
						ref: String(item.ref).slice(0, MAX_REF),
						kind: item.kind === 'file' ? 'file' : 'url',
						createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
					}));
			}
		}
		return this;
	}

	/** One person's saved tracks, in the order they were saved. */
	list(userId) {
		const id = userId ? String(userId) : '';
		return this.items.filter((item) => item.userId === id).map((item) => ({ ...item }));
	}

	/**
	 * Saves a track. The same track saved twice is one entry: the copy already there comes back with
	 * `duplicate`, so the caller can say so instead of adding it again.
	 * Returns null when the person's list is full.
	 */
	add({ userId, userName = null, title, ref, kind = 'url' }) {
		const id = userId ? String(userId) : '';
		const reference = String(ref ?? '').trim().slice(0, MAX_REF);
		if (!id || !reference) return null;
		const existing = this.items.find((item) => item.userId === id && item.ref === reference);
		if (existing) return { ...existing, duplicate: true };
		if (this.list(id).length >= MAX_SAVED_PER_USER) return null;
		const item = {
			id: randomUUID(),
			userId: id,
			userName: userName ? String(userName) : null,
			title: String(title ?? reference).slice(0, MAX_TITLE),
			ref: reference,
			kind: kind === 'file' ? 'file' : 'url',
			createdAt: this.now(),
		};
		this.items.push(item);
		return { ...item };
	}

	/** Takes one of this person's tracks out by id; somebody else's id does nothing. */
	remove(userId, id) {
		const owner = userId ? String(userId) : '';
		const index = this.items.findIndex((item) => item.id === id && item.userId === owner);
		if (index < 0) return null;
		const [removed] = this.items.splice(index, 1);
		return { ...removed };
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

/** A saved track by its number in the list, or by a few words of its title (normalised). */
export function pickSaved(items, needle) {
	const text = String(needle ?? '').trim();
	if (!text) return null;
	const number = Number(text);
	if (Number.isInteger(number) && number >= 1 && number <= items.length) return items[number - 1] ?? null;
	const wanted = normalize(text);
	return items.find((item) => wanted && normalize(item.title).includes(wanted)) ?? null;
}
