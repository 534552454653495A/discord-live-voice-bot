// The bot's own face: its nickname on this server, its avatar, banner and "about me", and the status
// line people see under its name. Everything here changes how the bot itself looks, never anybody else.
//
// Scope note: the nickname is per server (a member property), while the avatar, banner and description
// belong to the application and are therefore the same everywhere the bot is.

import { ActivityType } from 'discord.js';
import { t, tList, tRaw } from '../i18n/index.js';
import { WORDS, failure } from './helpers.js';
import { P, defineTool } from './registry.js';

// Pictures are fetched by Discord itself from a link we pass on, so the link has to be one Discord
// serves. A spoken URL is untrusted, and this is the same restriction the emoji and server tools use.
const CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

/** A picture link we are willing to hand to Discord, or null. */
function cdnImage(value) {
	const text = String(value ?? '').trim();
	if (!text) return null;
	let url;
	try {
		url = new URL(text);
	} catch {
		return null;
	}
	return url.protocol === 'https:' && CDN_HOSTS.has(url.hostname) ? url.toString() : null;
}

/** The four presence states Discord accepts, spoken in either language. */
function resolveStatus(value) {
	const key = String(value ?? '').trim().toLowerCase();
	if (!key) return null;
	const table = tRaw('keywords.presence_status') ?? {};
	for (const [status, words] of Object.entries(table)) {
		if (status === key || (Array.isArray(words) && words.some((word) => String(word).toLowerCase() === key))) return status;
	}
	return null;
}

/** "playing", "listening", "watching"… -> the ActivityType the gateway wants. */
function resolveActivityType(value) {
	const key = String(value ?? '').trim().toLowerCase();
	const table = tRaw('keywords.presence_activity') ?? {};
	for (const [name, words] of Object.entries(table)) {
		if (name === key || (Array.isArray(words) && words.some((word) => String(word).toLowerCase() === key))) {
			return ActivityType[name[0].toUpperCase() + name.slice(1)] ?? ActivityType.Playing;
		}
	}
	return ActivityType.Playing;
}

function selfMember(deps) {
	return deps.guild?.members?.me ?? null;
}

export const tools = [
	defineTool({
		name: 'set_bot_nickname',
		description:
			'Changes the nickname the bot itself carries on this server, or clears it. This is only the bot; use ' +
			'set_nickname for anybody else. Owner only.',
		parameters: P.obj({ nickname: P.str('The new nickname; leave empty to go back to the plain name') }),
		gate: { keywords: WORDS.identity },
		async handler(args, deps) {
			const me = selfMember(deps);
			if (!me) return { ok: false, spoken: t('tools.identity.no_self_member') };
			const nickname = args.nickname ? String(args.nickname).trim().slice(0, 32) : null;
			try {
				await me.setNickname(nickname, t('tools.helpers.audit_reason'));
				deps.log?.(t('tools.identity.log_nickname', { nickname: nickname ?? t('tools.identity.nickname_cleared_log') }));
				return {
					ok: true,
					spoken: nickname ? t('tools.identity.nickname_set', { nickname }) : t('tools.identity.nickname_cleared'),
					data: { nickname },
				};
			} catch (err) {
				return failure(deps, 'bot nickname change failed', err, t('tools.identity.nickname_failed'));
			}
		},
	}),

	defineTool({
		name: 'set_bot_appearance',
		description:
			'Changes how the bot looks everywhere: its avatar, its profile banner and its "about me" text. Pictures must ' +
			'be links Discord itself serves (cdn.discordapp.com / media.discordapp.net), so post the picture in a channel ' +
			'first and use that link. Owner only.',
		parameters: P.obj({
			avatar_url: P.str('Link to the new avatar on Discord; the word for "none" clears it'),
			banner_url: P.str('Link to the new profile banner on Discord; the word for "none" clears it'),
			about: P.str('The "about me" text on the bot profile, up to 400 characters'),
		}),
		gate: { keywords: WORDS.identity },
		async handler(args, deps) {
			const client = deps.client ?? deps.guild?.client ?? null;
			if (!client?.user) return { ok: false, spoken: t('tools.identity.no_client') };
			const clears = tList('keywords.no_picture_words');
			const wants = (value) => value !== undefined && value !== null && String(value).trim() !== '';
			const done = [];
			try {
				for (const [key, field] of [
					['avatar_url', 'setAvatar'],
					['banner_url', 'setBanner'],
				]) {
					if (!wants(args[key])) continue;
					const raw = String(args[key]).trim();
					if (clears.includes(raw.toLowerCase())) {
						await client.user[field](null);
						done.push(t(`tools.identity.part_${field === 'setAvatar' ? 'avatar' : 'banner'}_cleared`));
						continue;
					}
					const link = cdnImage(raw);
					if (!link) return { ok: false, spoken: t('tools.identity.not_a_discord_picture') };
					await client.user[field](link);
					done.push(t(`tools.identity.part_${field === 'setAvatar' ? 'avatar' : 'banner'}_set`));
				}
				if (wants(args.about)) {
					const application = client.application ?? null;
					if (!application?.edit) return { ok: false, spoken: t('tools.identity.no_application') };
					await application.edit({ description: String(args.about).trim().slice(0, 400) });
					done.push(t('tools.identity.part_about_set'));
				}
				if (!done.length) return { ok: false, spoken: t('tools.identity.nothing_to_change') };
				deps.log?.(t('tools.identity.log_appearance', { parts: done.join(', ') }));
				return { ok: true, spoken: t('tools.identity.appearance_set', { parts: done.join(', ') }), data: { changed: done.length } };
			} catch (err) {
				// Discord rate-limits avatar and banner changes hard; say that rather than a bare failure.
				return failure(deps, 'bot appearance change failed', err, t('tools.identity.appearance_failed'));
			}
		},
	}),

	defineTool({
		name: 'set_bot_status',
		description:
			'Sets the line under the bot\'s name and its online state: activity_type is playing, listening, watching, ' +
			'competing or streaming, text is what follows it, and status is online, idle, do not disturb or invisible. ' +
			'Leave text empty to clear the line. While music is playing the bot shows the track by itself, and this ' +
			'setting comes back when the music stops. Owner only.',
		parameters: P.obj({
			text: P.str('What the line says, e.g. "with the cat"; empty clears it'),
			activity_type: P.str('playing | listening | watching | competing | streaming'),
			status: P.str('online | idle | dnd | invisible'),
		}),
		gate: { keywords: WORDS.identity },
		async handler(args, deps) {
			const client = deps.client ?? deps.guild?.client ?? null;
			if (!client?.user) return { ok: false, spoken: t('tools.identity.no_client') };
			const status = resolveStatus(args.status);
			if (args.status && !status) return { ok: false, spoken: t('tools.identity.unknown_status', { value: args.status }) };
			const text = args.text === undefined || args.text === null ? null : String(args.text).trim().slice(0, 128);
			const type = resolveActivityType(args.activity_type);
			try {
				// Remembered on the session so the music player can put it back when a track ends.
				deps.setDefaultPresence?.({ text, type, status });
				const activities = text ? [{ name: text, type }] : [];
				client.user.setPresence({ activities, status: status ?? 'online' });
				deps.log?.(t('tools.identity.log_status', { text: text ?? t('tools.identity.status_cleared_log'), status: status ?? 'online' }));
				return {
					ok: true,
					spoken: text ? t('tools.identity.status_set', { text }) : t('tools.identity.status_cleared'),
					data: { text, type, status: status ?? 'online' },
				};
			} catch (err) {
				return failure(deps, 'bot status change failed', err, t('tools.identity.status_failed'));
			}
		},
	}),

	defineTool({
		name: 'bot_profile',
		description: 'Says how the bot currently looks: its nickname here, its status line and whether it has an avatar and a banner.',
		async handler(args, deps) {
			const client = deps.client ?? deps.guild?.client ?? null;
			const me = selfMember(deps);
			const presence = deps.defaultPresence?.() ?? null;
			return {
				ok: true,
				spoken: t('tools.identity.profile', {
					name: me?.displayName ?? client?.user?.username ?? '?',
					nickname: me?.nickname ?? t('tools.identity.no_nickname'),
					status: presence?.text ?? t('tools.identity.no_status'),
				}),
				data: {
					username: client?.user?.username ?? null,
					nickname: me?.nickname ?? null,
					avatar: Boolean(client?.user?.avatar),
					banner: Boolean(client?.user?.banner),
					presence,
				},
			};
		},
	}),
];
