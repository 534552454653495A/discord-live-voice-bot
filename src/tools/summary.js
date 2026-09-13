// Summary tool: "what was talked about today?" (via src/summary.js).

import { t } from '../i18n/index.js';
import { P, defineTool } from './registry.js';

export const tools = [
	defineTool({
		name: 'summarize_conversation',
		description: 'Briefly summarises the voice channel and text channel conversations from the last few hours.',
		parameters: P.obj({ hours: P.int('How many hours back (default 3, 0 = the whole log)') }),
		async handler(args, deps) {
			if (typeof deps.summarize !== 'function') return { ok: false, spoken: t('tools.summary.disabled') };
			const hours = Number.isFinite(Number(args.hours)) ? Math.max(0, Math.min(72, Number(args.hours))) : 3;
			const { summary, count } = await deps.summarize({ hours, spoken: true });
			return { ok: count > 0, spoken: summary, data: { hours, events: count } };
		},
	}),
];
