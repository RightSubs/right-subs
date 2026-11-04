import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findLanguage, type Language } from '../src/languages/languages.ts';
import { createLogger } from '../src/logger.ts';
import { pickLanguageTrack, pickTextTrack } from '../src/media/embedded.ts';
import { Limiter } from '../src/resources/limiter.ts';
import { SubtitleCache } from '../src/subtitles/cache.ts';
import { parseSrt, serializeSrt, type Cue } from '../src/subtitles/srt.ts';
import { EmbeddedReferences, windowTimeoutMs } from '../src/sync/embedded-reference.ts';
import { nearReference, pickWindows } from '../src/sync/windows.ts';

const cue = (startMs: number, text = 'x'): Cue => ({ startMs, endMs: startMs + 1500, text });

test('picks the embedded text track best suited as a reference', () => {
  // Halloween (1978) QTZ: forced and full French SRT, full English SRT, PGS images.
  const halloween = [
    { index: 3, codec: 'subrip', language: 'fre', title: 'FR Forced : SRT' },
    { index: 4, codec: 'subrip', language: 'fre', title: 'FR Full : SRT' },
    { index: 5, codec: 'subrip', language: 'eng', title: 'ENG Full : SRT' },
    { index: 6, codec: 'hdmv_pgs_subtitle', language: 'fre' },
  ];
  assert.equal(pickTextTrack(halloween)?.index, 4);
  // Anime: "Signs & Songs" only covers on-screen text.
  assert.equal(pickTextTrack([{ index: 4, codec: 'ass', title: 'Signs & Songs' }, { index: 3, codec: 'ass', title: 'English Subs' }])?.index, 3);
  assert.equal(pickTextTrack([{ index: 2, codec: 'hdmv_pgs_subtitle' }]), undefined);
});

test('prefers a full track in a reference language, any other otherwise', () => {
  const halloween = [
    { index: 3, codec: 'subrip', language: 'fre', title: 'FR Forced : SRT' },
    { index: 4, codec: 'subrip', language: 'fre', title: 'FR Full : SRT' },
    { index: 5, codec: 'subrip', language: 'eng', title: 'ENG Full : SRT' },
  ];
  const en = findLanguage('en') as Language;
  const ptBR = findLanguage('pt-BR') as Language;
  assert.equal(pickTextTrack(halloween, [en])?.index, 5);
  assert.equal(pickTextTrack(halloween, [ptBR])?.index, 4, 'no Portuguese track: the first full one');
  // Containers tag both Portuguese variants "por"; a forced track is never preferred.
  const tedLasso = [
    { index: 3, codec: 'subrip', language: 'por', title: 'Portuguese (Brazil) [Forced]' },
    { index: 4, codec: 'subrip', language: 'por', title: 'Portuguese (Brazil)' },
    { index: 6, codec: 'subrip', language: 'eng', title: 'English' },
  ];
  assert.equal(pickTextTrack(tedLasso, [ptBR, en])?.index, 4);
  assert.equal(pickTextTrack(tedLasso, [en])?.index, 6);
  assert.equal(pickTextTrack([{ index: 2, codec: 'subrip', language: 'fra' }], [findLanguage('fr') as Language])?.index, 2, 'ISO 639-2/T too');
});

test('reads windows where there is dialogue, one per slice of the movie', () => {
  // 100 min movie; dialogue bursts at 20, 52 and 85 min.
  const cues = [20, 52, 85].flatMap((minute) => Array.from({ length: 15 }, (_, i) => cue(minute * 60_000 + i * 3000)));
  const windows = pickWindows(cues, 100 * 60_000, 3, 60);
  assert.deepEqual(windows.map((w) => Math.round(w.startSeconds / 60)), [20, 52, 85]);
  assert.ok(windows.every((w) => w.seconds === 60));
});

test('compares only the subtitle part near the windows', () => {
  const subtitle = [cue(10_000), cue(1_000_000), cue(5_000_000)];
  assert.deepEqual(nearReference(subtitle, [cue(1_050_000)], 120_000), [cue(1_000_000)]);
});

function setup(extract: (url: string, index: number, windows: { startSeconds: number; seconds: number }[]) => Promise<string>) {
  const calls: { url: string; index: number; windows: number[]; timeoutMs: number }[] = [];
  const jobs = { open: 0 };
  const references = new EmbeddedReferences({
    locate: async ({ filename }) => (filename === 'Halloween.mkv' ? { url: 'https://rd/halloween', source: 'torrentio' } : undefined),
    cache: new SubtitleCache(mkdtempSync(join(tmpdir(), 'rightsubs-cache-'))),
    limiter: new Limiter(1),
    logger: createLogger('error'),
    beginJob: () => {
      jobs.open += 1;
      return () => void (jobs.open -= 1);
    },
    windows: 3,
    windowSeconds: 60,
    timeoutMs: 1000,
    extract: async (url, index, windows, { timeoutMs }) => {
      calls.push({ url, index, windows: windows.map((w) => w.startSeconds), timeoutMs });
      return extract(url, index, windows);
    },
  });
  return { references, calls, jobs };
}
const video = { fps: 23.976, durationMs: 90 * 60_000, subtitleTracks: [{ index: 5, codec: 'subrip', language: 'eng', title: 'ENG Full : SRT' }] };
const subtitle = Array.from({ length: 60 }, (_, i) => cue(i * 90_000));
const EXTRACTED = serializeSrt(Array.from({ length: 25 }, (_, i) => cue(600_000 + i * 4000, `line ${i}`)));

test('extracts once in the background, then serves the cues from the cache', async () => {
  const { references, calls, jobs } = setup(async () => EXTRACTED);
  const first = await references.lookup('Halloween.mkv', 4574627960, video, subtitle);
  assert.equal(first.state, 'pending');
  const again = await references.lookup('Halloween.mkv', 4574627960, video, subtitle);
  assert.equal(again.state, 'pending', 'no second extraction while one runs');
  if (first.state === 'pending') await first.done;

  const ready = await references.lookup('Halloween.mkv', 4574627960, video, subtitle);
  assert.equal(ready.state, 'ready');
  if (ready.state === 'ready') {
    assert.equal(ready.cues.length, 25);
    assert.equal(ready.track.index, 5);
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.index, 5);
  assert.equal(calls[0]?.windows.length, 3);
  assert.equal(jobs.open, 0, 'the job is released');
});

test('a file without a text track, unknown to the proxy, or with nothing extracted is unavailable', async () => {
  const empty = setup(async () => '');
  assert.equal((await empty.references.lookup('Halloween.mkv', 1, { ...video, subtitleTracks: [] }, subtitle)).state, 'unavailable');
  assert.equal((await empty.references.lookup('Other.mkv', 1, video, subtitle)).state, 'unavailable');
  const pending = await empty.references.lookup('Halloween.mkv', 1, video, subtitle);
  if (pending.state === 'pending') await pending.done;
  assert.equal((await empty.references.lookup('Halloween.mkv', 1, video, subtitle)).state, 'unavailable', 'tried once: not read again');
  assert.equal(empty.calls.length, 1);
});

test('a torrent being played is never read for the embedded reference', async () => {
  const calls: string[] = [];
  const references = new EmbeddedReferences({
    locate: async () => ({ url: 'http://127.0.0.1:11470/h/0', source: 'stremio', peerToPeer: true }),
    cache: new SubtitleCache(mkdtempSync(join(tmpdir(), 'rightsubs-cache-'))),
    limiter: new Limiter(1),
    logger: createLogger('error'),
    beginJob: () => () => {},
    windows: 3,
    windowSeconds: 45,
    timeoutMs: 1000,
    extract: async (url) => {
      calls.push(url);
      return EXTRACTED;
    },
  });
  assert.equal((await references.lookup('Ted.Lasso.mkv', 1, video, subtitle)).state, 'unavailable');
  assert.deepEqual(calls, []);
});

test('a failed extraction is retried on a later lookup', async () => {
  let fail = true;
  const { references, calls } = setup(async () => {
    if (fail) throw new Error('ffmpeg sem resposta');
    return EXTRACTED;
  });
  const first = await references.lookup('Halloween.mkv', 1, video, subtitle);
  if (first.state === 'pending') await first.done;
  fail = false;
  const second = await references.lookup('Halloween.mkv', 1, video, subtitle);
  if (second.state === 'pending') await second.done;
  assert.equal((await references.lookup('Halloween.mkv', 1, video, subtitle)).state, 'ready');
  assert.equal(calls.length, 2);
  assert.equal(parseSrt(EXTRACTED).length, 25);
});

test('heavy files get a longer per-window timeout, light ones keep the base one', () => {
  // Drive (2011) OpenMatte 60 fps: 23.6 GB in 100 min (31 Mbit/s) → 3 windows of 45 s ≈ 530 MB,
  // sharing ~110–150 Mbit/s from Real-Debrid: failed at 15 s and at 35 s per window.
  assert.equal(windowTimeoutMs(15_000, 45, 3, 23_576_705_373, 6_018_112), 84_621);
  // Halloween (1978) QTZ, 4.6 GB in 91 min: 3 × 45 s ≈ 113 MB → a little over the base.
  assert.equal(windowTimeoutMs(15_000, 45, 3, 4_574_627_960, 91 * 60_000), 18_097);
  // A light 1080p WEB episode (1.5 GB in 45 min) keeps the base.
  assert.equal(windowTimeoutMs(15_000, 45, 3, 1_500_000_000, 45 * 60_000), 15_000);
  // A huge remux stops at two minutes; unknown size keeps the base.
  assert.equal(windowTimeoutMs(15_000, 45, 3, 80_000_000_000, 6_000_000), 120_000);
  assert.equal(windowTimeoutMs(15_000, 45, 3, undefined, 6_000_000), 15_000);
  // The extra windows of the translation path assume half the rate, as the player shares the server.
  // Generation Z S01E01: 3.2 GB in 47 min, 6 windows: 48.7 s at 50 Mbit/s, 97.5 s at 25.
  assert.equal(windowTimeoutMs(15_000, 45, 6, 3_176_536_696, 2_815_744), 48_735);
  assert.equal(windowTimeoutMs(15_000, 45, 6, 3_176_536_696, 2_815_744, 25e6), 97_471);
});

test('the extraction uses the timeout for the file being read', async () => {
  const { references, calls } = setup(async () => EXTRACTED);
  const heavy = await references.lookup('Halloween.mkv', 30_000_000_000, video, subtitle);
  if (heavy.state === 'pending') await heavy.done;
  assert.equal(calls[0]?.timeoutMs, windowTimeoutMs(1000, 60, 3, 30_000_000_000, video.durationMs));
  assert.ok((calls[0]?.timeoutMs ?? 0) > 1000);
});

test('a subtitle track in the wanted language is found whatever its codec, never a forced one or another language', () => {
  const ptBR = findLanguage('pt-BR') as Language;
  const tracks = [
    { index: 3, codec: 'subrip', language: 'por', title: 'Portuguese (Brazil) [Forced]' },
    { index: 4, codec: 'hdmv_pgs_subtitle', language: 'por', title: 'Portuguese' },
    { index: 6, codec: 'subrip', language: 'eng', title: 'English' },
  ];
  assert.equal(pickLanguageTrack(tracks, [ptBR])?.index, 4, 'image tracks count: the player draws them');
  assert.equal(pickLanguageTrack([tracks[0]!, tracks[2]!], [ptBR]), undefined, 'forced only, or another language: none');
});
