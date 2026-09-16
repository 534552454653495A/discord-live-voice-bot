// Reminder tools: a spoken timer that outlives the process. The ticker in src/index.js speaks a due
// reminder in the voice channel of the server it was set in, so these tools only keep the book.

import { t } from '../i18n/index.js';
import { MAX_PENDING_PER_GUILD, parseWhen } from '../reminders.js';
import { P, defineTool } from './registry.js';

function noStore() {
	return { ok: false, spoken: t('tools.reminders.disabled') };
}

/** The person asking: who is speaking, so the reminder can be addressed to them when it is spoken. */
function asker(deps) {
	const id = deps.currentSpeakerId?.() ?? null;
	return { id: id ? String(id) : null, name: deps.currentSpeakerName?.() ?? null };
}

/** "21:30" — the clock time a reminder is due at, in the machine's own timezone. */
function clockText(timestamp) {
	const at = new Date(timestamp);
	return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

export const tools = [
	defineTool({
		name: 'set_reminder',
		description:
			'Says something out loud later: "minutes" for a delay ("remind me in 10 minutes to take the pizza out") or ' +
			'"at" for a clock time ("at 21:30"). The reminder is kept across restarts and is spoken in the server it was set in.',
		parameters: P.obj(
			{
				text: P.str('What to say when the time comes'),
				minutes: P.num('Delay in minutes (this or "at")'),
				at: P.str('Clock time as "HH:MM" (this or "minutes")'),
			},
			['text'],
		),
		async handler(args, deps) {
			if (!deps.reminders) return noStore();
			const text = String(args.text ?? '').trim();
			if (!text) return { ok: false, spoken: t('tools.reminders.empty') };
			const dueAt = parseWhen({ minutes: args.minutes, at: args.at });
			if (!dueAt) return { ok: false, spoken: t('tools.reminders.bad_time') };
			const speaker = asker(deps);
			const item = deps.reminders.add({
				guildId: String(deps.guild?.id ?? ''),
				userId: speaker.id,
				userName: speaker.name,
				text,
				dueAt,
			});
			if (!item) return { ok: false, spoken: t('tools.reminders.full', { max: MAX_PENDING_PER_GUILD }) };
			await deps.reminders.save();
			const when = clockText(item.dueAt);
			deps.log?.(t('tools.reminders.log_set', { when, text: item.text }));
			deps.activity?.({
				kind: 'session',
				whoName: deps.personaName?.() ?? 'bot',
				text: t('tools.reminders.activity_set', { when, text: item.text }),
			});
			return { ok: true, spoken: t('tools.reminders.set', { when, text: item.text }), data: { id: item.id, due_at: item.dueAt } };
		},
	}),

	defineTool({
		name: 'list_reminders',
		description: 'Lists the reminders still waiting in this server, with the time each one is due.',
		async handler(args, deps) {
			if (!deps.reminders) return noStore();
			const items = deps.reminders.list(deps.guild?.id ?? null);
			if (!items.length) return { ok: true, spoken: t('tools.reminders.list_empty'), data: { items: [] } };
			const lines = items.map((item) => `${clockText(item.dueAt)} ${item.text}`).join('; ');
			return {
				ok: true,
				spoken: t('tools.reminders.list', { count: items.length, lines }),
				data: { items: items.map((item) => ({ id: item.id, due_at: item.dueAt, text: item.text, who: item.userName })) },
			};
		},
	}),

	defineTool({
		name: 'cancel_reminder',
		description: 'Cancels a waiting reminder. Only the person who set it can cancel it.',
		parameters: P.obj({ text: P.str('A few words from the reminder, enough to find it by') }, ['text']),
		async handler(args, deps) {
			if (!deps.reminders) return noStore();
			const needle = String(args.text ?? '').trim().toLowerCase();
			if (!needle) return { ok: false, spoken: t('tools.reminders.needle_empty') };
			const speaker = asker(deps);
			const owned = (item) => (speaker.id ? item.userId === speaker.id : item.userId === null);
			const found = deps.reminders
				.list(deps.guild?.id ?? null)
				.filter(owned)
				.find((item) => item.text.toLowerCase().includes(needle));
			if (!found) return { ok: false, spoken: t('tools.reminders.not_found', { text: needle }) };
			deps.reminders.remove(found.id);
			await deps.reminders.save();
			deps.log?.(t('tools.reminders.log_cancel', { text: found.text }));
			return { ok: true, spoken: t('tools.reminders.cancelled', { text: found.text }), data: { id: found.id } };
		},
	}),
];
