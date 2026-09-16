// Music tools: the bot's own player (src/music.js). Music ducks by itself while the bot speaks.

import { t } from '../i18n/index.js';
import { QUEUE_FULL, UNSUPPORTED_LINK, YTDLP_MISSING } from '../music.js';
import { MAX_SAVED_PER_USER, pickSaved } from '../savedtracks.js';
import { P, defineTool } from './registry.js';

/** The player is not wired up (.env: MUSIC=0); every music tool answers the same way. */
function noMusic() {
	return { ok: false, spoken: t('tools.music.disabled') };
}

function musicEvent(deps, text, meta = {}) {
	deps.activity?.({ kind: 'music', whoName: deps.personaName?.() ?? 'bot', text, meta });
}

/** Who is asking: saved lists and "I meant this one" belong to people, not to the channel. */
function speakerOf(deps) {
	const id = deps.currentSpeakerId?.() ?? null;
	return { id: id ? String(id) : null, name: deps.currentSpeakerName?.() ?? null };
}

/** yt-dlp's stderr can echo back what a fetched page said, so only our own reasons are spoken. */
function playFailure(err, deps) {
	deps.log?.(t('tools.music.log_play_failed', { error: err.message }));
	if (err.message === UNSUPPORTED_LINK) return { ok: false, spoken: t('tools.music.unsupported_link') };
	if (err.message === QUEUE_FULL) return { ok: false, spoken: t('tools.music.queue_full') };
	if (err.message === YTDLP_MISSING) return { ok: false, spoken: t('tools.music.ytdlp_missing') };
	return { ok: false, spoken: t('tools.music.play_failed_generic') };
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
				const { track, position, startedNow, duplicate } = await deps.music.enqueue(query, {
					requestedBy: deps.currentSpeakerName?.() ?? null,
				});
				const label = `${track.title}${track.uploader ? ` — ${track.uploader}` : ''}`;
				if (duplicate) {
					return {
						ok: true,
						spoken: t('tools.music.already_queued', { title: track.title }),
						data: { title: track.title, duplicate: true, position },
					};
				}
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
				return playFailure(err, deps);
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

	defineTool({
		name: 'save_track',
		description:
			"Keeps a track in this person's own saved list, to be played again by name later. Without an argument it saves " +
			'what is playing now; with a query it looks the track up first.',
		parameters: P.obj({ query: P.str('Song title (+ artist) or URL; empty = what is playing now') }),
		async handler(args, deps) {
			if (!deps.savedTracks) return { ok: false, spoken: t('tools.music.save_disabled') };
			if (!deps.music) return noMusic();
			const speaker = speakerOf(deps);
			if (!speaker.id) return { ok: false, spoken: t('tools.music.save_no_speaker') };
			const query = String(args.query ?? '').trim();
			let track = null;
			try {
				track = query ? await deps.music.resolve(query) : deps.music.current;
			} catch (err) {
				return playFailure(err, deps);
			}
			if (!track) return { ok: false, spoken: t('tools.music.save_nothing_playing') };
			const saved = deps.savedTracks.add({
				userId: speaker.id,
				userName: speaker.name,
				title: track.title,
				// What plays it again: a local file is found by the words that found it (the player matches
				// names inside MUSIC_DIR, not paths), a link or a search by its URL.
				ref: track.kind === 'file' ? (track.query ?? track.title) : (track.url ?? track.title),
				kind: track.kind,
			});
			if (!saved) return { ok: false, spoken: t('tools.music.save_full', { max: MAX_SAVED_PER_USER }) };
			if (saved.duplicate) {
				return { ok: true, spoken: t('tools.music.saved_already', { title: saved.title }), data: { id: saved.id, duplicate: true } };
			}
			await deps.savedTracks.save();
			musicEvent(deps, t('tools.music.saved_event', { title: saved.title }), { source: saved.kind });
			return { ok: true, spoken: t('tools.music.saved', { title: saved.title }), data: { id: saved.id, title: saved.title } };
		},
	}),

	defineTool({
		name: 'list_saved',
		description: 'Lists the tracks this person has saved.',
		async handler(args, deps) {
			if (!deps.savedTracks) return { ok: false, spoken: t('tools.music.save_disabled') };
			const items = deps.savedTracks.list(speakerOf(deps).id);
			if (!items.length) return { ok: true, spoken: t('tools.music.saved_empty'), data: { items: [] } };
			const lines = items.map((item, index) => `${index + 1}. ${item.title}`).join(', ');
			return {
				ok: true,
				spoken: t('tools.music.saved_list', { count: items.length, lines }),
				data: { items: items.map((item, index) => ({ index: index + 1, id: item.id, title: item.title })) },
			};
		},
	}),

	defineTool({
		name: 'remove_saved',
		description: "Takes a track out of this person's saved list: its number in the list, or a few words from its title.",
		parameters: P.obj({ query: P.str('Number in the list, or words from the title') }, ['query']),
		async handler(args, deps) {
			if (!deps.savedTracks) return { ok: false, spoken: t('tools.music.save_disabled') };
			const speaker = speakerOf(deps);
			const needle = String(args.query ?? '').trim();
			const wanted = needle ? pickSaved(deps.savedTracks.list(speaker.id), needle) : null;
			if (!wanted) {
				return { ok: false, spoken: needle ? t('tools.music.saved_not_found', { text: needle }) : t('tools.music.saved_which') };
			}
			deps.savedTracks.remove(speaker.id, wanted.id);
			await deps.savedTracks.save();
			musicEvent(deps, t('tools.music.saved_removed_event', { title: wanted.title }));
			return { ok: true, spoken: t('tools.music.saved_removed', { title: wanted.title }), data: { id: wanted.id } };
		},
	}),

	defineTool({
		name: 'play_saved',
		description: 'Plays what this person saved: one track (its number in the list, or words from its title) or the whole list.',
		parameters: P.obj({ query: P.str('Number in the list, or words from a title'), all: P.bool('true = the whole saved list') }),
		async handler(args, deps) {
			if (!deps.savedTracks) return { ok: false, spoken: t('tools.music.save_disabled') };
			if (!deps.music) return noMusic();
			const speaker = speakerOf(deps);
			const items = deps.savedTracks.list(speaker.id);
			if (!items.length) return { ok: true, spoken: t('tools.music.saved_empty'), data: { queued: 0 } };
			const needle = String(args.query ?? '').trim();
			const wanted = args.all === true || !needle ? items : [pickSaved(items, needle)].filter(Boolean);
			if (!wanted.length) return { ok: false, spoken: t('tools.music.saved_not_found', { text: needle }) };
			let queued = 0;
			let failed = 0;
			let lastError = null;
			for (const item of wanted) {
				try {
					await deps.music.enqueue(item.ref, { requestedBy: speaker.name });
					queued += 1;
				} catch (err) {
					lastError = err;
					// A full queue is a stop, not a reason to keep asking: nothing else will fit either.
					if (err.message === QUEUE_FULL) break;
					failed += 1;
				}
			}
			if (!queued) {
				return lastError?.message === QUEUE_FULL ? playFailure(lastError, deps) : { ok: false, spoken: t('tools.music.saved_none_played') };
			}
			const spoken =
				wanted.length === 1 && queued === 1
					? t('tools.music.saved_playing', { title: wanted[0].title })
					: failed
						? t('tools.music.saved_partial', { count: queued, failed })
						: t('tools.music.saved_queued', { count: queued });
			return { ok: true, spoken, data: { queued, failed, titles: wanted.map((item) => item.title) } };
		},
	}),
];
