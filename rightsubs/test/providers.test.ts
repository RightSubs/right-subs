import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findLanguage, type Language } from '../src/languages/languages.ts';
import { createLogger } from '../src/logger.ts';
import { openSubtitlesApi } from '../src/providers/opensubtitles-api.ts';
import { stremioAddon } from '../src/providers/stremio-addon.ts';
import { ProviderError, type SubtitleQuery } from '../src/providers/types.ts';

const ptBR = findLanguage('pt-BR') as Language;
const en = findLanguage('en') as Language;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Fake fetch: answers by URL substring, records every call. */
function fakeFetch(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const route = Object.keys(routes).find((part) => call.url.includes(part));
    if (!route) return new Response('not found', { status: 404 });
    return (routes[route] as (call: Call) => Response)(call);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const context = (fetch: typeof globalThis.fetch, id: string) => ({ id, version: '0.1.0', logger: createLogger('error'), fetch });

const episode: SubtitleQuery = {
  type: 'series',
  imdbId: 'tt26591147',
  season: 2,
  episode: 12,
  videoHash: 'a4421889410a40f6',
  videoSize: 623569379,
  filename: 'Matlock.2024.S02E12.1080p.x265-ELiTE.mkv',
  languages: [ptBR, en],
};

// Shapes copied from real responses (docs/FINDINGS.md).
const V3_RESPONSE = {
  subtitles: [
    {
      id: '13677413',
      url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/1962244852',
      SubEncoding: 'UTF-8',
      lang: 'eng',
      m: 'h',
      g: '',
      subtitleFileName: 'Matlock.2024.S02E12.1080p.x265-ELiTE.srt',
      movieReleaseName: 'Matlock.2024.S02E12.1080p.x265-ELiTE',
      fpsMilli: 23976,
      season: 2,
      episode: 12,
    },
    { id: '13949003', url: 'https://subs5.strem.io/file/1962512795', lang: 'pob', m: 'i', subtitleFileName: 'Matlock.S02E12.Vyndros.srt' },
    { id: '99', url: 'https://subs5.strem.io/file/1', lang: 'por', m: 'i' },
    { id: '98', url: 'https://subs5.strem.io/file/2', lang: 'heb', m: 'i' },
  ],
};

const API_SEARCH = {
  total_count: 3,
  data: [
    {
      id: '11560035',
      attributes: {
        language: 'en',
        release: 'Matlock.2024.S02E12.1080p.x265-ELiTE',
        fps: 23.976,
        download_count: 1935,
        moviehash_match: true,
        legacy_subtitle_id: 13677413,
        files: [{ file_id: 12467248 }],
      },
    },
    {
      id: '11949799',
      attributes: { language: 'pt-BR', release: 'Matlock.(2024).S02E12', download_count: 65, legacy_subtitle_id: 13949003, files: [{ file_id: 12830848 }] },
    },
    { id: '1', attributes: { language: 'pt-BR', machine_translated: true, files: [{ file_id: 5 }] } },
    { id: '2', attributes: { language: 'pt-PT', files: [{ file_id: 6 }] } },
  ],
};

test('stremio-addon: builds the Stremio URL and keeps only the wanted languages', async () => {
  const { fetch, calls } = fakeFetch({ '/subtitles/': () => json(V3_RESPONSE) });
  const provider = stremioAddon.create({ url: 'https://opensubtitles-v3.strem.io/manifest.json', timeoutMs: 1000 }, context(fetch, 'os-v3'));
  const found = await provider.search(episode);

  assert.equal(
    calls[0]?.url,
    'https://opensubtitles-v3.strem.io/subtitles/series/tt26591147:2:12/videoHash=a4421889410a40f6&videoSize=623569379&filename=Matlock.2024.S02E12.1080p.x265-ELiTE.mkv.json',
  );
  assert.equal(calls[0]?.headers['User-Agent'], 'RightSubs v0.1.0');
  assert.deepEqual(
    found.map((c) => [c.sourceId, c.language.tag, c.hashMatch ?? false]),
    [
      ['13677413', 'en', true],
      ['13949003', 'pt-BR', false],
    ],
  );
  assert.equal(found[0]?.releaseName, 'Matlock.2024.S02E12.1080p.x265-ELiTE');
  assert.equal(found[0]?.fps, 23.976);
  assert.equal(found[1]?.releaseName, 'Matlock.S02E12.Vyndros', 'falls back to the file name without extension');
});

test('stremio-addon: movie without extra info and download by URL', async () => {
  const { fetch, calls } = fakeFetch({
    '/subtitles/': () => json({ subtitles: [] }),
    '/file/': () => new Response('1\n00:00:01,000 --> 00:00:02,000\nHi\n'),
  });
  const provider = stremioAddon.create({ url: 'https://addon.example/manifest.json', timeoutMs: 1000 }, context(fetch, 'addon'));
  assert.deepEqual(await provider.search({ type: 'movie', imdbId: 'tt0985699', languages: [ptBR] }), []);
  assert.equal(calls[0]?.url, 'https://addon.example/subtitles/movie/tt0985699.json');

  const file = await provider.download({ providerId: 'addon', ref: 'https://subs.example/file/1', language: ptBR });
  assert.match(file.toString(), /Hi/);
});

test('stremio-addon: HTTP errors and timeouts become ProviderError', async () => {
  const { fetch } = fakeFetch({ '/subtitles/': () => new Response('boom', { status: 503 }) });
  const provider = stremioAddon.create({ url: 'https://addon.example/manifest.json', timeoutMs: 1000 }, context(fetch, 'addon'));
  await assert.rejects(provider.search(episode), (err) => err instanceof ProviderError && err.status === 503);

  const slow = (async (_input: string | URL, init: RequestInit = {}) =>
    new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as typeof globalThis.fetch;
  const timed = stremioAddon.create({ url: 'https://addon.example/manifest.json', timeoutMs: 20 }, context(slow, 'addon'));
  await assert.rejects(timed.search(episode), /no response in 20 ms/);
});

test('opensubtitles-api: searches with sorted params and links copies on the v3 addon', async () => {
  const { fetch, calls } = fakeFetch({ '/api/v1/subtitles': () => json(API_SEARCH) });
  const provider = openSubtitlesApi.create(
    { apiKey: 'KEY', downloadVia: 'opensubtitles-v3', timeoutMs: 1000 },
    context(fetch, 'opensubtitles-api'),
  );
  const found = await provider.search(episode);

  assert.equal(
    calls[0]?.url,
    'https://api.opensubtitles.com/api/v1/subtitles?episode_number=12&languages=en%2Cpt-br&moviehash=a4421889410a40f6&parent_imdb_id=26591147&season_number=2',
  );
  assert.equal(calls[0]?.headers['Api-Key'], 'KEY');
  // machine-translated and unwanted languages are dropped
  assert.deepEqual(
    found.map((c) => [c.ref, c.language.tag, c.hashMatch ?? false, c.sameAs?.sourceId]),
    [
      ['12467248', 'en', true, '13677413'],
      ['12830848', 'pt-BR', false, '13949003'],
    ],
  );
  assert.equal(found[0]?.sameAs?.providerId, 'opensubtitles-v3');
  assert.equal(found[0]?.downloads, 1935);
});

test('opensubtitles-api: movie search uses imdb_id without tt and leading zeros', async () => {
  const { fetch, calls } = fakeFetch({ '/api/v1/subtitles': () => json({ data: [] }) });
  const provider = openSubtitlesApi.create({ apiKey: 'KEY', timeoutMs: 1000 }, context(fetch, 'api'));
  await provider.search({ type: 'movie', imdbId: 'tt0985699', languages: [ptBR] });
  assert.equal(calls[0]?.url, 'https://api.opensubtitles.com/api/v1/subtitles?imdb_id=985699&languages=pt-br');
});

test('opensubtitles-api: logs in once, downloads with the token and tracks the quota', async () => {
  const { fetch, calls } = fakeFetch({
    '/api/v1/login': () => json({ token: 'TOKEN', base_url: 'vip-api.opensubtitles.com', user: { allowed_downloads: 20 } }),
    '/api/v1/download': () => json({ link: 'https://dl.opensubtitles.com/file/1', remaining: 19, reset_time_utc: '2026-10-30T00:00:00.000Z' }),
    'dl.opensubtitles.com': () => new Response('1\n00:00:01,000 --> 00:00:02,000\nOi\n'),
  });
  const provider = openSubtitlesApi.create({ apiKey: 'KEY', username: 'user', password: 'pass', timeoutMs: 1000 }, context(fetch, 'api'));
  const candidate = { providerId: 'api', ref: '12830848', language: ptBR };

  assert.match((await provider.download(candidate)).toString(), /Oi/);
  await provider.download(candidate);

  assert.equal(calls.filter((c) => c.url.includes('/login')).length, 1, 'token reused');
  const download = calls.find((c) => c.url.includes('/download'));
  assert.equal(download?.url, 'https://vip-api.opensubtitles.com/api/v1/download');
  assert.deepEqual(download?.body, { file_id: 12830848 });
  assert.equal(download?.headers['Authorization'], 'Bearer TOKEN');
  assert.deepEqual(provider.status?.(), { login: 'ok', quota: { remaining: 19, resetAt: '2026-10-30T00:00:00.000Z' } });
});

test('opensubtitles-api: stops downloading once the quota is exhausted', async () => {
  let downloads = 0;
  const { fetch } = fakeFetch({
    '/api/v1/download': () => {
      downloads += 1;
      return json({ message: 'You have downloaded your allowed 20 subtitles' }, 406);
    },
  });
  const provider = openSubtitlesApi.create({ apiKey: 'KEY', timeoutMs: 1000 }, context(fetch, 'api'));
  const candidate = { providerId: 'api', ref: '1', language: ptBR };

  await assert.rejects(provider.download(candidate), (err) => err instanceof ProviderError && err.status === 406);
  await assert.rejects(provider.download(candidate), /daily download quota used up/);
  assert.equal(downloads, 1, 'no new API call while the quota is known to be exhausted');
  assert.equal((provider.status?.()['quota'] as { remaining: number }).remaining, 0);
});

test('opensubtitles-api: a refused login falls back to anonymous downloads', async () => {
  const { fetch, calls } = fakeFetch({
    '/api/v1/login': () => json({ message: 'invalid username/password' }, 400),
    '/api/v1/download': () => json({ link: 'https://dl.opensubtitles.com/file/1', remaining: 4 }),
    'dl.opensubtitles.com': () => new Response('1\n00:00:01,000 --> 00:00:02,000\nOi\n'),
  });
  const provider = openSubtitlesApi.create({ apiKey: 'KEY', username: 'user', password: 'bad', timeoutMs: 1000 }, context(fetch, 'api'));
  await provider.download({ providerId: 'api', ref: '1', language: ptBR });
  await provider.download({ providerId: 'api', ref: '1', language: ptBR });

  assert.equal(calls.filter((c) => c.url.includes('/login')).length, 1, 'does not hammer the login endpoint');
  assert.equal(calls.find((c) => c.url.includes('/download'))?.headers['Authorization'], undefined);
  assert.equal(provider.status?.()['login'], 'rejected');
});

test('opensubtitles-api: renews an expired token once', async () => {
  let logins = 0;
  let first = true;
  const { fetch } = fakeFetch({
    '/api/v1/login': () => json({ token: `T${++logins}` }),
    '/api/v1/download': () => {
      if (first) {
        first = false;
        return json({ message: 'token expired' }, 401);
      }
      return json({ link: 'https://dl.opensubtitles.com/file/1' });
    },
    'dl.opensubtitles.com': () => new Response('ok'),
  });
  const provider = openSubtitlesApi.create({ apiKey: 'KEY', username: 'user', password: 'pass', timeoutMs: 1000 }, context(fetch, 'api'));
  await provider.download({ providerId: 'api', ref: '1', language: ptBR });
  assert.equal(logins, 2);
});
