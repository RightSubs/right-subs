import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findLanguage, type Language } from '../src/languages/languages.ts';
import { placeholderSrt, statusLabel, statusPath, statusSrt } from '../src/stremio/status.ts';
import { parseSrt } from '../src/subtitles/srt.ts';
import { decodeSubtitle } from '../src/subtitles/text.ts';

const ptBR = findLanguage('pt-BR') as Language;
const en = findLanguage('en') as Language;
const it = findLanguage('it') as Language;

test('the status path mirrors the track path', () => {
  const request = { type: 'series' as const, id: 'tt1:1:2', imdbId: 'tt1', season: 1, episode: 2, filename: 'A B.mkv' };
  assert.match(statusPath(request, ptBR), /^\/status\/series\/tt1:1:2\/pt-BR\/[A-Za-z0-9_-]+\.srt$/);
});

test('the status track repeats its message for an hour, so it shows up wherever playback is', () => {
  const cues = parseSrt(decodeSubtitle(statusSrt(ptBR, true)));
  assert.equal(cues.length, 120);
  assert.equal(cues[0]?.startMs, 500);
  assert.equal(cues[1]?.startMs, 30_500);
  assert.ok(cues.every((cue) => cue.endMs - cue.startMs === 25_000));
});

test('says preparing or ready, in the language it is given', () => {
  const text = (language: Language, pending: boolean) => parseSrt(decodeSubtitle(statusSrt(language, pending)))[0]?.text ?? '';
  assert.match(text(ptBR, true), /Preparando a legenda traduzida/);
  assert.match(text(ptBR, false), /já está pronta/);
  assert.match(text(en, true), /Preparing the translated subtitle/);
  assert.match(text(en, false), /is ready/);
  assert.match(text(it, true), /Preparazione dei sottotitoli tradotti/);
  assert.match(statusLabel(ptBR), /aguarde 30 s/);
  assert.match(statusLabel(en), /wait 30 s/);
  assert.match(statusLabel(it), /attendi 30 s/);
});

test('the placeholder tells what to do, in the language it is given', () => {
  const text = (language: Language) => parseSrt(decodeSubtitle(placeholderSrt(language)))[0]?.text ?? '';
  assert.match(text(ptBR), /Saia do vídeo e abra de novo em cerca de 30 s/);
  assert.match(text(en), /Leave the video and open it again in about 30 s/);
});

test('the on-screen messages say "video", so they fit a movie as well as an episode', () => {
  for (const language of [ptBR, en]) {
    for (const srt of [placeholderSrt(language), statusSrt(language, true), statusSrt(language, false)]) {
      assert.doesNotMatch(decodeSubtitle(srt), /epis[óo]de/i);
    }
  }
});
