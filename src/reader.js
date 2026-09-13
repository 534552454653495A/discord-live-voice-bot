// Channel read tracking: at start-up the newest message of every channel is marked as "seen",
// later reads only return the new messages that arrived after it.
//
// Note: the bot being able to see other people's message content depends on the MESSAGE_CONTENT
// privileged intent (Developer Portal -> Bot -> Privileged Gateway Intents).

import { t } from './i18n/index.js';

export class ChannelReader {
	constructor({ defaultLimit = 5, maxLimit = 10 } = {}) {
		this.defaultLimit = defaultLimit;
		this.maxLimit = maxLimit;
		this.state = new Map(); // channelId -> { lastReadId, readCount }
	}

	/** Initial baseline: records the id of the channel's newest message, does not read any content. */
	async warmUp(channels) {
		for (const channel of channels) {
			try {
				const fetched = await channel.messages.fetch({ limit: 1 });
				// It may be a discord.js Collection or a Map; pick the newest message by timestamp.
				const newest = [...fetched.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];
				if (newest) {
					this.state.set(channel.id, { lastReadId: newest.id, readCount: 0 });
				}
			} catch {
				// if we cannot read the channel (no permission) skip it silently
			}
		}
	}

	/**
	 * Reads the channel.
	 * - Read before: only the new messages that came after the last one read.
	 * - Read for the first time: the last `limit` messages.
	 * @returns {Promise<{ messages: object[], isNew: boolean, firstTime: boolean }>}
	 */
	async read(channel, limit = this.defaultLimit) {
		const size = Math.min(Math.max(limit, 1), this.maxLimit);
		const state = this.state.get(channel.id);
		const after = state?.lastReadId;
		const alreadyRead = (state?.readCount ?? 0) > 0;

		if (after) {
			const fetched = await channel.messages.fetch({ limit: size, after });
			const messages = [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
			if (messages.length) {
				this.state.set(channel.id, { lastReadId: messages.at(-1).id, readCount: (state?.readCount ?? 0) + 1 });
				return { messages, isNew: true, firstTime: !alreadyRead };
			}
			if (alreadyRead) return { messages: [], isNew: false, firstTime: false };
			// the baseline was taken but this channel has never been read: read the last messages
		}

		const fetched = await channel.messages.fetch({ limit: size });
		const messages = [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
		if (messages.length) {
			this.state.set(channel.id, { lastReadId: messages.at(-1).id, readCount: (state?.readCount ?? 0) + 1 });
		}
		return { messages, isNew: false, firstTime: !alreadyRead };
	}

	/**
	 * Reads history: the channel's last `limit` messages without the baseline/new-message restriction (optionally
	 * the ones before a `before` id). It does not change the "new message" tracking; the next "what is new" still
	 * returns only the new ones.
	 */
	async readHistory(channel, { limit = this.defaultLimit, before = null, maxLimit = 20 } = {}) {
		const size = Math.min(Math.max(Number(limit) || this.defaultLimit, 1), maxLimit);
		const fetched = await channel.messages.fetch({ limit: size, ...(before ? { before } : {}) });
		const messages = [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
		return { messages, oldestId: messages[0]?.id ?? null };
	}

	/** The id of the last message read in the channel (null when there is none). */
	lastReadId(channelId) {
		return this.state.get(channelId)?.lastReadId ?? null;
	}
}

/** Turns one message into the single line handed to the model (content, files, stickers, embeds). */
export function describeMessage(message) {
	const who = message.author?.displayName ?? message.author?.username ?? t('reader.someone');
	const label = message.author?.bot ? t('reader.bot_label', { who }) : who;
	const parts = [];
	const content = String(message.content ?? '').replace(/\s+/g, ' ').trim();
	if (content) parts.push(content.slice(0, 200));
	if (message.stickers?.size) {
		parts.push(t('reader.stickers', { names: [...message.stickers.values()].map((s) => s.name).join(', ') }));
	}
	if (message.attachments?.size) parts.push(t('reader.attachments', { count: message.attachments.size }));
	if (message.embeds?.length) parts.push(t('reader.embeds', { count: message.embeds.length }));
	if (!parts.length) parts.push(t('reader.no_content'));
	return `${label}: ${parts.join(' ')}`;
}

/** Turns a message list into the text handed to the model. */
export function formatMessages(messages, channelName, { maxChars = 900, emptyHint = null } = {}) {
	if (!messages.length) return `${t('reader.no_new_messages', { channel: channelName })}${emptyHint ? ` ${emptyHint}` : ''}`;
	let body = messages.map(describeMessage).join(' | ');
	if (body.length > maxChars) body = `${body.slice(0, maxChars)}…`;
	return t('reader.messages_intro', { channel: channelName, body });
}
