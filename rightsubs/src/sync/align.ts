import type { Cue } from '../subtitles/srt.ts';

/** Frame-rate conversions seen between releases of the same video (23.976 ↔ 24 ↔ 25 fps). */
const SCALES = [1, 25 / 23.976, 23.976 / 25, 24 / 23.976, 23.976 / 24, 25 / 24, 24 / 25];
const BIN_MS = 100;
const REFINE_STEP_MS = 20;
/** Below this many cues the timing pattern is too thin to trust. */
const MIN_CUES = 20;
/** Two cue starts this close count as the same line. */
const START_TOLERANCE_MS = 500;

export interface Alignment {
  /** Apply `t' = t × scale + offsetMs` to the subtitle to match the reference. */
  scale: number;
  offsetMs: number;
  /** Share of speech time that overlaps after the correction (0–1). */
  confidence: number;
  /** Same measure without any correction: how synced the subtitle already was. */
  baseline: number;
  /**
   * Share of reference cues with a subtitle cue starting at the same time, after
   * and before the correction. In dense dialogue almost any offset overlaps
   * speech, but lines only start together at the right one.
   */
  starts: number;
  startsBaseline: number;
}

/**
 * Aligns a subtitle to a reference that is known to match the video (any
 * language: only *when* people speak matters). Every subtitle cue votes for the
 * offsets that would put it on a nearby reference cue; the most voted offset,
 * per frame-rate ratio, is refined and scored by speech-time overlap.
 * Cost is linear in the number of cues: milliseconds even on the box.
 */
export function align(reference: Cue[], subtitle: Cue[], maxOffsetMs = 120_000): Alignment | undefined {
  if (reference.length < MIN_CUES || subtitle.length < MIN_CUES) return undefined;
  const baseline = overlap(reference, subtitle, 1, 0);
  const startsBaseline = startShare(reference, subtitle, 1, 0);

  let best = { scale: 1, offsetMs: 0, confidence: baseline };
  for (const scale of SCALES) {
    const coarse = mostVotedOffset(reference, subtitle, scale, maxOffsetMs);
    let local = { offsetMs: coarse, confidence: overlap(reference, subtitle, scale, coarse) };
    for (let delta = -BIN_MS * 3; delta <= BIN_MS * 3; delta += REFINE_STEP_MS) {
      const confidence = overlap(reference, subtitle, scale, coarse + delta);
      if (confidence > local.confidence) local = { offsetMs: coarse + delta, confidence };
    }
    if (local.confidence > best.confidence) best = { scale, offsetMs: local.offsetMs, confidence: local.confidence };
  }
  return { ...best, baseline, starts: startShare(reference, subtitle, best.scale, best.offsetMs), startsBaseline };
}

function mostVotedOffset(reference: Cue[], subtitle: Cue[], scale: number, maxOffsetMs: number): number {
  const votes = new Map<number, number>();
  let low = 0;
  for (const cue of subtitle) {
    const start = cue.startMs * scale;
    while (low < reference.length && (reference[low] as Cue).startMs < start - maxOffsetMs) low += 1;
    for (let i = low; i < reference.length; i++) {
      const diff = (reference[i] as Cue).startMs - start;
      if (diff > maxOffsetMs) break;
      const bin = Math.round(diff / BIN_MS);
      votes.set(bin, (votes.get(bin) ?? 0) + 1);
    }
  }
  // Smooth over neighbouring bins: cue starts in two languages differ by a few hundred ms.
  let bestBin = 0;
  let bestVotes = -1;
  for (const bin of votes.keys()) {
    let total = 0;
    for (let d = -2; d <= 2; d++) total += votes.get(bin + d) ?? 0;
    if (total > bestVotes || (total === bestVotes && Math.abs(bin) < Math.abs(bestBin))) {
      bestVotes = total;
      bestBin = bin;
    }
  }
  return bestBin * BIN_MS;
}

function startShare(reference: Cue[], subtitle: Cue[], scale: number, offsetMs: number): number {
  let matched = 0;
  let j = 0;
  for (const ref of reference) {
    while (j < subtitle.length && (subtitle[j] as Cue).startMs * scale + offsetMs < ref.startMs - START_TOLERANCE_MS) j += 1;
    const next = subtitle[j];
    if (next && next.startMs * scale + offsetMs <= ref.startMs + START_TOLERANCE_MS) matched += 1;
  }
  return matched / reference.length;
}

/** Overlapping speech time / speech time of the shorter of the two (both cue lists sorted by start). */
function overlap(reference: Cue[], subtitle: Cue[], scale: number, offsetMs: number): number {
  let shared = 0;
  let j = 0;
  for (const cue of subtitle) {
    const start = cue.startMs * scale + offsetMs;
    const end = cue.endMs * scale + offsetMs;
    while (j < reference.length && (reference[j] as Cue).endMs <= start) j += 1;
    for (let k = j; k < reference.length && (reference[k] as Cue).startMs < end; k++) {
      const ref = reference[k] as Cue;
      shared += Math.max(0, Math.min(end, ref.endMs) - Math.max(start, ref.startMs));
    }
  }
  const total = (cues: Cue[], factor: number) => cues.reduce((sum, cue) => sum + (cue.endMs - cue.startMs) * factor, 0);
  return shared / Math.max(1, Math.min(total(reference, 1), total(subtitle, scale)));
}
