import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { maskSecret, updateEnvFile } from '../../src/envfile.js';

const dir = mkdtempSync(path.join(tmpdir(), 'envfile-'));
const fileFor = (name, body = '') => {
	const file = path.join(dir, name);
	writeFileSync(file, body, 'utf8');
	return file;
};

describe('updateEnvFile', () => {
	it('replaces a key where it is, keeping the comments and the other lines', async () => {
		const file = fileFor(
			'basic.env',
			['# the bot reads this at start', 'DISCORD_TOKEN=abc', 'OPENAI_API_KEY=sk-old', '', '# a note', 'PANEL=1', ''].join('\n'),
		);
		const result = await updateEnvFile(file, { OPENAI_API_KEY: 'sk-new-value', DEEPSEEK_API_KEY: 'sk-deep' });
		assert.deepEqual(result.changed.sort(), ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY']);
		const written = readFileSync(file, 'utf8');
		assert.match(written, /# the bot reads this at start/);
		assert.match(written, /OPENAI_API_KEY=sk-new-value/);
		assert.match(written, /# a note/);
		assert.match(written, /DEEPSEEK_API_KEY=sk-deep/);
		assert.ok(!written.includes('sk-old'), 'the old key is gone');
		assert.ok(result.backup && readFileSync(result.backup, 'utf8').includes('sk-old'), 'a copy of the old file is kept');
	});

	it('appends a key that was not there, and quotes what the format would misread', async () => {
		const file = fileFor('append.env', 'PANEL=1\n');
		await updateEnvFile(file, { GREET_TEXT: 'hello there # not a comment' });
		const written = readFileSync(file, 'utf8');
		assert.match(written, /GREET_TEXT="hello there # not a comment"/);
		assert.match(written, /PANEL=1/);
	});

	it('writes nothing when there is nothing to change', async () => {
		const file = fileFor('empty.env', 'PANEL=1\n');
		const before = readFileSync(file, 'utf8');
		const result = await updateEnvFile(file, {});
		assert.deepEqual(result.changed, []);
		assert.equal(result.backup, null);
		assert.equal(readFileSync(file, 'utf8'), before);
	});
});

describe('maskSecret', () => {
	it('shows which key it is, never the whole thing', () => {
		assert.equal(maskSecret('sk-proj-1234567890abcdef'), 'sk-pro…cdef');
		assert.equal(maskSecret(''), '');
		assert.equal(maskSecret('short'), '…');
	});
});
