// Conversation summary: builds a short summary from the voice transcripts and the channel/DM messages in
// the panel log. "What was talked about today?" (the voice tool) and the summary slash command both go through here.

import { t } from './i18n/index.js';
import { providerFromDeps } from './provider.js';

const KINDS = new Set(['voice', 'channel', 'dm']);

/** Turns the events to be summarised into plain text (maxChars at most). */
export function transcriptFromEvents(events, { sinceMs = null, maxChars = 6000, includeDm = false, nameFor = null } = {}) {
	const lines = [];
	for (const event of events) {
		if (!KINDS.has(event.kind)) continue;
		if (event.kind === 'dm' && !includeDm) continue;
		if (sinceMs && Date.parse(event.at) < sinceMs) continue;
		const text = String(event.text ?? '').trim();
		if (!text) continue;
		const who = event.whoName ?? (event.who ? (nameFor?.(event.who) ?? event.who) : event.direction === 'out' ? 'bot' : '?');
		const time = new Date(event.at).toISOString().slice(11, 16);
		lines.push(`[${time}] ${who}: ${text}`);
	}
	let body = lines.join('\n');
	if (body.length > maxChars) body = `…${body.slice(-maxChars)}`;
	return { text: body, count: lines.length };
}

/**
 * Produces the summary. `events` is ActivityLog.events; `hours` is the window to look back over (0 = everything).
 * @returns {Promise<{ summary: string, count: number }>}
 */
export async function summarizeConversation(deps, { events, hours = 3, includeDm = false, spoken = true } = {}) {
	const provider = providerFromDeps(deps);
	const sinceMs = hours > 0 ? Date.now() - hours * 3_600_000 : null;
	const { text, count } = transcriptFromEvents(events ?? [], { sinceMs, includeDm, nameFor: deps.nameFor ?? null });
	if (!count) return { summary: t('summary.nothing_to_summarize'), count: 0 };
	if (!provider.available) return { summary: t('summary.provider_missing'), count };
	const instructions = spoken ? t('summary.instructions_spoken') : t('summary.instructions_written');
	try {
		const summary = await provider.complete({
			instructions,
			input: `<transcript>\n${text}\n</transcript>`,
			timeoutMs: 45_000,
			maxTokens: spoken ? 300 : 600,
		});
		return { summary: String(summary ?? '').trim() || t('summary.empty'), count };
	} catch (err) {
		deps.log?.(t('summary.log_failed', { error: err.message }));
		return { summary: t('summary.failed'), count };
	}
}
