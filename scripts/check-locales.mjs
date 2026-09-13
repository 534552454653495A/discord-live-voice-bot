// Locale integrity check.
//
// Walks the source tree, collects every literal key passed to t() / tList() / tRaw(), and verifies
// that each one resolves in every bundled locale. Also reports keys that exist in a bundle but are
// never referenced, and placeholders that appear in one locale but not in another.
//
// Run with: npm run check:locales

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const localesDir = path.join(srcDir, 'locales');

const KEY_CALL = /\b(?:t|tList|tRaw)\(\s*'([^']+)'/g;
const PLACEHOLDER = /\{(\w+)\}/g;

async function walk(dir) {
	const found = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) found.push(...(await walk(full)));
		else if (entry.name.endsWith('.js')) found.push(full);
	}
	return found;
}

function flatten(node, prefix = '', out = new Map()) {
	for (const [key, value] of Object.entries(node ?? {})) {
		const full = prefix ? `${prefix}.${key}` : key;
		const nested = value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
		if (nested) flatten(value, full, out);
		else out.set(full, value);
	}
	return out;
}

function placeholdersOf(value) {
	const text = Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '';
	return new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]));
}

const localeCodes = (await readdir(localesDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const bundles = new Map();
for (const code of localeCodes) {
	const imported = await import(`../src/locales/${code}/index.js`);
	bundles.set(code, flatten(imported.default));
}

const files = (await walk(srcDir)).filter((file) => !file.startsWith(localesDir));
const used = new Map(); // key -> first file that used it
for (const file of files) {
	const text = await readFile(file, 'utf8');
	for (const match of text.matchAll(KEY_CALL)) {
		if (!used.has(match[1])) used.set(match[1], path.relative(root, file));
	}
}

const problems = [];
for (const [key, file] of used) {
	for (const [code, table] of bundles) {
		// A key may address a whole sub-tree (tRaw); accept it when something lives under that prefix.
		const exact = table.has(key);
		const subtree = !exact && [...table.keys()].some((candidate) => candidate.startsWith(`${key}.`));
		if (!exact && !subtree) problems.push(`missing  [${code}] ${key}  (used in ${file})`);
	}
}

// Vocabulary and grammar tables are genuinely different per language: English has "red", Turkish has
// "kirmizi", and each locale needs its own regular expressions. Only the "used in source" check
// applies to them; comparing their key sets across locales would be meaningless.
const VOCABULARY = /^(?:keywords|grammar)\.|(?:_aliases|_words|_names|_variants)(?:\.|$)/;
const symmetric = (key) => !VOCABULARY.test(key);

const [reference, ...others] = [...bundles.keys()];
for (const [key, value] of bundles.get(reference) ?? []) {
	if (!symmetric(key)) continue;
	const expected = placeholdersOf(value);
	for (const code of others) {
		const other = bundles.get(code);
		if (!other.has(key)) {
			problems.push(`missing  [${code}] ${key}  (present in ${reference})`);
			continue;
		}
		const actual = placeholdersOf(other.get(key));
		const lost = [...expected].filter((name) => !actual.has(name));
		const extra = [...actual].filter((name) => !expected.has(name));
		if (lost.length) problems.push(`placeholder [${code}] ${key}: missing {${lost.join('}, {')}}`);
		if (extra.length) problems.push(`placeholder [${code}] ${key}: unexpected {${extra.join('}, {')}}`);
	}
}
for (const code of others) {
	for (const key of bundles.get(code).keys()) {
		if (!symmetric(key)) continue;
		if (!bundles.get(reference).has(key)) problems.push(`extra    [${code}] ${key}  (not in ${reference})`);
	}
}

const counts = [...bundles].map(([code, table]) => `${code}: ${table.size}`).join(', ');
console.log(`locales: ${counts} | keys referenced in source: ${used.size}`);

if (problems.length) {
	for (const line of problems.sort()) console.error(`  ${line}`);
	console.error(`\n${problems.length} locale problem(s).`);
	process.exit(1);
}
console.log('locale bundles are consistent.');
