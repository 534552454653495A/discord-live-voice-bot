// Video tools: what the bot has read. The reading itself is src/video.js (yt-dlp subtitles); the
// transcript stays in memory, so a question or a summary does not fetch anything a second time.

import { t } from '../i18n/index.js';
import { UNSUPPORTED_LINK, YTDLP_MISSING } from '../music.js';
import { fetchVideo, recallVideo } from '../video.js';
import { resolveTextChannel } from './helpers.js';
import { P, defineTool } from './registry.js';

const CHUNK = 12_000;
const MAX_CHUNKS = 8;
const READ_DEFAULT = 6_000;

/** The failures the reader raises, in the words the channel hears. */
function videoFailure(err, deps) {
	deps.log?.(t('tools.videos.log_failed', { error: err.message }));
	if (err.message === UNSUPPORTED_LINK) return { ok: false, spoken: t('tools.music.unsupported_link') };
	if (err.message === YTDLP_MISSING) return { ok: false, spoken: t('tools.music.ytdlp_missing') };
	if (err.reason === 'no-subtitles') return { ok: false, spoken: t('tools.videos.no_subtitles') };
	if (err.reason === 'no-result') return { ok: false, spoken: t('tools.videos.no_result') };
	return { ok: false, spoken: t('tools.videos.failed', { error: err.message }) };
}

/** The reader this call should use: the real one unless a stand-in was wired in. */
function readerOf(deps) {
	return deps.fetchVideo ?? fetchVideo;
}

/** yt-dlp's options for reading a video, taken from the same settings the music player uses. */
function readOptions(deps) {
	return {
		ytDlpPath: deps.cfg?.ytDlpPath ?? null,
		autoDownload: deps.cfg?.ytDlpAutoDownload !== false,
		log: deps.log ?? (() => {}),
	};
}

function lengthText(video) {
	if (!Number.isFinite(video.duration) || video.duration <= 0) return t('tools.videos.unknown_length');
	const minutes = Math.floor(video.duration / 60);
	const seconds = Math.round(video.duration % 60);
	return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const tools = [
	defineTool({
		name: 'watch_video',
		description:
			'Reads a video by its link, or by name when it has to look it up: the subtitles become a transcript the bot ' +
			'keeps, so questions about it ("what did they say about X") and a summary can follow.',
		parameters: P.obj({ video: P.str('Video link, or a name to search for') }, ['video']),
		async handler(args, deps) {
			const wanted = String(args.video ?? '').trim();
			if (!wanted) return { ok: false, spoken: t('tools.videos.which_one') };
			try {
				const video = await readerOf(deps)(wanted, readOptions(deps));
				deps.log?.(t('tools.videos.log_read', { title: video.title, chars: video.chars }));
				return {
					ok: true,
					spoken: t('tools.videos.read', { title: video.title, length: lengthText(video), chars: video.chars }),
					data: { id: video.id, title: video.title, url: video.url, duration: video.duration, chars: video.chars, lang: video.lang },
				};
			} catch (err) {
				return videoFailure(err, deps);
			}
		},
	}),

	defineTool({
		name: 'video_transcript',
		description: 'Reads out a slice of the transcript of a video the bot has read (the last one, or one named by title or id).',
		parameters: P.obj({
			video: P.str('Title or id of a video already read; empty = the last one'),
			offset: P.int('Character to start at (0 = the beginning)'),
			limit: P.int('How many characters to return (6000 by default)'),
		}),
		async handler(args, _deps) {
			const video = recallVideo(args.video ? String(args.video) : null);
			if (!video) return { ok: false, spoken: t('tools.videos.nothing_read') };
			const offset = Math.max(0, Number.isFinite(args.offset) ? Math.floor(args.offset) : 0);
			const limit = Math.min(READ_DEFAULT, Math.max(200, Number.isFinite(args.limit) ? Math.floor(args.limit) : READ_DEFAULT));
			const part = video.transcript.slice(offset, offset + limit);
			if (!part) return { ok: false, spoken: t('tools.videos.out_of_range', { title: video.title }) };
			return {
				ok: true,
				spoken: t('tools.videos.transcript_part', { title: video.title, offset, next: offset + part.length, chars: video.chars }),
				data: { id: video.id, title: video.title, offset, chars: video.chars, transcript: part },
			};
		},
	}),

	defineTool({
		name: 'summarize_video',
		description:
			'Summarises a video the bot has read in a few sentences — or fetches it first when given a link or a name — and ' +
			'can post the summary in a channel.',
		parameters: P.obj({
			video: P.str('Link, title or id; empty = the last video read'),
			channel: P.str('Channel to post the summary in; empty = only say it'),
		}),
		async handler(args, deps) {
			const provider = deps.provider ?? null;
			if (!provider?.available) return { ok: false, spoken: t('tools.videos.no_text_model') };
			let video = recallVideo(args.video ? String(args.video) : null);
			if (!video && args.video) {
				try {
					video = await readerOf(deps)(String(args.video), readOptions(deps));
				} catch (err) {
					return videoFailure(err, deps);
				}
			}
			if (!video) return { ok: false, spoken: t('tools.videos.nothing_read') };
			const chunks = [];
			for (let at = 0; at < video.transcript.length && chunks.length < MAX_CHUNKS; at += CHUNK) {
				chunks.push(video.transcript.slice(at, at + CHUNK));
			}
			try {
				const parts = [];
				for (const [index, chunk] of chunks.entries()) {
					const text = await provider.complete({
						instructions: t('tools.videos.chunk_instructions', { index: index + 1, total: chunks.length }),
						input: chunk,
						timeoutMs: 45_000,
						maxTokens: 400,
					});
					if (text?.trim()) parts.push(text.trim());
				}
				if (!parts.length) return { ok: false, spoken: t('tools.videos.summary_failed') };
				const summary =
					parts.length === 1
						? parts[0]
						: await provider.complete({
								instructions: t('tools.videos.summary_instructions'),
								input: parts.join('\n\n'),
								timeoutMs: 45_000,
								maxTokens: 500,
							});
				const text = String(summary ?? '').trim();
				if (!text) return { ok: false, spoken: t('tools.videos.summary_failed') };
				let posted = null;
				if (args.channel) {
					const channel = resolveTextChannel(deps, String(args.channel));
					if (!channel) return { ok: false, spoken: t('tools.videos.no_channel') };
					try {
						await channel.send({ content: text.slice(0, 2000), allowedMentions: { parse: [] } });
						posted = `#${channel.name}`;
					} catch (err) {
						deps.log?.(t('tools.videos.log_failed', { error: err.message }));
					}
				}
				deps.log?.(t('tools.videos.log_summary', { title: video.title }));
				return {
					ok: true,
					spoken: posted
						? t('tools.videos.summary_posted', { title: video.title, channel: posted, summary: text })
						: t('tools.videos.summary', { title: video.title, summary: text }),
					data: { id: video.id, title: video.title, summary: text, posted },
				};
			} catch (err) {
				deps.log?.(t('tools.videos.log_failed', { error: err.message }));
				return { ok: false, spoken: t('tools.videos.summary_failed') };
			}
		},
	}),
];
