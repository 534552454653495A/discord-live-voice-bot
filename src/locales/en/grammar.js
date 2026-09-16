// grammar strings (en). Keys are referenced as "grammar.<key>" through src/i18n.
//
// This namespace holds the voice-command grammar: the patterns src/commands.js turns into matchers
// when it parses what was said in the voice channel. Every pattern is a plain RegExp source string
// plus its flags, so a language can be added without touching the parser. The patterns must be
// written in THIS locale's language -- they are matched against real speech, not translated.
//
// English puts the verb and the message first and the target last ("write hello in the general
// channel"), so the channel name is read out of the tail of the sentence and the message out of the
// part in front of it; see the send.body_before_channel switch below.
export default {
	// Dictation particles: "write X in general" leaves a trailing quoting particle that must not
	// become part of the message. Source string for a case-insensitive unicode RegExp.
	dictation_tail: '\\s+(?:okay|please)?\\s*(?:say|write|send)\\s+(?:that|it|this)?[.!?,]*$',
	// Speech-to-text can garble a channel name, and some languages need a tolerant letter class per
	// character, so that a plain letter matches its accented form too. English names are matched
	// literally, so the map is empty.
	letter_classes: {
		a: '[aáàâä]',
		c: '[cçć]',
		e: '[eéèêë]',
		g: '[gğ]',
		i: '[iíìîïıİ]',
		n: '[nñ]',
		o: '[oóòôöõ]',
		s: '[sśş]',
		u: '[uúùûü]',
	},

	// "switch to the Aria character", "change the character to Aria", "become the character Aria".
	// Capture group 1 is the character name; the word character/persona is required so that
	// "switch to the general channel" stays a join request. The first matching pattern wins.
	character_switch: [
		{
			pattern: '(?:switch|change|turn|go)\\s+(?:over\\s+)?to\\s+(?:the\\s+)?([\\p{L}\\p{N}_\\- ]{1,40}?)\\s+(?:character|persona)(?![\\p{L}])',
			flags: 'iu',
		},
		{
			pattern: '(?:switch|change|set)\\s+(?:the\\s+)?(?:character|persona)\\s+(?:over\\s+)?to\\s+(?:the\\s+)?([\\p{L}\\p{N}_\\- ]{1,40}?)[.!?]*\\s*$',
			flags: 'iu',
		},
		{
			pattern: '(?:become|act\\s+as|speak\\s+as|talk\\s+as|switch\\s+to|use)\\s+(?:the\\s+)?(?:character|persona)\\s+([\\p{L}\\p{N}_\\- ]{1,40}?)[.!?]*\\s*$',
			flags: 'iu',
		},
	],

	// "leave the channel", "get out of the voice channel", or a bare "disconnect".
	leave: {
		pattern:
			'(?<![\\p{L}])(?:leave|exit|quit|disconnect(?:\\s+from)?|get\\s+out\\s+of|hop\\s+out\\s+of)\\s+(?:the\\s+|this\\s+|your\\s+)?(?:voice\\s+)?(?:channel|chat|room|call|vc)(?![\\p{L}])|(?<![\\p{L}])(?:leave|disconnect)\\s*[.!?]*$',
		flags: 'iu',
	},

	// "be quiet", "shut up" and the way back, "you can speak again". Being quiet is a state of the
	// application and not a request to the model, so the words that switch it are matched here and run
	// without one. A bare "quiet" is deliberately absent: "the reading room is quiet" is a sentence,
	// not an instruction.
	quiet: {
		on: {
			pattern: '(?<![\\p{L}])(?:be\\s+quiet|quiet\\s+down|shut\\s+up|shut\\s+it|hush|silence)(?![\\p{L}])',
			flags: 'iu',
		},
		off: {
			pattern: '(?<![\\p{L}])(?:(?:you\\s+)?(?:can|may)\\s+(?:speak|talk)|(?:speak|talk)\\s+again)(?![\\p{L}])',
			flags: 'iu',
		},
	},

	// What may follow a channel name: the word that marks it as a channel.
	channel_suffix: { pattern: '^\\s*(?:voice\\s+)?(?:channel|chat|room|vc)(?![\\p{L}])', flags: 'iu' },

	// Filler words stripped from the front of a dictated message or a music query. "the" is
	// deliberately absent: it is part of plenty of band and song names.
	fillers: { pattern: '^(?:please|just|now|maybe|quickly|kindly|hey|okay|ok)\\s+', flags: 'iu' },

	// "message:" in front of the dictated text is part of the command, not of the message. A
	// separator (or the end of the text) is required so that a song called "Message in a Bottle"
	// survives intact.
	message_prefix: { pattern: '^(?:a\\s+|the\\s+)?(?:message|msg)\\s*(?:[:,]\\s*|$)', flags: 'i' },

	// Filler words stripped from the front of a spoken channel name.
	channel_name_fillers: { pattern: '^(?:the|this|that|a|an|our|my|voice|text|please|just|now)\\s+', flags: 'iu' },

	// Words that are too generic to be a channel name (compared against the normalised name).
	generic_channel_words: ['the', 'a', 'voice', 'voice channel', 'channel', 'channels', 'text', 'chat', 'room', 'this', 'that', 'here'],

	send: {
		// Left boundary so that the "say" inside "essay" is not a verb. "tell" and "announce" are
		// left out on purpose: they put the message after the channel, which this shape cannot read.
		verb: { pattern: '(?<![\\p{L}])(?:write|send|post|say|type|drop)(?:s|es|ing)?(?![\\p{L}])', flags: 'iu' },
		// English says the message before the channel ("write hello in the general channel"), so the
		// part in FRONT of the channel name is searched as well.
		body_before_channel: true,
		// ... after trimming the preposition that introduces the channel, which would otherwise end
		// up at the end of the message.
		channel_lead: { pattern: '\\s+(?:in|into|to|on|over\\s+(?:in|at)|at)\\s+(?:the\\s+|our\\s+|my\\s+)?$', flags: 'iu' },
		// Channel name is not in the list: pull it out of the "... in the <name> channel" shape and
		// match it loosely afterwards. Group 2 is the name, group 1 the message side.
		legacy: {
			pattern: '(.+?)\\s+(?:in|into|to|on)\\s+(?:the\\s+)?([\\p{L}\\p{N}_\\- ]{1,40}?)\\s*(?:voice\\s+)?(?:channel|chat|room)(?![\\p{L}])',
			flags: 'iu',
			name: 2,
			body: 1,
		},
		// No name at all: "write hello in the channel" (the default channel is used).
		bare: { pattern: '(?:in|into|to|on)\\s+(?:the\\s+)?(?:channel|chat)\\s*[:,]?\\s*(?:a\\s+)?(?:message\\s*)?', flags: 'i' },
	},

	read: {
		// A real request to read, not "already read that" on its own.
		hint: {
			pattern:
				"(?<![\\p{L}])(?:read(?:\\s+out)?|what(?:'|’)?s\\s+(?:new|written|being\\s+said|going\\s+on)|what\\s+(?:is|was)\\s+(?:written|said)|what\\s+(?:did|do)\\s+(?:you|they|he|she)\\s+(?:say|write|post)|any(?:thing)?\\s+new|new\\s+messages|last\\s+messages|latest\\s+messages|recent\\s+messages|catch\\s+me\\s+up)(?![\\p{L}])",
			flags: 'iu',
		},
		// The sentence must be about a channel or about messages.
		requires: { pattern: 'channel|chat|room|message', flags: 'i' },
		// Channel name is not in the list. Group 1 is the name.
		legacy: {
			pattern: '(?:(?:read|check|show|open)\\s+(?:me\\s+)?|(?:in|from|on)\\s+)(?:the\\s+)?([\\p{L}\\p{N}_\\- ]{1,40}?)\\s*(?:voice\\s+)?(?:channel|chat|room)(?![\\p{L}])',
			flags: 'iu',
		},
	},

	join: {
		// Tested against single normalised words, so only whole verbs belong here. "get" and "move"
		// are left out: they are far too common in sentences that are not a request to join.
		verb: { pattern: '^(?:join|joins|come|comes|connect|hop|jump|enter|pop|switch)$', flags: 'u' },
		// A channel/room word or a known voice channel name has to be there; otherwise "come/enter"
		// fires on the wrong sentences.
		place: { pattern: '(?<![\\p{L}])(?:channel|room|voice|vc|call)', flags: 'iu' },
		// Channel name is not in the list. Group 1 is the name.
		legacy: {
			pattern:
				'(?:(?:join|come\\s+to|connect\\s+to|get\\s+in(?:to)?|hop\\s+in(?:to)?|move\\s+to|switch\\s+to)\\s+)?(?:the\\s+)?([\\p{L}\\p{N}_\\- ]{1,40}?)\\s*(?:voice\\s+)?(?:channel|room)(?![\\p{L}])',
			flags: 'iu',
		},
	},

	music: {
		// Control patterns, tried in order; the first hit wins.
		patterns: [
			{
				action: 'stop',
				pattern:
					'(?:stop|turn\\s+off|shut\\s+off|shut\\s+down|kill|cut|end)\\s+(?:the\\s+)?(?:music|song|track|playback|tunes)(?![\\p{L}])|(?:music|song|playback)\\s+off(?![\\p{L}])',
				flags: 'iu',
			},
			{
				action: 'pause',
				pattern: '(?:pause|hold|freeze)\\s+(?:the\\s+)?(?:music|song|track|playback)(?![\\p{L}])|(?<![\\p{L}])pause(?:\\s+(?:it|this))?[.!?]*\\s*$',
				flags: 'iu',
			},
			{
				action: 'resume',
				pattern:
					'(?:resume|unpause|continue|keep\\s+playing)\\s*(?:the\\s+)?(?:music|song|track|playback)?(?![\\p{L}])|(?:play\\s+(?:it\\s+)?again|carry\\s+on\\s+with\\s+the\\s+(?:music|song)|pick\\s+up\\s+where\\s+(?:it|we)\\s+left\\s+off)',
				flags: 'iu',
			},
			{
				action: 'skip',
				pattern:
					'(?:skip|next)\\s*(?:the\\s+)?(?:song|track|music|one|this)?(?![\\p{L}])|(?:next|another)\\s+(?:song|track|one)(?![\\p{L}])|(?:skip|pass)\\s+(?:it|this)(?![\\p{L}])',
				flags: 'iu',
			},
			{
				action: 'status',
				pattern:
					"(?:what(?:'|’)?s\\s+(?:playing|this\\s+song)|what\\s+is\\s+playing|what\\s+song\\s+is\\s+(?:this|playing)|which\\s+song\\s+is\\s+this|now\\s+playing|current\\s+(?:song|track)|name\\s+of\\s+(?:this|the)\\s+song)",
				flags: 'iu',
			},
		],
		// "set the music volume to 20 percent" — group 1 is the percentage.
		volume_set: {
			pattern: '(?:(?:set|put|turn|make)\\s+)?(?:the\\s+)?(?:music\\s+)?(?:volume|sound)\\s*(?:level\\s*)?(?:to|at)?\\s*(\\d{1,3})(?:\\s*(?:percent|%))?(?![\\p{N}])',
			flags: 'iu',
		},
		// The sentence must be about music at all before a bare number changes the volume.
		volume_requires: { pattern: 'music|song|track|volume|sound', flags: 'iu' },
		volume_down: {
			pattern:
				'(?:turn\\s+(?:it|the\\s+(?:music|volume|sound))\\s+down|turn\\s+down\\s+(?:the\\s+)?(?:music|volume|sound)|lower\\s+(?:the\\s+)?(?:music|volume|sound)|volume\\s+down|(?:make|turn)\\s+it\\s+quieter|(?:a\\s+bit\\s+)?quieter)',
			flags: 'iu',
		},
		volume_up: {
			pattern:
				'(?:turn\\s+(?:it|the\\s+(?:music|volume|sound))\\s+up|turn\\s+up\\s+(?:the\\s+)?(?:music|volume|sound)|raise\\s+(?:the\\s+)?(?:music|volume|sound)|volume\\s+up|crank\\s+it\\s+up|(?:make|turn)\\s+it\\s+louder|(?:a\\s+bit\\s+)?louder)',
			flags: 'iu',
		},
		// A request to play something is never a request to turn the volume up.
		volume_up_exclude: { pattern: '(?:^|\\s)(?:play|queue|put\\s+on|start\\s+playing)\\s', flags: 'iu' },
		// "skip" only skips when a track is being talked about.
		skip_requires: { pattern: 'song|track|music|skip|next', flags: 'iu' },
		// Play requests; group 1 is the query.
		play_patterns: [
			// "play Daft Punk Around the World", "queue up some jazz"
			{
				pattern: '(?:^|\\s)(?:play|queue(?:\\s+up)?|start\\s+playing)\\s+(?:us\\s+|me\\s+)?(.+?)(?:\\s+(?:please|for\\s+(?:us|me)))?[.!?]*\\s*$',
				flags: 'iu',
			},
			// "put on some jazz", "throw on Miles Davis"
			{ pattern: '(?:^|\\s)(?:put|throw)\\s+on\\s+(.+?)[.!?]*\\s*$', flags: 'iu' },
			// "put Smells Like Teen Spirit on" (the sentence ends with "on"; at least two words)
			{ pattern: '(?:^|\\s)(?:put|throw)\\s+(\\S+(?:\\s+\\S+)+?)\\s+on[.!?]*\\s*$', flags: 'iu' },
		],
		// Applied in order to the captured query; each match is removed.
		query_cleanup: [
			{ pattern: '^(?:us|me|for\\s+us|for\\s+me)\\s+', flags: 'iu' },
			{ pattern: '^(?:some\\s+|a\\s+|the\\s+)?(?:song|music|track|tune)s?\\s*[:]?\\s*', flags: 'iu' },
		],
		// Queries that mean "anything"; compared against the normalised query.
		not_a_query: [
			'something', 'something good', 'something nice', 'some music', 'some songs', 'some tunes', 'music', 'song',
			'songs', 'track', 'tracks', 'tunes', 'anything', 'a song', 'a track', 'us', 'me', 'please', 'a good one',
		],
	},
};
