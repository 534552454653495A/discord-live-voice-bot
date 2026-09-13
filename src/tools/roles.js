// Role tools: create, edit, delete (confirmed), grant/revoke, list.

import { t } from '../i18n/index.js';
import {
	PermissionFlagsBits,
	STALE_CONFIRMATION,
	WORDS,
	askConfirmation,
	checkConfirmation,
	displayName,
	failure,
	findMember,
	parseColor,
	resolveRole,
} from './helpers.js';
import { P, defineTool } from './registry.js';

async function grantOrRevoke(args, deps, { name }) {
	const member = await findMember(deps, String(args.member ?? ''));
	const role = resolveRole(deps, String(args.role ?? ''));
	if (!member) return { ok: false, spoken: t('tools.roles.member_not_found', { name: args.member }) };
	if (!role) return { ok: false, spoken: t('tools.roles.role_not_found', { name: args.role }) };
	if (role.managed) {
		// Bot/integration roles cannot be assigned by hand; do not make it look like a hierarchy error.
		return { ok: false, spoken: t('tools.roles.managed_role', { role: role.name }) };
	}
	const me = deps.guild.members.me;
	const highest = me?.roles?.highest;
	const isSelf = Boolean(me?.id) && member.id === me.id;
	const who = displayName(member);
	if (me?.permissions?.has && !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
		return { ok: false, spoken: t('tools.roles.no_manage_roles') };
	}
	// Granting a role depends only on the ROLE's position (Discord: you may assign any role below your
	// own highest one). The target's own position, or being the guild owner, is NOT a blocker here --
	// unlike kick/ban/nickname. discord.js always reports `manageable: false` for the bot's own member,
	// so the hierarchy is computed from positions instead.
	const canManageRole = highest && Number.isFinite(role.position) ? highest.position > role.position : role.editable !== false;
	if (!canManageRole) {
		return {
			ok: false,
			spoken: t('tools.roles.role_above_me', {
				role: role.name,
				mine: highest?.name ?? '?',
				rolePosition: Number.isFinite(role.position) ? role.position : '?',
				myPosition: highest?.position ?? '?',
			}),
		};
	}
	try {
		if (name === 'grant_role') {
			await member.roles.add(role, t('tools.helpers.audit_reason'));
			deps.log?.(t('tools.roles.log_granted', { who, role: role.name }));
			return {
				ok: true,
				spoken: isSelf ? t('tools.roles.granted_self', { role: role.name }) : t('tools.roles.granted', { who, role: role.name }),
				data: { member: who, role: role.name },
			};
		}
		await member.roles.remove(role, t('tools.helpers.audit_reason'));
		deps.log?.(t('tools.roles.log_revoked', { who, role: role.name }));
		return {
			ok: true,
			spoken: isSelf ? t('tools.roles.revoked_self', { role: role.name }) : t('tools.roles.revoked', { who, role: role.name }),
			data: { member: who, role: role.name },
		};
	} catch (err) {
		return failure(deps, 'role update failed', err, t('tools.roles.update_failed'));
	}
}

export const tools = [
	defineTool({
		name: 'grant_role',
		description: 'Gives a role to a member. Owner only.',
		parameters: P.obj({ member: P.str('Member name'), role: P.str('Role name') }, ['member', 'role']),
		gate: { keywords: WORDS.role },
		handler: grantOrRevoke,
	}),
	defineTool({
		name: 'revoke_role',
		description: 'Takes a role away from a member. Owner only.',
		parameters: P.obj({ member: P.str('Member name'), role: P.str('Role name') }, ['member', 'role']),
		gate: { keywords: WORDS.role },
		handler: grantOrRevoke,
	}),

	defineTool({
		name: 'create_role',
		description: 'Creates a new role. Owner only.',
		parameters: P.obj(
			{
				name: P.str('Role name'),
				color: P.str('Colour (e.g. #ff8800 or a colour name)'),
				hoist: P.bool('Show members separately'),
				mentionable: P.bool('Allow the role to be mentioned'),
			},
			['name'],
		),
		gate: { keywords: WORDS.role },
		async handler(args, deps) {
			try {
				const color = parseColor(args.color);
				const role = await deps.guild.roles.create({
					name: String(args.name ?? '').trim().slice(0, 100) || t('tools.roles.default_name'),
					...(color === null ? {} : { color }),
					...(typeof args.hoist === 'boolean' ? { hoist: args.hoist } : {}),
					...(typeof args.mentionable === 'boolean' ? { mentionable: args.mentionable } : {}),
					reason: t('tools.helpers.audit_reason'),
				});
				deps.log?.(t('tools.roles.log_created', { role: role.name }));
				return { ok: true, spoken: t('tools.roles.created', { role: role.name }), data: { id: role.id, name: role.name } };
			} catch (err) {
				return failure(deps, 'role creation failed', err, t('tools.roles.create_failed'));
			}
		},
	}),

	defineTool({
		name: 'edit_role',
		description: 'Edits an existing role: name, colour, hoist, mentionable. Owner only.',
		parameters: P.obj(
			{
				role: P.str('Role name'),
				name: P.str('New name'),
				color: P.str('New colour'),
				hoist: P.bool('Show members separately'),
				mentionable: P.bool('Allow the role to be mentioned'),
			},
			['role'],
		),
		gate: { keywords: WORDS.role },
		async handler(args, deps) {
			const role = resolveRole(deps, String(args.role ?? ''));
			if (!role) return { ok: false, spoken: t('tools.roles.role_not_found', { name: args.role }) };
			if (role.managed) return { ok: false, spoken: t('tools.roles.managed_role_edit', { role: role.name }) };
			const patch = {};
			if (args.name) patch.name = String(args.name).trim().slice(0, 100);
			const color = parseColor(args.color);
			if (color !== null) patch.color = color;
			if (typeof args.hoist === 'boolean') patch.hoist = args.hoist;
			if (typeof args.mentionable === 'boolean') patch.mentionable = args.mentionable;
			if (!Object.keys(patch).length) return { ok: false, spoken: t('tools.roles.nothing_to_change') };
			try {
				await role.edit({ ...patch, reason: t('tools.helpers.audit_reason') });
				deps.log?.(t('tools.roles.log_edited', { role: role.name }));
				return { ok: true, spoken: t('tools.roles.edited', { role: role.name }), data: { id: role.id, changes: patch } };
			} catch (err) {
				return failure(deps, 'role edit failed', err, t('tools.roles.edit_failed'));
			}
		},
	}),

	defineTool({
		name: 'delete_role',
		description: 'Deletes a role. Owner only; two-step (asks first, deletes with confirm:true).',
		parameters: P.obj({ role: P.str('Role name'), reason: P.str('Reason (optional)'), confirm: P.confirm() }, ['role']),
		gate: { keywords: WORDS.role },
		async handler(args, deps, { name }) {
			const role = resolveRole(deps, String(args.role ?? ''));
			if (!role) return { ok: false, spoken: t('tools.roles.role_not_found', { name: args.role }) };
			if (role.managed) return { ok: false, spoken: t('tools.roles.managed_role_delete', { role: role.name }) };
			const decision = checkConfirmation(deps, {
				key: name,
				target: role.id,
				confirm: args.confirm,
				question: t('tools.roles.delete_question', { role: role.name }),
			});
			if (decision.ask) return askConfirmation(decision.ask, { role: role.name });
			if (decision.stale) return STALE_CONFIRMATION();
			try {
				const roleName = role.name;
				await role.delete(args.reason ? String(args.reason).slice(0, 400) : t('tools.helpers.audit_reason'));
				deps.log?.(t('tools.roles.log_deleted', { role: roleName }));
				return { ok: true, spoken: t('tools.roles.deleted', { role: roleName }), data: { name: roleName } };
			} catch (err) {
				return failure(deps, 'role deletion failed', err, t('tools.roles.delete_failed'));
			}
		},
	}),

	defineTool({
		name: 'list_roles',
		description: 'Lists the roles on the server.',
		async handler(args, deps) {
			const roles = [...deps.guild.roles.cache.values()]
				.filter((role) => role.name !== '@everyone')
				.sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
				.map((role) => role.name);
			deps.log?.(t('tools.roles.log_listed', { count: roles.length, sample: roles.slice(0, 10).join(', ') }));
			return {
				ok: true,
				spoken: roles.length ? t('tools.roles.list', { roles: roles.slice(0, 25).join(', ') }) : t('tools.roles.list_empty'),
				data: { roles },
			};
		},
	}),
];
