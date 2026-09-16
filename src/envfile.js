// Updating the .env file from the panel: in place (comments and the order of the other lines survive),
// atomically (tmp + rename, like every store here), and with a timestamped copy kept before the first
// change, so a pasted-wrong key can be undone by hand. No value ever comes back out of this module.

import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';

const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u;

/**
 * Writes `patch` ({ KEY: value }) into the file, replacing those keys where they are already there and
 * appending the rest. Values containing anything the format would misread are quoted, as dotenv expects.
 * @returns {{ changed: string[], backup: string|null }}
 */
export async function updateEnvFile(file, patch = {}) {
	let raw = '';
	try {
		raw = await readFile(file, 'utf8');
	} catch (err) {
		if (err.code !== 'ENOENT') throw err;
	}
	const remaining = new Map(Object.entries(patch).filter(([, value]) => value !== undefined && value !== null));
	const lines = raw.split(/\r?\n/u);
	const changed = [];
	for (let index = 0; index < lines.length; index++) {
		const match = KEY_LINE.exec(lines[index]);
		if (!match) continue;
		const key = match[1];
		if (!remaining.has(key)) continue;
		lines[index] = `${key}=${quote(remaining.get(key))}`;
		remaining.delete(key);
		changed.push(key);
	}
	for (const [key, value] of remaining) {
		lines.push(`${key}=${quote(value)}`);
		changed.push(key);
	}
	if (!changed.length) return { changed, backup: null };

	const backup = `${file}.${Date.now()}.bak`;
	await copyFile(file, backup).catch(() => {});
	const body = `${lines.join('\n').replace(/\n+$/u, '')}\n`;
	const tmp = `${file}.${process.pid}.tmp`;
	await writeFile(tmp, body, 'utf8');
	await rename(tmp, file);
	return { changed, backup };
}

/** A value plain enough to sit bare in the file stays bare; anything else is quoted. */
function quote(value) {
	const text = String(value);
	return /^[A-Za-z0-9_./:@+-]*$/u.test(text) ? text : `"${text.replace(/"/gu, '\\"')}"`;
}

/** `sk-proj-…4f9a`: enough to recognise which key this is, not enough to use one. */
export function maskSecret(value) {
	const text = String(value ?? '').trim();
	if (!text) return '';
	if (text.length <= 8) return '…';
	return `${text.slice(0, 6)}…${text.slice(-4)}`;
}
