import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSubtitlesRequest } from '../src/stremio/request.ts';

test('parses a movie request with extra properties', () => {
  assert.deepEqual(
    parseSubtitlesRequest({
      type: 'movie',
      id: 'tt0062622',
      extra: 'videoHash=8e245d9679d31e12&videoSize=1460000000&filename=2001.A.Space.Odyssey.1968%20(DVDRip).avi',
    }),
    {
      type: 'movie',
      id: 'tt0062622',
      imdbId: 'tt0062622',
      videoHash: '8e245d9679d31e12',
      videoSize: 1460000000,
      filename: '2001.A.Space.Odyssey.1968 (DVDRip).avi',
    },
  );
});

test('parses series ids, encoded or not', () => {
  for (const id of ['tt0903747:1:2', 'tt0903747%3A1%3A2']) {
    assert.deepEqual(parseSubtitlesRequest({ type: 'series', id }), {
      type: 'series',
      id: 'tt0903747:1:2',
      imdbId: 'tt0903747',
      season: 1,
      episode: 2,
    });
  }
});

test('ignores requests the addon does not handle', () => {
  assert.equal(parseSubtitlesRequest({ type: 'channel', id: 'tt1' }), undefined);
  assert.equal(parseSubtitlesRequest({ type: 'movie', id: 'mal:123' }), undefined);
  assert.equal(parseSubtitlesRequest({ type: 'series', id: 'kitsu:abc:1' }), undefined);
  assert.equal(parseSubtitlesRequest({ type: 'series', id: 'tt0903747' }), undefined);
});

test('parses anime (Kitsu) ids, with and without episode', () => {
  assert.deepEqual(parseSubtitlesRequest({ type: 'series', id: 'kitsu%3A1376%3A5', extra: 'filename=Death.Note.05.mkv' }), {
    type: 'series',
    id: 'kitsu:1376:5',
    imdbId: '',
    kitsu: { id: 1376, episode: 5 },
    filename: 'Death.Note.05.mkv',
  });
  assert.deepEqual(parseSubtitlesRequest({ type: 'movie', id: 'kitsu:4292' }), { type: 'movie', id: 'kitsu:4292', imdbId: '', kitsu: { id: 4292 } });
});
