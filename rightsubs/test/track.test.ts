import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findLanguage, type Language } from '../src/languages/languages.ts';
import { parseTrackPath, trackPath } from '../src/stremio/track.ts';

const ptBR = findLanguage('pt-BR') as Language;

function params(path: string): Record<string, string> {
  const [, , type = '', id = '', lang = '', file = ''] = path.split('/');
  return { type, id, lang, file: file.replace(/\.srt$/, '') };
}

test('round-trips an episode with an unusual file name', () => {
  const filename = "Matlock.(2024).S02E12.The.Cavalry.Isn't.Coming [ção] 1080p.mkv";
  const path = trackPath({ type: 'series', id: 'tt26591147:2:12', imdbId: 'tt26591147', season: 2, episode: 12, filename }, ptBR);
  assert.match(path, /^\/sub\/series\/tt26591147:2:12\/pt-BR\/[A-Za-z0-9_-]+\.srt$/);
  const track = parseTrackPath(params(path));
  assert.equal(track?.filename, filename);
  assert.equal(track?.episode, 12);
  assert.equal(track?.language.tag, 'pt-BR');
});

test('leaves the video hash out, so both Stremio requests get the same URL', () => {
  const base = { type: 'movie' as const, id: 'tt0985699', imdbId: 'tt0985699', filename: 'Valkyrie.mkv' };
  assert.equal(trackPath(base, ptBR), trackPath({ ...base, videoHash: 'e3af0d1b729cc9fe', videoSize: 1 }, ptBR));
});

test('works without a file name', () => {
  const path = trackPath({ type: 'movie', id: 'tt0985699', imdbId: 'tt0985699' }, ptBR);
  assert.equal(path, '/sub/movie/tt0985699/pt-BR/_.srt');
  assert.equal(parseTrackPath(params(path))?.filename, undefined);
});

test('rejects malformed paths', () => {
  assert.equal(parseTrackPath({ type: 'movie', id: 'tt1', lang: 'klingon', file: '_' }), undefined);
  assert.equal(parseTrackPath({ type: 'movie', id: 'tt1', lang: 'pt-BR', file: 'a.b' }), undefined);
  assert.equal(parseTrackPath({ type: 'channel', id: 'tt1', lang: 'pt-BR', file: '_' }), undefined);
});
