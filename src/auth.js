// Authorisation layer: who counts as an "administrator"?
//  - OWNER_ID (the bot owner)
//  - the ADMIN_USER_IDS list
//  - members who hold one of the ADMIN_ROLE_IDS roles
//  - members with the "Manage Server" (ManageGuild) permission on the guild
// Slash commands, panel buttons and text-based admin actions all pass through this gate.
// (Voice admin tools additionally sit behind the "owner's voice" gate; see tools/gate.js)

import { PermissionFlagsBits } from 'discord.js';
import { t } from './i18n/index.js';

export function isPrivileged({ userId, member = null, cfg = {} }) {
	const id = userId ? String(userId) : null;
	if (!id) return false;
	if (cfg.ownerId && id === String(cfg.ownerId)) return true;
	if (Array.isArray(cfg.adminUserIds) && cfg.adminUserIds.includes(id)) return true;
	const roleCache = member?.roles?.cache;
	if (roleCache && Array.isArray(cfg.adminRoleIds) && cfg.adminRoleIds.some((roleId) => roleCache.has(roleId))) return true;
	try {
		if (member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
	} catch {
		/* partial member: no permission data */
	}
	return false;
}

/** Was this Discord interaction (slash/button/modal) made by someone privileged? */
export function interactionPrivileged(interaction, cfg) {
	return isPrivileged({ userId: interaction?.user?.id, member: interaction?.member ?? null, cfg });
}

/**
 * Short message shown to an unauthorised user. It stays an exported constant because src/commands.js
 * uses it as a plain string; the locale is picked from BOT_LANGUAGE at import time, so the value is
 * already in the right language.
 */
export const NOT_ALLOWED = t('auth.not_allowed');
