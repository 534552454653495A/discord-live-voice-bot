// Local brain: when GPT-Live is unavailable (out of credit / BRAIN_MODE=local) it carries the voice
// conversation with a text model (DeepSeek or OpenAI chat). Tool calling (function calling) is
// supported in the OpenAI-compatible shape; the resulting text is spoken by Chatterbox (index.js).
//
//   whisper (ears) -> LocalBrain (DeepSeek, tools) -> Chatterbox (mouth)

import { EventEmitter } from 'node:events';
import { t, tList } from './i18n/index.js';
import { similarity } from './matcher.js';
import { normalize } from './text.js';

const MAX_TOOL_ROUNDS = 4;
const MAX_HISTORY = 20;

/** Voice-channel manners appended to the persona; one line per rule, joined into a single note. */
function localNote() {
	return tList('brain.local_note').join(' ');
}

/** Generic names the bot also answers to, on top of its own name. */
function wakeWords() {
	return tList('brain.local_wake_words');
}

/** toolDefinitions() (Responses format) -> chat.completions `tools` format. */
export function toChatTools(definitions = []) {
	return definitions
		.filter((tool) => tool?.type === 'function' && tool.name)
		.map((tool) => ({
			type: 'function',
			function: { name: tool.name, description: tool.description ?? '', parameters: tool.parameters ?? { type: 'object', properties: {} } },
		}));
}

export class LocalBrain extends EventEmitter {
	constructor({
		provider,
		persona = () => ({ name: null, instructions: '' }),
		tools = [],
		callTool = null,
		toolOutput = (result) => JSON.stringify(result),
		respondPolicy = 'auto', // always | addressed | auto
		participants = () => 1,
		log = () => {},
		now = Date.now,
		maxTokens = 220,
	} = {}) {
		super();
		this.provider = provider;
		this.persona = persona;
		this.tools = toChatTools(tools);
		this.callTool = callTool;
		this.toolOutput = toolOutput;
		this.respondPolicy = respondPolicy;
		this.participants = participants;
		this.log = log;
		this.now = now;
		this.maxTokens = maxTokens;
		this.history = [];
		this.lastReplyAt = 0;
		this.busy = false;
		this.pending = [];
	}

	get available() {
		return Boolean(this.provider?.available && this.provider.textClient?.chat?.completions);
	}

	/** Should this utterance be answered? */
	shouldRespond(text, { addressed = null } = {}) {
		if (this.respondPolicy === 'always') return true;
		const name = this.persona().name;
		const words = [...new Set([name, ...wakeWords()].filter(Boolean).map((w) => normalize(w)).filter(Boolean))];
		const tokens = normalize(text).split(' ').filter(Boolean);
		// The transcript can mangle the name ("Arla", "Ariaa"): for words of 4+ letters a prefix or a similarity of >=0.75 is enough.
		const isAddressed =
			addressed ??
			tokens.some((token) =>
				words.some((w) => token === w || (w.length >= 4 && (token.startsWith(w) || similarity(token, w) >= 0.75))),
			);
		if (isAddressed) return true;
		if (this.respondPolicy === 'addressed') return false;
		// auto: one-on-one chat, an ongoing conversation (we answered within the last 25 s) or a question
		if (this.participants() <= 1) return true;
		if (this.now() - this.lastReplyAt < 25_000) return true;
		return /\?\s*$/.test(text) && tokens.length >= 3;
	}

	_systemPrompt() {
		const { name, instructions } = this.persona();
		return [instructions, localNote(), name ? t('brain.local_name_hint', { name }) : ''].filter(Boolean).join('\n');
	}

	_remember(role, content) {
		this.history.push({ role, content });
		while (this.history.length > MAX_HISTORY) this.history.shift();
	}

	/**
	 * Adds the user utterance to the context and produces a reply when one is needed. Runs serially
	 * (a single generation at a time). `context` holds the extra dependencies of this utterance (for
	 * example pinning the turn for the owner gate) and is passed unchanged to the tool calls this
	 * utterance triggers; another utterance arriving in between does not change this request's decision.
	 */
	async handleUtterance({ userName = t('brain.local_default_speaker'), text, addressed = null, context = null } = {}) {
		const line = String(text ?? '').trim();
		if (!line) return { responded: false, text: '' };
		this._remember('user', `${userName}: ${line}`);
		if (!this.shouldRespond(line, { addressed })) return { responded: false, text: '' };
		if (!this.available) return { responded: false, text: '', error: t('brain.local_no_text_provider') };
		if (this.busy) {
			// An utterance arriving mid-generation: it will be in the context next turn; two replies must not overlap.
			return { responded: false, text: '', queued: true };
		}
		this.busy = true;
		try {
			const reply = await this._respond(context);
			if (reply) {
				this._remember('assistant', reply);
				this.lastReplyAt = this.now();
				this.emit('reply', reply);
			}
			return { responded: Boolean(reply), text: reply ?? '' };
		} catch (err) {
			this.log(t('brain.local_error', { error: err.message }));
			return { responded: false, text: '', error: err.message };
		} finally {
			this.busy = false;
		}
	}

	async _respond(context = null) {
		const client = this.provider.textClient;
		const model = this.provider.textModel;
		const messages = [{ role: 'system', content: this._systemPrompt() }, ...this.history];
		for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
			const response = await client.chat.completions.create(
				{
					model,
					messages,
					max_tokens: this.maxTokens,
					...(this.tools.length && this.callTool ? { tools: this.tools, tool_choice: round < MAX_TOOL_ROUNDS ? 'auto' : 'none' } : {}),
				},
				{ timeout: 45_000 },
			);
			const choice = response.choices?.[0];
			const message = choice?.message ?? {};
			const calls = message.tool_calls ?? [];
			if (!calls.length) return String(message.content ?? '').replace(/\s+/g, ' ').trim();
			messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
			for (const call of calls) {
				const name = call.function?.name;
				let args = {};
				try {
					args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
				} catch {
					args = {};
				}
				let output;
				const startedAt = this.now();
				try {
					const result = await this.callTool(name, args, context);
					output = this.toolOutput(result);
				} catch (err) {
					output = JSON.stringify({ ok: false, error: err.message });
				}
				this.emit('tool', { name, args, output, ms: this.now() - startedAt });
				messages.push({ role: 'tool', tool_call_id: call.id, content: String(output).slice(0, 4000) });
			}
		}
		return '';
	}

	/** A context note for the model (tool result, setting change and so on); produces no reply. */
	note(text) {
		const line = String(text ?? '').trim();
		if (line) this._remember('system', line);
	}

	reset() {
		this.history = [];
		this.lastReplyAt = 0;
	}
}
