// Music tools: the bot's own player (src/music.js). Music ducks by itself while the bot speaks.

import { t } from '../i18n/index.js';
import { QUEUE_FULL, UNSUPPORTED_LINK, YTDLP_MISSING } from '../music.js';
import { P, defineTool } from './registry.js';

/** The player is not wired up (.env: MUSIC=0); every music tool answers the same way. */
function noMusic() {
	return { ok: false, spoken: t('tools.music.disabled') };
}

function musicEvent(deps, text, meta = {}) {
	deps.activity?.({ kind: 'music', whoName: deps.personaName?.() ?? 'bot', text, meta });
}

export const tools = [
	defineTool({
		name: 'play_music',
		description:
			'Plays a song or track: a YouTube search (song title + artist) or a direct link. If something is already playing it is queued instead. Music is ducked while the bot speaks.',
		parameters: P.obj({ query: P.str('Song title (+ artist) or URL') }, ['query']),
		async handler(args, deps) {
			if (!deps.music) return noMusic();
			const query = String(args.query ?? '').trim();
			if (!query) return { ok: false, spoken: t('tools.music.no_query') };
			try {
				const { track, position, startedNow } = await deps.music.enqueue(query, { requestedBy: deps.currentSpeakerName?.() ?? null });
				const label = `${track.title}${track.uploader ? ` — ${track.uploader}` : ''}`;
				musicEvent(deps, startedNow ? t('tools.music.playing_event', { label }) : t('tools.music.queued_event', { position, label }), {
					query,
					source: track.kind,
				});
				return {
					ok: true,
					spoken: startedNow
						? t('tools.music.playing', { title: track.title })
						: t('tools.music.queued', { position, title: track.title }),
					data: { title: track.title, uploader: track.uploader, duration: track.duration, position, started_now: startedNow },
				};
			} catch (err) {
				deps.log?.(t('tools.music.log_play_failed', { error: err.message }));
				// yt-dlp's stderr can echo back what a fetched page said, so only our own reasons are spoken.
				if (err.message === UNSUPPORTED_LINK) return { ok: false, spoken: t('tools.music.unsupported_link') };
				if (err.message === QUEUE_FULL) return { ok: false, spoken: t('tools.music.queue_full') };
				if (err.message === YTDLP_MISSING) return { ok: false, spoken: t('tools.music.ytdlp_missing') };
				return { ok: false, spoken: t('tools.music.play_failed_generic') };
			}
		},
	}),

	defineTool({
		name: 'stop_music',
		description: 'Stops the music and clears the queue.',
		async handler(args, deps) {
			if (!deps.music) return noMusic();
			const stopped = deps.music.stop();
			if (!stopped) return { ok: true, spoken: t('tools.music.not_playing') };
			musicEvent(deps, t('tools.music.stopped_event', { title: stopped.title }));
			return { ok: true, spoken: t('tools.music.stopped'), data: { title: stopped.title } };
		},
	}),

	defineTool({
		name: 'pause_music',
		description: 'Pauses the music (it can be resumed from where it left off).',
		async handler(args, deps) {
			if (!deps.music) return noMusic();
			if (!deps.music.pause()) return { ok: false, spoken: t('tools.music.nothing_playing') };
			deps.log?.(t('tools.music.log_paused'));
			musicEvent(deps, t('tools.music.paused_event'));
			return { ok: true, spoken: t('tools.music.paused') };
		},
	}),

	defineTool({
		name: 'resume_music',
		description: 'Resumes paused music.',
		async handler(args, deps) {
			if (!deps.music) return noMusic();
			if (!deps.music.resume()) return { ok: false, spoken: t('tools.music.nothing_to_resume') };
			deps.log?.(t('tools.music.log_resumed'));
			musicEvent(deps, t('tools.music.resumed_event'));
			return { ok: true, spoken: t('tools.music.resumed') };
		},
	}),

	defineTool({
		name: 'skip_music',
		description: 'Skips the current track and moves on to the next one.',
		async handler(args, deps) {
			if (!deps.music) return noMusic();
			const skipped = deps.music.skip();
			if (!skipped) return { ok: false, spoken: t('tools.music.nothing_to_skip') };
			const next = deps.music.current;
			musicEvent(
				deps,
				next
					? t('tools.music.skipped_event_next', { title: skipped.title, next: next.title })
					: t('tools.music.skipped_event', { title: skipped.title }),
			);
			return {
				ok: true,
				spoken: next ? t('tools.music.skipped_to', { title: next.title }) : t('tools.music.skipped_empty'),
				data: { skipped: skipped.title, now: next?.title ?? null },
			};
		},
	}),

	defineTool({
		name: 'set_music_volume',
		description: 'Sets the music volume (0-100 percent). For "turn it down" go below the current value, for "turn it up" go above it.',
		parameters: P.obj({ percent: P.int('Volume in percent (0-100)') }, ['percent']),
		async handler(args, deps) {
			if (!deps.music) return noMusic();
			const percent = Math.max(0, Math.min(100, Math.round(Number(args.percent))));
			if (!Number.isFinite(percent)) return { ok: false, spoken: t('tools.music.bad_volume') };
			const current = deps.music.state?.()?.volume;
			const before = Number.isFinite(current) ? Math.round(current * 100) : null;
			deps.music.setVolume(percent / 100);
			// Show it in the console: the player itself does not log volume changes, so this is what
			// makes a claim like "I turned it up" verifiable.
			deps.log?.(before === null ? t('tools.music.log_volume', { percent }) : t('tools.music.log_volume_change', { before, percent }));
			musicEvent(
				deps,
				before === null ? t('tools.music.volume_event', { percent }) : t('tools.music.volume_event_change', { before, percent }),
				{ previous: before, current: percent },
			);
			const spoken =
				before === null
					? t('tools.music.volume_set', { percent })
					: before === percent
						? t('tools.music.volume_same', { percent })
						: t('tools.music.volume_changed', { before, percent });
			return { ok: true, spoken, data: { percent, before } };
		},
	}),

	defineTool({
		name: 'music_status',
		description: 'What is playing, what is in the queue, what is the volume?',
		async handler(args, deps) {
			if (!deps.music) return noMusic();
			const state = deps.music.state();
			return { ok: true, spoken: deps.music.nowPlayingText(), data: state };
		},
	}),

	defineTool({
		name: 'remove_from_queue',
		description: 'Removes a track from the queue (by queue position or title).',
		parameters: P.obj({ position: P.int('Queue position (1 = next up)'), title: P.str('Track title (partial)') }),
		async handler(args, deps) {
			if (!deps.music) return noMusic();
			const key = Number.isInteger(args.position) ? args.position : String(args.title ?? '');
			const removed = deps.music.remove(key);
			if (!removed) return { ok: false, spoken: t('tools.music.queue_not_found') };
			musicEvent(deps, t('tools.music.removed_event', { title: removed.title }));
			return { ok: true, spoken: t('tools.music.removed', { title: removed.title }), data: { title: removed.title } };
		},
	}),
];
