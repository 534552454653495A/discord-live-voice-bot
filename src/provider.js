// Text generation provider abstraction.
//
// One place decides it all: if there is a DeepSeek key, chat/research text goes to DeepSeek (an
// OpenAI-compatible chat completions API) and images ALWAYS go to OpenAI (Responses + vision).
// Callers never know whether it is "responses or chat"; they call complete / completeWithImages / research.

import { t } from './i18n/index.js';

const squash = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

export function createTextProvider({ openai, textModel, deepseek = null, log = () => {} }) {
	const useDeepseek = Boolean(deepseek?.client && deepseek?.model);
	const textClient = useDeepseek ? deepseek.client : openai;
	const model = useDeepseek ? deepseek.model : textModel;
	return buildProvider({
		kind: useDeepseek ? 'deepseek' : 'openai',
		textApi: useDeepseek ? 'chat' : 'responses',
		textClient,
		textModel: model,
		visionClient: openai,
		visionModel: textModel,
		log,
	});
}

/** Provider built from the legacy "deps bag" (textClient/textApi/textModel/visionClient). */
export function providerFromDeps(deps) {
	if (deps?.provider?.complete) return deps.provider;
	return buildProvider({
		kind: deps?.textApi === 'chat' ? 'deepseek' : 'openai',
		textApi: deps?.textApi === 'chat' ? 'chat' : 'responses',
		textClient: deps?.textClient ?? null,
		textModel: deps?.textModel ?? deps?.model ?? null,
		visionClient: deps?.visionClient ?? deps?.openai ?? (deps?.textApi === 'chat' ? null : deps?.textClient) ?? null,
		visionModel: deps?.visionModel ?? deps?.cfg?.textModel ?? deps?.textModel ?? null,
		log: deps?.log ?? (() => {}),
	});
}

function buildProvider({ kind, textApi, textClient, textModel, visionClient, visionModel, log }) {
	const provider = {
		kind,
		textApi,
		textModel,
		textClient,
		visionClient,
		visionModel,
		get available() {
			return Boolean(textClient && textModel);
		},

		/** Plain text answer (system instruction + user input). */
		async complete({ instructions, input, timeoutMs = 30_000, maxTokens = null }) {
			if (!textClient || !textModel) throw new Error(t('provider.text_provider_missing'));
			if (textApi === 'chat') {
				const response = await textClient.chat.completions.create(
					{
						model: textModel,
						messages: [
							{ role: 'system', content: instructions },
							{ role: 'user', content: String(input ?? '') },
						],
						...(maxTokens ? { max_tokens: maxTokens } : {}),
					},
					{ timeout: timeoutMs },
				);
				return response.choices?.[0]?.message?.content ?? '';
			}
			const response = await textClient.responses.create(
				{ model: textModel, instructions, input, ...(maxTokens ? { max_output_tokens: maxTokens } : {}) },
				{ timeout: timeoutMs },
			);
			return response.output_text ?? '';
		},

		/** Input with images: always the vision-capable OpenAI Responses path. */
		async completeWithImages({ instructions, input, timeoutMs = 30_000 }) {
			const client = visionClient?.responses ? visionClient : textApi === 'responses' ? textClient : null;
			const model = visionClient?.responses ? (visionModel ?? textModel) : textModel;
			if (!client || !model) throw new Error(t('provider.vision_client_missing'));
			const response = await client.responses.create({ model, instructions, input }, { timeout: timeoutMs });
			return response.output_text ?? '';
		},

		/** Up-to-date information: the web_search tool on OpenAI, plain chat on DeepSeek (no search). */
		async research(prompt, { timeoutMs = 60_000 } = {}) {
			if (!textClient || !textModel) throw new Error(t('provider.research_provider_missing'));
			if (textApi === 'chat') {
				const response = await textClient.chat.completions.create(
					{ model: textModel, messages: [{ role: 'user', content: prompt }] },
					{ timeout: timeoutMs },
				);
				return squash(response.choices?.[0]?.message?.content ?? '');
			}
			const response = await textClient.responses.create(
				{ model: textModel, tools: [{ type: 'web_search' }], tool_choice: 'auto', input: prompt },
				{ timeout: timeoutMs },
			);
			return squash(response.output_text ?? '');
		},

		/** Moderation (OpenAI only). */
		get moderations() {
			return visionClient?.moderations ?? null;
		},

		describe() {
			return kind === 'deepseek'
				? t('provider.describe_deepseek', { textModel, visionModel: visionModel ?? '?' })
				: t('provider.describe_openai', { textModel });
		},
	};
	void log;
	return provider;
}
