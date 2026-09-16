// grammar strings (tr). Keys are referenced as "grammar.<key>" through src/i18n.
//
// This namespace holds the voice-command grammar: the patterns src/commands.js turns into matchers
// when it parses what was said in the voice channel. Every pattern is a plain RegExp source string
// plus its flags, so a language can be added without touching the parser. The patterns must be
// written in THIS locale's language -- they are matched against real speech, not translated.
//
// Turkish marks the target with case suffixes AFTER the word ("genel kanalına ... yaz"), which is
// why the channel name comes first and the verb last in nearly every pattern here.
export default {
	// Dictation particles: "write X in general" leaves a trailing quoting particle that must not
	// become part of the message. Source string for a case-insensitive unicode RegExp.
	dictation_tail: '\\s+(?:de|da|diye|diyorum|diyor|dedim)(?:\\s+(?:yaz|söyle))?[.!?,]*$',
	// Speech-to-text loses Turkish diacritics, so a normalised channel name is expanded into a
	// tolerant pattern: "genel sohbet" -> /g[eé]n[eé]l[\s_-]+s[oö]hb[eé]t/. Letters that are not
	// listed are matched literally.
	letter_classes: {
		a: '[aá]',
		c: '[cç]',
		e: '[eé]',
		g: '[gğ]',
		i: '[iıİ]',
		o: '[oö]',
		s: '[sş]',
		u: '[uü]',
	},

	// "<ad> karakterine geç" / "... geçer misin" / "... geçebilir misin". Capture group 1 is the
	// character name. Note: \b is unreliable around Turkish letters (ç, ı...), so a non-letter
	// lookahead is used instead. The first matching pattern wins.
	character_switch: [
		{
			pattern: '([\\p{L}\\p{N}_\\- ]{1,40}?)\\s+karakter(?:ine|[ıi]ne|i|e|im)?\\s+ge[çc](?:er|ebilir)?(?![\\p{L}])',
			flags: 'iu',
		},
	],

	// "kanaldan ayrıl"
	leave: { pattern: 'kanaldan\\s+ayr[ıi]l', flags: 'iu' },

	// "sus", "sessiz ol", "kes sesini"; geri dönüş "konuşabilirsin". Susmak modelin değil uygulamanın
	// tuttuğu bir durum, bu yüzden kelimeler burada: model hiç devreye girmeden çalışsın. "susma",
	// "susam" ve "susadım" eşleşmez; "sus" tek başına ya da kendi çekimleriyle aranır.
	quiet: {
		on: {
			pattern:
				'(?<![\\p{L}])(?:sus(?:unuz|un|s[ae]n[ae]|ar\\s+m[ıi]s[ıi]n)?|sessiz\\s+ol(?:un|unuz)?|sessizlik|kes\\s+ses[iı]n[iı]|ses[iı]n[iı]\\s+kes|kapa\\s+çenen[iı]|çenen[iı]\\s+kapa)(?![\\p{L}])',
			flags: 'iu',
		},
		off: {
			pattern: '(?<![\\p{L}])(?:konu[şs]ab[iı]l[iı]r(?:s[iı]n(?:[iı]z)?)?|devam\\s+edeb[iı]l[iı]rs[iı]n)(?![\\p{L}])',
			flags: 'iu',
		},
	},

	// What may follow a channel name: the word "kanal" with any suffix, or the case suffix on its
	// own ("genel sohbete merhaba yaz").
	channel_suffix: {
		pattern: "^\\s*(?:kanal[a-zçğıöşü]*|['’]?(?:nin|nın|ne|na|de|da|te|ta|ye|ya|in|ın|e|a)(?=\\s|$))",
		flags: 'i',
	},

	// Filler words stripped from the front of a dictated message or a music query.
	fillers: { pattern: '^(?:bir|şöyle|ki|lütfen|hadi|hemen|şimdi|acaba|bana|bize|şu|bu|o)\\s+', flags: 'iu' },

	// "mesaj(ı)" in front of the dictated text is part of the command, not of the message.
	message_prefix: { pattern: '^(?:mesaj[ıi]?|mesajı)\\s*', flags: 'i' },

	// Filler words stripped from the front of a spoken channel name.
	channel_name_fillers: {
		pattern: '^(?:bu|şu|o|bir|sesli|metin|lütfen|hadi|hemen|şimdi|acaba|bana|bize)\\s+',
		flags: 'iu',
	},

	// Words that are too generic to be a channel name (compared against the normalised name).
	generic_channel_words: ['sesli', 'kanal', 'kanala', 'kanalina', 'metin', 'sohbet', 'bu', 'su'],

	send: {
		// Left boundary: the "at" inside "saat" and the "yaz" inside "beyaz" are not verbs.
		verb: { pattern: '(?<![\\p{L}])(?:yaz|g[öo]nder|at)(?:ar|er|abilir|abilirsen|sana|sene)?(?![\\p{L}])', flags: 'iu' },
		// Turkish puts the message in front of the verb and the channel first, so there is never a
		// message to pick up BEFORE the channel name, and nothing sits in front of that name either.
		body_before_channel: false,
		channel_lead: null,
		// Channel name is not in the list: pull it out of the "<ad> kanalına ..." shape and match it
		// loosely afterwards. Group 1 is the name, group 2 the rest of the sentence.
		legacy: { pattern: '([\\p{L}\\p{N}_\\- ]{1,40}?)\\s*kanal[a-zçğıöşü]*\\s*(.+)$', flags: 'iu', name: 1, body: 2 },
		// No name at all: "kanala mesaj gönder: ..." (the default channel is used).
		bare: { pattern: 'kanal[a-zçğıöşü]*\\s*(?:bir\\s+)?(?:mesaj[ıi]?\\s*)?', flags: 'i' },
	},

	read: {
		// A real request to read, not "okul/okyanus/okuma".
		hint: {
			pattern:
				'(?:ne\\s+yaz[ıi]yor\\w*|neler\\s+yaz[ıi]yor\\w*|(?<![\\p{L}])oku(?:r|yor|yabilir|sana|sene|yun|yal[ıi]m|)(?![\\p{L}])|son\\s+mesajlar?|son\\s+yaz[ıi]lanlar?)',
			flags: 'iu',
		},
		// The sentence must be about a channel or about messages.
		requires: { pattern: 'kanal|mesaj', flags: 'i' },
		// Channel name is not in the list. Group 1 is the name.
		legacy: { pattern: '([\\p{L}\\p{N}_\\- ]{1,40}?)\\s*kanal[a-zçğıöşü]*', flags: 'iu' },
	},

	join: {
		// Imperative and polite forms: katıl, katılsana, gir, gel, gelsene, geç, geçer misin,
		// gelebilir misin. Words like "gece", "gelin", "gelecek", "geçmiş" do not fit the
		// stem + allowed-suffix list, so they do not match. Tested against single normalised words.
		verb: { pattern: '^(?:katil|gir|gel|gec)(?:sene|sen|in|iniz|ebilir|abilir|er|ir|elim|eyim|meni|sin|iver|iversene|)$', flags: 'u' },
		// A channel/room word or a known voice channel name has to be there; otherwise "gel/gir"
		// fires on the wrong sentences.
		place: { pattern: '(?<![\\p{L}])(?:kanal|oda|sesli|ses)', flags: 'iu' },
		// Channel name is not in the list. Group 1 is the name.
		legacy: {
			pattern: '([\\p{L}\\p{N}_\\- ]{1,40}?)\\s*(?:isminde\\s+)?(?:sesli\\s+)?(?:kanal|oda)[a-zçğıöşü]*',
			flags: 'iu',
		},
	},

	music: {
		// Control patterns, tried in order; the first hit wins.
		patterns: [
			{
				action: 'stop',
				pattern:
					'(?:m[üu]zi[ğg]i|m[üu]zik|şark[ıi]y[ıi]|şark[ıi]|par[çc]ay[ıi]|par[çc]a)(?:n[ıi])?\\s+(?:durdur|kapat|kes|sustur|bitir)',
				flags: 'iu',
			},
			{
				action: 'pause',
				pattern:
					'(?:m[üu]zi[ğg]i|m[üu]zik|şark[ıi]y[ıi]|şark[ıi]|par[çc]ay[ıi]|par[çc]a)(?:n[ıi])?\\s+(?:duraklat|beklet|dondur)',
				flags: 'iu',
			},
			{
				action: 'resume',
				pattern:
					'(?:m[üu]zi[ğg]e|şark[ıi]ya|m[üu]zi[ğg]i|şark[ıi]y[ıi])\\s+(?:devam|s[üu]rd[üu]r)|(?:kald[ıi][ğg][ıi]\\s+yerden\\s+devam)',
				flags: 'iu',
			},
			{
				action: 'skip',
				pattern:
					'(?:şark[ıi]y[ıi]|par[çc]ay[ıi]|m[üu]zi[ğg]i|bunu)\\s+(?:atla|ge[çc](?:sene|sen|)(?![\\p{L}]))|(?:bir\\s+)?sonraki(?:ne|si)?\\s*(?:şark[ıi]|par[çc]a)?(?:ya|ye)?\\s*(?:ge[çc]|atla)?',
				flags: 'iu',
			},
			{
				action: 'status',
				pattern: '(?:ne\\s+çal[ıi]yor|hangi\\s+şark[ıi]|şark[ıi]n[ıi]n\\s+ad[ıi]\\s+ne|bu\\s+şark[ıi]\\s+ne|çalan\\s+şark[ıi])',
				flags: 'iu',
			},
		],
		// "müziğin sesini yüzde 20 yap" — group 1 is the percentage.
		volume_set: {
			pattern: '(?:m[üu]zi[ğg]in?\\s+)?sesi(?:ni)?\\s+(?:y[üu]zde\\s*)?(\\d{1,3})(?:\\s*(?:yap|olsun|e\\s+(?:al|getir|çek)|a\\s+(?:al|getir|çek)))?',
			flags: 'iu',
		},
		// The sentence must be about music at all before a bare number changes the volume.
		volume_requires: { pattern: 'm[üu]zi|şark|par[çc]a|ses', flags: 'iu' },
		volume_down: { pattern: 'm[üu]zi[ğg]i(?:n\\s+sesini)?\\s+(?:biraz\\s+)?(?:k[ıi]s|azalt|al[çc]alt|d[üu]ş[üu]r)', flags: 'iu' },
		volume_up: {
			pattern: 'm[üu]zi[ğg]i(?:n\\s+sesini)?\\s+(?:biraz\\s+)?(?:a[çc](?![\\p{L}])|y[üu]kselt|art[ıi]r|a[çc]sana)',
			flags: 'iu',
		},
		// "müzik aç: ..." means play, not louder.
		volume_up_exclude: { pattern: '(?:^|\\s)(?:bir\\s+)?(?:şark[ıi]|m[üu]zik|par[çc]a)\\s+a[çc][:\\s]', flags: 'iu' },
		// "atla" only skips when a track is being talked about.
		skip_requires: { pattern: 'şark|par[çc]a|m[üu]zi|sonraki', flags: 'iu' },
		// Play requests; group 1 is the query.
		play_patterns: [
			// "Tarkan Şımarık şarkısını çal", "Sezen Aksu'dan bir parça aç"
			{
				pattern:
					'(?:^|\\s)(?:bana\\s+|bize\\s+)?(.+?)\\s+(?:şark[ıi]s[ıi]n[ıi]|par[çc]as[ıi]n[ıi]|m[üu]zi[ğg]ini|şark[ıi]s[ıi]|par[çc]as[ıi]|şark[ıi]y[ıi]|par[çc]ay[ıi])\\s+(?:çal|a[çc]|oynat|başlat|koy|aç)(?:sana|sene|ar\\s+m[ıi]s[ıi]n|abilir\\s+misin)?(?![\\p{L}])',
				flags: 'iu',
			},
			// "şarkı çal: sezen aksu", "müzik aç sezen aksu gülümse", "bir şarkı koy: ..."
			{
				pattern: '(?:^|\\s)(?:bir\\s+)?(?:şark[ıi]|m[üu]zik|par[çc]a)\\s+(?:çal|a[çc]|oynat|koy|başlat)(?:sana|sene)?[:\\s]+(.+)$',
				flags: 'iu',
			},
			// "sezen aksu gülümse çal" (the sentence ends with "çal"; at least two words)
			{
				pattern: '(?:^|\\s)(?:bana\\s+|bize\\s+)?(\\S+(?:\\s+\\S+)+?)\\s+(?:çal|oynat)(?:sana|sene|ar\\s+m[ıi]s[ıi]n|abilir\\s+misin)?[.!?]*\\s*$',
				flags: 'iu',
			},
		],
		// Applied in order to the captured query; each match is removed.
		query_cleanup: [
			{ pattern: '^(?:bana|bize)\\s+', flags: 'iu' },
			{ pattern: '^(?:bir\\s+)?(?:şark[ıi]|m[üu]zik|par[çc]a)\\s*[:]?\\s*', flags: 'iu' },
		],
		// Queries that mean "anything"; compared against the normalised query.
		not_a_query: [
			'bir sey', 'bir seyler', 'sey', 'seyler', 'bisey', 'biseyler', 'muzik', 'sarki', 'parca', 'bana', 'bize',
			'hadi', 'lutfen', 'guzel bir sey', 'bir muzik', 'bir sarki',
		],
	},
};
