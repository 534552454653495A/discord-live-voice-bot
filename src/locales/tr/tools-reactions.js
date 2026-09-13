// Strings for src/tools/reactions.js (tr). Referenced as "tools.reactions.<key>".
export default {
	// ortak: hedef kanal, hedef mesaj, emoji
	channel_not_found: '"{name}" kanalını bulamadım.',
	no_channel: 'O mesaj hangi kanalda?',
	not_text_channel: '#{channel} kanalında mesaj yok — orası bir metin kanalı değil.',
	message_id_not_found: '#{channel} kanalında {id} numaralı mesaj yok.',
	message_not_found: '#{channel} kanalında öyle bir mesaj bulamadım.',
	read_failed: '#{channel} kanalındaki mesajları okuyamadım.',
	which_emoji: 'Hangi emojiyi kullanayım?',
	emoji_not_found: 'Bu sunucuda "{name}" diye bir emoji yok.',
	member_not_found: '"{name}" diye birini bulamadım.',
	empty_message: '(yazı yok)',

	// add_reaction
	no_add_reactions: '#{channel} kanalında tepki verebilmem için "Tepki Ekle" yetkisi lazım.',
	reacted: '{who} kişisinin mesajına {emoji} ile tepki verdim.',
	react_failed: 'Tepkiyi ekleyemedim',
	log_reacted: '[araç] tepki eklendi: {emoji} — #{channel}',

	// remove_reaction
	need_manage_messages: '#{channel} kanalında "Mesajları Yönet" yetkisi lazım; başkasının tepkisini ancak onunla kaldırabiliyorum.',
	no_such_reaction: 'O mesajda {emoji} tepkisi yok.',
	not_my_reaction: 'O mesaja {emoji} ile tepki vermemişim.',
	removed_own: '{emoji} tepkimi geri aldım.',
	removed_other: '{who} kişisinin {emoji} tepkisini kaldırdım.',
	remove_failed: 'Tepkiyi kaldıramadım',
	log_removed_own: '[araç] kendi tepkim kaldırıldı: {emoji} — #{channel}',
	log_removed_other: '[araç] tepki kaldırıldı: {who} / {emoji} — #{channel}',

	// clear_reactions
	no_reactions: 'O mesajda hiç tepki yok.',
	everything: 'bütün tepkiler',
	clear_question_all: '#{channel} kanalındaki o mesajın bütün tepkilerini sileceğim; tepki verenlere bir daha sorulmayacak.',
	clear_question_emoji: '#{channel} kanalındaki o mesajdan bütün {emoji} tepkilerini kaldıracağım.',
	cleared_all: 'O mesajdaki bütün tepkileri sildim (toplam {count} tane).',
	cleared_emoji: 'O mesajdan {count} tane {emoji} tepkisini kaldırdım.',
	clear_failed: 'Tepkileri temizleyemedim',
	log_cleared: '[araç] tepkiler temizlendi: {what} — #{channel}',

	// pin_message
	need_pin_messages: '#{channel} kanalında sabitleme yapabilmem için "Mesaj Sabitle" yetkisi lazım.',
	already_pinned: 'O mesaj #{channel} kanalında zaten sabit.',
	not_pinned: 'O mesaj sabit değil, kaldıracak bir şey yok.',
	pinned: '{who} kişisinin mesajını #{channel} kanalına sabitledim.',
	unpinned: '{who} kişisinin mesajının sabitlemesini #{channel} kanalında kaldırdım.',
	pin_failed: 'Mesajı sabitleyemedim',
	unpin_failed: 'Mesajın sabitlemesini kaldıramadım',
	log_pinned: '[araç] mesaj sabitlendi: #{channel} ({who})',
	log_unpinned: '[araç] mesaj sabitlemesi kaldırıldı: #{channel} ({who})',

	// list_pins
	need_read_history: '#{channel} kanalındaki sabitlenmiş mesajları görebilmem için "Mesaj Geçmişini Oku" yetkisi lazım.',
	no_pins: '#{channel} kanalında sabitlenmiş mesaj yok.',
	pins_list: '#{channel} kanalında {count} sabitlenmiş mesaj var: {items}.',
	pins_more: 'Daha eski sabitlenmiş mesajlar da var.',
	pin_item: '{who}: {text}',
	pins_failed: '#{channel} kanalındaki sabitlenmiş mesajları okuyamadım',
	log_pins: '[araç] sabitlenmişler listelendi: #{channel} içinde {count} tane',

	// create_poll
	no_question: 'Anket ne soracak?',
	too_few_answers: 'Ankette en az iki seçenek olmalı; bana birkaç seçenek söyle.',
	too_many_answers: 'ankette en fazla on seçenek olabiliyor, fazlasını almadım',
	need_send_polls: '#{channel} kanalında anket açabilmem için "Anket Gönder" yetkisi lazım.',
	poll_created: 'Anketi #{channel} kanalında açtım: {question} — {answers}. {hours} saat açık kalacak.',
	poll_failed: 'Anketi açamadım',
	log_poll: '[araç] anket açıldı: #{channel} — {question} ({answers} seçenek, {hours} saat)',

	// end_poll
	not_a_poll: 'O mesaj bir anket değil.',
	poll_not_mine: 'Discord anketi yalnızca sahibinin kapatmasına izin veriyor, o anket {who} kişisinin.',
	poll_already_ended: 'O anket zaten bitmiş.',
	poll_ended: 'Anketi kapattım. Sonuç: {results}.',
	poll_result_item: '{answer}: {votes}',
	no_votes: 'kimse oy vermedi',
	end_failed: 'Anketi kapatamadım',
	log_poll_ended: '[araç] anket kapatıldı: #{channel}',
};
