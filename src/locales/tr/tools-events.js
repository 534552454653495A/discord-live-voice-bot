// Strings for src/tools/events.js (tr). Referenced as "tools.events.<key>".
//
// *_words / *_names listeleri konuşmadan gelen SÖZCÜKLER, ekrana çıkan metin değil: zaman çözümleyici
// eşleştirmeden önce bunları normalize eder (şapkalar düşer, noktalama gider), o yüzden buraya doğal
// yazılabilirler. Liste dile göre uzayıp kısalabilir; üstlerindeki mesaj anahtarları aynı kalmak zorunda.
export default {
	// Zaman sözcükleri. "2 saat sonra", "yarın 21:00", "cuma 21:00".
	unit_minute_words: ['dakika', 'dk'],
	unit_hour_words: ['saat'],
	unit_day_words: ['gün'],
	unit_week_words: ['hafta'],
	one_words: ['bir'],
	at_words: ['saat', 'civarı', 'gibi'],
	today_words: ['bugün', 'bu akşam', 'bu gece', 'bu öğleden sonra'],
	tomorrow_words: ['yarın'],
	day_after_words: ['öbür gün', 'ertesi gün', 'yarından sonra'],
	// Her gün için bir liste, pazardan başlayarak (Date#getDay sırası).
	weekday_names: [
		['pazar'],
		['pazartesi'],
		['salı'],
		['çarşamba'],
		['perşembe'],
		['cuma'],
		['cumartesi'],
	],

	// Zaman reddi: saat asla uydurulmaz, sorulur.
	time_missing: 'Etkinliğin ne zaman başlayacağını söylemedin.',
	time_unreadable: '"{text}" ifadesinden bir zaman çıkaramadım. "2 saat sonra", "yarın 21:00" gibi söyle ya da tam tarih ver.',
	time_needs_clock: '"{text}" ifadesinden günü anladım ama saati anlamadım. Saat kaçta?',
	end_unreadable: '"{text}" ifadesinden bitiş zamanını çıkaramadım. "23:00" de ya da ne kadar süreceğini "2 saat" diye söyle.',
	end_needs_clock: '"{text}" ifadesinden bitiş gününü anladım ama saatini anlamadım. Saat kaçta bitiyor?',
	time_in_past: '{when} çoktan geçti; etkinliğin ileri bir tarihte başlaması lazım.',
	end_before_start: 'Etkinlik başlamadan bitemez.',
	end_missing: 'Discord dışındaki bir etkinliğin bitiş saati de gerekiyor. Ne zaman bitiyor?',
	when_unknown: 'bilinmeyen bir saatte',

	// Etkinliğin yeri.
	where_channel: '{channel} kanalında',
	where_location: '{location} adresinde',
	where_unknown: 'göremediğim bir yerde',

	// Arama.
	unavailable: 'Bu sunucudaki etkinliklere erişemiyorum.',
	which_event: 'Hangi etkinlikten bahsediyorsun?',
	event_not_found: '"{name}" diye bir etkinlik bulamadım.',
	lookup_failed: 'Etkinlikleri okuyamadım',

	// Yetkiler.
	no_create_permission: 'Bunun için "Etkinlik Oluştur" yetkisi lazım; rolüme ver, yapayım.',
	no_manage_permission: 'O etkinliği başkası açmış, ona dokunmak için "Etkinlikleri Yönet" yetkisi lazım.',
	no_channel_access: '{channel} kanalında etkinlik yapamam: orada "Kanalı Gör" ve "Bağlan" yetkilerine ihtiyacım var.',

	// Listeleme.
	no_events: 'Yaklaşan bir etkinlik yok.',
	list_entry: '{name}, {when}, {where}, {interested} kişi ilgileniyor',
	events_list: 'Yaklaşan etkinlikler: {events}.',

	// Oluşturma.
	name_missing: 'Etkinliğin adı ne olsun?',
	which_place: 'Etkinlik hangi sesli kanalda? Discord dışındaysa yerini söyle.',
	channel_not_found: '"{name}" kanalını bulamadım.',
	not_a_voice_channel: '"{name}" sesli ya da sahne kanalı değil, etkinlik ancak bunlardan birinde yapılır.',
	not_a_stage: '"{name}" normal bir sesli kanal, sahne kanalı değil.',
	location_missing: 'Discord dışındaki etkinliğin bir yeri olmalı. Nerede yapılıyor?',
	created: '"{name}" etkinliğini {when} için {where} oluşturdum.',
	create_failed: 'Etkinliği oluşturamadım',
	log_created: '[araç] etkinlik oluşturuldu: {name} ({when})',

	// Düzenleme.
	nothing_to_change: 'Etkinlikte neyi değiştireceğimi söylemedin.',
	event_over: '"{name}" çoktan bitti, değiştirecek bir şey kalmadı.',
	external_has_no_channel: '"{name}" Discord dışında yapılıyor, kanalı yok. Sesli kanal için yeni bir etkinlik aç.',
	not_an_external_event: '"{name}" bir kanalda yapılıyor, verilecek bir adresi yok. Bana kanal söyle.',
	part_renamed: 'adı "{name}" oldu',
	part_description: 'açıklaması değişti',
	part_start: '{when} başlıyor',
	part_end: '{when} bitiyor',
	part_channel: '{channel} kanalına taşındı',
	part_location: 'artık {location} adresinde',
	edited: '"{name}" etkinliğini güncelledim: {details}.',
	edit_failed: 'Etkinliği güncelleyemedim',
	log_edited: '[araç] etkinlik düzenlendi: {name} ({details})',

	// İptal.
	cancel_question: '{when} tarihli "{name}" etkinliğini iptal edeceğim; bu geri alınamaz.',
	already_cancelled: '"{name}" zaten iptal edilmiş.',
	already_finished: '"{name}" zaten bitmiş.',
	cancelled: '"{name}" etkinliğini iptal ettim.',
	ended: '"{name}" çoktan başlamıştı, iptal etmek yerine bitirdim.',
	cancel_failed: 'Etkinliği iptal edemedim',
	log_cancelled: '[araç] etkinlik iptal edildi: {name}',
	log_ended: '[araç] etkinlik bitirildi: {name}',

	// İlgilenenler.
	interest: '"{name}" etkinliğiyle {count} kişi ilgileniyor, aralarında {names} var.',
	interest_count: '"{name}" etkinliğiyle şu ana kadar {count} kişi ilgileniyor.',
	interest_none: '"{name}" etkinliğiyle henüz kimse ilgilenmiyor.',
	interest_failed: 'Kimlerin ilgilendiğini okuyamadım',
	log_subscribers_failed: '[araç] ilgilenenler listesi alınamadı: {error}',
};
