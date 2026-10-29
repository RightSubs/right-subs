import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findLanguage, type Language } from '../src/languages/languages.ts';
import { createLogger } from '../src/logger.ts';
import type { SubtitleCandidate, SubtitleProvider, SubtitleQuery } from '../src/providers/types.ts';
import type { SubtitlesRequest } from '../src/stremio/request.ts';
import { SubtitleCache } from '../src/subtitles/cache.ts';
import { SubtitleService } from '../src/subtitles/service.ts';
import { parseSrt } from '../src/subtitles/srt.ts';
import { decodeSubtitle } from '../src/subtitles/text.ts';
import type { EmbeddedLookup } from '../src/sync/embedded-reference.ts';

const ptBR = findLanguage('pt-BR') as Language;
const en = findLanguage('en') as Language;
const srt = (text: string) => Buffer.from(`1\n00:00:01,000 --> 00:00:02,000\n${text}\n`, 'utf8');

/** Provider double: fixed candidates, files by ref (a function may throw), records calls. */
function fakeProvider(id: string, candidates: SubtitleCandidate[], files: Record<string, Buffer | (() => Buffer)> = {}) {
  const searches: SubtitleQuery[] = [];
  const downloads: string[] = [];
  const provider: SubtitleProvider = {
    id,
    search: async (query) => {
      searches.push(query);
      return candidates;
    },
    download: async (candidate) => {
      downloads.push(candidate.ref);
      const file = files[candidate.ref];
      if (!file) throw new Error(`no file ${candidate.ref}`);
      return typeof file === 'function' ? file() : file;
    },
  };
  return { provider, searches, downloads };
}

function service(providers: SubtitleProvider[], options: { secondary?: Language | undefined; budgetMs?: number; sync?: boolean } = {}) {
  const lines: string[] = [];
  const jobs = { open: 0 };
  const instance = new SubtitleService({
    providers,
    primary: ptBR,
    secondary: 'secondary' in options ? options.secondary : en,
    cache: new SubtitleCache(mkdtempSync(join(tmpdir(), 'rightsubs-cache-'))),
    logger: createLogger('debug', (line) => lines.push(line)),
    budgetMs: options.budgetMs ?? 10_000,
    beginJob: () => {
      jobs.open += 1;
      return () => void (jobs.open -= 1);
    },
    sync: { enabled: options.sync ?? true, minConfidence: 0.7 },
  });
  return { instance, lines, jobs };
}

const movie: SubtitlesRequest = { type: 'movie', id: 'tt0985699', imdbId: 'tt0985699', filename: 'Valkyrie.2008.1080p.BluRay.x265-GEGE.mkv' };

test('offers the primary language when it exists', async () => {
  const api = fakeProvider('api', [
    { providerId: 'api', ref: '1', language: en },
    { providerId: 'api', ref: '2', language: ptBR },
  ]);
  assert.equal((await service([api.provider]).instance.chooseLanguage(movie))?.tag, 'pt-BR');
});

test('falls back to the secondary language, or to nothing', async () => {
  const api = fakeProvider('api', [{ providerId: 'api', ref: '1', language: en }]);
  assert.equal((await service([api.provider]).instance.chooseLanguage(movie))?.tag, 'en');
  assert.equal(await service([api.provider], { secondary: undefined }).instance.chooseLanguage(movie), undefined);
});

test('one failing provider does not hide the others', async () => {
  const broken: SubtitleProvider = { id: 'broken', search: async () => Promise.reject(new Error('down')), download: async () => Buffer.alloc(0) };
  const v3 = fakeProvider('v3', [{ providerId: 'v3', ref: 'u', language: ptBR }]);
  const { instance, lines } = service([broken, v3.provider]);
  assert.equal((await instance.chooseLanguage(movie))?.tag, 'pt-BR');
  assert.ok(lines.some((line) => line.includes('provider.search_failed') && line.includes('"provider":"broken"')));
});

test('downloads a copy listed by the v3 addon instead of spending the API quota', async () => {
  const api = fakeProvider('api', [{ providerId: 'api', ref: '12830848', language: ptBR, sameAs: { providerId: 'v3', sourceId: '13949003' } }]);
  const v3 = fakeProvider('v3', [{ providerId: 'v3', ref: 'https://subs5/1962512795', sourceId: '13949003', language: ptBR }], {
    'https://subs5/1962512795': srt('Oi'),
  });
  const { instance } = service([api.provider, v3.provider]);
  const file = await instance.prepare({ ...movie, language: ptBR });
  assert.match(file?.toString() ?? '', /Oi\r\n/);
  assert.deepEqual(api.downloads, []);
  assert.deepEqual(v3.downloads, ['https://subs5/1962512795']);
});

test('ranks hash matches and same-release subtitles first', async () => {
  const api = fakeProvider(
    'api',
    [
      { providerId: 'api', ref: 'popular', language: ptBR, releaseName: 'Valkyrie.2008.720p.WEB', downloads: 90_000 },
      { providerId: 'api', ref: 'release', language: ptBR, releaseName: 'Valkyrie.2008.1080p.BluRay.x265-GEGE', downloads: 10 },
      { providerId: 'api', ref: 'hash', language: ptBR, releaseName: 'Other', hashMatch: true },
    ],
    { popular: srt('popular'), release: srt('release'), hash: srt('hash') },
  );
  const { instance } = service([api.provider]);
  assert.match((await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /hash/);

  const noHash = fakeProvider('api', [
    { providerId: 'api', ref: 'popular', language: ptBR, releaseName: 'Valkyrie.2008.720p.WEB', downloads: 90_000 },
    { providerId: 'api', ref: 'release', language: ptBR, releaseName: 'Valkyrie.2008.1080p.BluRay.x265-GEGE', downloads: 10 },
  ], { popular: srt('popular'), release: srt('release') });
  assert.match((await service([noHash.provider]).instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /release/);
});

test('tries the next candidate when a download fails or is not SRT', async () => {
  const api = fakeProvider(
    'api',
    [
      { providerId: 'api', ref: 'quota', language: ptBR, hashMatch: true },
      { providerId: 'api', ref: 'ass', language: ptBR, downloads: 500 },
      { providerId: 'api', ref: 'good', language: ptBR, downloads: 5 },
    ],
    {
      quota: () => {
        throw new Error('cota diária de downloads esgotada');
      },
      ass: Buffer.from('[Script Info]\nTitle: x'),
      good: srt('good'),
    },
  );
  const { instance, lines } = service([api.provider]);
  assert.match((await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /good/);
  assert.deepEqual(api.downloads, ['quota', 'ass', 'good']);
  assert.ok(lines.some((line) => line.includes('subtitles.download_failed')));
  assert.ok(lines.some((line) => line.includes('subtitles.not_srt')));
});

test('uses the hash learned from the second Stremio request', async () => {
  const api = fakeProvider('api', [{ providerId: 'api', ref: '1', language: ptBR }], { '1': srt('x') });
  const { instance } = service([api.provider]);
  await instance.chooseLanguage(movie);
  await instance.chooseLanguage({ ...movie, videoHash: 'e3af0d1b729cc9fe', videoSize: 10978737004 });
  await instance.prepare({ ...movie, language: ptBR }); // the track URL carries no hash

  assert.deepEqual(
    api.searches.map((q) => q.videoHash),
    [undefined, 'e3af0d1b729cc9fe'],
    'the prepare step reused the cached search with the hash',
  );
  assert.equal(api.searches[1]?.videoSize, 10978737004);
});

test('caches prepared files on disk and serves them without downloading again', async () => {
  const api = fakeProvider('api', [{ providerId: 'api', ref: '1', language: ptBR }], { '1': srt('cached') });
  const { instance } = service([api.provider]);
  await instance.prepare({ ...movie, language: ptBR });
  instance.release(); // as when the addon goes idle
  assert.match((await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /cached/);
  assert.deepEqual(api.downloads, ['1']);
});

test('prepares a track once even when the player asks twice at the same time', async () => {
  const api = fakeProvider('api', [{ providerId: 'api', ref: '1', language: ptBR }], { '1': srt('once') });
  const { instance, jobs } = service([api.provider]);
  const [a, b] = await Promise.all([instance.prepare({ ...movie, language: ptBR }), instance.prepare({ ...movie, language: ptBR })]);
  assert.equal(a, b);
  assert.deepEqual(api.downloads, ['1']);
  assert.equal(jobs.open, 0, 'the job is released when done');
});

test('gives up when nothing usable exists', async () => {
  const api = fakeProvider('api', [{ providerId: 'api', ref: '1', language: en }]);
  const { instance, lines } = service([api.provider]);
  assert.equal(await instance.prepare({ ...movie, language: ptBR }), undefined);
  assert.ok(lines.some((line) => line.includes('subtitles.unavailable')));
});

test('the cache directory only holds .srt files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rightsubs-cache-'));
  const cache = new SubtitleCache(dir);
  await cache.put('api:1', srt('x'));
  assert.match(readdirSync(dir)[0] ?? '', /^[0-9a-f]{40}\.srt$/);
  assert.equal(await cache.get('api:2'), undefined);
});

/** A realistic-looking dialogue track: 60 cues with irregular gaps, shifted/scaled as asked. */
function dialogue(text: string, { offsetMs = 0, scale = 1 } = {}): Buffer {
  let t = 60_000;
  const blocks: string[] = [];
  for (let i = 0; i < 60; i++) {
    const length = 1200 + ((i * 7919) % 2300);
    const start = Math.round(t * scale + offsetMs);
    const end = Math.round((t + length) * scale + offsetMs);
    const fmt = (ms: number) => new Date(ms).toISOString().slice(11, 23).replace('.', ',');
    blocks.push(`${i + 1}\n${fmt(start)} --> ${fmt(end)}\n${text} ${i}\n`);
    t += length + 400 + ((i * 104729) % 5000);
  }
  return Buffer.from(blocks.join('\n'), 'utf8');
}

const exactEn = { providerId: 'v3', ref: 'en-exact', language: en, releaseName: 'Valkyrie.2008.1080p.BluRay.x265-GEGE' };
const otherPt = { providerId: 'api', ref: 'pt-other', language: ptBR, releaseName: 'Valkyrie.2008.BluRay.BLUDV', metered: true };

test('syncs a subtitle from another release against the exact-release reference', async () => {
  const api = fakeProvider('api', [otherPt], { 'pt-other': dialogue('Olá', { offsetMs: -25_500 }) });
  const v3 = fakeProvider('v3', [exactEn], { 'en-exact': dialogue('Hello') });
  const { instance, lines } = service([api.provider, v3.provider]);
  const srt = (await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';

  assert.match(srt, /^1\r\n00:01:00,000 --> 00:01:01,200\r\nOlá 0\r\n/, 'first cue back at 1:00');
  const served = lines.find((line) => line.includes('subtitles.served')) ?? '';
  assert.match(served, /"status":"synced"/);
  assert.match(served, /"offsetMs":25500/);
  assert.match(served, /"referenceLanguage":"en"/);
});

test('corrects a frame-rate mismatch', async () => {
  const api = fakeProvider('api', [otherPt], { 'pt-other': dialogue('Olá', { scale: 23.976 / 25 }) });
  const v3 = fakeProvider('v3', [exactEn], { 'en-exact': dialogue('Hello') });
  const { instance, lines } = service([api.provider, v3.provider]);
  const srt = (await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';
  assert.match(lines.find((line) => line.includes('subtitles.served')) ?? '', /"status":"synced".*"scale":1.04271/);
  assert.match(srt, /00:01:00,0\d\d --> /);
});

test('leaves exact, already synced or unmatched subtitles untouched', async () => {
  const statusOf = async (pt: SubtitleCandidate, ptFile: Buffer, enFile: Buffer) => {
    const api = fakeProvider('api', [pt], { [pt.ref]: ptFile });
    const v3 = fakeProvider('v3', [exactEn], { 'en-exact': enFile });
    const { instance, lines } = service([api.provider, v3.provider]);
    const srt = await instance.prepare({ ...movie, language: ptBR });
    return { status: /"status":"(\w+)"/.exec(lines.find((l) => l.includes('subtitles.served')) ?? '')?.[1], srt, v3 };
  };

  const exact = await statusOf({ ...otherPt, hashMatch: true }, dialogue('Olá', { offsetMs: 5000 }), dialogue('Hello'));
  assert.equal(exact.status, 'exact');
  assert.deepEqual(exact.v3.downloads, [], 'no reference downloaded for an exact match');

  assert.equal((await statusOf(otherPt, dialogue('Olá'), dialogue('Hello'))).status, 'already_synced');

  // Unrelated timing (another movie): confidence too low, served as downloaded.
  const unrelated = Buffer.from(
    Array.from({ length: 40 }, (_, i) => `${i + 1}\n00:${String(10 + i).padStart(2, '0')}:00,000 --> 00:${String(10 + i).padStart(2, '0')}:00,500\nX\n`).join('\n'),
  );
  const low = await statusOf(otherPt, unrelated, dialogue('Hello'));
  assert.equal(low.status, 'low_confidence');
  assert.match(low.srt?.toString() ?? '', /00:10:00,000/);
});

test('without a reference or with sync disabled, serves the subtitle as is', async () => {
  const api = fakeProvider('api', [otherPt], { 'pt-other': dialogue('Olá', { offsetMs: 3000 }) });
  const alone = service([api.provider]);
  await alone.instance.prepare({ ...movie, language: ptBR });
  assert.match(alone.lines.find((l) => l.includes('subtitles.served')) ?? '', /"status":"no_reference"/);

  const v3 = fakeProvider('v3', [exactEn], { 'en-exact': dialogue('Hello') });
  const off = service([api.provider, v3.provider], { sync: false });
  await off.instance.prepare({ ...movie, language: ptBR });
  assert.match(off.lines.find((l) => l.includes('subtitles.served')) ?? '', /"status":"disabled"/);
  assert.deepEqual(v3.downloads, []);
});

test('prefers a free reference over one that spends quota', async () => {
  const api = fakeProvider('api', [otherPt, { ...exactEn, providerId: 'api', ref: 'en-paid', metered: true, downloads: 9999 }], {
    'pt-other': dialogue('Olá', { offsetMs: -2000 }),
    'en-paid': dialogue('Hello'),
  });
  const v3 = fakeProvider('v3', [exactEn], { 'en-exact': dialogue('Hello') });
  await service([api.provider, v3.provider]).instance.prepare({ ...movie, language: ptBR });
  assert.deepEqual(api.downloads, ['pt-other']);
  assert.deepEqual(v3.downloads, ['en-exact']);
});

test('when the timing cannot be trusted, tries the next free candidate', async () => {
  const unrelated = Buffer.from(
    Array.from({ length: 40 }, (_, i) => `${i + 1}\n00:${String(10 + i).padStart(2, '0')}:00,000 --> 00:${String(10 + i).padStart(2, '0')}:00,500\nX\n`).join('\n'),
  );
  const api = fakeProvider(
    'api',
    [
      { ...otherPt, ref: 'pt-bad', downloads: 9999 },
      { ...otherPt, ref: 'pt-paid', downloads: 50 },
    ],
    { 'pt-bad': unrelated, 'pt-paid': dialogue('pago', { offsetMs: -1000 }) },
  );
  const v3 = fakeProvider('v3', [exactEn, { providerId: 'v3', ref: 'pt-free', language: ptBR, releaseName: 'Valkyrie.2008.WEB' }], {
    'en-exact': dialogue('Hello'),
    'pt-free': dialogue('grátis', { offsetMs: 4000 }),
  });
  const { instance, lines } = service([api.provider, v3.provider]);
  const srt = (await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';

  assert.match(srt, /grátis 0/);
  assert.match(lines.find((l) => l.includes('subtitles.served')) ?? '', /"status":"synced"/);
  assert.deepEqual(api.downloads, ['pt-bad'], 'the second paid candidate was skipped to spare the quota');
});

test('infers the video frame rate from exact-file subtitles', async () => {
  const api = fakeProvider(
    'api',
    [
      { providerId: 'api', ref: 'pt25', language: ptBR, fps: 25, downloads: 9999 },
      { providerId: 'api', ref: 'pt24', language: ptBR, fps: 23.976 },
      { providerId: 'api', ref: 'en', language: en, fps: 23.976, hashMatch: true },
    ],
    { pt25: dialogue('25'), pt24: dialogue('24'), en: dialogue('en') },
  );
  const srt = (await service([api.provider]).instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';
  assert.match(srt, /\r\n24 0\r\n/);
});

test('a subtitle already in the cache wins a close call against a new download', async () => {
  const api = fakeProvider(
    'api',
    [
      { ...otherPt, ref: 'pt-new', downloads: 5000 },
      { ...otherPt, ref: 'pt-cached', downloads: 10 },
    ],
    { 'pt-new': dialogue('novo'), 'pt-cached': dialogue('cache') },
  );
  const cache = new SubtitleCache(mkdtempSync(join(tmpdir(), 'rightsubs-cache-')));
  await cache.put('api:pt-cached', dialogue('cache'));
  const instance = new SubtitleService({
    providers: [api.provider],
    primary: ptBR,
    secondary: en,
    cache,
    logger: createLogger('error'),
    budgetMs: 10_000,
    beginJob: () => () => {},
    sync: { enabled: true, minConfidence: 0.7 },
  });
  assert.match((await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /cache 0/);
  assert.deepEqual(api.downloads, [], 'served from cache, no quota spent');
});

test('without a reference, rescales a subtitle made for another frame rate to the real one', async () => {
  const api = fakeProvider('api', [{ ...otherPt, fps: 25 }], { 'pt-other': dialogue('Olá', { scale: 23.976 / 25 }) });
  const inspected: (string | undefined)[] = [];
  const instance = new SubtitleService({
    providers: [api.provider],
    primary: ptBR,
    secondary: en,
    cache: new SubtitleCache(mkdtempSync(join(tmpdir(), 'rightsubs-cache-'))),
    logger: createLogger('error'),
    budgetMs: 10_000,
    beginJob: () => () => {},
    sync: { enabled: true, minConfidence: 0.7 },
    inspect: async (filename) => {
      inspected.push(filename);
      return { fps: 23.976, subtitleTracks: [] };
    },
  });
  const srt = (await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';
  assert.match(srt, /^1\r\n00:01:00,000 --> /, 'first cue back at 1:00');
  assert.deepEqual(inspected, [movie.filename]);
});

test('counts how tracks were synced and lists the unsynced ones', async () => {
  const api = fakeProvider('api', [otherPt], { 'pt-other': dialogue('Olá', { offsetMs: 3000 }) });
  const { instance } = service([api.provider]);
  await instance.prepare({ ...movie, language: ptBR });
  await instance.prepare({ ...movie, id: 'tt1', imdbId: 'tt1', language: ptBR });
  await instance.prepare({ ...movie, language: en });
  const status = instance.status() as { served: Record<string, number>; unavailable: number; recentUnsynced: { id: string; status: string }[] };
  assert.deepEqual(status.served, { no_reference: 2 });
  assert.equal(status.unavailable, 1);
  assert.deepEqual(status.recentUnsynced.map((c) => [c.id, c.status]), [
    ['tt1', 'no_reference'],
    ['tt0985699', 'no_reference'],
  ]);
});

test('does not rescale when the subtitle declares a frame rate that is not a real one', async () => {
  const api = fakeProvider('api', [{ ...otherPt, fps: 23.81 }], { 'pt-other': dialogue('Olá') });
  const lines: string[] = [];
  const instance = new SubtitleService({
    providers: [api.provider],
    primary: ptBR,
    secondary: en,
    cache: new SubtitleCache(mkdtempSync(join(tmpdir(), 'rightsubs-cache-'))),
    logger: createLogger('debug', (line) => lines.push(line)),
    budgetMs: 10_000,
    beginJob: () => () => {},
    sync: { enabled: true, minConfidence: 0.7 },
    inspect: async () => ({ fps: 23.976, subtitleTracks: [] }),
  });
  assert.match((await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /^1\r\n00:01:00,000 --> 00:01:01,200/);
  assert.ok(lines.some((l) => l.includes('"status":"no_reference"')));
});

/** Embedded-reference double: becomes ready after `delayMs`, with the given reference text. */
function fakeEmbedded(reference: Buffer, delayMs: number) {
  let ready = false;
  let started = 0;
  let done: Promise<void> | undefined;
  return {
    started: () => started,
    lookup: async (): Promise<EmbeddedLookup> => {
      if (ready) return { state: 'ready', cues: parseSrt(decodeSubtitle(reference)), track: { index: 5, codec: 'subrip', language: 'eng' } };
      if (!done) {
        started += 1;
        done = new Promise((resolve) => setTimeout(() => ((ready = true), resolve()), delayMs));
      }
      return { state: 'pending', done };
    },
  };
}

function embeddedService(embedded: ReturnType<typeof fakeEmbedded>, budgetMs: number) {
  const api = fakeProvider('api', [otherPt], { 'pt-other': dialogue('Olá', { offsetMs: -25_500 }) });
  const lines: string[] = [];
  const instance = new SubtitleService({
    providers: [api.provider],
    primary: ptBR,
    secondary: en,
    cache: new SubtitleCache(mkdtempSync(join(tmpdir(), 'rightsubs-cache-'))),
    logger: createLogger('debug', (line) => lines.push(line)),
    budgetMs,
    beginJob: () => () => {},
    sync: { enabled: true, minConfidence: 0.7 },
    inspect: async () => ({ fps: 23.976, durationMs: 3_600_000, subtitleTracks: [{ index: 5, codec: 'subrip', language: 'eng' }] }),
    embedded,
  });
  return { instance, lines, api };
}

test('waits for the embedded reference within the budget and serves the synced subtitle', async () => {
  const embedded = fakeEmbedded(dialogue('Hello'), 30);
  const { instance, lines } = embeddedService(embedded, 5000);
  const srt = (await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';
  assert.match(srt, /^1\r\n00:01:00,000 --> 00:01:01,200\r\nOlá 0/);
  const served = lines.find((l) => l.includes('subtitles.served')) ?? '';
  assert.match(served, /"status":"synced","reference":"embedded","referenceLanguage":"eng"/);
  assert.match(served, /"offsetMs":25500/);
});

test('waits for the embedded reference even past the budget: the player keeps the first subtitle it gets', async () => {
  const embedded = fakeEmbedded(dialogue('Hello'), 150);
  const { instance, lines } = embeddedService(embedded, 20);
  const srt = (await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';
  assert.match(srt, /^1\r\n00:01:00,000 --> /);
  assert.match(lines.find((l) => l.includes('subtitles.served')) ?? '', /"status":"synced","reference":"embedded"/);
  assert.equal(embedded.started(), 1);
});

test('when the embedded reference cannot be read, serves the subtitle as downloaded', async () => {
  const failing = {
    lookup: async (): Promise<EmbeddedLookup> => ({ state: 'unavailable' }),
  };
  const { instance, lines } = embeddedService(failing as unknown as ReturnType<typeof fakeEmbedded>, 1000);
  assert.ok(await instance.prepare({ ...movie, language: ptBR }));
  assert.match(lines.find((l) => l.includes('subtitles.served')) ?? '', /"status":"no_reference"/);
});

test('a subtitle of the same source and resolution as the file is not checked against the embedded one', async () => {
  const QTZ = 'Halloween (1978) MULTi VFI 2160p 10bit 4KLight DOLBY VISION BluRay AC3 5.1 x265-QTZ.mkv';
  const run = async (releaseName: string, file: Buffer) => {
    const embedded = fakeEmbedded(dialogue('Hello'), 30);
    const api = fakeProvider('api', [{ ...otherPt, releaseName }], { 'pt-other': file });
    const lines: string[] = [];
    const instance = new SubtitleService({
      providers: [api.provider],
      primary: ptBR,
      secondary: en,
      cache: new SubtitleCache(mkdtempSync(join(tmpdir(), 'rightsubs-cache-'))),
      logger: createLogger('debug', (line) => lines.push(line)),
      budgetMs: 5000,
      beginJob: () => () => {},
      sync: { enabled: true, minConfidence: 0.7 },
      inspect: async () => ({ fps: 23.976, durationMs: 3_600_000, subtitleTracks: [{ index: 4, codec: 'subrip', language: 'fre' }] }),
      embedded,
    });
    await instance.prepare({ ...movie, filename: QTZ, language: ptBR });
    return { served: lines.find((l) => l.includes('subtitles.served')) ?? '', reads: embedded.started() };
  };

  const same = await run('Halloween.1978.2160p.4K.BluRay.x265.10bit.AAC5.1-[YTS.MX]', dialogue('Olá'));
  assert.match(same.served, /"status":"likely_synced"/);
  assert.equal(same.reads, 0, 'no video read');

  // A different source (DVDRip for the BluRay) is still checked.
  const dvd = await run('Halloween.1978.DVDRip.XviD', dialogue('Olá', { offsetMs: -25_500 }));
  assert.match(dvd.served, /"status":"synced","reference":"embedded"/);
  assert.equal(dvd.reads, 1);
});

test('the request with the hash starts preparing before the player asks', async () => {
  const embedded = fakeEmbedded(dialogue('Hello'), 30);
  const { instance, lines, api } = embeddedService(embedded, 5000);
  await instance.chooseLanguage({ ...movie, videoHash: 'f155987eac723cee', videoSize: 4574627960 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(embedded.started(), 1, 'reference extraction already running');
  assert.deepEqual(api.downloads, ['pt-other'], 'subtitle already downloaded');
  assert.ok(!lines.some((l) => l.includes('subtitles.served')), 'warming up is not "served"');

  const srt = (await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';
  assert.match(srt, /^1\r\n00:01:00,000 --> /);
  assert.equal(lines.filter((l) => l.includes('subtitles.served')).length, 1);
});
