// Video strings (en). Keys are referenced as "tools.videos.<key>".
export default {
	which_one: 'Which video should I read?',
	nothing_read: 'I have not read a video yet; give me a link or a name.',
	read: 'Read it: {title} ({length}, {chars} characters). Ask me about it, or ask for a summary.',
	unknown_length: 'length unknown',
	no_result: 'I could not find that video.',
	no_subtitles: 'That video has no subtitles I can read, so I cannot follow it.',
	failed: 'I could not read that video: {error}.',
	transcript_part: 'Transcript of {title}, characters {offset}-{next} of {chars}:',
	out_of_range: 'That is past the end of the transcript of {title}.',
	no_channel: 'I could not find the channel to post it in.',
	no_text_model: 'I cannot summarise: no text model is configured on this setup.',
	chunk_instructions:
		'This is part {index} of {total} of a video transcript. Summarise what it says in a few short sentences; keep names and numbers, add nothing.',
	summary_instructions:
		'These are summaries of the parts of one video, in order. Write one summary of the whole video in 2-4 sentences: what it is about, what is said, how it ends. No bullet points, add nothing.',
	summary: 'What {title} says: {summary}',
	summary_posted: 'Summary of {title}, posted in {channel}: {summary}',
	summary_failed: 'I could not summarise that video.',
	log_read: '[video] read {title} ({chars} characters)',
	log_summary: '[video] summarised {title}',
	log_failed: '[video] {error}',
};
