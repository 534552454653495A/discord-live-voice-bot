// Speaker attribution: tracks who the audio we send out belongs to.
//
// The audio path is priority based: while the bot owner speaks the mixer sends ONLY their audio
// (priority=true). That is why we can answer "was the audio we sent the owner's, or a mix of
// somebody else's" with certainty — the gate in front of the admin commands rests on it.
// With priority off the owner is recognised by their id among the active speakers in the mix.
//
// The real question for the gate is not "who is speaking right now" but "who said the COMMAND":
// transcript fragments are attributed to a person by audio position (word + utterance list), the
// moment the model starts answering (the turn) is marked, and voices that cut in AFTER the turn
// started do not affect that turn's decision.

import { normalize } from './text.js';

const TURN_TTL_MS = 30_000; // the turn marker counts as stale after this long
const UTTERANCE_GAP_MS = 1500; // fragments from the same person within this gap count as one utterance
const MAX_UTTERANCES = 60;

/**
 * Gate keyword entries. Turkish and English both take suffixes, so an entry of three letters or more
 * matches as a PREFIX by default ("ban" also matches "banned" / "banla"). An entry written as "=word"
 * is matched EXACTLY: short, everyday stems ("go", "gec", "al") would otherwise match a large part of
 * ordinary speech and make the "the owner said the command word" test meaningless.
 */
function parseKeywords(keywords) {
	const parsed = [];
	for (const raw of keywords ?? []) {
		const text = String(raw ?? '');
		const exact = text.startsWith('=');
		const word = exact ? text.slice(1) : text;
		const needle = normalize(word);
		if (needle) parsed.push({ word, needle, exact });
	}
	return parsed;
}

function matchesNeedle(token, needle, exact) {
	if (exact || needle.length < 3) return token === needle;
	return token.startsWith(needle);
}

export class SpeakerAttribution {
	constructor({
		windowMs = 6000,
		speakWindowMs = 1500,
		transcriptWindowMs = 15_000,
		continuityMs = 60_000,
		trackMs = 120_000,
		frameMs = 20,
		ownerId = null,
		maxText = 400,
		now = Date.now,
	} = {}) {
		this.windowMs = windowMs;
		this.speakWindowMs = speakWindowMs;
		this.transcriptWindowMs = transcriptWindowMs;
		this.continuityMs = continuityMs;
		this.maxText = maxText;
		this.now = now;
		this.ownerId = ownerId ? String(ownerId) : null;
		this.frameMs = frameMs;
		this.audioMs = 0;
		this.track = []; // the last ~2 min: { startMs, endMs, owner, id } — audio position -> speaker
		this.trackMs = trackMs;
		this.ownerAt = 0;
		this.otherAt = 0;
		this.ownerSeq = 0;
		this.otherSeq = 0;
		this.seq = 0;
		this.ownerText = '';
		this.ownerTextAt = 0;
		this.otherText = '';
		this.otherTextAt = 0;
		// Word level window, for EVERYONE: { word, at, owner, id, pos } (pos = audio position, null if none)
		this.words = [];
		// Monotonic counter stamped on every noted fragment: two fragments can share a millisecond, so
		// ordering by `at` alone would let an interjection tie with the owner's command and slip past the gate.
		this.noteSeq = 0;
		// Utterances (consecutive fragments from the same person merged): { owner, id, at, startMs, endMs, text, tokens }
		this.utterances = [];
		// The moment the model's answer/delegation turn started: { at, audioMs }
		this.turn = null;
	}

	/** Compatibility: the owner's words inside the window. */
	get ownerWords() {
		return this.words.filter((entry) => entry.owner);
	}

	/**
	 * Called for every 20 ms audio frame (from the bridge).
	 * `sent` = was the frame really appended to the Live session; the audio position only advances then.
	 */
	onFrame({ priority = false, active = [], sent = true } = {}) {
		this.seq++;
		const activeIds = active.map((id) => String(id));
		const ownerInMix = !priority && this.ownerId ? activeIds.includes(this.ownerId) : false;
		const othersInMix = activeIds.some((id) => id !== this.ownerId);
		if (priority) {
			this.ownerAt = this.now();
			this.ownerSeq = this.seq;
		} else {
			if (ownerInMix) {
				this.ownerAt = this.now();
				this.ownerSeq = this.seq;
			}
			if (othersInMix) {
				this.otherAt = this.now();
				this.otherSeq = this.seq;
			}
		}
		if (!sent) return;
		const ownerSpeaks = Boolean(priority) || ownerInMix;
		const kind = ownerSpeaks ? true : active.length > 0 ? false : null;
		// Speaker id: the owner on the priority path, the person standing out in the normal mix otherwise.
		const speakerId = kind === null ? null : priority ? this.ownerId ?? activeIds[0] ?? null : (activeIds[0] ?? null);
		this._track(kind, this.audioMs, this.audioMs + this.frameMs, speakerId);
		this.audioMs += this.frameMs;
	}

	_track(owner, startMs, endMs, speakerId = null) {
		if (owner === null) return; // silence is not recorded
		const last = this.track[this.track.length - 1];
		if (last && last.owner === owner && last.endMs === startMs && (last.id ?? null) === (speakerId ?? null)) {
			last.endMs = endMs;
			return;
		}
		this.track.push({ startMs, endMs, owner, id: speakerId ?? null });
		const cutoff = endMs - this.trackMs;
		let drop = 0;
		while (drop < this.track.length - 1 && this.track[drop].endMs < cutoff) drop++;
		if (drop > 0) this.track.splice(0, drop);
	}

	/**
	 * Id of the speaker that lines up with the transcript window (whoever owns the most audio time in it).
	 * Labelling by arrival time points at the wrong person in a busy channel.
	 */
	speakerIdAt(startMs, endMs) {
		return this.speakerShareAt(startMs, endMs).id;
	}

	/**
	 * Who this stretch of audio belongs to, and how much of it is theirs.
	 *
	 * With two people talking at once a line can straddle the moment the sent audio switched from one to
	 * the other, and "whoever holds the most of it" is then a coin toss dressed up as a fact. `share` is
	 * that person's fraction of the stretch, so the caller can say "I am not sure who said this" instead
	 * of naming the wrong person confidently.
	 *
	 * @returns {{ id: string|null, share: number, speakers: number }}
	 */
	speakerShareAt(startMs, endMs) {
		if (!Number.isFinite(startMs)) return { id: null, share: 0, speakers: 0 };
		const from = Math.max(0, startMs);
		const to = Number.isFinite(endMs) && endMs > from ? endMs : from + 400;
		const totals = new Map();
		let heard = 0;
		for (const seg of this.track) {
			if (!seg.id || seg.endMs <= from || seg.startMs >= to) continue;
			const overlap = Math.min(seg.endMs, to) - Math.max(seg.startMs, from);
			if (overlap <= 0) continue;
			totals.set(seg.id, (totals.get(seg.id) ?? 0) + overlap);
			heard += overlap;
		}
		let best = null;
		let bestMs = 0;
		for (const [id, ms] of totals) {
			if (ms > bestMs) {
				best = id;
				bestMs = ms;
			}
		}
		return { id: best, share: heard > 0 ? bestMs / heard : 0, speakers: totals.size };
	}

	/**
	 * Which audio position does this transcript fragment fall on? true=owner, false=somebody else,
	 * null=unknown. The transcript arrives late, so we look at the audio position, not the arrival time.
	 * A tie is NOT decided in the owner's favour (no bias towards opening the gate).
	 */
	speakerAt(startMs, endMs) {
		if (!Number.isFinite(startMs)) return null;
		const from = Math.max(0, startMs);
		const to = Number.isFinite(endMs) && endMs > from ? endMs : from + 400;
		let ownerMs = 0;
		let otherMs = 0;
		for (const seg of this.track) {
			if (seg.endMs <= from || seg.startMs >= to) continue;
			const overlap = Math.min(seg.endMs, to) - Math.max(seg.startMs, from);
			if (overlap <= 0) continue;
			if (seg.owner) ownerMs += overlap;
			else otherMs += overlap;
		}
		if (ownerMs === 0 && otherMs === 0) return null;
		return ownerMs > otherMs;
	}

	/**
	 * New Live session: the server's audio timeline restarts at 0, so our position counter has to be
	 * reset too — otherwise the position drifts after a drop and the owner's own words stop matching.
	 * The gate state (ownerAt/words) is kept on purpose: across short drops the owner's words from a
	 * moment ago should stay valid. Audio positions from the old session cannot be compared with the new
	 * counter, so the positions are cleared while the arrival time stays.
	 */
	resetSession() {
		this.audioMs = 0;
		this.track = [];
		for (const entry of this.words) entry.pos = null;
		for (const utt of this.utterances) {
			utt.startMs = null;
			utt.endMs = null;
		}
		this.turn = null;
	}

	/** Is the audio we are sending right now (the last ~1.5 s) the owner's, with nobody speaking after? */
	ownerSpeakingNow() {
		if (!this.ownerAt) return false;
		if (this.now() - this.ownerAt > this.speakWindowMs) return false;
		return this.ownerSeq > this.otherSeq;
	}

	/**
	 * Attributes text coming from the Live transcript to its speaker. When `startMs/endMs` (the audio
	 * position) is given the attribution follows the audio position; otherwise the arrival time is used
	 * (fallback path). When `owner`/`id` is given (local STT: one fragment per user) it is used directly.
	 */
	noteTranscript(text, { startMs = null, endMs = null, owner: ownerOverride = null, id: idOverride = null } = {}) {
		const fragment = String(text ?? '').trim();
		if (!fragment) return;
		const at = this.now();
		// On the local STT path the speaker is known for sure (one fragment per user): it is passed in.
		const byAudio = typeof ownerOverride === 'boolean' ? ownerOverride : this.speakerAt(startMs, endMs);
		const owner = byAudio === null ? this.ownerSpeakingNow() : byAudio;
		const id = idOverride ? String(idOverride) : owner ? this.ownerId : this.speakerIdAt(startMs, endMs);
		const pos = Number.isFinite(startMs) ? startMs : null;
		const tokens = normalize(fragment).split(' ').filter(Boolean);
		if (owner) {
			this.ownerText = `${this.ownerText} ${fragment}`.slice(-this.maxText);
			this.ownerTextAt = at;
		} else {
			this.otherText = `${this.otherText} ${fragment}`.slice(-this.maxText);
			this.otherTextAt = at;
		}
		const seq = ++this.noteSeq;
		for (const word of tokens) this.words.push({ word, at, owner, id: id ?? null, pos, seq });
		this._pruneWords(at);
		this._noteUtterance({ owner, id: id ?? null, at, seq, startMs: pos, endMs: Number.isFinite(endMs) ? endMs : null, text: fragment, tokens });
	}

	_noteUtterance({ owner, id, at, seq, startMs, endMs, text, tokens }) {
		const last = this.utterances[this.utterances.length - 1];
		const sameSpeaker = last && last.owner === owner && (last.id ?? null) === (id ?? null);
		const close =
			sameSpeaker &&
			(at - last.at <= UTTERANCE_GAP_MS ||
				(startMs !== null && last.endMs !== null && startMs - last.endMs <= UTTERANCE_GAP_MS && startMs >= last.startMs));
		if (close) {
			last.at = at;
			last.seq = seq;
			if (endMs !== null) last.endMs = endMs;
			last.text = `${last.text} ${text}`.slice(-this.maxText);
			last.tokens.push(...tokens);
			if (last.tokens.length > 80) last.tokens.splice(0, last.tokens.length - 80);
			return;
		}
		this.utterances.push({ owner, id: id ?? null, at, seq, startMs, endMs, text, tokens: [...tokens] });
		const cutoff = at - Math.max(this.transcriptWindowMs * 2, this.continuityMs);
		let drop = 0;
		while (drop < this.utterances.length - 1 && this.utterances[drop].at < cutoff) drop++;
		if (drop > 0) this.utterances.splice(0, drop);
		if (this.utterances.length > MAX_UTTERANCES) this.utterances.splice(0, this.utterances.length - MAX_UTTERANCES);
	}

	_pruneWords(now = this.now()) {
		// The continuity window (60 s) keeps words around longer than the 15 s window does.
		const cutoff = now - Math.max(this.transcriptWindowMs, this.continuityMs);
		let drop = 0;
		while (drop < this.words.length && this.words[drop].at < cutoff) drop++;
		if (drop > 0) this.words.splice(0, drop);
		if (this.words.length > 400) this.words.splice(0, this.words.length - 400);
	}

	// ---------------------------------------------------------------- turn (the model's answer moment)

	/**
	 * The model started an answer/delegation: the audio position sent so far and the clock are marked.
	 * Utterances arriving AFTER this moment (people cutting in) do not enter this turn's gate decision.
	 */
	markTurn({ audioMs = this.audioMs, at = this.now() } = {}) {
		this.turn = { at, audioMs: Number.isFinite(audioMs) ? audioMs : null };
		return this.turn;
	}

	/** The active turn (when not stale). If `turn` is given (not undefined) that one is used; null = no cut-off. */
	_resolveTurn(turn, now) {
		if (turn !== undefined) return turn;
		if (!this.turn) return null;
		if (now - this.turn.at > TURN_TTL_MS) return null;
		return this.turn;
	}

	/**
	 * Did this entry (word/utterance) arrive before the turn started? When an audio position exists it is
	 * the one compared: at the moment of the turn `audioMs` of audio had been sent, so audio starting at
	 * or after that position comes AFTER the turn (strictly <). Without a position (the local path) the
	 * arrival time decides: an utterance noted in the same instant as the mark belongs to the turn (<=).
	 */
	_beforeTurn(entry, turn) {
		if (!turn) return true;
		const pos = entry.pos ?? entry.startMs ?? null;
		if (pos !== null && Number.isFinite(turn.audioMs)) return pos < turn.audioMs;
		return entry.at <= turn.at;
	}

	/**
	 * Who said the command word LAST inside the window? { owner, id, word, at }, or null.
	 * When a turn is marked, words that arrived after it started do not count (somebody cutting in does
	 * not change the decision).
	 * Continuity: even when the owner's word is older than the window (15 s) it stays valid within
	 * `continuityMs` (60 s) as long as nobody else has spoken since (the bot asked a question and the
	 * owner answered: "which role?" -> "chillz").
	 */
	commandSpeaker(keywords, { windowMs = this.transcriptWindowMs, continuityMs = this.continuityMs, turn = undefined } = {}) {
		const now = this.now();
		const cut = this._resolveTurn(turn, now);
		const needles = parseKeywords(keywords);
		if (!needles.length) return null;
		let sawOther = false; // did somebody else speak in the scanned range (before the turn)
		for (let i = this.words.length - 1; i >= 0; i--) {
			const entry = this.words[i];
			const age = now - entry.at;
			if (age > Math.max(windowMs, continuityMs)) break;
			if (!this._beforeTurn(entry, cut)) continue;
			if (age > windowMs && (!entry.owner || sawOther)) break; // outside the window: only uninterrupted owner words
			if (!entry.owner) sawOther = true;
			for (const { word, needle, exact } of needles) {
				if (!matchesNeedle(entry.word, needle, exact)) continue;
				return { owner: entry.owner, id: entry.id, word, at: entry.at, seq: entry.seq ?? 0 };
			}
		}
		return null;
	}

	/**
	 * The last utterance before the turn started (whose, and what). The gate: if somebody else spoke
	 * after the owner's command but before the model's answer, the command could be theirs -> we ask for
	 * it again.
	 */
	lastUtterance({ windowMs = this.transcriptWindowMs, turn = undefined, minTokens = 1 } = {}) {
		const now = this.now();
		const cut = this._resolveTurn(turn, now);
		for (let i = this.utterances.length - 1; i >= 0; i--) {
			const utt = this.utterances[i];
			if (now - utt.at > windowMs) break;
			if (!this._beforeTurn(utt, cut)) continue;
			if (utt.tokens.length < minTokens) continue;
			return { owner: utt.owner, id: utt.id, text: utt.text, at: utt.at, seq: utt.seq ?? 0, tokens: utt.tokens.length };
		}
		return null;
	}

	/**
	 * Could the transcript of the utterance that triggered the turn still be on its way? (Yes when the
	 * last utterance's audio position is well behind the turn.) In that case the gate waits a moment.
	 */
	transcriptLagging({ turn = undefined, lagMs = 3000 } = {}) {
		const now = this.now();
		const cut = this._resolveTurn(turn, now);
		if (!cut) return false;
		const last = this.utterances[this.utterances.length - 1];
		if (!last) return true;
		if (Number.isFinite(cut.audioMs) && last.endMs !== null) return last.endMs < cut.audioMs - lagMs;
		return last.at < cut.at - lagMs;
	}

	// ---------------------------------------------------------------- legacy (frame level) gate helpers

	/**
	 * Which of these words did the owner say within the last `windowMs`? (null when none)
	 * Only words inside the window are looked at; a ban command spoken minutes ago does not open the gate.
	 * In a suffixing language a keyword rarely shows up bare (the root picks up inflections), so words of
	 * three letters or more are matched as a prefix while short ones need an exact match.
	 */
	ownerMatch(words, windowMs = this.transcriptWindowMs) {
		const now = this.now();
		const tokens = this.words.filter((entry) => entry.owner && now - entry.at <= windowMs).map((entry) => entry.word);
		if (!tokens.length) return null;
		for (const { word, needle, exact } of parseKeywords(words)) {
			if (tokens.some((token) => matchesNeedle(token, needle, exact))) return word;
		}
		return null;
	}

	/** Did the owner really say one of these words within the last `windowMs`? */
	ownerSaidRecently(words, windowMs = this.transcriptWindowMs) {
		return this.ownerMatch(words, windowMs) !== null;
	}

	/**
	 * Frame level gate: the most recently heard audio must be the owner's and must not be too old. It
	 * closes if somebody else spoke after the owner. The admin tools now decide with `commandSpeaker`
	 * (who said the command); this is left only for keyword-less/legacy callers.
	 */
	isOwnerActive() {
		if (!this.ownerSeq) return false;
		if (this.now() - this.ownerAt > this.windowMs) return false;
		return this.ownerSeq > this.otherSeq;
	}

	/** Short status snapshot for debugging/telemetry. */
	state() {
		return {
			ownerAt: this.ownerAt,
			otherAt: this.otherAt,
			ownerActive: this.isOwnerActive(),
			ownerText: this.ownerText.slice(-120),
			turn: this.turn,
		};
	}
}
