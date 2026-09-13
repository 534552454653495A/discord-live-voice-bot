// Strings for src/tools/helpers.js (tr). Referenced as "tools.helpers.<key>".
// Also covers the shared tool plumbing in src/tools/index.js and src/tools/registry.js.
export default {
	gate_transcript_missing: 'Bunu henüz net duymadım; tekrar söyle, hemen yapayım.',
	gate_reason_transcript_missing: 'bu turun dökümü gelmemişti',
	audit_reason: 'sesli komut',
	stale_confirmation: 'Onayı eşleştiremedim (hedef değişmiş ya da 30 sn geçmiş). Tekrar söyle, yeniden sorayım.',
	confirm_prompt: '{question} Onaylıyorsan "onayla" de ve aynı hedefi tekrar söyle.',

	// members / mentions / emojis / stickers
	someone: 'kişi',
	log_member_fuzzy: '[araç] "{name}" tam eşleşmedi; benzer kişi seçildi: {display}',
	log_member_not_found: '[araç] "{name}" diye üye bulunamadı.',
	mention_not_found: '"{name}" diye üye/rol bulunamadı',
	emoji_missing: '"{name}" emojisi sunucuda yok',
	sticker_missing: '"{name}" çıkartması sunucuda yok',

	// dates and audit-log entries
	date_locale: 'tr-TR',
	date_unknown: 'bilinmiyor',
	audit_action_unknown: 'işlem {action}',

	// Discord API errors, keyed by error code; each one is read out as the reason for a failure.
	discord_errors: {
		10003: 'kanal bulunamadı',
		10007: 'üye bulunamadı',
		10008: 'mesaj bulunamadı',
		10011: 'rol bulunamadı',
		10013: 'kullanıcı bulunamadı',
		50001: 'bu kanala erişimim yok',
		50007: 'kişinin DM kutusu kapalı',
		50013: 'iznim yetmiyor',
		50021: 'sistem mesajına bu yapılamaz',
		50024: 'bu kanal türünde yapılamaz',
		50034: '14 günden eski mesajlar toplu silinemez',
		50035: 'Discord isteği reddetti (alan geçersiz)',
		50074: 'bu kanal silinemez (topluluk kanalı)',
		60003: 'iki aşamalı doğrulama gerekiyor',
		429: 'Discord hız sınırına takıldım, biraz bekle',
	},
	error_unknown: 'bilinmeyen hata',
	log_failure: '[araç] {label}: {error}',
	failure_spoken: '{prefix} ({reason}).',

	// owner gate
	gate_default_tool: 'yönetici',
	log_gate_denied: '[kapı] {tool}: reddedildi ({reason})',
	log_gate_allowed: '[kapı] {tool}: izin verildi — {detail}{tail}',
	log_gate_tail: ' (metin: "{text}")',
	gate_denied_activity: '{tool}: reddedildi ({reason})',
	gate_allowed_activity: '{tool}: izin verildi — {detail}',
	gate_disabled: 'Yönetici komutları bu kurulumda kapalı.',
	gate_reason_disabled: 'kapalı',
	gate_not_heard: 'Bu komutu sahibin kendisinin söylediğini duymadım; sahip tekrar söylerse yaparım.',
	gate_reason_not_said: 'sahip kelimeyi söylemedi',
	gate_overlap: 'Senin üstüne konuşuldu, o sesin senin olduğundan emin olamıyorum. Ortalık sakinleyince tekrar söyle.',
	gate_reason_overlap: 'sahip ve bir başkası aynı anda konuştu',
	gate_not_owner: 'Bunu yalnızca bot sahibi söyleyebilir; bunu isteyen o değildi.',
	gate_reason_not_owner: 'komutu söyleyen sahip değil',
	gate_reason_who: ' ({who})',
	gate_interrupted: 'Sahibin isteğinden sonra araya başkası girdi; emin olmak için sahip tekrar söylesin.',
	gate_reason_interrupted: 'sahipten sonra {who} konuştu: "{text}"',
	gate_someone_else: 'başkası',
	gate_detail_owner_said: 'komutu sahip söyledi ("{word}")',
	gate_owner_not_active: 'Bunu yalnızca bot sahibi söyleyebilir; şu an onu duymuyorum.',
	gate_reason_last_not_owner: 'son konuşan sahip değil',
	gate_detail_last_owner: 'son konuşan sahip, kelime kontrolü yok',
	gate_unsure: 'Bu komutu sahibin kendisinin söylediğinden emin olamadım; sahip tekrar söylerse yaparım.',
	gate_detail_owner_word: 'son konuşan sahip, sahip "{word}" dedi',

	// tool dispatch (src/tools/index.js)
	unknown_tool: 'Bilinmeyen araç: {name}',
	log_tool_error: '[araç] {name} beklenmedik hata: {error}',
	tool_error: '{name} çalışırken bir hata oldu: {error}',
};
