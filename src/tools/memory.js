// Memory tools: take a note about a person / recall it / forget it (src/memory.js).

import { t, tList } from '../i18n/index.js';
import { WORDS, displayName, findMember, ownerGate } from './helpers.js';
import { P, defineTool } from './registry.js';

/** Memory is not wired up (.env: MEMORY=0); every memory tool answers the same way. */
function noMemory() {
	return { ok: false, spoken: t('tools.memory.disabled') };
}

/** Target member: look them up when a name is given, otherwise the person speaking right now. */
async function targetOf(deps, name) {
	const wanted = String(name ?? '').trim();
	if (wanted) {
		const member = await findMember(deps, wanted);
		return member ? { id: member.id, name: displayName(member) } : null;
	}
	const id = deps.currentSpeakerId?.() ?? null;
	if (!id) return null;
	return { id, name: deps.currentSpeakerName?.() ?? null };
}

export const tools = [
	defineTool({
		name: 'remember_note',
		description:
			'Saves a short note to keep in mind about a person (e.g. "their cat is called Smokey", "exam on Friday"). If member is empty, the current speaker.',
		parameters: P.obj({ member: P.str('Person name (empty = the current speaker)'), note: P.str('Short note') }, ['note']),
		async handler(args, deps, { name }) {
			if (!deps.memory) return noMemory();
			const target = await targetOf(deps, args.member);
			if (!target) return { ok: false, spoken: t('tools.memory.no_target_remember') };
			// Anyone may leave a note about THEMSELVES. A note about somebody else is replayed to the model
			// whenever that person speaks, so writing one on their behalf needs the owner -- the same
			// asymmetry forget_note already applies.
			const speakerId = deps.currentSpeakerId?.() ?? null;
			if (!speakerId || String(speakerId) !== String(target.id)) {
				const denied = await ownerGate(deps, WORDS.forget, name);
				if (denied) return denied;
			}
			const entry = await deps.memory.add(target.id, args.note, { by: speakerId, name: target.name });
			if (!entry) return { ok: false, spoken: t('tools.memory.empty_note') };
			deps.activity?.({ kind: 'memory', whoName: target.name ?? target.id, text: t('tools.memory.note_event', { note: entry.text }) });
			return {
				ok: true,
				spoken: target.name
					? t('tools.memory.noted_named', { who: target.name, note: entry.text })
					: t('tools.memory.noted', { note: entry.text }),
				data: { member: target.name, note: entry.text },
			};
		},
	}),

	defineTool({
		name: 'recall_notes',
		description:
			'Reads your saved notes. With `search` it looks through the notes of EVERYONE for a word or phrase -- use that ' +
			'whenever you are asked what you remember about something ("what is my favourite song", "check your memory"), ' +
			'before saying you do not know. With `member` (or neither) it returns the notes about that person.',
		parameters: P.obj({
			member: P.str('Person name (empty = the current speaker)'),
			search: P.str('Word or phrase to look for across every saved note; an empty string returns the most recent notes'),
		}),
		async handler(args, deps) {
			if (!deps.memory) return noMemory();
			if (args.search !== undefined && args.search !== null) {
				const hits = deps.memory.search(String(args.search));
				if (!hits.length) {
					return { ok: true, spoken: t('tools.memory.search_empty', { query: String(args.search) }), data: { notes: [] } };
				}
				const list = hits.map((hit) => (hit.name ? `${hit.name}: ${hit.text}` : hit.text));
				return { ok: true, spoken: t('tools.memory.search_hits', { notes: list.join('; ') }), data: { notes: hits } };
			}
			const target = await targetOf(deps, args.member);
			if (!target) return { ok: false, spoken: t('tools.memory.no_target_recall') };
			const notes = deps.memory.notesFor(target.id);
			if (!notes.length) {
				return {
					ok: true,
					spoken: target.name ? t('tools.memory.no_notes', { who: target.name }) : t('tools.memory.no_notes_unknown'),
					data: { member: target.name, notes: [] },
				};
			}
			const list = notes.slice(-8).map((note) => note.text);
			return {
				ok: true,
				spoken: target.name
					? t('tools.memory.notes', { who: target.name, notes: list.join('; ') })
					: t('tools.memory.notes_unknown', { notes: list.join('; ') }),
				data: { member: target.name, notes: list },
			};
		},
	}),

	defineTool({
		name: 'forget_note',
		description:
			'Deletes one note, or every note about a person. Anyone may delete their own notes; only the owner may delete notes about someone else.',
		parameters: P.obj(
			{ member: P.str('Person name (empty = the current speaker)'), note: P.str('Part of the note to delete; "all" = every note') },
			['note'],
		),
		async handler(args, deps, { name }) {
			if (!deps.memory) return noMemory();
			const target = await targetOf(deps, args.member);
			if (!target) return { ok: false, spoken: t('tools.memory.no_target_forget') };
			const speakerId = deps.currentSpeakerId?.() ?? null;
			if (!speakerId || speakerId !== target.id) {
				const denied = await ownerGate(deps, WORDS.forget, name);
				if (denied) return denied;
			}
			const key = String(args.note ?? '').trim().toLowerCase();
			const all = tList('tools.memory.all_words').includes(key);
			const done = all ? await deps.memory.clear(target.id) : await deps.memory.remove(target.id, key);
			if (!done) return { ok: false, spoken: t('tools.memory.note_not_found') };
			deps.activity?.({
				kind: 'memory',
				whoName: target.name ?? target.id,
				text: all ? t('tools.memory.cleared_event') : t('tools.memory.removed_event', { note: key }),
			});
			return { ok: true, spoken: all ? t('tools.memory.cleared') : t('tools.memory.removed') };
		},
	}),
];
