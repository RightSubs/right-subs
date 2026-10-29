import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VideoInspector } from '../src/media/inspector.ts';
import { parseProbe, probeVideo, standardRate } from '../src/media/probe.ts';
import { createLogger } from '../src/logger.ts';
import { Limiter } from '../src/resources/limiter.ts';

test('reads fps, duration and embedded subtitle tracks from ffprobe output', () => {
  const info = parseProbe({
    streams: [
      { index: 0, codec_type: 'video', codec_name: 'hevc', avg_frame_rate: '24000/1001', r_frame_rate: '24000/1001' },
      { index: 1, codec_type: 'audio', codec_name: 'eac3', tags: { language: 'eng' } },
      { index: 2, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'ita' } },
      { index: 3, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', tags: { language: 'eng', title: 'SDH' } },
      { index: 4, codec_type: 'video', codec_name: 'mjpeg', avg_frame_rate: '0/0', r_frame_rate: '90000/1' },
    ],
    format: { duration: '6678.123' },
  });
  assert.deepEqual(info, {
    fps: 23.976,
    durationMs: 6678123,
    subtitleTracks: [
      { index: 2, codec: 'subrip', language: 'ita' },
      { index: 3, codec: 'hdmv_pgs_subtitle', language: 'eng', title: 'SDH' },
    ],
  });
  assert.equal(parseProbe({ streams: [{ index: 0, codec_type: 'video', avg_frame_rate: '0/0', r_frame_rate: '90000/1' }] }).fps, undefined);
});

test('reports a missing ffprobe as an error', async () => {
  await assert.rejects(probeVideo('http://127.0.0.1:1/x.mkv', 1000, 'ffprobe-that-does-not-exist'));
});

test('probes each file once and only files listed by the proxy', async () => {
  const probed: string[] = [];
  const inspector = new VideoInspector({
    find: (filename) => (filename === 'Known.mkv' ? { url: 'https://rd/known', indexer: 'torrentio' } : undefined),
    limiter: new Limiter(1),
    logger: createLogger('error'),
    timeoutMs: 1000,
    probe: async (url) => {
      probed.push(url);
      return { fps: 25, subtitleTracks: [] };
    },
  });
  const [a, b] = await Promise.all([inspector.inspect('Known.mkv'), inspector.inspect('Known.mkv')]);
  assert.equal(a?.fps, 25);
  assert.equal(a, b);
  assert.equal(await inspector.inspect('Unknown.mkv'), undefined);
  assert.equal(await inspector.inspect(undefined), undefined);
  assert.deepEqual(probed, ['https://rd/known']);
});

test('a failed probe resolves to undefined', async () => {
  const inspector = new VideoInspector({
    find: () => ({ url: 'https://rd/x', indexer: 'sootio' }),
    limiter: new Limiter(1),
    logger: createLogger('error'),
    timeoutMs: 1000,
    probe: async () => Promise.reject(new Error('403')),
  });
  assert.equal(await inspector.inspect('X.mkv'), undefined);
});

test('the limiter runs one job at a time', async () => {
  const limiter = new Limiter(1);
  let running = 0;
  let peak = 0;
  const job = () =>
    limiter.run(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
    });
  await Promise.all([job(), job(), job()]);
  assert.equal(peak, 1);
});

test('trusts the declared frame rate over a header-only average, and only real rates', () => {
  // Halloween (1978) QTZ: avg_frame_rate estimated as 23.81 from a 2 MB probe.
  const video = (avg: string, r: string) => parseProbe({ streams: [{ index: 0, codec_type: 'video', avg_frame_rate: avg, r_frame_rate: r }] }).fps;
  assert.equal(video('2381/100', '24000/1001'), 23.976);
  assert.equal(video('24/1', '2381/100'), 24, 'falls back to the average when the declared rate is odd');
  assert.equal(video('2381/100', '2381/100'), undefined, 'neither is a real frame rate');
  assert.equal(standardRate(23.98), 23.976);
  assert.equal(standardRate(25.0), 25);
  assert.equal(standardRate(23.81), undefined);
  assert.equal(standardRate(0), undefined);
});
