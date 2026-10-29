import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogger } from '../src/logger.ts';
import { KitsuResolver } from '../src/stremio/kitsu.ts';
import { parseSubtitlesRequest, type SubtitlesRequest } from '../src/stremio/request.ts';

// Shape of the Anime Kitsu addon's /meta response (Death Note, kitsu:1376).
const DEATH_NOTE = {
  meta: {
    imdb_id: 'tt0877057',
    videos: [
      { id: 'kitsu:1376:1', imdb_id: 'tt0877057', imdbSeason: 1, imdbEpisode: 1 },
      { id: 'kitsu:1376:5', imdb_id: 'tt0877057', imdbSeason: 1, imdbEpisode: 5 },
    ],
  },
};
// Absolute numbering mapped to IMDb seasons (One Piece style).
const LONG_RUNNER = { meta: { imdb_id: 'tt0388629', videos: [{ id: 'kitsu:12:1000', imdb_id: 'tt0388629', imdbSeason: 21, imdbEpisode: 108 }] } };
const MOVIE = { meta: { imdb_id: 'tt1234567', videos: [] } };

function resolver(responses: Record<string, unknown>) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL) => {
    calls.push(String(input));
    const key = Object.keys(responses).find((part) => String(input).includes(part));
    return key ? Response.json(responses[key]) : new Response('no', { status: 500 });
  }) as typeof globalThis.fetch;
  return { instance: new KitsuResolver({ fetch, logger: createLogger('error'), version: '0.1.0', baseUrl: 'https://kitsu.example' }), calls };
}
const parse = (type: string, id: string) => parseSubtitlesRequest({ type, id, extra: 'filename=x.mkv' }) as SubtitlesRequest;

test('maps a Kitsu episode to the IMDb id, season and episode', async () => {
  const { instance, calls } = resolver({ 'kitsu:1376': DEATH_NOTE });
  const resolved = await instance.resolve(parse('series', 'kitsu:1376:5'));
  assert.deepEqual(resolved, {
    type: 'series',
    id: 'kitsu:1376:5',
    imdbId: 'tt0877057',
    season: 1,
    episode: 5,
    kitsu: { id: 1376, episode: 5 },
    filename: 'x.mkv',
  });
  assert.deepEqual(calls, ['https://kitsu.example/meta/series/kitsu:1376.json']);
  await instance.resolve(parse('series', 'kitsu:1376:1'));
  assert.equal(calls.length, 1, 'one lookup per anime');
});

test('fixes absolute episode numbering', async () => {
  const { instance } = resolver({ 'kitsu:12': LONG_RUNNER });
  const resolved = await instance.resolve(parse('series', 'kitsu:12:1000'));
  assert.deepEqual([resolved?.imdbId, resolved?.season, resolved?.episode], ['tt0388629', 21, 108]);
});

test('maps anime movies', async () => {
  const { instance } = resolver({ 'kitsu:4292': MOVIE });
  const resolved = await instance.resolve(parse('movie', 'kitsu:4292'));
  assert.deepEqual([resolved?.type, resolved?.imdbId, resolved?.episode], ['movie', 'tt1234567', undefined]);
});

test('no IMDb match or a failed lookup means no subtitles, and the lookup is retried later', async () => {
  const { instance, calls } = resolver({ 'kitsu:1376': DEATH_NOTE });
  assert.equal(await instance.resolve(parse('series', 'kitsu:1376:99')), undefined);
  assert.equal(await instance.resolve(parse('series', 'kitsu:777:1')), undefined);
  assert.equal(await instance.resolve(parse('series', 'kitsu:777:1')), undefined);
  assert.equal(calls.filter((c) => c.includes('kitsu:777')).length, 2);
});

test('IMDb requests pass through untouched', async () => {
  const { instance, calls } = resolver({});
  const request = parse('series', 'tt0903747:1:2');
  assert.equal(await instance.resolve(request), request);
  assert.deepEqual(calls, []);
});
