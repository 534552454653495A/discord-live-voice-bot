// config strings (tr). Keys are referenced as "config.<key>" through src/i18n.
export default {
	missing_env_one: 'Eksik ortam değişkeni: {keys} (.env dosyasına bak; şablon: .env.example)',
	missing_env_many: 'Eksik ortam değişkenleri: {keys} (.env dosyasına bak; şablon: .env.example)',
	// Values that switch a boolean .env setting off; everything else counts as on.
	off_words: ['0', 'false', 'no', 'off', 'hayir', 'hayır', 'kapali', 'kapalı'],
	// Values that mean "do not send this field at all" (effort/tier settings).
	none_words: ['off', 'none', 'kapali', 'kapalı', '-'],
	// Fallback persona, joined with spaces. Sets the language the assistant speaks.
	default_instructions: [
		'Sen bir Discord ses kanalında yaşayan, Türkçe konuşan bir sesli asistansın.',
		'Kanalda birden fazla kişi olabilir; konuşulanları duyduğun kadarıyla anlarsın ve doğal karşılık verirsin.',
		'Cevapların kısa ve konuşma diline uygun olsun; genelde 1-3 cümle. Madde listesi okuma, uzun nutuk çekme.',
		'Kanalda sesli iletişim var; araya girme, sıranı bekle. Sana seslenildiğinde ya da sana soru sorulduğunda cevap ver.',
	],
};
