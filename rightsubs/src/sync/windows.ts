import type { Cue } from '../subtitles/srt.ts';

const STEP_MS = 10_000;
/** Openings and credits rarely have dialogue: skip the first and last 5%. */
const EDGE = 0.05;

/**
 * Picks `count` windows of `seconds` where the subtitle has the most dialogue,
 * one per equal slice of the movie, so the reference read from the video
 * (which costs ~1 MB/s of a 4K file) yields as many cues as possible and still
 * covers the whole runtime (needed to see frame-rate drift).
 */
export function pickWindows(cues: Cue[], durationMs: number, count: number, seconds: number): { startSeconds: number; seconds: number }[] {
  const windowMs = seconds * 1000;
  const from = durationMs * EDGE;
  const slice = (durationMs * (1 - 2 * EDGE)) / count;
  const windows: { startSeconds: number; seconds: number }[] = [];
  for (let i = 0; i < count; i++) {
    const sliceStart = from + i * slice;
    let best = { start: sliceStart, cues: -1 };
    for (let start = sliceStart; start + windowMs <= sliceStart + slice; start += STEP_MS) {
      const inside = cues.filter((cue) => cue.startMs >= start && cue.startMs < start + windowMs).length;
      if (inside > best.cues) best = { start, cues: inside };
    }
    windows.push({ startSeconds: Math.round(best.start / 1000), seconds });
  }
  return windows;
}

/**
 * The part of a subtitle that can be compared with a reference read in windows:
 * its cues within `marginMs` of the reference's (the subtitle may be off by that much).
 */
export function nearReference(subtitle: Cue[], reference: Cue[], marginMs: number): Cue[] {
  return subtitle.filter((cue) => reference.some((ref) => Math.abs(ref.startMs - cue.startMs) <= marginMs));
}
