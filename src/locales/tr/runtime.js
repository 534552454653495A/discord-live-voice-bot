// runtime strings (tr). Keys are referenced as "runtime.<key>" through src/i18n.
//
// Everything src/index.js says once the bot is running: console lines, panel/activity entries, the
// owner DMs, and the context notes handed to the model (speaker announcements, wake-word nudges).
export default {
	live_unusable: '[live] oturum sürekli hata veriyor ({message}); kapatıp yeniden başlatıyorum',
	reason_live_unusable: 'oturum kullanılamaz hâle geldi',
	silenced_on: '[ses] sahip susmamı istedi; o aksini söyleyene kadar konuşmayacağım',
	silenced_off: '[ses] sahip tekrar konuşmama izin verdi',
	silenced_note_on: 'Sahibin sana susmanı söyledi. Başkası ne derse desin konuşma; zaten uygulama sesini kanala vermiyor. Dinlemeye ve istenen işleri araçlarla yapmaya devam et. Bunu yalnızca sahibin kendi ağzıyla kaldırabilir.',
	silenced_note_off: 'Sahibin tekrar konuşmana izin verdi.',
	speaker_line_overlap: 'Kanalda {names} aynı anda konuştu, hangisinin söylediğini ayıramıyorum: "{line}"',
	window_shape_cumulative: '[deşifre] zaman aralıkları kümülatif: {total} parçanın {straddled} tanesi öncekini de kapsıyordu, bu yüzden her parça yalnızca yeni sesi üzerinden değerlendiriliyor',
	window_shape_per_fragment: '[deşifre] zaman aralıkları parça başına: {total} parçanın yalnızca {straddled} tanesi öncekiyle kesişti',
	log_context_overlap: '[bağlam] aynı anda iki ses ({names}): "{line}"',
	log_command_unclear: '[komut] çalıştırılmadı, satır tek kişiye ait değil: "{line}"',
	name_with_account: '{name} ({account} hesabı)',
	name_join: ' ve ',
	speaker_line_mixed: 'Kanalda {name}{owner} şunu söyledi, araya başkasının birkaç kelimesi karışmış olabilir: "{line}"',
	speaker_line: 'Kanalda {name}{owner} şunu söyledi: "{line}"',
	// ---------------------------------------------------------------- privacy / recording
	record_off_placeholder: '[kayıt kapalı: {count} karakter]',

	// ---------------------------------------------------------------- music
	music_playing: 'çalıyor: {title}',
	music_finished: 'bitti: {title} (sıra boş)',
	music_failed: 'çalınamadı: {title} — {error}',

	// ---------------------------------------------------------------- local speech (Chatterbox)
	local_tts_failed: 'Yerel ses üretilemedi: {error}',
	meta_voice_local: 'yerel',

	// ---------------------------------------------------------------- local brain
	local_brain_no_text_model: 'metin modeli yok (DEEPSEEK_API_KEY ya da OpenAI TEXT_MODEL)',
	local_brain_server_down: 'Chatterbox sunucusu kapalı',
	local_brain_server_loading: 'Chatterbox yükleniyor ({status})',
	local_brain_no_stt: 'whisper STT yüklü değil (sunucu --stt small ile başlamalı)',
	local_brain_hint_started: 'sunucu başlatıldı, hazır olunca geçilecek',
	local_brain_hint_status: 'sunucu: {status}',
	local_brain_hint_manual: 'tools\\run-chatterbox.cmd ile başlat',
	local_brain_not_yet: 'Yerel beyne henüz geçilemedi ({reason}): {problems} — {hint}',
	local_brain_failed: 'Yerel beyne geçilemedi: {problems}',
	local_brain_active: 'Yerel beyin devrede ({reason}): kulak whisper ({stt}), beyin {brain}, ağız Chatterbox ({tts}).',
	chatterbox_started: 'Chatterbox sunucusu bot tarafından başlatıldı',
	local_brain_gave_up: 'Yerel beyin: Chatterbox 10 dk içinde hazır olmadı; vazgeçildi (sunucu logunu kontrol et).',
	local_brain_off_log: 'Yerel beyin kapandı ({reason}); GPT-Live kullanılıyor.',
	local_brain_off: 'Yerel beyin kapandı ({reason})',
	local_stt_error: 'Yerel STT hatası: {error}',
	local_brain_no_reply: 'Yerel beyin cevap üretemedi: {error}',
	source_local_brain: 'yerel beyin',
	note_action: '(uygulama, {name} için) {text}',
	note_self_said: '(sen söyledin) {text}',
	barge_in: 'Söz kesildi; bot susuyor.',
	someone: 'biri',

	// ---------------------------------------------------------------- reasons handed to enter/exit/pause
	reason_live_back: 'GPT-Live geri geldi',
	reason_live_down: 'GPT-Live kapalı',
	reason_setting: 'ayar',
	reason_auto_mode: 'otomatik moda dönüldü',
	reason_live_selected: 'GPT-Live seçildi',
	reason_local_brain_selected: 'yerel beyin seçildi',
	reason_left_voice: 'sesli kanaldan ayrıldı',
	reason_voice_lost: 'ses bağlantısı koptu',
	reason_quota_exceeded: 'günlük kota doldu',
	reason_idle: 'boşta',

	// ---------------------------------------------------------------- transcripts
	transcript_in: 'kanal> {line}',
	transcript_out: 'bot > {line}',
	transcript_user_line: 'kanal> {name}: {line}',
	log_attribution: '[atıf] konum={start}-{end}ms eklendi={audio}ms sahipKonuştu={ownerActive} sahipMetin="{ownerText}"',
	speaker_correction: 'Düzeltme: az önceki "{line}" sözünü söyleyen kişi {name}{owner}.',
	log_context_correction: '[bağlam] düzeltme: "{line}" -> {name}',
	command_error: 'Komut hatası: {error}',

	// ---------------------------------------------------------------- wake word
	// Names the bot answers to on top of the active character's name; matched against normalised speech.
	wake_words: ['bot', 'asistan'],
	// Filler words dropped when deciding whether the name was called on its own or with a request.
	wake_filler_words: ['ya', 'be', 'hey', 'abi', 'canim', 'lan'],
	log_wake_name_only: 'İsimle seslenildi; modele cevap vermesi bildirildi.',
	wake_nudge: 'Sana az önce adınla seslenildi. Kısa bir cevapla karşılık ver.',
	log_wake_request: 'İsimle seslenildi ve istek yapıldı; modele isteği yerine getirmesi bildirildi.',
	wake_nudge_request:
		'Sana adınla seslenildi ve şu söylendi: "{line}". "Efendim" diye sorma; isteği anla ve yerine getir ' +
		"(Discord işi ya da araştırma ise backend'e delege et, sonucu söyle) ya da soruysa cevapla.",

	// ---------------------------------------------------------------- tool events
	tool_ok: 'başarılı',
	tool_failed: 'başarısız',
	tool_timing: ' ({seconds} sn)',
	log_tool_failed: '[araç] {name} başarısız{timing}: {output}',
	log_tool_slow: '[araç] {name} yavaş{timing}',

	// ---------------------------------------------------------------- GPT-Live session
	live_session_open: 'GPT-Live oturumu açıldı ({sessionId})',
	live_ready: 'GPT-Live hazır (oturum {sessionId}, model {model}, ses {voice}{character}, araçlar: {tools})',
	live_ready_character: ', karakter: {name}',
	tools_backend: 'backend',
	tools_client: 'istemci',
	intro_prompt: 'Yeni bir karaktere geçtin. Tek kısa cümleyle, bu karakterin üslubuyla kendini tanıt ve dinlemeye geç.',
	greet_prompt: 'İlk yanıtın olarak, kimsenin konuşmasını beklemeden şunu söyle: "{text}". Sonra dinlemeye geç.',
	greet_nudge: 'Şimdi konuşmaya başla.',
	music_context: 'Şu an arka planda müzik çalıyor: {title}. Sen konuşurken müzik kısılır.',

	// ---------------------------------------------------------------- latency
	seconds_value: '{seconds} sn',
	latency_kind_response: 'yanıt',
	latency_kind_backend: 'backend',
	latency_note_response: 'kullanıcı sustu -> ilk ses',
	log_latency_response: '[gecikme] yanıt {seconds} sn (kullanıcı sustu -> ilk ses)',
	log_latency_backend: '[gecikme] backend yanıtı {seconds} sn',

	// ---------------------------------------------------------------- quota
	live_session_seconds: 'GPT-Live oturum süresi: {seconds} sn{quota}',
	live_session_quota_suffix: ' (bugün {used}/{limit} dk)',
	quota_warning: "GPT-Live günlük kotasının %90'ı doldu ({used}/{limit} dk).",
	quota_exceeded_activity: 'Günlük GPT-Live kotası doldu ({limit} dk); oturum yarına kadar kapalı.',
	quota_exceeded_dm: 'GPT-Live günlük kotası doldu; sesli oturumu yarına kadar kapattım. (DAILY_LIVE_SECONDS)',

	// ---------------------------------------------------------------- connection / retry
	live_error: 'GPT-Live hatası{code}: {message}',
	live_warning: 'GPT-Live uyarısı: {message}',
	retry_why_closed: 'bağlantı kapandı ({detail})',
	retry_why_connect_failed: 'bağlanamadı',
	live_retry_fatal: 'GPT-Live {why} — {detail}{hint}\n            {minutes} dk sonra tekrar denenecek (kredi eklenince kendiliğinden düzelir).',
	live_fatal_activity: 'GPT-Live kalıcı hata: {detail}',
	live_fatal_dm: 'GPT-Live bağlanamıyor ({code}): {message}{hint}',
	live_retry_soon: 'GPT-Live {why}{detail}; {seconds} sn sonra tekrar denenecek',
	// MAX_LIVE_SESSIONS: this server may not open a realtime session yet, so it stays silent.
	live_cap_reached: '"{guild}" için GPT-Live açılmadı: {max} sunucu zaten oturum tutuyor (MAX_LIVE_SESSIONS).',
	live_cap_reason: 'sıra bekliyor (en fazla {max} sunucu)',
	session_dropped: '"{guild}" oturumu kapatıldı ve bırakıldı (kalıcı ayrılma).',
	live_paused: 'GPT-Live oturumu kapatıldı ({reason})',
	live_paused_log: 'GPT-Live oturumu kapatıldı ({reason}).',
	idle_close: 'Uzun süredir konuşan yok; GPT-Live oturumu kapatılıyor (ücret durur).',

	// ---------------------------------------------------------------- rejoin / persona / owner
	rejoin_label_recover: 'Ses kanalına yeniden katılıyorum',
	rejoin_label_return: 'Kanaldan çıkmıştım; geri dönüyorum',
	rejoin_failed: 'Geri dönemedim: {error}',
	persona_updated: 'Karakter güncellendi ({reason}) — aktif: {name}',
	persona_default: 'varsayılan',
	owner_log: '[sahip] {text}',
	owner_dm_failed: 'Sahibe DM gönderilemedi: {error}',

	// ---------------------------------------------------------------- settings
	// Spoken aliases -> canonical setting name; the switch in applySetting only knows the canonical ones.
	setting_aliases: {
		sus: 'quiet',
		sessiz: 'quiet',
		sessizlik: 'quiet',
		konusma: 'quiet',
		kes: 'quiet',
		transcript: 'transcripts',
		dokum: 'transcripts',
		konusan_bildir: 'announce_speaker',
		sahip_onceligi: 'owner_priority',
		idle: 'idle_close_minutes',
		bos_kapat: 'idle_close_minutes',
		kayit: 'record',
		gizlilik: 'record',
		local_mode: 'local_tts',
		yerel_ses: 'local_tts',
		yerel_mod: 'local_tts',
		beyin: 'brain',
		yerel_beyin: 'brain',
	},
	record_on: 'Kayıt açıldı (dökümler yazılıyor)',
	record_off: 'Kayıt kapatıldı (dökümler yazılmıyor)',
	local_brain_busy: 'Yerel beyin açıkken ses zaten Chatterbox; önce beyni GPT-Live yap.',
	// Spoken values for the "brain" setting.
	brain_local_words: ['local', 'yerel', 'ac', 'acik', '1', 'true', 'on'],
	brain_live_words: ['live', 'gpt', 'openai', 'kapat', 'kapali', '0', 'false', 'off'],
	brain_auto_words: ['auto', 'otomatik'],
	brain_setting_help: 'Beyin ayarı için "yerel", "gpt" ya da "otomatik" de.',
	brain_local_failed: 'Yerel beyne geçemedim; Chatterbox sunucusu (--stt ile) ve bir metin modeli gerekiyor.',
	brain_value_local: 'yerel',
	brain_value_auto: 'otomatik',
	brain_value_live: 'gpt-live',

	// ---------------------------------------------------------------- local voice mode
	local_tts_disabled_log: 'Yerel ses modu kapalı (LOCAL_TTS=1 ile açılır).',
	local_tts_disabled: 'Yerel ses modu bu kurulumda kapalı (.env: LOCAL_TTS=1).',
	local_tts_server_started_log: 'Yerel TTS sunucusu kapalıydı; başlatıldı (1-2 dk sonra tekrar dene).',
	local_tts_server_started: 'Yerel ses sunucusunu başlattım; bir iki dakika sonra tekrar dene.',
	local_tts_server_down_log: 'Yerel TTS sunucusu kapalı; başlat: tools\\run-chatterbox.cmd',
	local_tts_server_down: 'Yerel ses sunucusu kapalı; önce Chatterbox sunucusunu başlatmak gerekiyor.',
	local_tts_not_ready_log: 'Yerel TTS hazır değil ({status}{error}).',
	local_tts_status_unknown: 'bilinmiyor',
	local_tts_status_loading: 'yükleniyor',
	local_tts_not_ready: 'Yerel ses sunucusu henüz hazır değil ({status}).',
	local_tts_on_log: 'Yerel ses modu AÇIK — model {model} ({device}), {rate} Hz.',
	local_tts_off_log: 'Yerel ses modu kapandı; GPT-Live sesi kullanılıyor.',
	local_tts_mode_on: 'Yerel ses modu açıldı',
	local_tts_mode_off: 'Yerel ses modu kapandı',

	// ---------------------------------------------------------------- delegation
	delegation_requested: 'Delegasyon istendi ({id}): "{question}"',
	delegation_answered: 'Delegasyon yanıtlandı ({id}){timing}.',
	delegation_timing: ' — {seconds} sn',
	delegation_error: 'Delegasyon hatası: {error}',
	delegation_failed_spoken: 'İşi tamamlayamadım.',

	// ---------------------------------------------------------------- who is in the channel
	speaker_context:
		'Şu an seninle konuşan kişi {name}{ownerNote}. Onu tanıyorsun: adını biliyorsun, ' +
		'"kimim ben / beni tanıdın mı" derse adıyla{ownerAnswer} cevap ver.',
	speaker_context_owner: '; bu kişi senin sahibin (bot sahibi)',
	speaker_context_owner_answer: ' ve sahibin olduğunu söyleyerek',
	memory_notes: '{name} hakkında önceki notların (gerekirse doğal biçimde kullan, ezberden okuma):\n{summary}',
	log_context_speaker: '[bağlam] konuşan: {name}{owner}',
	owner_tag: ' (sahip)',
	owner_suffix: ' (sahibin)',
	roster_prefix: 'Sesli kanalda şu an',
	roster_context: '{prefix}: {names}. Kim konuştuğu sana ayrıca bildirilir; kişilere adlarıyla hitap et, sahibini tanı.',
	log_context_roster: '[bağlam] kanaldakiler: {names}',
	member_left_voice: '{name} sesli kanaldan ayrıldı.',
	member_joined_voice: '{name}{owner} sesli kanala katıldı.',

	// ---------------------------------------------------------------- voice connection
	speech_detected: 'Konuşma algılandı; GPT-Live oturumu yeniden açılıyor.',
	voice_lost: 'Ses bağlantısı koptu ve geri gelmedi; toparlanmaya çalışıyorum.',
	joined_voice: 'Sesli kanala katıldım: {channel}',
	join_notice: '🎙️ **{channel}** kanalına katıldım. {recording}; /yardim ile komutları görebilirsin.',
	join_notice_recording_on: 'Konuşmalar dökümleniyor ve yerel panelde kaydediliyor',
	join_notice_recording_off: 'Kayıt kapalı',
	left_voice_permanent: 'Sesli kanaldan ayrıldım (kalıcı).',
	left_voice_temporary: 'Sesli kanaldan ayrıldım; geri döneceğim.',

	// ---------------------------------------------------------------- process lifecycle
	shutting_down: 'Kapatılıyor...',
	unhandled_rejection: 'Yakalanmamış hata:',
	uncaught_exception: 'Beklenmedik hata, kapatılıyor:',
	discord_error: 'Discord hatası: {error}',
	interaction_error: 'Etkileşim hatası: {error}',
	message_error: '[mesaj] hata: {error}',
	image_placeholder: '[görsel]',
	// Spellings that force a privileged intent on or off instead of using what was detected.
	enabled_words: ['1', 'true', 'yes', 'on', 'evet', 'acik', 'açık'],
	disabled_words: ['0', 'false', 'no', 'off', 'hayir', 'hayır', 'kapali', 'kapalı'],

	// ---------------------------------------------------------------- local panel
	panel_title: '{name} — yerel panel',
	panel_default_name: 'Sesli bot',
	panel_status_voice: 'Sesli: {channel}',
	panel_status_brain: ' · Beyin: {brain}',
	// With several servers the status line names each one instead of showing a single channel.
	panel_status_guild: '{guild}: {channel} · {brain}',
	panel_status_guild_silent: ' (sessiz: {reason})',
	panel_status_chatterbox: ' · Chatterbox: {status}',
	panel_status_live: ' · GPT-Live: {state}',
	panel_status_record: ' · Kayıt: {state}',
	panel_status_events: ' · {count} olay',
	panel_on: 'açık',
	panel_off: 'kapalı',
	panel_local: 'yerel',
	panel_metric_dm: 'DM',
	panel_metric_channel: 'Kanal',
	panel_metric_voice: 'Ses',
	panel_metric_tool: 'Araç',
	panel_metric_gate: 'Kapı',
	panel_metric_response_p50: 'Yanıt P50',
	panel_metric_voice_source: 'Ses kaynağı',
	panel_metric_sessions: 'Sunucular',
	panel_metric_sessions_value: '{count} ({live} canlı)',
	panel_metric_member_index: 'Üye hafızası',
	panel_metric_memory_notes: 'Hafıza notu',
	panel_metric_daily_live: 'Günlük Live',
	panel_music: '🎵 {now} (ses %{volume})',
	minutes_value: '{used} dk',
	minutes_pair: '{used}/{limit} dk',
};
