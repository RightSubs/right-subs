import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createServer } from '../src/app.ts';
import { loadConfig } from '../src/config/load.ts';
import { findLanguage } from '../src/languages/languages.ts';
import { createLogger } from '../src/logger.ts';
import type { SubtitleProvider } from '../src/providers/types.ts';
import { IdleMonitor } from '../src/resources/idle.ts';
import type { TrackRequest } from '../src/subtitles/service.ts';
import { FULL_ENV, writeConfig } from './helpers.ts';

const lines: string[] = [];
const logger = createLogger('debug', (line) => lines.push(line));
const idle = new IdleMonitor({
  idleAfterMs: 60_000,
  maxIdleMemoryMB: 1000,
  logger,
  onIdle: async () => {},
  requestRestart: () => {},
});
const prepared: TrackRequest[] = [];
// Breaking Bad (tt0903747) has subtitles in the primary language; nothing else does.
const subtitles = {
  chooseLanguage: async (request: { imdbId: string }) => (request.imdbId === 'tt0903747' ? findLanguage('pt-BR') : undefined),
  status: () => ({ served: { synced: 2 }, unavailable: 0 }),
  prepare: async (track: TrackRequest) => {
    prepared.push(track);
    return track.imdbId === 'tt0903747' ? Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\nOlá\r\n\r\n') : undefined;
  },
};
const providers: SubtitleProvider[] = [
  { id: 'opensubtitles-api', search: async () => [], download: async () => Buffer.alloc(0), status: () => ({ quota: { remaining: 17 } }) },
];
const server = createServer({
  config: loadConfig({ configFile: writeConfig(), env: FULL_ENV }),
  logger,
  version: '0.1.0',
  tools: { ffmpeg: { available: true, version: '7.1' }, ffprobe: { available: false } },
  resources: { idle, lastSweep: () => ({ removedFiles: 0, freedBytes: 0, remainingBytes: 3 * 1024 * 1024 }) },
  providers,
  subtitles,
});
let base = '';

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  idle.stop();
  server.close();
});

test('serves the manifest with CORS', async () => {
  const res = await fetch(`${base}/manifest.json`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const manifest = (await res.json()) as Record<string, unknown>;
  assert.equal(manifest['id'], 'community.rightsubs');
  assert.deepEqual(manifest['resources'], [{ name: 'subtitles', types: ['movie', 'series'], idPrefixes: ['tt', 'kitsu'] }]);
  assert.match(String(manifest['description']), /Português \(Brasil\) \(secundária: English\)/);
});

test('redirects / to the manifest', async () => {
  const res = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/manifest.json');
});

test('reports health without exposing secrets', async () => {
  const res = await fetch(`${base}/health`);
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.doesNotMatch(body, /secret|"key"/);
  const health = JSON.parse(body) as Record<string, any>;
  assert.equal(health['status'], 'ok');
  assert.deepEqual(health['languages'], { primary: 'pt-BR', secondary: 'en', useSecondaryWhen: ['not_found'] });
  assert.equal(health['tools'].ffprobe.available, false);
  assert.equal(health['resources'].cacheMB, 3);
  assert.equal(health['resources'].cacheLimitMB, 50);
  assert.deepEqual(health['providers'][0].quota, { remaining: 17 });
  assert.deepEqual(health['subtitles'], { served: { synced: 2 }, unavailable: 0 });
});

test('Stremio requests wake the addon, health checks do not', async () => {
  assert.equal(idle.state, 'active'); // earlier tests already hit the manifest
  idle.stop();
  const quiet = new IdleMonitor({ idleAfterMs: 60_000, maxIdleMemoryMB: 1000, logger, onIdle: async () => {}, requestRestart: () => {} });
  const served = createServer({
    config: loadConfig({ configFile: writeConfig(), env: FULL_ENV }),
    logger,
    version: '0.1.0',
    tools: { ffmpeg: { available: false }, ffprobe: { available: false } },
    resources: { idle: quiet, lastSweep: () => undefined },
    providers: [],
    subtitles,
  });
  await new Promise<void>((resolve) => served.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(served.address() as AddressInfo).port}`;

  await fetch(`${url}/health`);
  assert.equal(quiet.state, 'idle');
  await fetch(`${url}/manifest.json`);
  assert.equal(quiet.state, 'active');

  quiet.stop();
  served.close();
});

test('offers a single track and logs what Stremio sent', async () => {
  const res = await fetch(`${base}/subtitles/series/tt0903747:1:2/videoHash=abc&filename=Breaking.Bad.S01E02.mkv.json`);
  assert.equal(res.status, 200);
  const { subtitles: tracks } = (await res.json()) as { subtitles: { id: string; url: string; lang: string }[] };
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.lang, 'pob');
  assert.equal(tracks[0]?.id, 'rightsubs-pt-BR');
  assert.ok(tracks[0]?.url.startsWith(`${base}/sub/series/tt0903747:1:2/pt-BR/`));
  const logged = lines.find((line) => line.includes('subtitles.request')) ?? '';
  assert.match(logged, /"imdbId":"tt0903747","season":1,"episode":2,"videoHash":"abc","filename":"Breaking.Bad.S01E02.mkv"/);

  // Without the hash (Stremio's first request), the URL is the same.
  const first = await fetch(`${base}/subtitles/series/tt0903747:1:2/filename=Breaking.Bad.S01E02.mkv.json`);
  assert.equal(((await first.json()) as { subtitles: { url: string }[] }).subtitles[0]?.url, tracks[0]?.url);
});

test('offers nothing when no language has subtitles', async () => {
  const res = await fetch(`${base}/subtitles/movie/tt0000001.json`);
  assert.deepEqual(await res.json(), { subtitles: [] });
});

test('serves the prepared track as UTF-8 SRT', async () => {
  const offered = await fetch(`${base}/subtitles/series/tt0903747:1:2/filename=Breaking.Bad.S01E02.mkv.json`);
  const url = ((await offered.json()) as { subtitles: { url: string }[] }).subtitles[0]?.url ?? '';
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/x-subrip; charset=utf-8');
  assert.match(await res.text(), /Olá/);
  const track = prepared.at(-1);
  assert.equal(track?.filename, 'Breaking.Bad.S01E02.mkv');
  assert.equal(track?.language.tag, 'pt-BR');
  assert.equal(track?.episode, 2);
});

test('answers 404 for unavailable or malformed tracks', async () => {
  assert.equal((await fetch(`${base}/sub/movie/tt0000001/pt-BR/_.srt`)).status, 404);
  assert.equal((await fetch(`${base}/sub/movie/tt0000001/xx-YY/_.srt`)).status, 404);
  assert.equal((await fetch(`${base}/sub/movie/nope/pt-BR/_.srt`)).status, 404);
});

test('answers CORS preflight and unknown paths', async () => {
  assert.equal((await fetch(`${base}/manifest.json`, { method: 'OPTIONS' })).status, 204);
  assert.equal((await fetch(`${base}/catalog/movie/top.json`)).status, 404);
});

test('without indexers, offers no streams and no stream resource', async () => {
  const res = await fetch(`${base}/stream/movie/tt0985699.json`);
  assert.deepEqual(await res.json(), { streams: [] });
  const manifest = (await (await fetch(`${base}/manifest.json`)).json()) as { resources: unknown[] };
  assert.deepEqual(manifest.resources, [{ name: 'subtitles', types: ['movie', 'series'], idPrefixes: ['tt', 'kitsu'] }]);
});

test('with indexers, passes streams through and declares the stream resource', async () => {
  const yaml = `languages:
  primary: pt-BR
providers:
  - id: os-v3
    type: stremio-addon
    url: https://opensubtitles-v3.strem.io/manifest.json
streams:
  indexers:
    - id: torrentio
      url: https://torrentio.example/rd=KEY/manifest.json
`;
  const asked: string[] = [];
  const served = createServer({
    config: loadConfig({ configFile: writeConfig(yaml), env: {} }),
    logger,
    version: '0.1.0',
    tools: { ffmpeg: { available: false }, ffprobe: { available: false } },
    resources: { idle, lastSweep: () => undefined },
    providers: [],
    subtitles,
    streams: {
      enabled: true,
      streams: async (type: string, id: string) => {
        asked.push(`${type}/${id}`);
        return { streams: [{ name: 'Torrentio', url: 'https://torrentio.example/resolve/1' }] };
      },
      status: () => ({ indexers: ['torrentio'], knownFiles: 1 }),
    },
  });
  await new Promise<void>((resolve) => served.listen(0, '127.0.0.1', resolve));
  after(() => served.close());
  const url = `http://127.0.0.1:${(served.address() as AddressInfo).port}`;

  const manifest = (await (await fetch(`${url}/manifest.json`)).json()) as { resources: unknown[] };
  assert.deepEqual(manifest.resources, [{ name: 'subtitles', types: ['movie', 'series'], idPrefixes: ['tt', 'kitsu'] }, { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'kitsu'] }]);
  const res = await fetch(`${url}/stream/series/tt26591147:2:12.json`);
  assert.deepEqual(await res.json(), { streams: [{ name: 'Torrentio', url: 'https://torrentio.example/resolve/1' }] });
  assert.deepEqual(asked, ['series/tt26591147:2:12']);
  const health = (await (await fetch(`${url}/health`)).json()) as { streams: unknown };
  assert.deepEqual(health.streams, { indexers: ['torrentio'], knownFiles: 1 });
});

test('anime (Kitsu) ids: resolved to IMDb, the track URL keeps the Kitsu id', async () => {
  const seen: { imdbId: string; season?: number; episode?: number }[] = [];
  const animeSubtitles = {
    chooseLanguage: async (request: { imdbId: string; season?: number; episode?: number }) => {
      seen.push(request);
      return findLanguage('pt-BR');
    },
    prepare: async (track: TrackRequest) => {
      seen.push(track);
      return Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\nL\r\n\r\n');
    },
    status: () => ({}),
  };
  const kitsu = {
    resolve: async (request: { id: string }) =>
      request.id === 'kitsu:1376:5' ? { ...request, imdbId: 'tt0877057', season: 1, episode: 5 } as never : undefined,
  };
  const served = createServer({
    config: loadConfig({ configFile: writeConfig(), env: FULL_ENV }),
    logger,
    version: '0.1.0',
    tools: { ffmpeg: { available: false }, ffprobe: { available: false } },
    resources: { idle, lastSweep: () => undefined },
    providers: [],
    subtitles: animeSubtitles,
    kitsu,
  });
  await new Promise<void>((resolve) => served.listen(0, '127.0.0.1', resolve));
  after(() => served.close());
  const url = `http://127.0.0.1:${(served.address() as AddressInfo).port}`;

  const res = await fetch(`${url}/subtitles/series/kitsu:1376:5/filename=Death.Note.05.mkv.json`);
  const track = ((await res.json()) as { subtitles: { url: string }[] }).subtitles[0]?.url ?? '';
  assert.match(track, /\/sub\/series\/kitsu:1376:5\/pt-BR\//);
  assert.equal((await fetch(track)).status, 200);
  assert.deepEqual(seen.map((r) => [r.imdbId, r.season, r.episode]), [
    ['tt0877057', 1, 5],
    ['tt0877057', 1, 5],
  ]);

  const unmapped = await fetch(`${url}/subtitles/series/kitsu:9:1.json`);
  assert.deepEqual(await unmapped.json(), { subtitles: [] });
});

test('a translation still being prepared is flagged in the subtitle menu, and the flag follows the real state', async () => {
  let pending = true;
  const translating = {
    chooseLanguage: async () => findLanguage('pt-BR'),
    prepare: async () => Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\nL\r\n\r\n'),
    translationPending: async () => pending,
    status: () => ({}),
  };
  const served = createServer({
    config: loadConfig({ configFile: writeConfig(), env: FULL_ENV }),
    logger,
    version: '0.1.0',
    tools: { ffmpeg: { available: false }, ffprobe: { available: false } },
    resources: { idle, lastSweep: () => undefined },
    providers: [],
    subtitles: translating,
  });
  await new Promise<void>((resolve) => served.listen(0, '127.0.0.1', resolve));
  after(() => served.close());
  const url = `http://127.0.0.1:${(served.address() as AddressInfo).port}`;

  const list = async () => ((await (await fetch(`${url}/subtitles/series/tt0000002:1:1/filename=Show.S01E01.mkv.json`)).json()) as { subtitles: { id: string; url: string; lang: string }[] }).subtitles;
  const preparing = await list();
  assert.deepEqual(preparing.map((t) => t.id), ['rightsubs-pt-BR', 'rightsubs-status']);
  assert.equal(preparing[0]?.lang, 'pob');
  assert.match(preparing[1]?.lang ?? '', /aguarde 30 s/);
  assert.match(preparing[1]?.url ?? '', /\/status\/series\/tt0000002:1:1\/pt-BR\//);

  // The status track says "preparing" while it is, and "ready" once it is.
  const whilePreparing = await fetch(preparing[1]?.url ?? '');
  assert.equal(whilePreparing.status, 200);
  assert.equal(whilePreparing.headers.get('cache-control'), 'no-store');
  assert.match(await whilePreparing.text(), /Preparando a legenda traduzida/);
  pending = false;
  assert.match(await (await fetch(preparing[1]?.url ?? '')).text(), /já está pronta/);

  // Ready: no extra entry any more.
  assert.deepEqual((await list()).map((t) => t.id), ['rightsubs-pt-BR']);
  assert.equal((await fetch(`${url}/status/series/tt0000002:1:1/xx-XX/_.srt`)).status, 404);
});

test('a track that needs no preparation is the only entry', async () => {
  const res = await fetch(`${base}/subtitles/series/tt0903747:1:2/filename=Breaking.Bad.S01E02.mkv.json`);
  assert.equal(((await res.json()) as { subtitles: unknown[] }).subtitles.length, 1);
});

/** A server whose subtitle service is a translation that is pending, with a short wait before the placeholder. */
async function pendingServer(prepare: () => Promise<Buffer>, isPending: () => boolean) {
  const translating = {
    chooseLanguage: async () => findLanguage('pt-BR'),
    prepare,
    translationPending: async () => isPending(),
    status: () => ({}),
  };
  const served = createServer({
    config: loadConfig({ configFile: writeConfig(), env: FULL_ENV }),
    logger,
    version: '0.1.0',
    tools: { ffmpeg: { available: false }, ffprobe: { available: false } },
    resources: { idle, lastSweep: () => undefined },
    providers: [],
    subtitles: translating,
    translationWaitMs: 60,
  });
  await new Promise<void>((resolve) => served.listen(0, '127.0.0.1', resolve));
  after(() => served.close());
  const url = `http://127.0.0.1:${(served.address() as AddressInfo).port}`;
  const offered = await fetch(`${url}/subtitles/series/tt0000003:1:1/filename=Show.S01E01.mkv.json`);
  const track = ((await offered.json()) as { subtitles: { url: string }[] }).subtitles[0]?.url ?? '';
  return track;
}

test('a translation not ready in time is answered with a placeholder, and the next request gets the real one', async () => {
  let pending = true;
  let finish!: (srt: Buffer) => void;
  const slow = new Promise<Buffer>((resolve) => (finish = resolve));
  const track = await pendingServer(() => slow, () => pending);

  const started = Date.now();
  const first = await fetch(track);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.match(await first.text(), /Saia do vídeo e abra de novo em cerca de 30 s/);
  assert.ok(Date.now() - started < 2000, 'answered within the wait, not when the translation ended');
  assert.ok(lines.some((l) => l.includes('subtitles.placeholder')));

  // The translation finishes in the background; the video opened again gets it.
  finish(Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\nOlá real\r\n\r\n'));
  pending = false;
  assert.match(await (await fetch(track)).text(), /Olá real/);
});

test('a translation that finishes within the wait is served as it is, with no placeholder', async () => {
  const track = await pendingServer(async () => Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\nRápida\r\n\r\n'), () => true);
  const text = await (await fetch(track)).text();
  assert.match(text, /Rápida/);
  assert.doesNotMatch(text, /RightSubs\]/);
});

test('a track that is not a pending translation waits for its subtitle, however long', async () => {
  const track = await pendingServer(() => new Promise((resolve) => setTimeout(() => resolve(Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\nDemorada\r\n\r\n')), 200)), () => false);
  assert.match(await (await fetch(track)).text(), /Demorada/);
});

test('a video that already has a subtitle in the user\'s language gets only a notice entry, and no search', async () => {
  let chosen = 0;
  const served = createServer({
    config: loadConfig({ configFile: writeConfig(), env: FULL_ENV }),
    logger,
    version: '0.1.0',
    tools: { ffmpeg: { available: false }, ffprobe: { available: false } },
    resources: { idle, lastSweep: () => undefined },
    providers: [],
    subtitles: {
      chooseLanguage: async () => {
        chosen += 1;
        return findLanguage('pt-BR');
      },
      prepare: async () => undefined,
      embeddedLanguage: async () => findLanguage('pt-BR'),
      status: () => ({}),
    },
  });
  await new Promise<void>((resolve) => served.listen(0, '127.0.0.1', resolve));
  after(() => served.close());
  const url = `http://127.0.0.1:${(served.address() as AddressInfo).port}`;

  const list = (await (await fetch(`${url}/subtitles/series/tt0000002:1:1/filename=Show.S01E01.mkv.json`)).json()) as { subtitles: { id: string; url: string; lang: string }[] };
  assert.deepEqual(list.subtitles.map((t) => t.id), ['rightsubs-embedded']);
  assert.match(list.subtitles[0]?.lang ?? '', /legenda embutida/);
  assert.equal(chosen, 0, 'nothing was searched');
  const notice = await (await fetch(list.subtitles[0]?.url ?? '')).text();
  assert.match(notice, /contém a legenda embutida/);
});
