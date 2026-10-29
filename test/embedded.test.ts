import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLogger } from '../src/logger.ts';
import { pickTextTrack } from '../src/media/embedded.ts';
import { Limiter } from '../src/resources/limiter.ts';
import { SubtitleCache } from '../src/subtitles/cache.ts';
import { parseSrt, serializeSrt, type Cue } from '../src/subtitles/srt.ts';
import { EmbeddedReferences } from '../src/sync/embedded-reference.ts';
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
  const calls: { url: string; index: number; windows: number[] }[] = [];
  const jobs = { open: 0 };
  const references = new EmbeddedReferences({
    find: (filename) => (filename === 'Halloween.mkv' ? { url: 'https://rd/halloween', indexer: 'torrentio' } : undefined),
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
    extract: async (url, index, windows) => {
      calls.push({ url, index, windows: windows.map((w) => w.startSeconds) });
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
