// Jev (TypeSafe's System One model): typed judgments about what somebody said, for the things a
// keyword grammar cannot see. It never generates text and never decides on its own: it answers the
// narrow questions the code asks, as probabilities, and the code decides what to do with them.
//
// Two uses. `judge` asks two questions about a finished line, together in one round trip (the docs'
// own advice: ask everything up front, filter in code): is this said TO the bot at all, and what kind
// of thing is it -- a request, a question, banter, or people talking among themselves. `asks` is the
// owner gate's question: does what the owner just said ask for THIS tool? The keyword list cannot know
// every phrasing, and Turkish inflects a verb out of a prefix match ("konusmaya devam edebilirsin" for
// "let it talk"); who spoke stays the audio's call, Jev only reads the owner's own words.
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { t } from './i18n/index.js';

// One round trip per question set. A line has already been handed to the model when `judge` is asked,
// and a gate decision is worth a moment, so both sit under one timeout.
const JEV_TIMEOUT_MS = 2500;
// After this many failures in a row the session stops asking: a dead endpoint must not cost a timeout
// per line. The first and the last failure are logged, not every one.
const JEV_MAX_FAILURES = 5;
// A burst of lines in a busy room: past this many in flight the rest are skipped, not queued.
const JEV_MAX_IN_FLIGHT = 3;
// Enough context for "is this for the bot" without sending the room's whole history.
const RECENT_CHARS = 300;

/**
 * @param {object} cfg  jev, jevApiKey, jevModel
 * @param {{ log?: Function, client?: object }} deps  a client with systemOne(request); tests pass a fake
 * @returns {{ enabled: boolean, model: string, judge: Function, asks: Function }}
 */
export function createJev(cfg, { log = () => {}, client = null } = {}) {
	const model = cfg.jevModel ?? 'jev-latest';
	if (!cfg.jev || (!cfg.jevApiKey && !client)) return { enabled: false, model, judge: async () => null, asks: async () => null };
	const api = client ?? new TypeSafeClient({ apiKey: cfg.jevApiKey, timeout: JEV_TIMEOUT_MS });
	let failures = 0;
	let inFlight = 0;

	/** One request; null when it could not be made or answered. Failures are counted here, once. */
	async function run(state, questions) {
		if (failures >= JEV_MAX_FAILURES || inFlight >= JEV_MAX_IN_FLIGHT) return null;
		inFlight++;
		try {
			const response = await api.systemOne({ model, state, questions });
			failures = 0;
			return response?.answers ?? null;
		} catch (err) {
			failures++;
			// The message only: a failure must never print the key or the request.
			if (failures === 1 || failures === JEV_MAX_FAILURES) log(t('runtime.log_jev_failed', { error: err?.message ?? String(err), count: failures }));
			return null;
		} finally {
			inFlight--;
		}
	}

	return {
		enabled: true,
		model,
		/**
		 * @returns {Promise<{ addressed: number, kind: string, kindP: number, confidence: number }|null>}
		 *   addressed = probability the line was said to the bot; kind = command | question | banter | chat
		 */
		async judge({ line, speaker, botName, ownerSpeaking = false, recent = '' }) {
			const answers = await run(
				{
					line: String(line ?? ''),
					speaker: String(speaker ?? ''),
					assistant: String(botName ?? 'bot'),
					speaker_is_owner: Boolean(ownerSpeaking),
					recent_lines: String(recent ?? '').slice(-RECENT_CHARS),
				},
				{
					addressed: {
						type: 'noul',
						instructions:
							'Is `line` said TO the assistant named `assistant`, rather than to another person in the voice channel? '
							+ 'The assistant is a member of the channel with a persona; people also talk among themselves.',
						criteria: {
							true: 'The line is aimed at the assistant: it names it, answers it, or asks or tells it something.',
							false: 'The line is aimed at another person, or is people talking among themselves.',
						},
					},
					kind: {
						type: 'choice',
						instructions: 'What kind of thing is `line`, as said by `speaker` in a voice channel where friends hang out with an AI assistant?',
						criteria: {
							command:
								'A real request for the assistant to do something (play or stop music, send or read a message, move or mute somebody, remember something, change a setting).',
							question: 'A real question the assistant is expected to answer.',
							banter: 'A joke, insult, swearing, wind-up, dare or absurd order that is not meant seriously and expects no real action.',
							chat: 'People talking among themselves; nothing is asked of the assistant.',
						},
					},
				},
			);
			const addressed = answers?.addressed?.noul;
			const kind = answers?.kind;
			if (typeof addressed !== 'number' || !kind?.choice) return null;
			return {
				addressed,
				kind: kind.choice,
				kindP: Number(kind.probabilities?.[kind.choice] ?? kind.confidence ?? 0),
				confidence: Number(kind.confidence ?? 0),
			};
		},
		/**
		 * Does what the owner said ask for this tool? The line is the owner's own recent words; the tool
		 * is named and described as the model sees it.
		 * @returns {Promise<number|null>} the probability, or null when there is no answer
		 */
		async asks({ line, tool, description = '' }) {
			const answers = await run(
				{
					line: String(line ?? ''),
					tool: String(tool ?? ''),
					tool_does: String(description ?? ''),
				},
				{
					asks: {
						type: 'noul',
						instructions:
							'`line` was just said by the owner of an AI assistant in a voice channel. Does it ask the assistant to do what '
							+ '`tool` does (described in `tool_does`), including undoing or switching off that state? Any wording counts; '
							+ 'a joke, a remark about the tool, or an instruction NOT to do it does not.',
						criteria: {
							true: 'The owner is asking for this action (or its opposite state) to be carried out now.',
							false: 'The owner is not asking for this action: unrelated talk, a question about it, a joke, or a request not to do it.',
						},
					},
				},
			);
			const p = answers?.asks?.noul;
			return typeof p === 'number' ? p : null;
		},
	};
}
