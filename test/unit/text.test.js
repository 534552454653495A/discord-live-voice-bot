import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setLocale } from '../../src/i18n/index.js';
import { balanceCodeFences, escapeHtml, findCharacter, normalize, parseBool, squash, stripDictationTail } from '../../src/text.js';
import { detectLanguage, splitSentences } from '../../src/localtts.js';

// normalize() and detectLanguage() carry LANGUAGE DATA rather than user-visible text: normalize()
// folds Turkish letters whatever the interface language is, and the language hints are the same in
// every bundle. Their Turkish fixtures below are deliberate and need no setLocale('tr').
// parseBool() and stripDictationTail() are different: their spoken words come from the active
// locale (keywords.bool_*, grammar.dictation_tail), so the Turkish cases switch the locale and put
// it back to 'en' afterwards.

describe('text.js', () => {
	it('normalises Turkish letters, apostrophe suffixes and fancy letters', () => {
		assert.equal(normalize("Görkem'e"), 'gorkem');
		assert.equal(normalize('ᴄʜɪʟʟ Zone'), 'chill zone');
		assert.equal(normalize('  Şükrü-ÇAĞLAR  '), 'sukru caglar');
	});

	it('parses the universal and the English on/off words, and falls back on anything else', () => {
		assert.equal(parseBool('off'), false);
		assert.equal(parseBool('nope'), false, 'spoken English "no"');
		assert.equal(parseBool('on'), true);
		assert.equal(parseBool('yeah'), true, 'spoken English "yes"');
		assert.equal(parseBool('maybe', true), true, 'an unknown value takes the fallback');
		assert.equal(parseBool(undefined, false), false);
	});

	it('parses the spoken Turkish on/off words under the Turkish locale', () => {
		setLocale('tr');
		try {
			assert.equal(parseBool('kapat'), false, 'Turkish "turn it off"');
			assert.equal(parseBool('kapalı'), false, 'Turkish "off"');
			assert.equal(parseBool('aç'), true, 'Turkish "turn it on"');
			assert.equal(parseBool('evet'), true, 'Turkish "yes"');
			assert.equal(parseBool('1'), true, 'the universal spellings still work');
		} finally {
			setLocale('en');
		}
	});

	it('does not let a one-letter character name match every sentence', () => {
		const characters = [{ id: 'a', name: 'A' }, { id: 'm', name: 'Melis' }];
		assert.equal(findCharacter(characters, 'hello how are you'), null, '"A" must not match through reverse-contains');
		assert.equal(findCharacter(characters, 'the melis character')?.id, 'm');
		assert.equal(findCharacter(characters, 'A')?.id, 'a', 'an exact match still works');
	});

	it('trims the message first and closes the code fence afterwards', () => {
		const long = `\`\`\`js\n${'x'.repeat(1900)}`;
		const out = balanceCodeFences(long, { maxLength: 1900 });
		assert.ok(out.length <= 1900 + 4, `length ${out.length}`);
		assert.ok(out.endsWith('```'), 'the closing fence must not fall victim to the trim');
	});

	it('escapes HTML so user data cannot carry markup', () => {
		assert.equal(escapeHtml('<img src=x onerror="a">'), '&lt;img src=x onerror=&quot;a&quot;&gt;');
	});

	it('strips the English dictation tail and collapses whitespace', () => {
		assert.equal(stripDictationTail('come to the voice channel say that'), 'come to the voice channel');
		assert.equal(stripDictationTail('tell them we are done write it'), 'tell them we are done');
		assert.equal(squash('  a   b \n c '), 'a b c');
	});

	it('strips the Turkish dictation particle under the Turkish locale', () => {
		setLocale('tr');
		try {
			assert.equal(stripDictationTail('sese gel de'), 'sese gel');
		} finally {
			setLocale('en');
		}
	});
});

describe('localtts.js', () => {
	it('does not break a sentence on the dots inside decimals, clock times and URLs', () => {
		assert.deepEqual(splitSentences('The price came to 3.5 euros. Drop by around 12.30. All right?').sentences, [
			'The price came to 3.5 euros.',
			'Drop by around 12.30.',
			'All right?',
		]);
		assert.deepEqual(splitSentences('Have a look at example.com/x. We can talk afterwards.').sentences, [
			'Have a look at example.com/x.',
			'We can talk afterwards.',
		]);
	});

	it('splits a long sentence even when it ends with punctuation', () => {
		const out = splitSentences(`${'word '.repeat(80).trim()}.`, { maxLength: 100 });
		assert.ok(out.sentences.length > 1);
		assert.ok(out.sentences.every((s) => s.length <= 100));
		assert.equal(out.rest, '');
	});

	it('detects the language from its characters and common words', () => {
		// Detection data is the same in every locale, so no setLocale is needed here either.
		assert.equal(detectLanguage('Selam canım nasılsın bugün?'), 'tr');
		assert.equal(detectLanguage('Hello there, how are you doing today?'), 'en');
		assert.equal(detectLanguage('Привет, как дела?'), 'ru');
		assert.equal(detectLanguage('Hallo, wie geht es dir? Ich bin müde.'), 'de');
		assert.equal(detectLanguage('ok', 'tr'), 'tr', 'a short, ambiguous text takes the fallback');
	});
});
