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
import { parseSrt, retime, serializeSrt } from '../src/subtitles/srt.ts';
import { decodeSubtitle } from '../src/subtitles/text.ts';
import type { EmbeddedLookup } from '../src/sync/embedded-reference.ts';
import { loadTimings } from './helpers.ts';

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

function service(
  providers: SubtitleProvider[],
  options: { secondary?: Language | undefined; references?: Language[]; budgetMs?: number; sync?: boolean } = {},
) {
  const lines: string[] = [];
  const jobs = { open: 0 };
  const instance = new SubtitleService({
    providers,
    primary: ptBR,
    secondary: 'secondary' in options ? options.secondary : en,
    ...(options.references ? { references: options.references } : {}),
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

test('leaves the timing alone for frame-interpolated video (60 fps from a 23.976 film)', async () => {
  // Drive (2011) RIFE 60 fps: same duration as the BluRay, three times the frames.
  const api = fakeProvider('api', [{ ...otherPt, fps: 23.976 }], { 'pt-other': dialogue('Olá') });
  const lines: string[] = [];
  const instance = new SubtitleService({
    providers: [api.provider],
    primary: ptBR,
    secondary: en,
    cache: new SubtitleCache(mkdtempSync(join(tmpdir(), 'rightsubs-cache-'))),
    logger: createLogger('info', (line) => lines.push(line)),
    budgetMs: 10_000,
    beginJob: () => () => {},
    sync: { enabled: true, minConfidence: 0.7 },
    inspect: async () => ({ fps: 60, subtitleTracks: [] }),
  });
  const srt = (await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';
  assert.match(srt, /^1\r?\n00:01:00,000 --> /);
  assert.match(lines.find((l) => l.includes('subtitles.served')) ?? '', /"status":"no_reference","fps":60/);
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

test('applies an offset in dense dialogue even when speech overlap barely improves', async () => {
  // Drive (2011) OpenMatte: embedded English windows, BluRay pt-BR subtitle ~13 s late; unshifted overlap 0.85.
  const drive = loadTimings('drive-2011-timings.json');
  const api = fakeProvider('api', [otherPt], { 'pt-other': Buffer.from(serializeSrt(drive.subtitle), 'utf8') });
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
    inspect: async () => ({ fps: 60, durationMs: 6_000_000, subtitleTracks: [{ index: 5, codec: 'subrip', language: 'eng' }] }),
    embedded: fakeEmbedded(Buffer.from(serializeSrt(drive.reference), 'utf8'), 10),
  });
  const first = drive.subtitle[0]?.startMs ?? 0;
  const srt = parseSrt((await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '');
  assert.ok(Math.abs((srt[0]?.startMs ?? 0) - (first - 12_820)) <= 100, 'moved ~12.8 s earlier');
  assert.match(lines.find((l) => l.includes('subtitles.served')) ?? '', /"status":"synced","reference":"embedded"/);
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

test('another cut is no reference; a subtitle of the same cut, source and resolution is', async () => {
  // Box, 2026-11-01: DC file at 25 fps; the theatrical RARBG subtitle passed for exact
  // and kept the PT-BR at 23.976 (×0.999). The DC subtitle of another group fits.
  const DC = 'Enter.the.Void.2009.DC.1080p.BluRay.H264.AAC-RARBG.mp4';
  const theatrical = { providerId: 'v3', ref: 'en-theatrical', language: en, releaseName: 'Enter.The.Void.2009.1080p.BluRay.H264.AAC-RARBG' };
  const sameCut = { providerId: 'v3', ref: 'en-dc', language: en, releaseName: 'Enter.the.Void.2009.DC.1080p.BluRay.x265-RARBG' };
  const run = async (releaseName: string) => {
    const api = fakeProvider('api', [{ ...otherPt, releaseName }], { 'pt-other': dialogue('Olá', { scale: 25 / 23.976, offsetMs: -500 }) });
    const v3 = fakeProvider('v3', [theatrical, sameCut], {
      'en-theatrical': dialogue('Hello', { scale: 25 / 23.976 }),
      'en-dc': dialogue('Hello'),
    });
    const { instance, lines } = service([api.provider, v3.provider]);
    await instance.prepare({ ...movie, id: 'tt1191111', imdbId: 'tt1191111', filename: DC, language: ptBR });
    return { served: lines.find((l) => l.includes('subtitles.served')) ?? '', v3 };
  };

  const lounge = await run('Enter.the.Void.2010.BRRip.[A.Release-Lounge.H264]');
  assert.match(lounge.served, /"status":"synced","reference":"Enter.the.Void.2009.DC.1080p.BluRay.x265-RARBG","referenceLanguage":"en","referenceMatch":"same_edit".*"scale":0.95904/);
  assert.deepEqual(lounge.v3.downloads, ['en-dc'], 'the theatrical subtitle is not used');

  // A theatrical BluRay 1080p subtitle is not "likely synced" with the DC BluRay 1080p either.
  const fgt = await run('Enter.The.Void.2009.1080p.BluRay.x264.DTS-FGT');
  assert.match(fgt.served, /"status":"synced".*"referenceMatch":"same_edit"/);
});

test('reference languages are searched to sync, never served', async () => {
  // Box, 2026-11-01: with PT-PT as secondary, English left the search and so did the DC
  // reference that fixed the Release-Lounge PT-BR (×0.95904): served unsynced.
  const ptPT = findLanguage('pt-PT') as Language;
  const DC = 'Enter.the.Void.2009.DC.1080p.BluRay.H264.AAC-RARBG.mp4';
  const sameCut = { providerId: 'v3', ref: 'en-dc', language: en, releaseName: 'Enter.the.Void.2009.DC.1080p.BluRay.x265-RARBG' };
  const lounge = { ...otherPt, releaseName: 'Enter.the.Void.2010.BRRip.[A.Release-Lounge.H264]' };
  // Real providers only answer the languages asked for.
  const byLanguage = (provider: SubtitleProvider): SubtitleProvider => ({
    ...provider,
    search: async (query) => (await provider.search(query)).filter((c) => query.languages.some((lang) => lang.tag === c.language.tag)),
  });
  const run = async (references: Language[] | undefined, candidates: SubtitleCandidate[] = [lounge]) => {
    const api = fakeProvider('api', candidates, { 'pt-other': dialogue('Olá', { scale: 25 / 23.976, offsetMs: -500 }) });
    const v3 = fakeProvider('v3', [sameCut], { 'en-dc': dialogue('Hello') });
    const { instance, lines } = service([byLanguage(api.provider), byLanguage(v3.provider)], { secondary: ptPT, ...(references ? { references } : {}) });
    const request = { ...movie, id: 'tt1191111', imdbId: 'tt1191111', filename: DC };
    const chosen = await instance.chooseLanguage(request);
    if (chosen) await instance.prepare({ ...request, language: chosen });
    return { chosen, served: lines.find((l) => l.includes('subtitles.served')) ?? '', languages: v3.searches[0]?.languages.map((lang) => lang.tag) };
  };

  const withEnglish = await run([en]);
  assert.deepEqual(withEnglish.languages, ['pt-BR', 'pt-PT', 'en'], 'one search for all of them');
  assert.match(withEnglish.served, /"status":"synced","reference":"Enter.the.Void.2009.DC.1080p.BluRay.x265-RARBG","referenceLanguage":"en".*"scale":0.95904/);

  const without = await run(undefined);
  assert.deepEqual(without.languages, ['pt-BR', 'pt-PT']);
  assert.match(without.served, /"status":"no_reference"/);

  // Only English exists: it is a reference language, not one to watch, so nothing is offered.
  const englishOnly = await run([en], []);
  assert.equal(englishOnly.chosen, undefined);
  assert.equal(englishOnly.served, '');
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

// --- last resort: translation (DeepL) ---

/** Translator double: upper-cases the text and records the calls. */
function fakeTranslator(fail?: string) {
  const calls: string[][] = [];
  return {
    calls,
    translate: async (texts: string[]) => {
      calls.push(texts);
      if (fail) throw new Error(fail);
      return texts.map((text) => `PT ${text}`);
    },
  };
}

function translatingService(
  files: Record<string, Buffer>,
  candidates: SubtitleCandidate[],
  translator: ReturnType<typeof fakeTranslator>,
  embedded?: { lookup: () => Promise<EmbeddedLookup> },
  extra: { forceFrom?: Language[] } = {},
) {
  const api = fakeProvider('api', candidates, files);
  const lines: string[] = [];
  const instance = new SubtitleService({
    providers: [api.provider],
    primary: ptBR,
    secondary: undefined,
    references: [en],
    cache: new SubtitleCache(mkdtempSync(join(tmpdir(), 'rightsubs-cache-'))),
    logger: createLogger('debug', (line) => lines.push(line)),
    budgetMs: 5000,
    beginJob: () => () => {},
    sync: { enabled: true, minConfidence: 0.7 },
    inspect: async () => ({ fps: 23.976, durationMs: 3_600_000, subtitleTracks: [{ index: 5, codec: 'subrip', language: 'fre' }] }),
    translator,
    ...(embedded ? { embedded } : {}),
    ...extra,
  });
  return { instance, lines, api };
}

const readyEmbedded = (reference: Buffer) => ({
  lookup: async (): Promise<EmbeddedLookup> => ({ state: 'ready', cues: parseSrt(decodeSubtitle(reference)), track: { index: 5, codec: 'subrip', language: 'fre' } }),
});

const de = findLanguage('de') as Language;
const german: SubtitleCandidate = { providerId: 'api', ref: 'de-1', language: de, releaseName: 'Valkyrie.2008.DVDRip.XviD' };

/** Like dialogue(), but the second half is shifted by another offset: a subtitle made for another cut of the video. */
function steppedDialogue(text: string, firstOffsetMs: number, secondOffsetMs: number): Buffer {
  const cues = parseSrt(decodeSubtitle(dialogue(text)));
  const half = cues.length / 2;
  return Buffer.from(serializeSrt([...retime(cues.slice(0, half), 1, firstOffsetMs), ...retime(cues.slice(half), 1, secondOffsetMs)]), 'utf8');
}

const exactEnApi: SubtitleCandidate = { providerId: 'api', ref: 'en-exact', language: en, releaseName: 'Valkyrie.2008.1080p.BluRay.x265-GEGE' };
const otherEn: SubtitleCandidate = { providerId: 'api', ref: 'en-other', language: en, releaseName: 'Valkyrie.2008.DVDRip.XviD' };

test('offers the primary language to translate into when a subtitle exists in any language', async () => {
  const translator = fakeTranslator();
  const withEnglish = translatingService({}, [exactEnApi], translator);
  assert.equal((await withEnglish.instance.chooseLanguage(movie))?.tag, 'pt-BR');
  const inGerman = translatingService({}, [{ providerId: 'api', ref: 'x', language: de }], translator);
  assert.equal((await inGerman.instance.chooseLanguage(movie))?.tag, 'pt-BR');
  const nothing = translatingService({}, [], translator);
  assert.equal(await nothing.instance.chooseLanguage(movie), undefined);
});

test('searches every language when there is a translator, only the wanted ones otherwise', async () => {
  const withTranslator = translatingService({}, [exactEnApi], fakeTranslator());
  await withTranslator.instance.chooseLanguage(movie);
  assert.ok((withTranslator.api.searches[0]?.languages.length ?? 0) > 5);
  const api = fakeProvider('api', [exactEnApi]);
  await service([api.provider], { references: [en] }).instance.chooseLanguage(movie);
  assert.deepEqual(api.searches[0]?.languages.map((lang) => lang.tag), ['pt-BR', 'en']);
});

test('translates an English subtitle that was out of sync after syncing it to the embedded track', async () => {
  const translator = fakeTranslator();
  const { instance, lines } = translatingService(
    { 'en-other': dialogue('Hello', { offsetMs: -25_500 }) },
    [otherEn],
    translator,
    readyEmbedded(dialogue('Bonjour')),
  );
  const served = (await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';
  assert.match(served, /PT Hello 0/);
  assert.match(served, /\r\n2\r\n00:01:00,000 --> /, 'shifted back to the embedded timing before translating');
  assert.match(lines.find((l) => l.includes('subtitles.served')) ?? '', /"status":"translated",.*"sourceSync":"synced"/);
});

test('does not translate a subtitle whose timing could not be confirmed', async () => {
  const translator = fakeTranslator();
  const { instance, lines } = translatingService({ 'en-other': dialogue('Hello', { offsetMs: -25_500 }) }, [otherEn], translator);
  assert.equal(await instance.prepare({ ...movie, language: ptBR }), undefined);
  assert.equal(translator.calls.length, 0, 'no quota spent');
  assert.ok(lines.some((l) => l.includes('translation.skipped') && l.includes('no_reference')));
});

test('an exact English subtitle is checked against the embedded track before translating', async () => {
  const translator = fakeTranslator();
  // The "exact" subtitle is really 25.5 s late (the Enter the Void / Drive kind of case).
  const { instance, lines } = translatingService(
    { 'en-exact': dialogue('Hello', { offsetMs: -25_500 }) },
    [exactEnApi],
    translator,
    readyEmbedded(dialogue('Bonjour')),
  );
  const served = (await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';
  assert.match(served, /\r\n2\r\n00:01:00,000 --> /);
  assert.match(lines.find((l) => l.includes('subtitles.served')) ?? '', /"sourceSync":"synced"/);
});

test('an exact English subtitle with nothing to check it against is translated as is', async () => {
  const translator = fakeTranslator();
  const { instance, lines } = translatingService({ 'en-exact': dialogue('Hello') }, [exactEnApi], translator);
  assert.match((await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /PT Hello 0/);
  assert.match(lines.find((l) => l.includes('subtitles.served')) ?? '', /"verified":false/);
});

test('the translation is cached: replaying spends no quota', async () => {
  const translator = fakeTranslator();
  const { instance, api } = translatingService({ 'en-exact': dialogue('Hello') }, [exactEnApi], translator);
  await instance.prepare({ ...movie, language: ptBR });
  instance.release();
  const again = await instance.prepare({ ...movie, language: ptBR });
  assert.match(again?.toString() ?? '', /PT Hello 0/);
  assert.equal(translator.calls.length, 1);
  assert.deepEqual(api.downloads, ['en-exact']);
});

test('a translator failure (quota, key) leaves the track unavailable and is logged without the text', async () => {
  const translator = fakeTranslator('cota mensal do DeepL esgotada');
  const { instance, lines } = translatingService({ 'en-exact': dialogue('Hello') }, [exactEnApi], translator);
  assert.equal(await instance.prepare({ ...movie, language: ptBR }), undefined);
  const failed = lines.find((l) => l.includes('translation.failed')) ?? '';
  assert.match(failed, /cota mensal/);
  assert.doesNotMatch(failed, /Hello/);
});

test('an existing subtitle in the primary language is never translated over', async () => {
  const translator = fakeTranslator();
  const { instance } = translatingService({ 'pt-1': dialogue('Olá'), 'en-exact': dialogue('Hello') }, [{ providerId: 'api', ref: 'pt-1', language: ptBR }, exactEnApi], translator);
  assert.match((await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /Olá/);
  assert.equal(translator.calls.length, 0);
});

// --- last resort: choosing the source among every language ---

test('translates the German subtitle that fits all over the movie, not the English one made for another cut', async () => {
  const translator = fakeTranslator();
  const { instance, lines } = translatingService(
    { 'en-other': steppedDialogue('Hello', -11_000, 2_800), 'de-1': dialogue('Hallo', { offsetMs: -6_000 }) },
    [otherEn, german],
    translator,
    readyEmbedded(dialogue('Bonjour')),
  );
  const served = (await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';
  assert.match(served, /PT Hallo 0/);
  assert.match(served, /\r\n2\r\n00:01:00,000 --> /, 'shifted to the embedded timing before translating');
  assert.deepEqual(translator.calls.flat().filter((text) => text.startsWith('Hello')), [], 'the English one was not paid for');
  assert.ok(lines.some((l) => l.includes('translation.candidate') && l.includes('"from":"en"') && l.includes('"status":"inconsistent"')));
  assert.match(lines.find((l) => l.includes('subtitles.served')) ?? '', /"sourceSync":"synced".*"from":"de"/);
});

test('does not translate when the only candidate has steps, even if its alignment looks excellent', async () => {
  const translator = fakeTranslator();
  const { instance, lines } = translatingService(
    { 'en-other': steppedDialogue('Hello', -11_000, 2_800) },
    [otherEn],
    translator,
    readyEmbedded(dialogue('Bonjour')),
  );
  assert.equal(await instance.prepare({ ...movie, language: ptBR }), undefined);
  assert.equal(translator.calls.length, 0, 'no quota spent');
  assert.ok(lines.some((l) => l.includes('translation.skipped') && l.includes('no_confirmed_source')));
});

test('on a tie in confidence the English subtitle wins, whatever the order', async () => {
  const translator = fakeTranslator();
  const { instance } = translatingService(
    { 'de-1': dialogue('Hallo', { offsetMs: -6_000 }), 'en-other': dialogue('Hello', { offsetMs: -6_040 }) },
    [german, otherEn],
    translator,
    readyEmbedded(dialogue('Bonjour')),
  );
  assert.match((await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /PT Hello 0/);
});

test('a perfect match that checks out is used without examining the others', async () => {
  const translator = fakeTranslator();
  const { instance, api } = translatingService(
    { 'en-exact': dialogue('Hello', { offsetMs: -6_000 }), 'de-1': dialogue('Hallo', { offsetMs: -6_000 }) },
    [german, exactEnApi],
    translator,
    readyEmbedded(dialogue('Bonjour')),
  );
  assert.match((await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /PT Hello 0/);
  assert.deepEqual(api.downloads, ['en-exact']);
});

test('metered candidates are only downloaded when no free one works', async () => {
  const paid: SubtitleCandidate = { ...otherEn, ref: 'en-paid', metered: true };
  const embedded = readyEmbedded(dialogue('Bonjour'));

  const freeWorks = translatingService(
    { 'en-paid': dialogue('Hello', { offsetMs: -3_000 }), 'de-1': dialogue('Hallo', { offsetMs: -6_000 }) },
    [paid, german],
    fakeTranslator(),
    embedded,
  );
  assert.match((await freeWorks.instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /PT Hallo 0/);
  assert.deepEqual(freeWorks.api.downloads, ['de-1'], 'the quota was not touched');

  const freeFails = translatingService(
    { 'en-paid': dialogue('Hello', { offsetMs: -3_000 }), 'de-1': steppedDialogue('Hallo', -11_000, 2_800) },
    [paid, german],
    fakeTranslator(),
    embedded,
  );
  assert.match((await freeFails.instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /PT Hello 0/);
  assert.deepEqual(freeFails.api.downloads, ['de-1', 'en-paid']);
});

test('copies of the same subtitle count once', async () => {
  const copies = ['a', 'b', 'c'].map((ref): SubtitleCandidate => ({ ...otherEn, ref: `en-${ref}` }));
  const same = dialogue('Hello', { offsetMs: -6_000 });
  const { instance, lines } = translatingService(
    { 'en-a': same, 'en-b': same, 'en-c': same, 'de-1': dialogue('Hallo', { offsetMs: -6_300 }) },
    [...copies, german],
    fakeTranslator(),
    readyEmbedded(dialogue('Bonjour')),
  );
  assert.ok(await instance.prepare({ ...movie, language: ptBR }));
  assert.equal(lines.filter((l) => l.includes('translation.candidate')).length, 2, 'English once and German once');
});

test('"looks like the file" is not enough to translate without an embedded track to check it', async () => {
  const translator = fakeTranslator();
  const sameCut: SubtitleCandidate = { providerId: 'api', ref: 'en-cut', language: en, releaseName: 'Valkyrie.2008.1080p.BluRay.x264-OTHER' };
  const { instance, lines } = translatingService({ 'en-cut': dialogue('Hello') }, [sameCut], translator);
  assert.equal(await instance.prepare({ ...movie, language: ptBR }), undefined);
  assert.equal(translator.calls.length, 0);
  assert.ok(lines.some((l) => l.includes('translation.skipped') && l.includes('likely_synced')));
});

test('a translated subtitle starts with a notice that DeepL did it, kept in the cache', async () => {
  const translator = fakeTranslator();
  const { instance } = translatingService({ 'en-exact': dialogue('Hello') }, [exactEnApi], translator);
  const first = (await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';
  assert.match(first, /^1\r\n00:00:00,500 --> 00:00:04,500\r\n\[Legenda traduzida por IA \(DeepL\)\]\r\n\r\n2\r\n00:01:00,000 --> /);
  instance.release();
  const again = (await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';
  assert.equal(again, first, 'the cached copy has it too');
});

test('a subtitle that is not translated has no notice', async () => {
  const { instance } = translatingService({ 'pt-1': dialogue('Olá') }, [{ providerId: 'api', ref: 'pt-1', language: ptBR }], fakeTranslator());
  assert.doesNotMatch((await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /DeepL/);
});

// --- TEST mode: forced translation (translation.deepl.forceFrom) ---

const ptExisting: SubtitleCandidate = { providerId: 'api', ref: 'pt-1', language: ptBR, releaseName: 'Valkyrie.2008.1080p.BluRay.x265-GEGE' };

test('forced translation translates from the chosen language even when the wanted one exists', async () => {
  const translator = fakeTranslator();
  const { instance, lines, api } = translatingService(
    { 'pt-1': dialogue('Olá'), 'en-other': dialogue('Hello', { offsetMs: -6_000 }) },
    [ptExisting, otherEn],
    translator,
    readyEmbedded(dialogue('Bonjour')),
    { forceFrom: [en] },
  );
  assert.equal((await instance.chooseLanguage(movie))?.tag, 'pt-BR');
  const served = (await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '';
  assert.match(served, /PT Hello 0/);
  assert.doesNotMatch(served, /Olá/);
  assert.ok(!api.downloads.includes('pt-1'), 'the existing Portuguese subtitle was not even downloaded');
  assert.ok(lines.some((l) => l.includes('translation.forced')));
  assert.match(lines.find((l) => l.includes('subtitles.served')) ?? '', /"status":"translated"/);
});

test('forced translation only uses the languages it was told to', async () => {
  const translator = fakeTranslator();
  const { instance, api } = translatingService(
    { 'de-1': dialogue('Hallo', { offsetMs: -6_000 }), 'en-other': dialogue('Hello', { offsetMs: -6_040 }) },
    [german, otherEn, ptExisting],
    translator,
    readyEmbedded(dialogue('Bonjour')),
    { forceFrom: [de] },
  );
  assert.match((await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /PT Hallo 0/);
  assert.deepEqual(api.downloads, ['de-1']);
});

test('forced translation without a candidate in the chosen languages falls back to the normal flow', async () => {
  const translator = fakeTranslator();
  const { instance } = translatingService({ 'pt-1': dialogue('Olá') }, [ptExisting], translator, undefined, { forceFrom: [en] });
  assert.equal((await instance.chooseLanguage(movie))?.tag, 'pt-BR');
  assert.match((await instance.prepare({ ...movie, language: ptBR }))?.toString() ?? '', /Olá/);
  assert.equal(translator.calls.length, 0);
});

test('forced translation keeps its own cache entry, apart from the last-resort one', async () => {
  const translator = fakeTranslator();
  const { instance } = translatingService({ 'en-other': dialogue('Hello', { offsetMs: -6_000 }) }, [otherEn], translator, readyEmbedded(dialogue('Bonjour')), { forceFrom: [en] });
  await instance.prepare({ ...movie, language: ptBR });
  instance.release();
  await instance.prepare({ ...movie, language: ptBR });
  assert.equal(translator.calls.length, 1, 'the second request came from the cache');
});

// --- translation pending (the "preparing" entry in the subtitle menu) ---

test('a translation is pending until it has been made', async () => {
  const { instance } = translatingService({ 'en-exact': dialogue('Hello') }, [exactEnApi], fakeTranslator());
  assert.equal(await instance.translationPending(movie), true);
  await instance.prepare({ ...movie, language: ptBR });
  assert.equal(await instance.translationPending(movie), false);
});

test('nothing is pending when the wanted language exists, or when there is no translator', async () => {
  const withPt = translatingService({ 'pt-1': dialogue('Olá') }, [ptExisting, exactEnApi], fakeTranslator());
  assert.equal(await withPt.instance.translationPending(movie), false);
  const api = fakeProvider('api', [exactEnApi]);
  assert.equal(await service([api.provider], { references: [en] }).instance.translationPending(movie), false);
});

test('a forced translation is pending even though the wanted language exists', async () => {
  const { instance } = translatingService(
    { 'pt-1': dialogue('Olá'), 'en-other': dialogue('Hello', { offsetMs: -6_000 }) },
    [ptExisting, otherEn],
    fakeTranslator(),
    readyEmbedded(dialogue('Bonjour')),
    { forceFrom: [en] },
  );
  assert.equal(await instance.translationPending(movie), true);
  await instance.prepare({ ...movie, language: ptBR });
  assert.equal(await instance.translationPending(movie), false);
});

// --- movies with nothing to check the timing against: translated anyway, saying so ---

const webEn: SubtitleCandidate = { providerId: 'api', ref: 'en-web', language: en, releaseName: 'A.Movie.2026.1080p.AMZN.WEB-DL.DDP5.1.H.264', fps: 23.976 };
const webMovie: SubtitlesRequest = { type: 'movie', id: 'tt30825636', imdbId: 'tt30825636', filename: 'A Murder Between Friends 2026 WEB H264-RGB.mp4' };
const webSeries: SubtitlesRequest = { type: 'series', id: 'tt0985699:1:1', imdbId: 'tt0985699', season: 1, episode: 1, filename: 'Show.S01E01.WEB.H264-RGB.mkv' };

test('a movie with no way to check the timing is translated anyway, with a notice that says so', async () => {
  const translator = fakeTranslator();
  const { instance, lines } = translatingService({ 'en-web': dialogue('Hello') }, [webEn], translator);
  const served = (await instance.prepare({ ...webMovie, language: ptBR }))?.toString() ?? '';
  assert.match(served, /PT Hello 0/);
  assert.match(served, /\[Legenda traduzida por IA \(DeepL\) - tempo não confirmado\]/);
  assert.ok(lines.some((l) => l.includes('translation.unconfirmed')));
  assert.match(lines.find((l) => l.includes('subtitles.served')) ?? '', /"status":"translated".*"sourceSync":"unconfirmed"/);
  // It is cached like any translation: nothing is pending afterwards, and replaying spends no quota.
  assert.equal(await instance.translationPending(webMovie), false);
});

test('the same subtitle for an episode is not translated: an episode has ad breaks and other cuts', async () => {
  const translator = fakeTranslator();
  const { instance } = translatingService({ 'en-web': dialogue('Hello') }, [webEn], translator);
  assert.equal(await instance.prepare({ ...webSeries, language: ptBR }), undefined);
  assert.equal(translator.calls.length, 0);
});

test('a movie is only translated unchecked when the frame rate of the subtitle is the video\'s', async () => {
  const other = { ...webEn, fps: 25 };
  const unknown: SubtitleCandidate = { providerId: 'api', ref: 'en-web', language: en, releaseName: webEn.releaseName as string };
  for (const candidate of [other, unknown]) {
    const translator = fakeTranslator();
    const { instance } = translatingService({ 'en-web': dialogue('Hello') }, [candidate], translator);
    assert.equal(await instance.prepare({ ...webMovie, language: ptBR }), undefined);
    assert.equal(translator.calls.length, 0);
  }
});

test('a movie whose candidate the embedded track refused is not translated unchecked', async () => {
  const translator = fakeTranslator();
  const { instance } = translatingService(
    { 'en-web': steppedDialogue('Hello', -11_000, 2_800) },
    [webEn],
    translator,
    readyEmbedded(dialogue('Bonjour')),
  );
  assert.equal(await instance.prepare({ ...webMovie, language: ptBR }), undefined);
  assert.equal(translator.calls.length, 0, 'there was a ruler and it said no');
});

test('unchecked, the English subtitle is preferred over another language', async () => {
  const translator = fakeTranslator();
  const dePair: SubtitleCandidate = { providerId: 'api', ref: 'de-web', language: de, releaseName: 'A.Movie.2026.1080p.WEB', fps: 23.976 };
  const { instance } = translatingService({ 'de-web': dialogue('Hallo'), 'en-web': dialogue('Hello') }, [dePair, webEn], translator);
  assert.match((await instance.prepare({ ...webMovie, language: ptBR }))?.toString() ?? '', /PT Hello 0/);
});

// --- the file already has a subtitle in the user's language: the addon only says so ---

function inspectingService(tracks: { index: number; codec: string; language?: string; title?: string }[], secondary?: Language) {
  const api = fakeProvider('api', [exactEnApi], { 'en-exact': dialogue('Hello') });
  const lines: string[] = [];
  const instance = new SubtitleService({
    providers: [api.provider],
    primary: ptBR,
    secondary,
    references: [en],
    cache: new SubtitleCache(mkdtempSync(join(tmpdir(), 'rightsubs-cache-'))),
    logger: createLogger('debug', (line) => lines.push(line)),
    budgetMs: 5000,
    beginJob: () => () => {},
    sync: { enabled: true, minConfidence: 0.7 },
    inspect: async () => ({ fps: 23.976, durationMs: 3_600_000, subtitleTracks: tracks }),
  });
  return { instance, lines, api };
}

test('a file with a subtitle track in the primary language is reported, whatever its codec', async () => {
  for (const codec of ['subrip', 'hdmv_pgs_subtitle', 'unknown']) {
    const { instance, lines } = inspectingService([{ index: 6, codec, language: 'por' }]);
    assert.equal((await instance.embeddedLanguage(movie))?.tag, 'pt-BR', codec);
    assert.ok(lines.some((l) => l.includes('subtitles.embedded_language')));
  }
});

test('the secondary language counts too, after the primary', async () => {
  const ptPT = findLanguage('pt-PT') as Language;
  const { instance } = inspectingService([{ index: 3, codec: 'subrip', language: 'spa' }, { index: 4, codec: 'subrip', language: 'por' }], ptPT);
  assert.equal((await instance.embeddedLanguage(movie))?.tag, 'pt-BR', '"por" is the primary first');
  const onlySecondary = inspectingService([{ index: 4, codec: 'subrip', language: 'spa' }], findLanguage('es') as Language);
  assert.equal((await onlySecondary.instance.embeddedLanguage(movie))?.tag, 'es');
});

test('no track in the wanted languages, a forced track only, or no probe: nothing is reported', async () => {
  assert.equal(await inspectingService([{ index: 5, codec: 'subrip', language: 'eng' }]).instance.embeddedLanguage(movie), undefined);
  assert.equal(await inspectingService([{ index: 3, codec: 'subrip', language: 'por', title: 'Portuguese [Forced]' }]).instance.embeddedLanguage(movie), undefined);
  assert.equal(await service([fakeProvider('api', []).provider]).instance.embeddedLanguage(movie), undefined, 'cannot probe');
});

test('looking for the file\'s own track searches and downloads nothing', async () => {
  const { instance, api } = inspectingService([{ index: 6, codec: 'subrip', language: 'por' }]);
  await instance.embeddedLanguage(movie);
  assert.equal(api.searches.length, 0);
  assert.equal(api.downloads.length, 0);
});
