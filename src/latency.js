// Latency measurement — the metrics from the GPT-Live evaluation guide:
//  * response latency: the user stops speaking -> the assistant's first audio
//  * delegation time: the backend job starts -> it finishes
//  * tool time: how long a single tool runs
// Summarised as P50/P90; the window keeps the most recent samples.

import { t } from './i18n/index.js';

const pct = (list, q) => {
	if (!list.length) return null;
	const sorted = [...list].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};

const secs = (ms) => (ms === null ? '—' : t('brain.latency_seconds', { value: (ms / 1000).toFixed(1) }));

export class LatencyMeter {
	constructor({ window = 100 } = {}) {
		this.window = window;
		this.samples = { response: [], delegation: [], tool: [] };
		this.userSpeechEndAt = null;
		this.delegationStartedAt = null;
	}

	/** The user has stopped speaking (wall clock). */
	userSpeechEnd(at = Date.now()) {
		this.userSpeechEndAt = at;
	}

	/** The assistant's first audio is arriving; returns the latency when the speech had ended. */
	assistantAudio(at = Date.now()) {
		if (this.userSpeechEndAt === null) return null;
		const ms = Math.max(0, at - this.userSpeechEndAt);
		this.userSpeechEndAt = null;
		this._push('response', ms);
		return ms;
	}

	delegationStart(at = Date.now()) {
		if (this.delegationStartedAt === null) this.delegationStartedAt = at;
	}

	delegationDone(at = Date.now()) {
		if (this.delegationStartedAt === null) return null;
		const ms = Math.max(0, at - this.delegationStartedAt);
		this.delegationStartedAt = null;
		this._push('delegation', ms);
		return ms;
	}

	toolDone(ms) {
		if (Number.isFinite(ms)) this._push('tool', ms);
	}

	_push(kind, ms) {
		const list = this.samples[kind];
		list.push(ms);
		while (list.length > this.window) list.shift();
	}

	summary() {
		const response = this.samples.response;
		const p50 = pct(response, 0.5);
		const p90 = pct(response, 0.9);
		return {
			count: response.length,
			responseP50: p50,
			responseP90: p90,
			delegationP50: pct(this.samples.delegation, 0.5),
			toolP50: pct(this.samples.tool, 0.5),
			text: t('brain.latency_summary', { p50: secs(p50), p90: secs(p90), count: response.length }),
		};
	}
}
