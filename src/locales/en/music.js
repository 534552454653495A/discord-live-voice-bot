// music strings (en). Keys are referenced as "music.<key>" through src/i18n.
export default {
	// --- console log lines (src/music.js)
	log_ytdlp_download: 'yt-dlp not found; downloading: {target}',
	log_ytdlp: 'yt-dlp: {message}',
	log_ffmpeg: 'ffmpeg: {message}',
	log_playing: 'music: playing -> {title}{duration}',
	log_finished: 'music: finished -> {title}',
	log_skipped: 'music: skipped -> {title}',
	log_stopped: 'music: stopped ({title})',
	log_track_failed: 'music: could not play "{title}": {message}',
	// --- failure reasons; they are read out through the music tools
	error_empty_query: 'I could not work out what to play',
	error_no_results: 'no results found',
	error_bad_output: 'could not read the yt-dlp output',
	error_no_url: 'could not resolve the track address',
	error_too_long: 'track is too long ({duration}); the limit is {minutes} min',
	error_search_timeout: 'search timed out',
	error_spawn_failed: '{binary} could not be started: {message}',
	error_exit_code: 'exit code {code}',
	error_ffmpeg_spawn: 'ffmpeg could not be started: {message}',
	error_no_audio: 'no audio data arrived',
	error_decode: 'decoding error ({code})',
	// --- spoken status line
	nothing_playing: 'Nothing is playing right now.',
	state_playing: 'Playing',
	state_paused: 'Paused',
	now_playing: '{state}: {title}{extra}.',
	queue_suffix: ' {count} more in the queue.',
};
