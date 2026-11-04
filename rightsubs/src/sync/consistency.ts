import { retime, type Cue } from '../subtitles/srt.ts';
import { align, type Alignment } from './align.ts';
import { nearReference } from './windows.ts';

/**
 * How far (ms) the alignment of one half of the windows may sit from the joint one.
 * Measured on Generation Z S01E01 over six window layouts: the German subtitle that fits
 * deviated 0–120 ms, the English one made for another cut 1000 ms at best (and 3.5–13.6 s
 * usually).
 */
export const MAX_HALF_DEVIATION_MS = 750;

/**
 * How far from the joint correction each half is searched. Searching ±2 min, as for the
 * joint alignment, let noise win in a half with few cues (a 28 s "deviation" for the
 * subtitle that fits); a real step between parts of a movie is seconds, not minutes.
 */
const RESIDUAL_RANGE_MS = 15_000;

/**
 * Share of a half's lines that must start together with a subtitle line once corrected.
 * A half whose real correction lies beyond RESIDUAL_RANGE_MS comes back as "nothing to
 * correct", which looks consistent but only matches by chance (0.2–0.35 in dense dialogue);
 * the German subtitle that fits had 0.49–0.62 in every half over ten window layouts.
 */
const MIN_HALF_STARTS = 0.4;

export type Consistency =
  | { ok: true; deviationMs: number }
  /** A half has too few cues to align: the timing cannot be confirmed. */
  | { ok: false; reason: 'few_cues' }
  /** The two halves want different corrections: no single offset and scale fits the whole movie. */
  | { ok: false; reason: 'steps'; deviationMs: number };

/**
 * Whether one offset and scale fit the subtitle all over the movie, not only on average.
 *
 * A subtitle made for another cut of the video (different ad breaks or intro) lines up at
 * one offset in one part of the movie and at another elsewhere (Generation Z S01E01:
 * +11 s, +6.5 s, −2.8 s). The joint alignment of a few windows still looks excellent
 * (it follows the larger cluster: confidence 0.98), so it cannot tell. Applying the joint
 * correction and aligning the first and the second half of the windows separately can:
 * for a subtitle that fits, each half has almost nothing left to correct, while for steps
 * at least one has seconds left. A steady frame-rate drift is fine: the halves may
 * rescale a little, and only the position at their centre counts.
 *
 * `reference` are the cues read from the video (windows in time order).
 */
export function checkConsistency(reference: Cue[], subtitle: Cue[], joint: Alignment, marginMs: number): Consistency {
  const corrected = retime(subtitle, joint.scale, joint.offsetMs);
  const middle = Math.floor(reference.length / 2);
  let worst = 0;
  for (const half of [reference.slice(0, middle), reference.slice(middle)]) {
    const residual = align(half, nearReference(corrected, half, marginMs), RESIDUAL_RANGE_MS);
    if (!residual) return { ok: false, reason: 'few_cues' };
    if (residual.starts < MIN_HALF_STARTS) return { ok: false, reason: 'steps', deviationMs: RESIDUAL_RANGE_MS };
    // Where this half sits, in video time (the corrected subtitle is already in it).
    const centre = (half[Math.floor(half.length / 2)] as Cue).startMs;
    worst = Math.max(worst, Math.abs(centre * residual.scale + residual.offsetMs - centre));
  }
  const deviationMs = Math.round(worst);
  return worst <= MAX_HALF_DEVIATION_MS ? { ok: true, deviationMs } : { ok: false, reason: 'steps', deviationMs };
}
