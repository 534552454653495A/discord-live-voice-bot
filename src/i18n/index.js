// Localisation: every string the user can see (console logs, spoken replies, panel UI, slash
// command descriptions, model instructions) is looked up here. Model-facing schema text (tool
// names, parameter descriptions) stays in English and is NOT localised.
//
// Locale bundles live in src/locales/<code>/ and are plain objects, so a missing key is a
// programming error that shows up as the key itself rather than as silence.

import en from '../locales/en/index.js';
import tr from '../locales/tr/index.js';

const BUNDLES = { en, tr };
const FALLBACK = 'en';

export const SUPPORTED_LOCALES = Object.keys(BUNDLES);

let currentCode = FALLBACK;
let currentBundle = BUNDLES[FALLBACK];

// Picked up at import time so module-level constants are built in the right language even before
// the configuration is parsed; setLocale() can still override it afterwards.
initFromEnv();

function initFromEnv() {
	const fromEnv = String(process.env.BOT_LANGUAGE ?? '').trim().toLowerCase();
	if (fromEnv) setLocale(fromEnv);
}

/**
 * Selects the active locale. Accepts "en", "tr", "tr-TR"; unknown codes fall back to English.
 * @returns {string} the code that ended up active
 */
export function setLocale(code) {
	const raw = String(code ?? '').trim().toLowerCase();
	const short = raw.slice(0, 2);
	const picked = BUNDLES[raw] ? raw : BUNDLES[short] ? short : FALLBACK;
	currentCode = picked;
	currentBundle = BUNDLES[picked];
	return picked;
}

/** Currently active locale code. */
export function locale() {
	return currentCode;
}

/** Is this locale bundled? */
export function hasLocale(code) {
	const raw = String(code ?? '').trim().toLowerCase();
	return Boolean(BUNDLES[raw] ?? BUNDLES[raw.slice(0, 2)]);
}

function lookup(bundle, key) {
	let node = bundle;
	for (const part of String(key).split('.')) {
		if (node === null || node === undefined || typeof node !== 'object') return undefined;
		node = node[part];
	}
	return node;
}

/** Replaces {name} placeholders; an unknown placeholder is left untouched so it is visible. */
function fill(text, params) {
	if (!params) return text;
	return text.replace(/\{(\w+)\}/gu, (match, name) => (params[name] === undefined ? match : String(params[name])));
}

function resolve(key) {
	const value = lookup(currentBundle, key);
	return value === undefined ? lookup(BUNDLES[FALLBACK], key) : value;
}

/**
 * Translated string. Arrays are joined with newlines (multi-line notes), functions are called with
 * the parameters (plurals, conditional wording). A missing key returns the key itself.
 */
export function t(key, params = null) {
	const value = resolve(key);
	if (typeof value === 'function') return String(value(params ?? {}));
	if (Array.isArray(value)) return value.map((line) => fill(String(line), params)).join('\n');
	if (typeof value === 'string') return fill(value, params);
	return String(key);
}

/** Translated list (keyword tables, note lines, help entries). Always a fresh array. */
export function tList(key, params = null) {
	const value = resolve(key);
	if (typeof value === 'function') {
		const produced = value(params ?? {});
		return Array.isArray(produced) ? [...produced] : [];
	}
	if (Array.isArray(value)) return value.map((item) => (typeof item === 'string' ? fill(item, params) : item));
	return [];
}

/** Raw locale value (objects: alias tables, grammars). Falls back to English, then null. */
export function tRaw(key) {
	const value = resolve(key);
	return value === undefined ? null : value;
}
