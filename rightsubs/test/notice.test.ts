import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findLanguage, type Language } from '../src/languages/languages.ts';
import type { Cue } from '../src/subtitles/srt.ts';
import { noticeText, withTranslationNotice } from '../src/translation/notice.ts';

const ptBR = findLanguage('pt-BR') as Language;
const it = findLanguage('it') as Language;
const ko = findLanguage('ko') as Language;
const cue = (startMs: number, lengthMs = 1000): Cue => ({ startMs, endMs: startMs + lengthMs, text: 'x' });
const notices = (cues: Cue[]) => cues.filter((c) => c.text.includes('DeepL'));

test('puts the notice at the start, before the first line', () => {
  const out = withTranslationNotice([cue(10_000), cue(20_000)], ptBR);
  assert.deepEqual(out[0], { startMs: 500, endMs: 4500, text: '[Legenda traduzida por IA (DeepL)]' });
  assert.equal(out[1]?.startMs, 10_000);
});

test('shows it again after a minute, for a player that got the subtitle late', () => {
  const out = withTranslationNotice([cue(10_000), cue(20_000), cue(90_000)], ptBR);
  assert.deepEqual(notices(out).map((c) => c.startMs), [500, 60_000]);
});

test('repeats every 15 minutes in a long movie', () => {
  const lines = Array.from({ length: 120 }, (_, i) => cue(10_000 + i * 20_000)); // ~40 min
  assert.deepEqual(notices(withTranslationNotice(lines, ptBR)).map((c) => c.startMs), [500, 60_000, 900_000, 1_800_000]);
});

test('is cut short when the first line comes early, and moves after it when there is no room', () => {
  assert.equal(notices(withTranslationNotice([cue(3_000)], ptBR))[0]?.endMs, 2_900);
  const crowded = notices(withTranslationNotice([cue(1_500), cue(30_000)], ptBR))[0];
  assert.equal(crowded?.startMs, 2_600, 'right after the line that was in the way');
});

test('never overlaps a real line, and is left out when the dialogue leaves no gap', () => {
  const lines = Array.from({ length: 80 }, (_, i) => cue(i * 1_000, 950)); // 80 s of non-stop speech
  const out = withTranslationNotice(lines, ptBR);
  for (const notice of notices(out)) {
    assert.ok(lines.every((line) => line.endMs <= notice.startMs || line.startMs >= notice.endMs), 'no overlap');
  }
  assert.ok(!notices(out).some((c) => c.startMs < 30_000), 'no gap in the first 30 s: no opening notice');
});

test('is in the language of the translation', () => {
  assert.match(noticeText(ptBR), /Legenda traduzida por IA \(DeepL\)/);
  assert.match(noticeText(it), /Sottotitoli tradotti automaticamente/);
  assert.match(noticeText(ko), /기계 번역/);
});

test('says the timing was not confirmed when it was not', () => {
  assert.match(noticeText(ptBR, true), /tempo não confirmado/);
  assert.match(noticeText(it, true), /sincronizzazione non confermata/);
  assert.equal(withTranslationNotice([cue(10_000)], ptBR, true)[0]?.text, '[Legenda traduzida por IA (DeepL) - tempo não confirmado]');
});
