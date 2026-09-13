// Strings for src/tools/webhooks.js (tr). Referenced as "tools.webhooks.<key>".
// A webhook address is a credential: only dm_body may carry one, and it is sent to the owner in a
// direct message. No other string here takes a {url} placeholder.
export default {
	// resolving the channel and the webhook
	channel_unknown: 'göremediğim bir kanal',
	creator_unknown: 'göremediğim biri',
	which_channel: 'Webhook hangi kanala kurulsun?',
	channel_not_found: '"{name}" kanalını bulamadım.',
	not_webhook_channel: '"{name}" webhook tutamaz; sadece metin, duyuru, forum, medya ve ses kanalları tutabilir.',
	no_permission_channel: '#{channel} kanalında "Webhookları Yönet" yetkisi bende yok; rolüme verirsen yaparım.',
	no_permission: 'Bu sunucuda "Webhookları Yönet" yetkisi bende yok; rolüme verirsen yaparım.',
	which_webhook: 'Hangi webhook olduğunu söyler misin?',
	not_found: '"{name}" adında bir webhook bulamadım.',
	not_found_in_channel: '#{channel} kanalında "{name}" adında bir webhook yok.',
	ambiguous_entry: '#{channel} içindeki {name}',
	ambiguous: '"{name}" ile eşleşen birden fazla webhook var: {list}. Kanalı da söyle ya da tam adını ver.',

	// names
	no_name: "Webhook'un adı ne olsun?",
	name_too_long: 'Bir webhook adı en fazla {limit} karakter olabilir.',
	name_reserved: 'Discord, webhook adının içinde "discord" ya da "clyde" geçmesine izin vermiyor.',

	// listing
	list_failed: 'Webhookları okuyamadım',
	none: 'Bu sunucuda hiç webhook yok.',
	none_in_channel: '#{channel} kanalında hiç webhook yok.',
	entry_channel: '{name} ({creator} kurmuş)',
	entry_server: '#{channel} içindeki {name} ({creator} kurmuş)',
	and_more: 've {count} tane daha',
	list_channel: '#{channel} kanalındaki webhooklar: {list}.',
	list_server: 'Sunucudaki webhooklar: {list}.',
	log_listed_channel: '[araç] #{channel} kanalındaki webhooklar listelendi: {count}',
	log_listed_server: '[araç] sunucudaki webhooklar listelendi: {count}',

	// creating
	channel_full: 'Bir kanalda en fazla {limit} webhook olabilir ve #{channel} dolu; önce birini sil.',
	created: '#{channel} kanalında "{name}" webhookunu kurdum. Adresini sesli söylemiyorum; istersen özel mesajla yollarım.',
	create_failed: 'Webhooku kuramadım',
	log_created: '[araç] webhook kuruldu: {name} -> #{channel}',

	// renaming
	same_name: 'O webhookun adı zaten "{name}".',
	renamed: '"{old}" webhookunun adını "{name}" yaptım.',
	rename_failed: 'Webhookun adını değiştiremedim',
	log_renamed: '[araç] webhook adı değişti: {old} -> {name}',

	// deleting
	delete_question: '#{channel} kanalındaki "{webhook}" webhookunu sileceğim; oradan mesaj atan ne varsa duracak ve bu geri alınamaz.',
	deleted: '#{channel} kanalındaki "{webhook}" webhookunu sildim.',
	delete_failed: 'Webhooku silemedim',
	log_deleted: '[araç] webhook silindi: {webhook} -> #{channel}',

	// the address, owner only, by direct message
	url_unavailable: '"{webhook}" için adres alamıyorum: Discord sadece kendi yönettiğim webhookların anahtarını veriyor, bu ise başka bir uygulamanın ya da başka bir kanalı takip eden bir webhook.',
	no_owner: 'Kayıtlı bir bot sahibi yok, adresi kimseye yollayamam; sesli de söylemem.',
	owner_not_found: 'Sahibi bu sunucuda bulamadım, adresi yollayamam; sesli de söylemem.',
	dm_body: '#{channel} kanalındaki "{webhook}" webhookunun adresi: {url} — bu bağlantıyı eline geçiren herkes o webhook adına mesaj atabilir, kimseyle paylaşma.',
	url_sent: '"{webhook}" adresini sana özel mesajla yolladım; sesli söylemiyorum.',
	url_failed: 'Adresi özel mesajla yollayamadım, sesli de söylemiyorum',
	log_url_sent: '[araç] webhook adresi sahibine özel mesajla yollandı: {webhook}',
};
