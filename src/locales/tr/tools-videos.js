// Video strings (tr). Keys are referenced as "tools.videos.<key>".
export default {
	which_one: 'Hangi videoyu okuyayım?',
	nothing_read: 'Henüz bir video okumadım; link ya da ad ver.',
	read: 'Okudum: {title} ({length}, {chars} karakter). Sorabilirsin, özet de isteyebilirsin.',
	unknown_length: 'uzunluk bilinmiyor',
	no_result: 'O videoyu bulamadım.',
	no_subtitles: 'Bu videoda okuyabileceğim altyazı yok, takip edemiyorum.',
	failed: 'Videoyu okuyamadım: {error}.',
	transcript_part: '{title} transkripti, {chars} karakterin {offset}-{next} arası:',
	out_of_range: '{title} transkriptinin sonunu geçtin.',
	no_channel: 'Gönderecek kanalı bulamadım.',
	no_text_model: 'Özetleyemem: bu kurulumda metin modeli yok.',
	chunk_instructions:
		'Bu bir video transkriptinin {total} parçasından {index}. Ne anlatıldığını birkaç kısa cümleyle özetle; isimleri ve sayıları koru, ekleme yapma.',
	summary_instructions:
		'Bunlar tek bir videonun parça özetleri, sırayla. Videonun tamamını 2-4 cümleyle özetle: neyle ilgili, ne anlatılıyor, nasıl bitiyor. Madde işareti yok, ekleme yapma.',
	summary: '{title} ne anlatıyor: {summary}',
	summary_posted: '{title} özeti, {channel} kanalına gönderildi: {summary}',
	summary_failed: 'Bu videoyu özetleyemedim.',
	log_read: '[video] okundu: {title} ({chars} karakter)',
	log_summary: '[video] özetlendi: {title}',
	log_failed: '[video] {error}',
};
