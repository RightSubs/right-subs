import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Cue } from '../src/subtitles/srt.ts';
import { align } from '../src/sync/align.ts';
import { checkConsistency } from '../src/sync/consistency.ts';

/** Irregular dialogue, `count` cues from `from`, in the time axis of the video. */
function speech(count: number, from = 60_000): Cue[] {
  const cues: Cue[] = [];
  let t = from;
  for (let i = 0; i < count; i++) {
    const length = 1200 + ((i * 7919) % 2300);
    cues.push({ startMs: t, endMs: t + length, text: `line ${i}` });
    t += length + 400 + ((i * 104729) % 5000);
  }
  return cues;
}

/** What a subtitle made for another timeline looks like: `t' = (t − offset) / scale`, per cue range. */
const shifted = (cues: Cue[], offsetMs: number, scale = 1, range: [number, number] = [0, cues.length]): Cue[] =>
  cues.map((cue, i) => {
    const inside = i >= range[0] && i < range[1];
    const move = (t: number) => (inside ? Math.round((t - offsetMs) / scale) : t);
    return { ...cue, startMs: move(cue.startMs), endMs: move(cue.endMs) };
  });

const MARGIN = 120_000;
const joint = (reference: Cue[], subtitle: Cue[]) => align(reference, subtitle) as NonNullable<ReturnType<typeof align>>;

test('a subtitle with one offset fits both halves', () => {
  const reference = speech(80);
  const subtitle = shifted(reference, 6_000);
  const result = checkConsistency(reference, subtitle, joint(reference, subtitle), MARGIN);
  assert.equal(result.ok, true);
  assert.ok(result.ok && result.deviationMs < 500);
});

test('a steady frame-rate drift is not steps', () => {
  const reference = speech(80);
  const subtitle = shifted(reference, 2_000, 25 / 23.976);
  const result = checkConsistency(reference, subtitle, joint(reference, subtitle), MARGIN);
  assert.equal(result.ok, true);
});

test('a subtitle with a different offset in each half is refused, however good the joint alignment', () => {
  const reference = speech(80);
  // First half 11 s off, second half 6.5 s the other way: no single correction fits (Generation Z S01E01).
  const subtitle = shifted(shifted(reference, 11_000, 1, [0, 40]), -6_500, 1, [40, 80]);
  const result = checkConsistency(reference, subtitle, joint(reference, subtitle), MARGIN);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === 'steps' && result.deviationMs > 1500);
});

test('too few cues to align each half cannot confirm anything', () => {
  const reference = speech(30);
  const subtitle = shifted(reference, 6_000);
  const result = checkConsistency(reference, subtitle, joint(reference, subtitle), MARGIN);
  assert.deepEqual(result, { ok: false, reason: 'few_cues' });
});
