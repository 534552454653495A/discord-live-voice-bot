// Strings for src/tools/automod.js (tr). Referenced as "tools.automod.<key>".
export default {
	unavailable: 'Bu sunucunun otomatik moderasyon kurallarına erişemiyorum.',
	no_manage_guild: 'Otomatik moderasyon kurallarına dokunmak için "Sunucuyu Yönet" yetkisi lazım; rolüme verirsen hallederim.',
	no_moderate_members: 'Kurala susturma koymak için "Üyeleri Denetle" yetkisi lazım. O olmadan da kuralı kurarım ama susturmasız.',

	// what a rule looks for
	trigger_keyword: '{count} yasak kelime arıyor ({words})',
	trigger_keyword_one: 'tek bir yasak kelime arıyor ({words})',
	trigger_regex: '{count} regex kalıbına bakıyor',
	trigger_regex_one: 'bir regex kalıbına bakıyor',
	trigger_empty: 'içinde henüz hiç kelime yok',
	trigger_spam: 'genel spam yakalıyor',
	trigger_preset: "Discord'un hazır kelime listelerini kullanıyor ({presets})",
	trigger_mention_spam: '{limit} etiketten fazlasını içeren mesajları yakalıyor',
	trigger_member_profile: 'üye profillerinde {words} arıyor',
	trigger_unknown: 'tanımadığım bir filtre kullanıyor',
	preset_profanity: 'küfür',
	preset_sexual: 'cinsel içerik',
	preset_slurs: 'hakaret',
	and_more: 've {more} tane daha',

	// what it does when it fires
	action_block: 'mesajı engelliyor',
	action_alert: '#{channel} kanalına bildiriyor',
	action_alert_unknown: 'göremediğim bir kanala bildiriyor',
	action_timeout: 'kişiyi {minutes} dakika susturuyor',
	action_timeout_one: 'kişiyi bir dakika susturuyor',
	action_block_interaction: 'kişinin yazmasını ve sese girmesini engelliyor',
	action_none: 'hiçbir şey yapmıyor',
	exempt_suffix: '; şunları atlıyor: {targets}',
	exempt_suffix_unknown: '; bazı roller ya da kanallar kuralın dışında',
	effect: '{trigger}, sonra {actions}{exempt}',
	state_on: 'açık',
	state_off: 'kapalı',

	// listing
	no_rules: 'Bu sunucuda hiç otomatik moderasyon kuralı yok.',
	list: '{count} otomatik moderasyon kuralı var. {rules}.',
	list_one: 'Tek bir otomatik moderasyon kuralı var. {rules}.',
	rule_line: '{rule} ({state}) — {effect}',
	list_failed: 'Otomatik moderasyon kurallarını okuyamadım',

	// creating
	default_name: 'sesli filtre',
	no_keywords: 'Kural hangi kelimeleri engellesin? En az {min} harflik bir kelime söyle.',
	keyword_too_short: '"{words}" ile filtre kurmam — {min} harften kısa bir şey neredeyse her mesajın içinde geçer, sunucunun tamamını susturur.',
	keyword_too_long: "Discord'un filtre kelimesi için verdiği {limit} karakteri aşıyorlar: {words}.",
	too_many_rules: "Bu sunucuda Discord'un izin verdiği {limit} kelime kuralı zaten dolu. Birini silersen bunu eklerim.",
	name_taken: '"{name}" adında bir kural zaten var. Ayırt edebilmem için buna başka bir ad ver.',
	alert_channel_not_found: 'Bildirimleri göndereceğim "{name}" kanalını bulamadım.',
	alert_channel_not_text: '#{channel} bir metin kanalı değil, bildirimler oraya gidemez.',
	exempt_role_not_found: 'Kuralın dışında tutacağım "{name}" rolünü bulamadım.',
	exempt_channel_not_found: 'Kuralın dışında tutacağım "{name}" kanalını bulamadım.',
	created: '{rule} kuralı hazır ve {state}: {effect}.',
	create_failed: 'Otomatik moderasyon kuralını kuramadım',
	log_created: '[araç] otomod kuralı kuruldu: {rule} ({count} kelime)',

	// switching on and off
	rule_not_found: '"{name}" diye bir otomatik moderasyon kuralı bulamadım.',
	already_on: '{rule} kuralı zaten açık.',
	already_off: '{rule} kuralı zaten kapalı, hiçbir şeyi engellemiyor.',
	turned_on: '{rule} kuralı artık açık: {effect}.',
	turned_off: '{rule} kuralı artık kapalı; sen açana kadar hiçbir şeyi engellemiyor.',
	toggle_failed: 'Kuralı açıp kapatamadım',
	log_toggled: '[araç] otomod kuralı {state} duruma alındı: {rule}',

	// changing the words
	not_keyword_rule: '{rule} kuralı kelime listesiyle çalışmıyor ({trigger}), değiştirecek kelime yok.',
	nothing_to_update: 'Hangi kelimeleri ekleyeyim ya da çıkarayım?',
	would_be_empty: '{rule} kuralı tek kelimesiz kalır. Tamamen gitsin istiyorsan kuralı sileyim.',
	words_unchanged: '{rule} kuralı zaten tam olarak o kelimeleri izliyor.',
	updated: '{rule} kuralı artık {count} kelime izliyor: {words}. Kural {state}.',
	updated_one: '{rule} kuralı artık tek kelime izliyor: {words}. Kural {state}.',
	update_failed: 'Kuralın kelimelerini değiştiremedim',
	log_updated: '[araç] otomod kelimeleri güncellendi: {rule} ({count} kelime)',

	// deleting
	delete_question: '{rule} kuralını tamamen sileceğim; şu an {effect}.',
	deleted: '{rule} kuralını sildim; engellediği ne varsa artık serbest.',
	delete_failed: 'Kuralı silemedim',
	log_deleted: '[araç] otomod kuralı silindi: {rule}',
};
