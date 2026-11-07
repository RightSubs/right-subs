import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fill, MESSAGES, messagesFor, type Messages } from '../src/i18n/messages.ts';
import { findLanguage, LANGUAGES, type Language } from '../src/languages/languages.ts';

const en = MESSAGES['en'] as Messages;
const keys = Object.keys(en) as (keyof Messages)[];
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const lines = (text: string) => text.split('\n').length;

test('every language the addon knows has its own translation, and no other is listed', () => {
  assert.deepEqual(Object.keys(MESSAGES).sort(), LANGUAGES.map((l) => l.tag).sort());
});

test('every translation has every text, not empty, with the same placeholders and line breaks as English', () => {
  for (const [tag, messages] of Object.entries(MESSAGES)) {
    assert.deepEqual(Object.keys(messages).sort(), [...keys].sort(), tag);
    for (const key of keys) {
      const text = messages[key];
      assert.ok(text.trim().length > 0, `${tag}.${key} is empty`);
      assert.deepEqual(placeholders(text), placeholders(en[key]), `${tag}.${key}: placeholders`);
      assert.equal(lines(text), lines(en[key]), `${tag}.${key}: line breaks`);
    }
  }
});

test('the texts keep what the viewer must recognize: the addon name, DeepL and the 30 s wait', () => {
  for (const [tag, messages] of Object.entries(MESSAGES)) {
    for (const key of ['statusLabel', 'statusPending', 'statusReady', 'placeholder', 'embeddedLabel', 'embeddedNotice'] as const) {
      assert.match(messages[key], /RightSubs/, `${tag}.${key}`);
    }
    for (const key of ['statusLabel', 'statusPending', 'placeholder'] as const) assert.match(messages[key], /30/, `${tag}.${key}`);
    for (const key of ['translated', 'translatedUnconfirmed'] as const) assert.match(messages[key], /DeepL/, `${tag}.${key}`);
    assert.notEqual(messages.translated, messages.translatedUnconfirmed, tag);
  }
});

test('a language with no translation falls back to English', () => {
  const unknown: Language = { tag: 'xx', name: 'X', stremio: 'xxx', opensubtitles: 'xx', aliases: [] };
  assert.equal(messagesFor(unknown), en);
  assert.equal(messagesFor(findLanguage('it') as Language), MESSAGES['it']);
});

test('fill replaces the placeholders it is given and leaves the others', () => {
  assert.equal(fill('{primary} ({secondary})', { primary: 'A', secondary: 'B' }), 'A (B)');
  assert.equal(fill('{primary} {other}', { primary: 'A' }), 'A {other}');
});
