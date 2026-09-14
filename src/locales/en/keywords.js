// keywords strings (en). Keys are referenced as "keywords.<key>" through src/i18n.
//
// This namespace holds the speech-matching language data: the owner-gate keyword table, mention and
// permission vocabularies, colour names and audit-log labels. The gate compares these words against
// what was actually heard, so they must be real words of THIS locale, not translations of the keys.
export default {
	// Ways of saying "the private conversation we just had" (delete_messages / edit_message dm argument).
	last_dm_words: ['last', 'the last one', 'that one', 'it', 'latest', 'previous'],
	// How the bot's own status line and online state may be spoken (src/tools/identity.js).
	presence_status: {
		online: ['online', 'active', 'available'],
		idle: ['idle', 'away'],
		dnd: ['dnd', 'do not disturb', 'busy'],
		invisible: ['invisible', 'offline', 'hidden'],
	},
	presence_activity: {
		playing: ['playing', 'play'],
		listening: ['listening', 'listen'],
		watching: ['watching', 'watch'],
		competing: ['competing', 'compete'],
		streaming: ['streaming', 'stream'],
	},
	no_picture_words: ['none', 'no picture', 'remove', 'clear', 'off'],
	// Spoken ways of saying "do not put this channel in any category" (edit_channel parent).
	no_category_words: ['none', 'no category', 'nowhere', 'root', 'top level', 'uncategorised', 'uncategorized', 'outside'],
	// Spoken and written spellings of on/off, beyond the universal 1/0/true/false/yes/no set.
	bool_true: ['ok', 'okay', 'yep', 'yeah', 'active', 'up'],
	bool_false: ['nope', 'nah', 'inactive', 'stop', 'down'],
	// Which tails a "=stem" gate keyword may pick up before it stops being that word. An English command
	// is an imperative and hardly inflects, so only the third-person "s" is allowed: "takes" is still
	// "take", while "taking" and "taken" are ordinary speech and must not open the gate.
	inflection: { pattern: '^(?:s|es)?$', flags: 'u' },
	// Owner-gate keywords: for an admin tool to run, the owner must have said one of these words.
	// Matching is prefix based for words of 3+ letters ("ban" also matches "banned"), so stems are enough.
	// An entry of three letters or more matches as a prefix ("ban" also matches "banned"); an entry
	// written as "=word" must match exactly. Everyday words that would otherwise match a large part of
	// ordinary speech are pinned to exact matches, so "the owner said the command word" stays meaningful.
	words: {
		ban: ['ban', 'banned', 'unban', 'blacklist', 'forbid', 'pardon', 'forgive'],
		kick: ['kick', 'kicked', 'boot', 'eject'],
		timeout: ['timeout', 'mute', 'silence'],
		role: ['role', 'rank', 'permission'],
		voice: ['voice', 'mic', 'microphone', 'mute', 'sound'],
		setting: ['setting', 'mode', 'config', 'option'],
		delete: ['delete', 'remove', 'clear', 'purge', 'wipe', 'clean'],
		channel: ['channel', 'room', 'category', 'lock', 'unlock'],
		name: ['nickname', 'nick', 'rename', '=name'],
		invite: ['invite', 'invitation', 'link'],
		log: ['log', 'audit', 'record', 'history'],
		move: [
			'move', 'relocate', 'transfer', 'drag', 'gather', 'summon', '=bring', '=pull', '=take', '=send',
			'=come', '=join', '=fetch', '=put', '=shift', '=haul',
		],
		everyone: ['everyone', 'everybody', 'here', 'ping', 'tag', 'mention', 'announce'],
		forget: ['forget', 'delete', 'remove', 'drop'],
		record: ['record', 'transcript', 'privacy'],
		bot: ['bot', 'use bot', 'bot command', 'robot'],
		thread: ['thread', 'threads', 'subthread', 'discussion'],
		pin: ['pin', 'pinned', 'unpin', 'sticky'],
		reaction: ['reaction', 'react', 'reacted'],
		emoji: ['emoji', 'emote', 'sticker', 'expression'],
		event: ['event', 'schedule', 'scheduled'],
		automod: ['automod', 'automoderation', 'filter', 'rule'],
		webhook: ['webhook', 'hook'],
		server: ['server', 'guild', 'prune', 'vanity', 'widget', 'banner'],
		identity: [
			'avatar', 'banner', 'profile', 'nickname', 'status', 'presence', 'playing', 'appearance', 'picture',
			'bio', 'about', 'rename', 'username', '=name',
		],
		permission: [
			'permission', 'perm', 'access', 'channel', 'room', 'connect', '=lock', '=join', '=enter', '=view', '=see',
			'=read', '=write', '=send', '=speak', '=talk', '=allow', '=deny', '=block', '=only',
		],
	},

	// Mention resolution: names that mean the whole channel rather than one member.
	everyone_mention_words: ['everyone', 'everybody', 'all', 'all members'],
	here_mention_words: ['here', 'present', 'online'],
	// Extra spellings fed to the name -> mention replacement, so "@everyone" is not written twice.
	everyone_mention_variants: ['everyone', 'everybody'],
	here_mention_variants: ['here'],

	// Relative voice-channel targets ("the room below") and which of them mean "upwards".
	relative_target_words: ['down', 'below', 'lower', 'down channel', 'lower channel', 'up', 'above', 'upper', 'up channel', 'upper channel'],
	relative_up_words: ['up', 'above', 'upper'],

	// Spoken colour names -> colour value, used when creating or editing a role.
	color_names: {
		red: 0xed4245,
		blue: 0x3498db,
		green: 0x57f287,
		yellow: 0xfee75c,
		purple: 0x9b59b6,
		orange: 0xe67e22,
		pink: 0xeb459e,
		white: 0xffffff,
		black: 0x000000,
		grey: 0x95a5a6,
		gray: 0x95a5a6,
	},

	// Audit-log entries: Discord enum name -> readable label.
	audit_actions: {
		MemberBanAdd: 'ban',
		MemberBanRemove: 'unban',
		MemberKick: 'kick',
		MemberMove: 'voice channel move',
		MemberDisconnect: 'voice disconnect',
		MemberUpdate: 'member update',
		MemberRoleUpdate: 'role change',
		MemberTimeout: 'timeout',
		MessageDelete: 'message delete',
		MessageBulkDelete: 'bulk message delete',
		MessagePin: 'message pin',
		MessageUnpin: 'message unpin',
		ChannelCreate: 'channel create',
		ChannelUpdate: 'channel update',
		ChannelDelete: 'channel delete',
		RoleCreate: 'role create',
		RoleUpdate: 'role update',
		RoleDelete: 'role delete',
		InviteCreate: 'invite create',
		InviteDelete: 'invite delete',
	},

	// Channel permissions: the "everyone" target of a permission change.
	permission_everyone_words: ['everyone', 'everybody', 'here', 'all', 'all members', 'default'],

	// Permission names that can be said out loud -> discord.js PermissionFlagsBits key. Dangerous,
	// server-wide permissions (Administrator, ManageRoles, ManageGuild, ManageWebhooks, Ban/Kick) are
	// deliberately absent: they cannot be handed out by voice.
	permission_aliases: {
		ViewChannel: ['see', 'view', 'visible', 'visibility', 'show', 'look', 'view channel', 'read channel'],
		Connect: ['connect', 'connection', 'join', 'enter', 'access voice'],
		Speak: ['speak', 'talk', 'voice', 'mic', 'microphone'],
		SendMessages: ['write', 'send', 'message', 'send message', 'send messages', 'chat', 'post', 'type'],
		ReadMessageHistory: ['history', 'read history', 'message history', 'read message history', 'past messages'],
		AttachFiles: ['file', 'files', 'attach', 'attach files', 'upload', 'send files'],
		EmbedLinks: ['link', 'links', 'embed', 'embed links'],
		AddReactions: ['reaction', 'reactions', 'react', 'add reactions', 'emoji reaction'],
		Stream: ['stream', 'go live', 'screen share', 'screenshare', 'camera', 'video'],
		UseVAD: ['voice activity', 'vad', 'use vad'],
		PrioritySpeaker: ['priority', 'priority speaker'],
		MuteMembers: ['mute', 'mute members', 'silence members'],
		DeafenMembers: ['deafen', 'deafen members'],
		MoveMembers: ['move', 'move members', 'drag members'],
		ManageMessages: ['manage messages', 'manage message', 'delete messages', 'moderate messages'],
		ManageChannels: ['manage channels', 'manage channel', 'edit channel'],
		MentionEveryone: ['mention everyone', 'ping everyone', 'tag everyone'],
		CreatePublicThreads: ['thread', 'threads', 'start thread', 'create thread', 'create public threads'],
		SendMessagesInThreads: ['write in threads', 'reply in threads', 'send messages in threads'],
		UseApplicationCommands: ['command', 'commands', 'slash', 'slash command', 'use application commands'],
		UseExternalEmojis: ['external emoji', 'external emojis', 'use external emojis'],
		CreateInstantInvite: ['invite', 'invitation', 'create invite', 'create instant invite'],
	},
	// Groups: one word, several permissions.
	permission_groups: {
		access: ['ViewChannel', 'Connect', 'SendMessages'],
		entry: ['ViewChannel', 'Connect'],
	},
	// Spoken labels for a permission, used when reading a permission change back out loud.
	permission_labels: {
		ViewChannel: 'view',
		Connect: 'connect',
		Speak: 'speak',
		SendMessages: 'write',
		ReadMessageHistory: 'read history',
		AttachFiles: 'attach files',
		EmbedLinks: 'embed links',
		AddReactions: 'add reactions',
		Stream: 'stream',
		UseVAD: 'voice activity',
		PrioritySpeaker: 'priority speaker',
		MuteMembers: 'mute',
		DeafenMembers: 'deafen',
		MoveMembers: 'move',
		ManageMessages: 'manage messages',
		ManageChannels: 'manage channels',
		MentionEveryone: 'mention everyone',
		CreatePublicThreads: 'create threads',
		SendMessagesInThreads: 'write in threads',
		UseApplicationCommands: 'slash commands',
		UseExternalEmojis: 'external emojis',
		CreateInstantInvite: 'create invites',
	},
	permission_help: 'see, connect, speak, write, history, files, links, reactions, stream, mute, move, manage messages, manage channels, invite, access (= see + connect + write)',
};
