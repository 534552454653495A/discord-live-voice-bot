// Consecutive transcript deltas -> runs, one per stretch of one speaker.
//
// The realtime API gives one [start_ms, end_ms] per delta and nothing else: no word timings and no
// speaker field. The grouping therefore follows DELIVERY order, which the API does guarantee, and uses
// the timestamps only to ask the audio track who was audible at that position. Deltas are shorter than
// a word in practice, so nothing is ever thrown away: dropping one corrupts a word rather than
// removing a mistake.
//
// A "run" is what makes two people in one flush come out as two lines with two names, instead of one
// line carrying whoever happened to speak last.

// Shorter than a syllable and a half. Below this the boundary sits inside the mixer's own hysteresis,
// so the LABEL cannot be trusted even though the text can.
const RUN_MIN_MS = 300;
// Below this the TEXT cannot stand as a line of its own; it belongs to a neighbour.
const RUN_MIN_CHARS = 2;
// The longest hole one voice may be carried across: somebody talking through a cough, not two turns.
const RUN_BRIDGE_MS = 400;

export const runText = (run) =>
	run.parts
		.map((part) => part.text)
		.join('')
		.replace(/\s+/g, ' ')
		.trim();

export function runEnd(run) {
	let end = null;
	for (const part of run.parts) {
		if (Number.isFinite(part.endMs) && (end === null || part.endMs > end)) end = part.endMs;
	}
	return end;
}

export function runSpanMs(run) {
	let start = null;
	let end = null;
	for (const part of run.parts) {
		if (Number.isFinite(part.startMs) && (start === null || part.startMs < start)) start = part.startMs;
		if (Number.isFinite(part.endMs) && (end === null || part.endMs > end)) end = part.endMs;
	}
	return start === null || end === null ? 0 : Math.max(0, end - start);
}

/** Everybody the audio heard anywhere in this run, used to name the candidates on an unknown line. */
export function runCandidates(run) {
	const ids = new Set();
	for (const part of run.parts) {
		for (const id of part.ids ?? []) ids.add(id);
	}
	return [...ids];
}

/**
 * May the line be cut between these two deltas? Only where they do not run into each other inside a
 * word. Deltas are sub-word, so a handover can land mid-word, and "ban Da" / "na" is a worse answer
 * than one line carrying two names: it also stops the command parser recognising either half.
 */
function canCut(prevText, text) {
	if (!prevText) return true;
	return /\s$/u.test(prevText) || /^[\s.,!?;:…"')\]]/u.test(text);
}

/** Neighbouring runs that turn out to be the same speaker are one run (folding and bridging make these). */
function coalesce(runs) {
	for (let i = runs.length - 1; i >= 1; i--) {
		const run = runs[i];
		const prev = runs[i - 1];
		if (prev.id !== run.id) continue;
		prev.parts.push(...run.parts);
		prev.mixed = prev.mixed || run.mixed;
		runs.splice(i, 1);
	}
	return runs;
}

/**
 * @param {Array<{ text: string, startMs: number|null, endMs: number|null, id: string|null, sure: boolean, confidence: string, ids: string[] }>} parts
 *   the deltas in the order they arrived
 * @returns {Array<{ id: string|null, parts: Array, mixed: boolean }>}
 *   id    = the speaker, or null when the audio could not tell
 *   mixed = the run absorbed something uncertain, or somebody else's fragment. The transcript line is
 *           still this person's; it simply may not be ACTED on. Meaningless while id is null.
 */
export function buildRuns(parts) {
	// 1) Split on a confident change of speaker, but never inside a word.
	const runs = [];
	let pending = []; // whitespace that arrived before any word had a run to belong to
	let lastText = '';
	for (const part of parts) {
		const current = runs[runs.length - 1];
		// Whitespace between words says nothing about who is talking: it stays where it is and does not
		// open a run, change a speaker, or cost a run its purity.
		if (!part.text.trim()) {
			if (current) current.parts.push(part);
			else pending.push(part);
			lastText = part.text || lastText;
			continue;
		}
		const id = part.confidence === 'unsure' ? null : (part.id ?? null);
		if (current && current.id === id) {
			current.parts.push(part);
			if (!part.sure) current.mixed = true;
		} else if (current && !canCut(lastText, part.text)) {
			// The speaker changed in the middle of a word: the deltas stay glued together and the run stops
			// claiming to be one person's.
			current.parts.push(part);
			current.mixed = true;
		} else {
			runs.push({ id, parts: [...pending, part], mixed: !part.sure });
			pending = [];
		}
		lastText = part.text;
	}
	// A flush that is nothing but whitespace still has to come back out: the caller decides what an
	// empty line means, and a function that quietly eats its input is the wrong place to decide it.
	if (pending.length) runs.push({ id: null, parts: pending, mixed: false });

	// 2) Fold away runs too small to be a turn. They are folded into a neighbour, never deleted, and the
	//    neighbour loses its purity for having taken them. A line that is nothing BUT one short run is
	//    still a line: "skip" is a real thing to say.
	for (let i = runs.length - 1; i >= 0; i--) {
		if (runs.length === 1) break;
		const run = runs[i];
		if (runSpanMs(run) >= RUN_MIN_MS && runText(run).length >= RUN_MIN_CHARS) continue;
		const into = runs[i - 1] ?? runs[i + 1];
		if (!into) continue;
		if (runs[i - 1]) into.parts.push(...run.parts);
		else into.parts.unshift(...run.parts);
		into.mixed = true; // a folded run was somebody else's, or nobody's
		runs.splice(i, 1);
	}
	coalesce(runs); // folding can leave one person's two halves side by side

	// 3) Carry one voice across a short hole nobody could identify. The hole has to be genuinely
	//    unidentified, never a run that confidently names somebody else, and the same person has to be on
	//    both sides of it.
	for (let i = runs.length - 2; i >= 1; i--) {
		const hole = runs[i];
		const before = runs[i - 1];
		const after = runs[i + 1];
		if (hole.id !== null || before.id === null || before.id !== after.id) continue;
		if (runSpanMs(hole) > RUN_BRIDGE_MS) continue;
		before.parts.push(...hole.parts, ...after.parts);
		before.mixed = true;
		runs.splice(i, 2);
	}
	return coalesce(runs);
}
