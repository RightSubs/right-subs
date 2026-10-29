import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findLanguage, LANGUAGES } from '../src/languages/languages.ts';

test('resolves canonical tags case-insensitively', () => {
  assert.equal(findLanguage('pt-BR')?.stremio, 'pob');
  assert.equal(findLanguage('PT-br')?.tag, 'pt-BR');
  assert.equal(findLanguage('pt_BR')?.tag, 'pt-BR');
});

test('resolves aliases, including regional English variants', () => {
  assert.equal(findLanguage('en-US')?.tag, 'en');
  assert.equal(findLanguage('eng')?.tag, 'en');
  assert.equal(findLanguage('pob')?.tag, 'pt-BR');
});

test('does not guess ambiguous or unknown languages', () => {
  assert.equal(findLanguage('pt'), undefined);
  assert.equal(findLanguage('klingon'), undefined);
});

test('every tag and alias is unique', () => {
  const keys = LANGUAGES.flatMap((lang) => [lang.tag.toLowerCase(), ...lang.aliases]);
  assert.equal(new Set(keys).size, keys.length);
});
