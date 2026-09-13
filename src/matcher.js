// Member name matching: the speech transcript mangles names ("Alex Rivera" can come back as "Alexriver'a"),
// so exact matching is not enough; similarity + token coverage + a bonus for the people in the room are used.
//
// On top of that, every member of the guild is fetched over REST at start-up and kept in memory, so anyone
// can be found by name even when they are in no voice channel and in no cache (the GUILD_MEMBERS intent is
// not needed, the single/bulk member endpoints work for this bot).

import { t } from './i18n/index.js';
import { normalize } from './text.js';

/** Levenshtein-based similarity (0-1). */
export function similarity(a, b) {
	if (!a || !b) return 0;
	if (a === b) return 1;
	const m = a.length;
	const n = b.length;
	let previous = new Int32Array(n + 1);
	let current = new Int32Array(n + 1);
	for (let j = 0; j <= n; j++) previous[j] = j;
	for (let i = 1; i <= m; i++) {
		current[0] = i;
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
		}
		const swap = previous;
		previous = current;
		current = swap;
	}
	return 1 - previous[n] / Math.max(m, n);
}

/** Similarity threshold: strict for short names, loose for long ones. */
export function fuzzyThreshold(needle) {
	if (needle.length < 4) return 0.95;
	if (needle.length === 4) return 0.75;
	if (needle.length <= 6) return 0.6;
	return 0.55;
}

/** Name match score: 3 exact, 2 prefix, 1 contains, 0 none. */
export function nameScore(names, needle) {
	if (!needle) return 0;
	if (names.some((name) => name === needle)) return 3;
	if (names.some((name) => name.startsWith(needle))) return 2;
	if (names.some((name) => name.includes(needle))) return 1;
	return 0;
}

/** The member's name variants: account name, account display name, server nickname, display name. */
export function memberNames(member) {
	return [member?.user?.username, member?.user?.globalName, member?.nickname, member?.displayName]
		.filter((value) => typeof value === 'string' && value.trim())
		.map((value) => normalize(value))
		.filter(Boolean);
}

/** Search entry: so matching also works without the raw member object. */
export function entryFromMember(member) {
	const names = memberNames(member);
	if (!names.length) return null;
	return {
		id: member.id,
		display: member.displayName ?? member.user?.username ?? member.id,
		names,
		isBot: Boolean(member.user?.bot ?? member.bot ?? false),
		raw: member,
	};
}

/** Token coverage score, because multi-word names can be split up in the speech transcript. */
function coverageScore(flatNames, needleTokens) {
	let sum = 0;
	for (const token of needleTokens) {
		let best = 0;
		for (const name of flatNames) best = Math.max(best, similarity(name, token));
		sum += best;
	}
	return sum / needleTokens.length;
}

export function scoreEntry(entry, needle, { voiceChannelId = null, botChannelId = null } = {}) {
	const flat = (entry.names ?? []).flatMap((name) => [name, ...name.split(' ')]);
	if (!flat.length) return 0;

	let score = nameScore(flat, needle);
	if (!score) {
		let bestFull = 0;
		for (const name of flat) bestFull = Math.max(bestFull, similarity(name, needle));
		const needleTokens = needle.split(' ').filter(Boolean);
		const coverage = needleTokens.length > 1 ? coverageScore(flat, needleTokens) : 0;
		const best = Math.max(bestFull, coverage);
		if (best < fuzzyThreshold(needle)) return 0;
		score = 0.5 + best;
	}
	if (voiceChannelId) score += 0.2;
	if (voiceChannelId && voiceChannelId === botChannelId) score += 0.3;
	return score;
}

/**
 * Picks the best match.
 * `voiceChannelOf(entryId)` gives the voice channel per entry (so the people in the room come first).
 */
export function pickBest(entries, needle, { voiceChannelOf = null, botChannelId = null } = {}) {
	let best = null;
	let bestScore = 0;
	for (const entry of entries) {
		const voiceChannelId = voiceChannelOf ? voiceChannelOf(entry.id) : (entry.voiceChannelId ?? null);
		const score = scoreEntry(entry, needle, { voiceChannelId, botChannelId });
		if (score > bestScore) {
			best = entry;
			bestScore = score;
		}
	}
	return best;
}

/** In-memory member index: every member is loaded at start-up, new ones are added as they appear. */
export class MemberIndex {
	constructor() {
		this.entries = new Map();
		this.selfId = null;
	}

	get size() {
		return this.entries.size;
	}

	list() {
		return [...this.entries.values()];
	}

	get(id) {
		return this.entries.get(id) ?? null;
	}

	/** Drops a member who left the guild from the index. */
	remove(id) {
		return this.entries.delete(String(id));
	}

	upsert(member) {
		const entry = entryFromMember(member);
		if (!entry || !entry.id) return null;
		this.entries.set(entry.id, entry);
		return entry;
	}

	upsertMany(members) {
		for (const member of members) this.upsert(member);
	}

	search(needle, opts = {}) {
		return pickBest(this.list(), normalize(needle), opts);
	}

	/** Lists the bots (marking which ones are authorised); does not list itself. */
	bots(authorized = new Set(), { excludeId = this.selfId } = {}) {
		return this.list()
			.filter((entry) => entry.isBot && entry.id !== excludeId)
			.map((entry) => ({
				id: entry.id,
				name: entry.display,
				authorized: authorized.has(entry.id) || authorized.has(normalize(entry.display)),
			}));
	}

	/**
	 * Fetches every member of the guild over REST.
	 * Note: these endpoints work for this bot even without the GUILD_MEMBERS intent.
	 */
	async load({ token, guildId, fetchImpl = fetch, pageSize = 1000, log = null } = {}) {
		let after = '0';
		let total = 0;
		for (;;) {
			const url = `https://discord.com/api/v10/guilds/${guildId}/members?limit=${pageSize}&after=${after}`;
			const response = await fetchImpl(url, {
				headers: { Authorization: `Bot ${token}` },
				signal: AbortSignal.timeout(30_000),
			});
			if (!response.ok) throw new Error(`member list could not be fetched (HTTP ${response.status})`);
			const page = await response.json();
			for (const raw of page) {
				this.upsert({
					id: raw.user?.id,
					displayName: raw.nick ?? raw.user?.global_name ?? raw.user?.username,
					nickname: raw.nick ?? null,
					user: { username: raw.user?.username, globalName: raw.user?.global_name, bot: Boolean(raw.user?.bot) },
				});
			}
			total += page.length;
			if (page.length < pageSize || !page.length) break;
			const lastId = page[page.length - 1].user?.id;
			if (!lastId || lastId === after) break; // no id: do not request the same page again
			after = lastId;
			if (total > 50_000) break;
		}
		log?.(t('reader.member_index_loaded', { count: this.entries.size }));
		return total;
	}
}
