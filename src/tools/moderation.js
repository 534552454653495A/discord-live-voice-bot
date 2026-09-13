// Moderation tools: timeout, kick, ban, ban list, audit log. All of them are owner-gated.
// When the name only matches fuzzily (the transcript may have mangled it), irreversible actions ask for a two-step confirmation.

import { t } from '../i18n/index.js';
import { normalize } from '../text.js';
import { pickBest } from '../matcher.js';
import {
	STALE_CONFIRMATION,
	WORDS,
	askConfirmation,
	auditActionLabel,
	checkConfirmation,
	displayName,
	failure,
	findMemberDetailed,
} from './helpers.js';
import { P, defineTool } from './registry.js';

/** Ask for confirmation on a fuzzy match; pass straight through on an exact match or once confirmed. */
function confirmIfFuzzy(deps, { name, args, member, exact, action }) {
	if (exact) return null;
	const decision = checkConfirmation(deps, {
		key: name,
		target: member.id,
		confirm: args.confirm,
		question: t('tools.moderation.fuzzy_question', { name: args.member, who: displayName(member), action }),
	});
	if (decision.ask) return askConfirmation(decision.ask, { member: displayName(member), fuzzy: true });
	if (decision.stale) return STALE_CONFIRMATION();
	return null;
}

export const tools = [
	defineTool({
		name: 'timeout_member',
		description: 'Applies a timeout (mute) to a member. Owner only.',
		parameters: P.obj(
			{
				member: P.str('Member name'),
				minutes: P.int('How many minutes (1-40320, default 10)'),
				reason: P.str('Reason (optional)'),
				confirm: P.confirm(),
			},
			['member'],
		),
		gate: { keywords: WORDS.timeout },
		async handler(args, deps, { name }) {
			const { member, exact } = await findMemberDetailed(deps, String(args.member ?? ''));
			if (!member) return { ok: false, spoken: t('tools.moderation.member_not_found', { name: args.member }) };
			const pending = confirmIfFuzzy(deps, { name, args, member, exact, action: t('tools.moderation.action_timeout') });
			if (pending) return pending;
			const minutes = Math.min(Math.max(Number(args.minutes ?? 10) || 10, 1), 40_320);
			if (member.moderatable === false) {
				return { ok: false, spoken: t('tools.moderation.no_timeout_permission', { who: displayName(member, t('tools.moderation.that_person')) }) };
			}
			try {
				await member.timeout(minutes * 60_000, args.reason ? String(args.reason).slice(0, 400) : t('tools.helpers.audit_reason'));
				const who = displayName(member);
				deps.log?.(t('tools.moderation.log_timeout', { who, minutes }));
				return { ok: true, spoken: t('tools.moderation.timeout_done', { who, minutes }), data: { member: who, minutes } };
			} catch (err) {
				return failure(deps, 'timeout failed', err, t('tools.moderation.timeout_failed'));
			}
		},
	}),

	defineTool({
		name: 'untimeout_member',
		description: "Lifts a member's timeout (mute). Owner only.",
		parameters: P.obj({ member: P.str('Member name'), reason: P.str('Reason (optional)') }, ['member']),
		gate: { keywords: WORDS.timeout },
		async handler(args, deps) {
			const { member } = await findMemberDetailed(deps, String(args.member ?? ''));
			if (!member) return { ok: false, spoken: t('tools.moderation.member_not_found', { name: args.member }) };
			try {
				await member.timeout(null, args.reason ? String(args.reason).slice(0, 400) : t('tools.helpers.audit_reason'));
				deps.log?.(t('tools.moderation.log_untimeout', { who: member.displayName }));
				return { ok: true, spoken: t('tools.moderation.untimeout_done', { who: member.displayName }), data: { id: member.id } };
			} catch (err) {
				return failure(deps, 'timeout removal failed', err, t('tools.moderation.untimeout_failed'));
			}
		},
	}),

	defineTool({
		name: 'kick_member',
		description: 'Removes a member FROM THE SERVER (kick). They can rejoin with a new invite. This is not the same as throwing them out of a voice channel -- for that use voice_disconnect. Owner only; asks for confirmation when the name is not an exact match.',
		parameters: P.obj({ member: P.str('Member name'), reason: P.str('Reason (optional)'), confirm: P.confirm() }, ['member']),
		gate: { keywords: WORDS.kick },
		async handler(args, deps, { name }) {
			const { member, exact } = await findMemberDetailed(deps, String(args.member ?? ''));
			if (!member) return { ok: false, spoken: t('tools.moderation.member_not_found', { name: args.member }) };
			const pending = confirmIfFuzzy(deps, { name, args, member, exact, action: t('tools.moderation.action_kick') });
			if (pending) return pending;
			if (member.kickable === false) {
				return { ok: false, spoken: t('tools.moderation.no_kick_permission', { who: displayName(member, t('tools.moderation.that_person')) }) };
			}
			const who = displayName(member);
			try {
				await member.kick(args.reason ? String(args.reason).slice(0, 400) : t('tools.helpers.audit_reason'));
				deps.log?.(t('tools.moderation.log_kick', { who }));
				return { ok: true, spoken: t('tools.moderation.kick_done', { who }), data: { member: who } };
			} catch (err) {
				return failure(deps, 'kick failed', err, t('tools.moderation.kick_failed'));
			}
		},
	}),

	defineTool({
		name: 'ban_member',
		description: 'Bans a member from the server. Owner only.',
		parameters: P.obj(
			{
				member: P.str('Member name'),
				reason: P.str('Reason (optional)'),
				delete_days: P.int('How many days of their messages to delete (0-7, default 0)'),
				confirm: P.confirm(),
			},
			['member'],
		),
		gate: { keywords: WORDS.ban },
		async handler(args, deps, { name }) {
			const { member, exact } = await findMemberDetailed(deps, String(args.member ?? ''));
			if (!member) return { ok: false, spoken: t('tools.moderation.member_not_found', { name: args.member }) };
			const pending = confirmIfFuzzy(deps, { name, args, member, exact, action: t('tools.moderation.action_ban') });
			if (pending) return pending;
			if (member.bannable === false) {
				return { ok: false, spoken: t('tools.moderation.no_ban_permission', { who: displayName(member, t('tools.moderation.that_person')) }) };
			}
			const days = Math.min(Math.max(Number(args.delete_days ?? 0) || 0, 0), 7);
			try {
				await deps.guild.members.ban(member, {
					reason: args.reason ? String(args.reason).slice(0, 400) : t('tools.helpers.audit_reason'),
					deleteMessageSeconds: days * 86_400,
				});
				const who = displayName(member);
				deps.log?.(t('tools.moderation.log_ban', { who }));
				return { ok: true, spoken: t('tools.moderation.ban_done', { who }), data: { member: who } };
			} catch (err) {
				return failure(deps, 'ban failed', err, t('tools.moderation.ban_failed'));
			}
		},
	}),

	defineTool({
		name: 'list_bans',
		description: "Shows the server's ban list. Owner only.",
		gate: { keywords: WORDS.ban },
		async handler(args, deps) {
			try {
				const bans = await deps.guild.bans.fetch();
				const names = [...bans.values()].map((entry) => entry.user?.username ?? entry.user?.id);
				deps.log?.(t('tools.moderation.log_ban_list', { count: names.length }));
				return {
					ok: true,
					spoken: names.length
						? t('tools.moderation.ban_list', {
								count: names.length,
								names: names.slice(0, 20).join(', '),
								more: names.length > 20 ? '…' : '',
							})
						: t('tools.moderation.ban_list_empty'),
					data: { bans: names },
				};
			} catch (err) {
				return failure(deps, 'ban list fetch failed', err, t('tools.moderation.ban_list_failed'));
			}
		},
	}),

	defineTool({
		name: 'unban_member',
		description: 'Lifts the ban on a banned user. Owner only.',
		parameters: P.obj({ user: P.str('Username (the name as it appears on the ban list)'), reason: P.str('Reason (optional)') }, ['user']),
		gate: { keywords: WORDS.ban },
		async handler(args, deps) {
			const wanted = String(args.user ?? '').trim();
			if (!wanted) return { ok: false, spoken: t('tools.moderation.no_unban_target') };
			try {
				const bans = await deps.guild.bans.fetch();
				const entries = [...bans.values()]
					.map((entry) => ({
						id: entry.user?.id,
						display: entry.user?.username ?? entry.user?.id,
						names: [normalize(entry.user?.username ?? ''), normalize(entry.user?.globalName ?? '')].filter(Boolean),
						raw: entry,
					}))
					.filter((entry) => entry.id && entry.names.length);
				const hit = pickBest(entries, normalize(wanted));
				if (!hit) return { ok: false, spoken: t('tools.moderation.unban_not_found', { name: wanted }) };
				await deps.guild.bans.remove(hit.id, args.reason ? String(args.reason).slice(0, 400) : t('tools.helpers.audit_reason'));
				deps.log?.(t('tools.moderation.log_unban', { who: hit.display }));
				return { ok: true, spoken: t('tools.moderation.unban_done', { who: hit.display }), data: { user: hit.display } };
			} catch (err) {
				return failure(deps, 'unban failed', err, t('tools.moderation.unban_failed'));
			}
		},
	}),

	defineTool({
		name: 'audit_log',
		description: "Reads the most recent moderator actions from the server's audit log. Owner only.",
		parameters: P.obj({ limit: P.int('How many entries (1-20, default 5)') }),
		gate: { keywords: WORDS.log },
		async handler(args, deps) {
			const limit = Math.max(1, Math.min(20, Math.round(Number(args.limit ?? 5)) || 5));
			try {
				const logs = await deps.guild.fetchAuditLogs({ limit });
				const entries = [...(logs.entries?.values?.() ?? [])].map((entry) => ({
					action: auditActionLabel(entry.action),
					executor: entry.executor?.username ?? entry.executorId ?? '?',
					target: entry.target?.username ?? entry.target?.name ?? entry.targetId ?? null,
					at: new Date(entry.createdTimestamp ?? Date.now()).toISOString(),
				}));
				deps.log?.(t('tools.moderation.log_audit', { count: entries.length }));
				return {
					ok: true,
					spoken: entries.length
						? t('tools.moderation.audit_summary', {
								count: entries.length,
								executor: entries[0].executor,
								action: entries[0].action,
								target: entries[0].target ? ` (${entries[0].target})` : '',
							})
						: t('tools.moderation.audit_empty'),
					data: { entries },
				};
			} catch (err) {
				return failure(deps, 'audit log read failed', err, t('tools.moderation.audit_failed'));
			}
		},
	}),
];
