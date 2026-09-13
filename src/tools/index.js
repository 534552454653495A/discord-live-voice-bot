// Tool registry: pulls all the domain modules together, hands the schemas to the model and routes
// calls through the gate (owner check) to the handler.

import { tools as channelTools } from './channels.js';
import { tools as memberTools } from './members.js';
import { tools as memoryTools } from './memory.js';
import { tools as messagingTools } from './messaging.js';
import { tools as moderationTools } from './moderation.js';
import { tools as musicTools } from './music.js';
import { tools as roleTools } from './roles.js';
import { tools as sessionTools } from './session.js';
import { tools as summaryTools } from './summary.js';
import { tools as threadsTools } from './threads.js';
import { tools as reactionsTools } from './reactions.js';
import { tools as expressionsTools } from './expressions.js';
import { tools as eventsTools } from './events.js';
import { tools as automodTools } from './automod.js';
import { tools as webhooksTools } from './webhooks.js';
import { tools as serverTools } from './server.js';
import { tools as identityTools } from './identity.js';
import { ownerGate } from './helpers.js';
import { t } from '../i18n/index.js';

const REGISTRY = new Map();
for (const list of [
	messagingTools,
	sessionTools,
	memberTools,
	moderationTools,
	channelTools,
	roleTools,
	musicTools,
	memoryTools,
	summaryTools,
	identityTools,
	serverTools,
	webhooksTools,
	automodTools,
	eventsTools,
	expressionsTools,
	reactionsTools,
	threadsTools,
]) {
	for (const tool of list) {
		if (REGISTRY.has(tool.name)) throw new Error(`tool defined twice: ${tool.name}`);
		REGISTRY.set(tool.name, tool);
	}
}

/** The function-calling schemas handed to the model. */
export function toolDefinitions() {
	return [...REGISTRY.values()].map((tool) => tool.definition);
}

/** Tool name -> { gated, keywords } (for tests/documentation). */
export function toolMeta() {
	return [...REGISTRY.values()].map((tool) => ({
		name: tool.name,
		gated: Boolean(tool.gate),
		keywords: tool.gate?.keywords ?? null,
	}));
}

export function hasTool(name) {
	return REGISTRY.has(name);
}

/**
 * Runs the tool.
 * @returns {Promise<{ ok: boolean, spoken: string, data?: object, warnings?: string[], needs_confirmation?: boolean }>}
 *   spoken: the short result text the model says out loud.
 */
export async function callTool(name, args = {}, deps) {
	const tool = REGISTRY.get(name);
	if (!tool) return { ok: false, spoken: t('tools.helpers.unknown_tool', { name }) };
	if (tool.gate) {
		const denied = await ownerGate(deps, tool.gate.keywords ?? null, name);
		if (denied) return denied;
	}
	try {
		return await tool.handler(args ?? {}, deps, { name });
	} catch (err) {
		deps?.log?.(t('tools.helpers.log_tool_error', { name, error: String(err?.stack ?? err) }));
		return { ok: false, spoken: t('tools.helpers.tool_error', { name, error: String(err?.message ?? err) }) };
	}
}

/** Turns a tool result into the function_call_output text sent back to the Responses backend. */
export function toolOutput(result) {
	return JSON.stringify({
		ok: Boolean(result?.ok),
		summary: result?.spoken ?? '',
		...(result?.needs_confirmation ? { needs_confirmation: true } : {}),
		...(result?.denied ? { denied: true } : {}),
		...(result?.error ? { error: result.error } : {}),
		...(result?.data ? { data: result.data } : {}),
		...(result?.warnings?.length ? { warnings: result.warnings } : {}),
	});
}
