import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findLanguage, type Language } from '../src/languages/languages.ts';
import { createLogger } from '../src/logger.ts';
import { SubtitleCache } from '../src/subtitles/cache.ts';
import { ResumableTranslator } from '../src/translation/resume.ts';
import type { Translator } from '../src/translation/deepl.ts';

const ptBR = findLanguage('pt-BR') as Language;
const fr = findLanguage('fr') as Language;
// 130 short lines = 3 DeepL requests (50 + 50 + 30).
const texts = Array.from({ length: 130 }, (_, i) => `line ${i}`);
const characters = (list: string[]) => list.reduce((sum, text) => sum + text.length, 0);

function setup(options: { remaining?: number | undefined; failBatch?: number } = {}) {
  const lines: string[] = [];
  const cache = new SubtitleCache(mkdtempSync(join(tmpdir(), 'rightsubs-resume-')));
  const requested: string[][] = [];
  let failBatch = options.failBatch;
  const inner: Translator = {
    translate: async (batch) => {
      requested.push(batch);
      if (failBatch !== undefined && batch[0] === `line ${failBatch}`) throw new Error('DeepL monthly quota used up');
      return batch.map((text) => `PT ${text}`);
    },
  };
  const make = (remaining = options.remaining) =>
    new ResumableTranslator(inner, { cache, logger: createLogger('debug', (line) => lines.push(line)), remaining: async () => remaining });
  return { make, requested, lines, healed: () => (failBatch = undefined) };
}

test('translates in the same order, one request per batch', async () => {
  const { make, requested } = setup();
  const out = await make().translate(texts, ptBR, fr);
  assert.deepEqual(out, texts.map((text) => `PT ${text}`));
  assert.equal(requested.length, 3);
});

test('an interrupted translation resumes: what was translated is not asked (or paid) again', async () => {
  const { make, requested, lines, healed } = setup({ failBatch: 100 }); // the last batch fails (quota)
  await assert.rejects(make().translate(texts, ptBR, fr), /quota used up/);
  assert.equal(requested.length, 3, 'all three were tried');
  healed();
  requested.length = 0;
  const out = await make().translate(texts, ptBR, fr);
  assert.deepEqual(out, texts.map((text) => `PT ${text}`));
  assert.equal(requested.length, 1, 'only the missing batch goes to DeepL');
  assert.equal(requested[0]?.[0], 'line 100');
  assert.ok(lines.some((line) => line.includes('translation.resumed') && line.includes('"cached":2')));
});

test('a finished translation is answered from disk, without calling DeepL', async () => {
  const { make, requested } = setup();
  await make().translate(texts, ptBR, fr);
  requested.length = 0;
  await make().translate(texts, ptBR, fr);
  assert.equal(requested.length, 0);
});

test('the same lines into another language are not taken for the same translation', async () => {
  const { make, requested } = setup();
  await make().translate(texts, ptBR, fr);
  requested.length = 0;
  await make().translate(texts, findLanguage('es') as Language, fr);
  assert.equal(requested.length, 3);
});

test('does not start a translation the quota cannot finish', async () => {
  const { make, requested } = setup({ remaining: 500 });
  await assert.rejects(make().translate(texts, ptBR, fr), /quota too low.*needs \d+ characters, 500 left/);
  assert.equal(requested.length, 0, 'nothing was spent');
});

test('the quota check counts only what is still missing', async () => {
  const run = setup({ failBatch: 100 });
  await assert.rejects(run.make().translate(texts, ptBR, fr));
  run.healed();
  run.requested.length = 0;
  // Exactly enough for the last batch alone: the two already translated do not count.
  const out = await run.make(characters(texts.slice(100))).translate(texts, ptBR, fr);
  assert.equal(out.length, 130);
  assert.equal(run.requested.length, 1);
});

test('an unknown quota does not block the translation', async () => {
  const { make } = setup({ remaining: undefined });
  assert.equal((await make().translate(texts, ptBR, fr)).length, 130);
});

test('a damaged entry on disk is translated again instead of breaking the subtitle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rightsubs-resume-'));
  const cache = new SubtitleCache(dir);
  const logger = createLogger('debug', () => {});
  let calls = 0;
  const inner: Translator = {
    translate: async (batch) => {
      calls += 1;
      return batch.map((text) => `PT ${text}`);
    },
  };
  const translator = new ResumableTranslator(inner, { cache, logger });
  await translator.translate(['a', 'b'], ptBR, fr);
  const { readdirSync, writeFileSync } = await import('node:fs');
  for (const file of readdirSync(dir)) writeFileSync(join(dir, file), 'not json');
  assert.deepEqual(await translator.translate(['a', 'b'], ptBR, fr), ['PT a', 'PT b']);
  assert.equal(calls, 2);
});
