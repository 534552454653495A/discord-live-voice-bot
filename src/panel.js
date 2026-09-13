// Local admin panel: what is the bot doing, who wrote what, who said what in voice?
//
// Events are kept in an in-memory ring buffer and, when asked for, appended to a JSONL file; the
// panel binds to 127.0.0.1 only (it is never exposed) and validates the Host header (closed to DNS
// rebinding). User data reaches the HTML only through textContent/setAttribute (no XSS).

import http from 'node:http';
import { dirname } from 'node:path';
import { appendFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';

import { t } from './i18n/index.js';

const FILE_ROTATE_BYTES = 5 * 1024 * 1024;
const BACKUPS = 2;

// Personal text can arrive in `text` (a transcript, a DM, a note) or hidden inside `meta` (the owner's
// words behind a gate decision, a tool's arguments, a spoken music query). While recording is off all of
// it is replaced by its length, so the event is still counted and timed but says nothing.
const REDACT_TEXT_KINDS = new Set(['voice', 'dm', 'channel', 'memory']);
const REDACT_META_FIELDS = ['text', 'args', 'query', 'note', 'result'];

function redactEntry(entry) {
	if (REDACT_TEXT_KINDS.has(entry.kind) && entry.text) entry.text = `[${String(entry.text).length} characters, not recorded]`;
	if (entry.meta && typeof entry.meta === 'object') {
		for (const field of REDACT_META_FIELDS) {
			if (entry.meta[field] !== undefined && entry.meta[field] !== null) {
				entry.meta = { ...entry.meta, [field]: `[${String(entry.meta[field]).length} characters, not recorded]` };
			}
		}
	}
	return entry;
}

/** Event kinds: dm | channel | voice | tool | gate | safety | session | latency | music | memory */
export class ActivityLog {
	constructor({ file = null, limit = 3000, log = null, redact = () => false } = {}) {
		this.file = file;
		this.limit = limit;
		this.log = log;
		// Privacy is enforced HERE rather than at each call site: every producer reaches push(), so a new
		// one cannot forget to redact. `redact()` is read per event so the setting can change at runtime.
		this.redact = redact;
		this.events = [];
		this.nextId = 1;
		this.counts = Object.create(null);
		this.loaded = false;
		this.dirReady = false;
		this.writeFailed = false;
		this.pending = Promise.resolve();
		this.bytesSinceStat = 0;
	}

	push(event) {
		const entry = {
			id: this.nextId++,
			at: new Date().toISOString(),
			kind: event.kind ?? 'session',
			direction: event.direction ?? null,
			who: event.who ?? null,
			whoName: event.whoName ?? null,
			text: event.text ?? '',
			meta: event.meta ?? null,
		};
		if (this.redact()) redactEntry(entry);
		this.events.push(entry);
		this.counts[entry.kind] = (this.counts[entry.kind] ?? 0) + 1;
		if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
		if (this.file && event.persist !== false) void this._append(entry);
		return entry;
	}

	async _append(entry) {
		const line = `${JSON.stringify(entry)}\n`;
		this.pending = this.pending
			.then(async () => {
				try {
					if (!this.dirReady) {
						await mkdir(dirname(this.file), { recursive: true });
						this.dirReady = true;
					}
					// Check rarely against an approximate byte counter instead of calling stat() on every event.
					this.bytesSinceStat += line.length;
					if (this.bytesSinceStat > 256 * 1024) {
						this.bytesSinceStat = 0;
						await this._rotateIfNeeded();
					}
					await appendFile(this.file, line, 'utf8');
				} catch (err) {
					if (!this.writeFailed) {
						this.writeFailed = true;
						this.log?.(t('panel.log_write_failed', { file: this.file, error: err.message }));
					}
				}
			})
			.catch(() => {});
		return this.pending;
	}

	async _rotateIfNeeded() {
		try {
			const info = await stat(this.file);
			if (info.size < FILE_ROTATE_BYTES) return;
			await unlink(`${this.file}.${BACKUPS}`).catch(() => {});
			for (let i = BACKUPS - 1; i >= 1; i--) {
				await rename(`${this.file}.${i}`, `${this.file}.${i + 1}`).catch(() => {});
			}
			await rename(this.file, `${this.file}.1`);
		} catch {
			/* no file, nothing to rotate */
		}
	}

	/** On start-up, pulls earlier sessions into the panel (the file's last lines; if too few, the .1 backup as well). */
	async load(limit = 500) {
		if (!this.file || this.loaded) return this.events.length;
		this.loaded = true;
		const lines = [];
		for (const candidate of [`${this.file}.1`, this.file]) {
			try {
				lines.push(...(await readFile(candidate, 'utf8')).split('\n').filter(Boolean));
			} catch {
				/* skip it if it is not there */
			}
		}
		const restored = [];
		for (const line of lines.slice(-limit)) {
			try {
				restored.push(JSON.parse(line));
			} catch {
				/* skip a corrupt line */
			}
		}
		// Events pushed before the load (the gateway can come up early) belong at the end.
		const fresh = this.events;
		this.events = [];
		this.counts = Object.create(null);
		for (const entry of [...restored, ...fresh]) {
			entry.id = this.nextId++;
			this.events.push(entry);
			this.counts[entry.kind] = (this.counts[entry.kind] ?? 0) + 1;
		}
		while (this.events.length > this.limit) this.events.shift();
		return restored.length;
	}

	/** For the panel: the latest events (kind/text/date filter). */
	list({ since = 0, kinds = [], q = '', limit = 300, from = null, to = null } = {}) {
		const needle = String(q ?? '').trim().toLowerCase();
		const fromMs = from ? Date.parse(from) : null;
		const toMs = to ? Date.parse(to) : null;
		const filtered = this.events.filter((event) => {
			if (event.id <= since) return false;
			if (kinds.length && !kinds.includes(event.kind)) return false;
			if (Number.isFinite(fromMs) && Date.parse(event.at) < fromMs) return false;
			if (Number.isFinite(toMs) && Date.parse(event.at) > toMs) return false;
			if (!needle) return true;
			return `${event.whoName ?? ''} ${event.text} ${event.meta ? JSON.stringify(event.meta) : ''}`.toLowerCase().includes(needle);
		});
		const take = Math.max(1, Math.min(5000, Number(limit) || 300));
		const events = filtered.slice(-take);
		return { events, lastId: this.events.length ? this.events[this.events.length - 1].id : since, total: filtered.length };
	}

	stats() {
		return { ...this.counts, total: this.events.length };
	}
}

// Displayed labels only: the `kind` values themselves are an API and stay as they are.
const KIND_LABELS = {
	dm: t('panel.kinds.dm'),
	channel: t('panel.kinds.channel'),
	voice: t('panel.kinds.voice'),
	tool: t('panel.kinds.tool'),
	gate: t('panel.kinds.gate'),
	safety: t('panel.kinds.safety'),
	session: t('panel.kinds.session'),
	latency: t('panel.kinds.latency'),
	music: t('panel.kinds.music'),
	memory: t('panel.kinds.memory'),
};

// Filter tabs, in the order they appear in the header: "all" first, then the kinds.
const TAB_KINDS = [
	['', t('panel.kinds.all')],
	['dm', KIND_LABELS.dm],
	['channel', KIND_LABELS.channel],
	['voice', KIND_LABELS.voice],
	['tool', KIND_LABELS.tool],
	['gate', KIND_LABELS.gate],
	['safety', KIND_LABELS.safety],
	['music', KIND_LABELS.music],
	['memory', KIND_LABELS.memory],
	['latency', KIND_LABELS.latency],
	['session', KIND_LABELS.session],
];

// Text injected into the inline <script> goes through JSON.stringify so quotes cannot break it.
const PAGE = `<!doctype html>
<html lang="${t('panel.html_lang')}">
<head>
<meta charset="utf-8" />
<title>${t('panel.page_title')}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
	:root { color-scheme: dark; --bg:#0f1115; --card:#171a21; --line:#242835; --fg:#e6e8ee; --dim:#98a0b3; --accent:#7aa2f7; }
	* { box-sizing: border-box; }
	body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 ui-sans-serif, system-ui, "Segoe UI", sans-serif; }
	header { position:sticky; top:0; z-index:2; background:rgba(15,17,21,.95); border-bottom:1px solid var(--line); padding:12px 16px; }
	h1 { font-size:16px; margin:0 0 10px; }
	.bar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
	button, input, a.btn { background:var(--card); color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:6px 10px; font:inherit; text-decoration:none; }
	button.active { border-color:var(--accent); color:var(--accent); }
	input[type=search] { min-width:240px; }
	main { padding:12px 16px 40px; display:flex; flex-direction:column; gap:6px; }
	.ev { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:8px 10px; display:grid; grid-template-columns:74px 88px 150px 1fr; gap:10px; align-items:start; }
	.ev time { color:var(--dim); font-variant-numeric:tabular-nums; }
	.badge { color:var(--dim); }
	.who { color:var(--accent); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.text { white-space:pre-wrap; word-break:break-word; }
	.dir-in .text { border-left:3px solid #3d5a80; padding-left:8px; }
	.dir-out .text { border-left:3px solid #6b8f71; padding-left:8px; }
	.kind-gate .text, .kind-safety .text { border-left:3px solid #e0a458; padding-left:8px; }
	.status { color:var(--dim); font-size:12px; margin-left:auto; display:flex; gap:12px; }
	.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:8px; margin-top:10px; }
	.metric { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:8px 10px; }
	.metric b { display:block; font-size:18px; }
	.metric span { color:var(--dim); font-size:12px; }
	.music { margin-top:8px; color:var(--dim); font-size:12px; }
</style>
</head>
<body>
<header>
	<h1 id="title">${t('panel.heading')}</h1>
	<div class="bar" id="tabs"></div>
	<div class="bar" style="margin-top:8px">
		<input type="search" id="q" placeholder="${t('panel.search_placeholder')}" />
		<input type="datetime-local" id="from" title="${t('panel.filter_from')}" />
		<input type="datetime-local" id="to" title="${t('panel.filter_to')}" />
		<button id="pause">${t('panel.pause')}</button>
		<button id="clear">${t('panel.clear')}</button>
		<a class="btn" id="export" href="/api/export" target="_blank">${t('panel.export')}</a>
		<span class="status" id="status"></span>
	</div>
	<div class="grid" id="metrics"></div>
	<div class="music" id="music"></div>
</header>
<main id="list"></main>
<script>
const kinds = ${JSON.stringify(TAB_KINDS)};
let kind = '', paused = false, lastId = 0;
const list = document.getElementById('list');
const tabs = document.getElementById('tabs');
const q = document.getElementById('q');
const from = document.getElementById('from');
const to = document.getElementById('to');
for (const [value, label] of kinds) {
	const b = document.createElement('button');
	b.textContent = label;
	b.className = value === kind ? 'active' : '';
	b.onclick = () => { kind = value; [...tabs.children].forEach((c) => c.classList.remove('active')); b.classList.add('active'); reset(); };
	tabs.appendChild(b);
}
document.getElementById('pause').onclick = (e) => { paused = !paused; e.target.textContent = paused ? ${JSON.stringify(t('panel.resume'))} : ${JSON.stringify(t('panel.pause'))}; };
document.getElementById('clear').onclick = () => { list.replaceChildren(); };
q.oninput = () => reset();
from.onchange = () => reset();
to.onchange = () => reset();
function params(extra) {
	const p = new URLSearchParams({ q: q.value, ...extra });
	if (kind) p.set('kinds', kind);
	if (from.value) p.set('from', new Date(from.value).toISOString());
	if (to.value) p.set('to', new Date(to.value).toISOString());
	return p;
}
function reset() { list.replaceChildren(); lastId = 0; document.getElementById('export').href = '/api/export?' + params({}); }
function metric(value, label) {
	const box = document.createElement('div'); box.className = 'metric';
	const b = document.createElement('b'); b.textContent = String(value);
	const s = document.createElement('span'); s.textContent = label;
	box.append(b, s);
	return box;
}
function render(state) {
	document.getElementById('status').textContent = state.status ?? '';
	if (state.title) document.getElementById('title').textContent = state.title;
	document.getElementById('metrics').replaceChildren(...(state.metrics ?? []).map((m) => metric(m.value, m.label)));
	document.getElementById('music').textContent = state.music ?? '';
}
async function tick() {
	if (!paused) {
		try {
			const response = await fetch('/api/events?' + params({ since: String(lastId), limit: '200' }));
			const payload = await response.json();
			for (const event of payload.events) {
				lastId = Math.max(lastId, event.id);
				list.appendChild(row(event));
			}
			while (list.children.length > 800) list.firstChild.remove();
			if (payload.events.length) window.scrollTo({ top: document.body.scrollHeight });
			render(payload.state);
		} catch { /* stay quiet if the server is gone */ }
	}
	setTimeout(tick, 1500);
}
function row(event) {
	const el = document.createElement('div');
	el.className = 'ev dir-' + (event.direction ?? 'none') + ' kind-' + event.kind;
	const time = document.createElement('time');
	time.textContent = new Date(event.at).toLocaleTimeString(${JSON.stringify(t('panel.time_locale'))});
	const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = event.badge ?? '';
	const who = document.createElement('span'); who.className = 'who';
	const whoText = event.whoName ? event.whoName : (event.who ?? '');
	who.textContent = whoText; who.setAttribute('title', whoText);
	const text = document.createElement('span'); text.className = 'text';
	text.textContent = event.text + (event.meta && Object.keys(event.meta).length ? '  ' + JSON.stringify(event.meta) : '');
	el.append(time, badge, who, text);
	return el;
}
reset();
tick();
</script>
</body>
</html>`;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function hostAllowed(hostHeader, port) {
	const value = String(hostHeader ?? '').trim().toLowerCase();
	if (!value) return false;
	const match = value.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
	if (!match) return false;
	if (!LOCAL_HOSTS.has(match[1])) return false;
	return !match[2] || Number(match[2]) === port || port === 0;
}

/** Prometheus text format. */
function promText(metrics = {}) {
	const lines = [];
	for (const [name, value] of Object.entries(metrics)) {
		if (!Number.isFinite(Number(value))) continue;
		const key = `voicebot_${name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
		lines.push(`# TYPE ${key} gauge`, `${key} ${Number(value)}`);
	}
	return `${lines.join('\n')}\n`;
}

/**
 * Starts the panel (127.0.0.1 only). `state()` returns the live status metrics, `metrics()` the
 * numeric measurements (for the Prometheus /metrics endpoint), `health()` the health summary.
 * @returns {{url: string, port: number, close: () => Promise<void>}}
 */
export function startPanel({
	activity,
	port = 8787,
	host = '127.0.0.1',
	state = () => ({}),
	metrics = () => ({}),
	health = () => ({ ok: true }),
	log = () => {},
	nameFor = () => null,
}) {
	let actualPort = port;
	const server = http.createServer(async (request, response) => {
		try {
			if (!hostAllowed(request.headers.host, actualPort)) {
				response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
				response.end(t('panel.local_only'));
				return;
			}
			const url = new URL(request.url ?? '/', `http://${host}:${actualPort}`);
			const filters = () => ({
				since: Math.max(0, Number(url.searchParams.get('since') ?? 0) || 0),
				kinds: (url.searchParams.get('kinds') ?? '').split(',').filter(Boolean),
				q: url.searchParams.get('q') ?? '',
				from: url.searchParams.get('from') || null,
				to: url.searchParams.get('to') || null,
			});
			if (url.pathname === '/api/events') {
				const payload = activity.list({ ...filters(), limit: Math.min(500, Number(url.searchParams.get('limit') ?? 200) || 200) });
				payload.events = payload.events.map((event) => ({
					...event,
					badge: KIND_LABELS[event.kind] ?? event.kind,
					whoName: event.whoName ?? (event.who ? nameFor(event.who) : null),
				}));
				payload.state = state();
				response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
				response.end(JSON.stringify(payload));
				return;
			}
			if (url.pathname === '/api/export') {
				const payload = activity.list({ ...filters(), since: 0, limit: 5000 });
				response.writeHead(200, {
					'content-type': 'application/x-ndjson; charset=utf-8',
					'content-disposition': `attachment; filename="activity-${new Date().toISOString().slice(0, 10)}.jsonl"`,
				});
				response.end(payload.events.map((event) => JSON.stringify(event)).join('\n'));
				return;
			}
			if (url.pathname === '/healthz') {
				const info = health();
				response.writeHead(info.ok === false ? 503 : 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
				response.end(JSON.stringify(info));
				return;
			}
			if (url.pathname === '/metrics') {
				response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' });
				response.end(promText(metrics()));
				return;
			}
			if (url.pathname === '/' || url.pathname === '/index.html') {
				response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
				response.end(PAGE);
				return;
			}
			response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
			response.end(t('panel.not_found'));
		} catch (err) {
			log(t('panel.request_failed', { error: err.message }));
			if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
			response.end(t('panel.error'));
		}
	});

	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, host, () => {
			const address = server.address();
			actualPort = address.port;
			const url = `http://${host}:${actualPort}`;
			log(t('panel.ready', { url }));
			resolve({
				url,
				port: actualPort,
				close: () => new Promise((done) => server.close(() => done())),
			});
		});
	});
}
