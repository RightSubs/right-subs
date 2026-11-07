import type { Language } from '../languages/languages.ts';
import type { Cue } from '../subtitles/srt.ts';

/** First showing, right at the start. */
const FIRST_MS = 500;
/**
 * Showings again after this, and then every REPEAT_EVERY_MS: the player may get the
 * subtitle seconds after playback began (the first time costs reading the video and the
 * translation, ~40 s on the box), and the opening would have passed without it.
 */
const SECOND_MS = 60_000;
const REPEAT_EVERY_MS = 15 * 60_000;
const SHOW_FOR_MS = 4000;
/** A flash shorter than this is not readable. */
const MIN_SHOW_MS = 1500;
/** Gap kept from the real lines. */
const GAP_MS = 100;
/** How far past the planned time a free gap is looked for before giving that showing up. */
const SEARCH_MS = 30_000;

/**
 * The notice, in Portuguese for the Portuguese variants and in English otherwise. When the
 * timing of the source subtitle could not be checked against the video, it says so: the
 * viewer must know the subtitle may be early or late.
 */
export function noticeText(target: Language, timingUnconfirmed = false): string {
  const portuguese = target.tag.startsWith('pt-');
  if (timingUnconfirmed) {
    return portuguese ? '[Legenda traduzida por IA (DeepL) - tempo não confirmado]' : '[Subtitles machine-translated by AI (DeepL) - timing not confirmed]';
  }
  return portuguese ? '[Legenda traduzida por IA (DeepL)]' : '[Subtitles machine-translated by AI (DeepL)]';
}

/**
 * Puts lines in a machine-translated subtitle saying so (at the start, again after a
 * minute and every 15 minutes), so nobody takes it for a human translation. Each one goes
 * in a gap between the real lines: cut short to fit, and left out when there is no room.
 */
export function withTranslationNotice(cues: Cue[], target: Language, timingUnconfirmed = false): Cue[] {
  const end = cues[cues.length - 1]?.endMs ?? 0;
  const planned = [FIRST_MS, SECOND_MS];
  for (let at = REPEAT_EVERY_MS; at < end; at += REPEAT_EVERY_MS) planned.push(at);
  const text = noticeText(target, timingUnconfirmed);
  const notices: Cue[] = [];
  for (const from of planned) {
    const slot = freeSlot(cues, from);
    if (slot) notices.push({ ...slot, text });
  }
  return [...cues, ...notices].sort((a, b) => a.startMs - b.startMs);
}

/** The first stretch at or after `from` (within SEARCH_MS) that the real lines leave free for a readable notice. */
function freeSlot(cues: Cue[], from: number): { startMs: number; endMs: number } | undefined {
  let start = from;
  for (const cue of cues) {
    if (cue.endMs + GAP_MS <= start) continue;
    const room = cue.startMs - GAP_MS - start;
    if (room >= MIN_SHOW_MS) return { startMs: start, endMs: start + Math.min(SHOW_FOR_MS, room) };
    start = Math.max(start, cue.endMs + GAP_MS);
    if (start - from > SEARCH_MS) return undefined;
  }
  return { startMs: start, endMs: start + SHOW_FOR_MS };
}
