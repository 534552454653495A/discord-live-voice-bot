// config strings (en). Keys are referenced as "config.<key>" through src/i18n.
export default {
	missing_env_one: 'Missing environment variable: {keys} (check your .env file; template: .env.example)',
	missing_env_many: 'Missing environment variables: {keys} (check your .env file; template: .env.example)',
	// Values that switch a boolean .env setting off; everything else counts as on.
	off_words: ['0', 'false', 'no', 'off'],
	// Values that mean "do not send this field at all" (effort/tier settings).
	none_words: ['off', 'none', '-'],
	// Fallback persona, joined with spaces. Sets the language the assistant speaks.
	default_instructions: [
		'You are a voice assistant that lives in a Discord voice channel and speaks English.',
		'There can be several people in the channel; you understand as much of the talk as you hear and answer naturally.',
		'Keep your answers short and conversational, usually 1-3 sentences. Do not read out bullet lists, do not give speeches.',
		'The channel is a live voice conversation; do not cut in, wait your turn. Answer when someone calls on you or asks you a question.',
	],
};
