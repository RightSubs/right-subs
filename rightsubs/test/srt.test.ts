import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSrt, retime, serializeSrt } from '../src/subtitles/srt.ts';
import { align } from '../src/sync/align.ts';
import { loadTimings } from './helpers.ts';

/** Drive (2011) OpenMatte 60 fps: embedded English windows vs. the BluRay pt-BR subtitle, ~13 s late. */
const drive = loadTimings('drive-2011-timings.json');

const SAMPLE = '1\n00:00:01,000 --> 00:00:02,500\nOlá\nmundo\n\n2\n00:01:00.5 --> 00:01:02,000\nTchau\n\nlixo sem tempo\n\n3\n00:00:05,000 --> 00:00:04,000\ninválida\n';

test('parses cues, skipping malformed ones', () => {
  assert.deepEqual(parseSrt(SAMPLE), [
    { startMs: 1000, endMs: 2500, text: 'Olá\nmundo' },
    { startMs: 60500, endMs: 62000, text: 'Tchau' },
  ]);
});

test('serializes with CRLF and renumbers', () => {
  assert.equal(
    serializeSrt(parseSrt(SAMPLE)),
    '1\r\n00:00:01,000 --> 00:00:02,500\r\nOlá\r\nmundo\r\n\r\n2\r\n00:01:00,500 --> 00:01:02,000\r\nTchau\r\n\r\n',
  );
});

test('retimes and drops cues pushed before the start', () => {
  const cues = parseSrt(SAMPLE);
  assert.deepEqual(retime(cues, 1, -2000).map((c) => [c.startMs, c.endMs]), [
    [0, 500],
    [58500, 60000],
  ]);
  assert.deepEqual(retime(cues, 1, -3000).map((c) => c.startMs), [57500]);
  assert.deepEqual(retime(cues, 2, 0).map((c) => c.startMs), [2000, 121000]);
});

test('alignment needs enough cues', () => {
  assert.equal(align(parseSrt(SAMPLE), parseSrt(SAMPLE)), undefined);
});

test('in dense dialogue, lines starting together expose an offset that speech overlap barely shows', () => {
  const result = align(drive.reference, drive.subtitle);
  assert.ok(result);
  assert.ok(Math.abs(result.offsetMs + 12_820) <= 100, `offset ${result.offsetMs}`);
  assert.ok(result.confidence - result.baseline < 0.1, 'speech overlap alone would call it synced');
  assert.ok(result.starts - result.startsBaseline >= 0.4, `starts ${result.startsBaseline} → ${result.starts}`);
});
