// music strings (tr). Keys are referenced as "music.<key>" through src/i18n.
export default {
	// --- console log lines (src/music.js)
	log_ytdlp_download: 'yt-dlp bulunamadı; indiriliyor: {target}',
	log_ytdlp: 'yt-dlp: {message}',
	log_ffmpeg: 'ffmpeg: {message}',
	log_playing: 'müzik: çalıyor -> {title}{duration}',
	log_finished: 'müzik: bitti -> {title}',
	log_skipped: 'müzik: atlandı -> {title}',
	log_stopped: 'müzik: durduruldu ({title})',
	log_track_failed: 'müzik: "{title}" çalınamadı: {message}',
	// --- failure reasons; they are read out through the music tools
	error_empty_query: 'ne çalacağımı anlayamadım',
	error_no_results: 'sonuç bulunamadı',
	error_bad_output: 'yt-dlp çıktısı okunamadı',
	error_no_url: 'parça adresi çözülemedi',
	error_too_long: 'parça çok uzun ({duration}); sınır {minutes} dk',
	error_search_timeout: 'arama zaman aşımı',
	error_spawn_failed: '{binary} çalıştırılamadı: {message}',
	error_exit_code: 'çıkış kodu {code}',
	error_ffmpeg_spawn: 'ffmpeg çalıştırılamadı: {message}',
	error_no_audio: 'ses verisi gelmedi',
	error_decode: 'çözme hatası ({code})',
	// --- spoken status line
	nothing_playing: 'Şu an müzik çalmıyor.',
	state_playing: 'Çalıyor',
	state_paused: 'Duraklatıldı',
	now_playing: '{state}: {title}{extra}.',
	queue_suffix: ' Sırada {count} parça var.',
};
