import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeFilename, parseSubtitlesRequest } from '../src/stremio/request.ts';

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

test('keeps only the file name when Stremio sends a stream URL or an internal id', () => {
  // As received on the box (2026-11-01): the Real-Debrid link, percent-encoded twice.
  const link = 'https%3A%2F%2F45-4.download.real-debrid.com%2Fd%2FABCDEF123456%2FEnter%2520the%2520Void%2520(2010)%2520Extended%2520(1080p%2520BluRay%2520x265%2520r00t).mkv';
  const parsed = parseSubtitlesRequest({ type: 'movie', id: 'tt1191111', extra: `videoSize=6961452262&filename=${encodeURIComponent(link)}` });
  assert.equal(parsed?.filename, 'Enter the Void (2010) Extended (1080p BluRay x265 r00t).mkv');
  assert.equal(parsed?.videoSize, 6961452262);

  assert.equal(normalizeFilename('https://1.download.real-debrid.com/d/ABC/Movie.2009.1080p.BluRay.x264-GRP.mkv'), 'Movie.2009.1080p.BluRay.x264-GRP.mkv');
  assert.equal(normalizeFilename('realdebrid%3AJVKFJOFDWUJ74%3A1'), undefined);
  assert.equal(normalizeFilename('realdebrid:JVKFJOFDWUJ74:1'), undefined);
  assert.equal(normalizeFilename('https://host/d/ABC/'), undefined);
  // Ordinary names are untouched, even with a colon.
  assert.equal(normalizeFilename('Mission: Impossible (1996) 1080p.mkv'), 'Mission: Impossible (1996) 1080p.mkv');
  assert.equal(normalizeFilename('Death.Note.05.mkv'), 'Death.Note.05.mkv');
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
