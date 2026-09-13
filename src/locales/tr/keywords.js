// keywords strings (tr). Keys are referenced as "keywords.<key>" through src/i18n.
//
// This namespace holds the speech-matching language data: the owner-gate keyword table, mention and
// permission vocabularies, colour names and audit-log labels. The gate compares these words against
// what was actually heard, so they must be real words of THIS locale, not translations of the keys.
export default {
	// Spoken ways of saying "do not put this channel in any category" (edit_channel parent).
	no_category_words: ['yok', 'kategorisiz', 'hicbiri', 'kategori disi', 'disari', 'en ust', 'ust seviye', 'bagimsiz'],
	// Spoken and written spellings of on/off, beyond the universal 1/0/true/false/yes/no set.
	bool_true: ['evet', 'acik', 'açık', 'ac', 'aç', 'aktif', 'tamam', 'olur'],
	bool_false: ['hayir', 'hayır', 'kapali', 'kapalı', 'kapat', 'kapa', 'pasif', 'yok'],
	// Owner-gate keywords: for an admin tool to run, the owner must have said one of these words.
	// An entry of three letters or more matches as a prefix ("ban" also matches "banned"); an entry
	// written as "=word" must match exactly. Everyday words that would otherwise match a large part of
	// ordinary speech are pinned to exact matches, so "the owner said the command word" stays meaningful.
	words: {
		ban: ['ban', 'banla', 'unban', 'yasak', 'yasakla', 'kaldir', 'affet'],
		kick: ['kick', 'at', 'kov'],
		timeout: ['timeout', 'sustur', 'mute'],
		role: ['rol', 'yetki'],
		voice: ['ses', 'sesini', 'voice', 'mikrofon', 'mute'],
		setting: ['ayar', 'setting', 'mod', 'modu', 'modunu'],
		delete: ['sil', 'temizle', 'kaldir'],
		channel: ['kanal', 'oda', 'kategori', 'kilit', 'kilitle'],
		name: ['nick', 'nickname', 'isim', 'takma', 'adi', 'adini'],
		invite: ['davet', 'invite', 'link'],
		log: ['log', 'kayit', 'denetim'],
		move: ['tasi', 'getir', 'surukle', 'gecir', 'gecin', 'gecsin', 'gotur', 'gonder', 'gitsin', 'gidin', 'gidelim', '=cek', '=al', '=at', '=gec', '=git'],
		everyone: ['herkes', 'herkesi', 'everyone', 'here', 'buradakiler', 'etiketle', 'duyuru'],
		forget: ['unut', 'sil', 'forget'],
		record: ['kayit', 'kaydi', 'dokum', 'gizlilik'],
		bot: ['bot', 'botu', 'botuna', 'botla', 'robot'],
		permission: [
			'yetki', 'izin', 'erisim', 'kanal', 'oda', 'kilit', 'baglan', 'girebil', 'giremes', 'girsin', 'girmesin',
			'gorebil', 'goremes', 'gorsun', 'gormesin', 'yazabil', 'yazamas', 'yazsin', 'yazmasin', 'konusabil', 'konusamas',
		],
	},

	// Mention resolution: names that mean the whole channel rather than one member.
	everyone_mention_words: ['everyone', 'herkes', 'everyone.', 'tümü', 'tumu'],
	here_mention_words: ['here', 'burada', 'buradakiler'],
	// Extra spellings fed to the name -> mention replacement, so "@everyone" is not written twice.
	everyone_mention_variants: ['everyone', 'herkes'],
	here_mention_variants: ['here', 'buradakiler'],

	// Relative voice-channel targets ("the room below") and which of them mean "upwards".
	relative_target_words: ['alt', 'aşağıdaki', 'asagidaki', 'alt oda', 'alt kanal', 'üst', 'ust', 'yukarıdaki', 'yukaridaki', 'üst oda', 'üst kanal'],
	relative_up_words: ['üst', 'ust', 'yukar'],

	// Spoken colour names -> colour value, used when creating or editing a role.
	color_names: {
		kirmizi: 0xed4245,
		mavi: 0x3498db,
		yesil: 0x57f287,
		sari: 0xfee75c,
		mor: 0x9b59b6,
		turuncu: 0xe67e22,
		pembe: 0xeb459e,
		beyaz: 0xffffff,
		siyah: 0x000000,
		gri: 0x95a5a6,
	},

	// Audit-log entries: Discord enum name -> readable label.
	audit_actions: {
		MemberBanAdd: 'banlama',
		MemberBanRemove: 'ban kaldırma',
		MemberKick: 'atma (kick)',
		MemberMove: 'sesli kanal taşıma',
		MemberDisconnect: 'sesli kanaldan atma',
		MemberUpdate: 'üye güncelleme',
		MemberRoleUpdate: 'rol değişikliği',
		MemberTimeout: 'susturma (timeout)',
		MessageDelete: 'mesaj silme',
		MessageBulkDelete: 'toplu mesaj silme',
		MessagePin: 'mesaj sabitleme',
		MessageUnpin: 'sabitlemeyi kaldırma',
		ChannelCreate: 'kanal açma',
		ChannelUpdate: 'kanal güncelleme',
		ChannelDelete: 'kanal silme',
		RoleCreate: 'rol oluşturma',
		RoleUpdate: 'rol güncelleme',
		RoleDelete: 'rol silme',
		InviteCreate: 'davet oluşturma',
		InviteDelete: 'davet silme',
	},

	// Channel permissions: the "everyone" target of a permission change.
	permission_everyone_words: ['herkes', 'herkese', 'everyone', 'here', 'hepsi', 'tum uyeler', 'butun uyeler', 'default', 'varsayilan'],

	// Permission names that can be said out loud -> discord.js PermissionFlagsBits key. Dangerous,
	// server-wide permissions (Administrator, ManageRoles, ManageGuild, ManageWebhooks, Ban/Kick) are
	// deliberately absent: they cannot be handed out by voice.
	permission_aliases: {
		ViewChannel: ['gor', 'gorme', 'goruntule', 'goruntuleme', 'goster', 'gorsun', 'gorunur', 'gorunurluk', 'view', 'view channel', 'see'],
		Connect: ['baglan', 'baglanma', 'baglansin', 'baglanti', 'gir', 'giris', 'girme', 'girsin', 'katil', 'katilma', 'connect', 'join'],
		Speak: ['konus', 'konusma', 'konussun', 'speak', 'ses', 'mikrofon'],
		SendMessages: ['yaz', 'yazma', 'yazsin', 'mesaj', 'mesaj gonder', 'mesaj gonderme', 'mesaj yaz', 'send', 'send messages'],
		ReadMessageHistory: ['gecmis', 'gecmisi oku', 'mesaj gecmisi', 'read message history', 'history'],
		AttachFiles: ['dosya', 'dosya ekle', 'dosya gonder', 'attach', 'attach files'],
		EmbedLinks: ['link', 'link ekle', 'embed', 'embed links'],
		AddReactions: ['tepki', 'tepki ver', 'emoji tepki', 'reaction', 'add reactions'],
		Stream: ['yayin', 'yayin ac', 'ekran paylas', 'ekran paylasimi', 'kamera', 'video', 'stream'],
		UseVAD: ['ses aktivitesi', 'vad', 'use vad'],
		PrioritySpeaker: ['oncelikli konusmaci', 'priority speaker'],
		MuteMembers: ['sustur', 'susturma', 'mute', 'mute members'],
		DeafenMembers: ['sagirlastir', 'deafen', 'deafen members'],
		MoveMembers: ['tasi', 'tasima', 'move', 'move members'],
		ManageMessages: ['mesaj yonet', 'mesajlari yonet', 'mesaj sil', 'manage messages'],
		ManageChannels: ['kanal yonet', 'kanali yonet', 'kanal duzenle', 'manage channels', 'manage channel'],
		MentionEveryone: ['herkesi etiketle', 'everyone etiketle', 'mention everyone'],
		CreatePublicThreads: ['alt baslik', 'thread', 'thread ac', 'konu ac', 'create public threads'],
		SendMessagesInThreads: ['thread yaz', 'send messages in threads'],
		UseApplicationCommands: ['komut', 'slash', 'slash komut', 'use application commands'],
		UseExternalEmojis: ['dis emoji', 'external emojis', 'use external emojis'],
		CreateInstantInvite: ['davet', 'davet olustur', 'create instant invite', 'invite'],
	},
	// Groups: one word, several permissions.
	permission_groups: {
		erisim: ['ViewChannel', 'Connect', 'SendMessages'],
		access: ['ViewChannel', 'Connect', 'SendMessages'],
		giris: ['ViewChannel', 'Connect'],
	},
	// Spoken labels for a permission, used when reading a permission change back out loud.
	permission_labels: {
		ViewChannel: 'görme',
		Connect: 'bağlanma',
		Speak: 'konuşma',
		SendMessages: 'yazma',
		ReadMessageHistory: 'geçmişi okuma',
		AttachFiles: 'dosya ekleme',
		EmbedLinks: 'link ekleme',
		AddReactions: 'tepki verme',
		Stream: 'yayın açma',
		UseVAD: 'ses aktivitesi',
		PrioritySpeaker: 'öncelikli konuşma',
		MuteMembers: 'susturma',
		DeafenMembers: 'sağırlaştırma',
		MoveMembers: 'taşıma',
		ManageMessages: 'mesaj yönetme',
		ManageChannels: 'kanal yönetme',
		MentionEveryone: 'herkesi etiketleme',
		CreatePublicThreads: 'thread açma',
		SendMessagesInThreads: "thread'e yazma",
		UseApplicationCommands: 'slash komut',
		UseExternalEmojis: 'dış emoji',
		CreateInstantInvite: 'davet oluşturma',
	},
	permission_help: 'gör, bağlan, konuş, yaz, geçmiş, dosya, link, tepki, yayın, sustur, taşı, mesaj yönet, kanal yönet, davet, erişim (= gör + bağlan + yaz)',
};
