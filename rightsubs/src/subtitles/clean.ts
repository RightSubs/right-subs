import { parseSrt, serializeSrt, type Cue } from './srt.ts';
import { decodeSubtitle } from './text.ts';

/**
 * Music notes (♪ ♫ ♬ ♩ ♭ ♯ ♮) and the replacement character: TV fonts often lack the glyph and
 * draw a box (seen on the box, 2026-11-04, in the songs at the start of a movie).
 */
const UNREADABLE = /[\u2669-\u266F\uFFFD\u200B-\u200F\u2028\u2029\u202A-\u202E\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE000-\uF8FF]/g;
/**
 * The same music notes after a UTF-8 → Windows-1252 mix-up somewhere upstream (♪ = E2 99 AA
 * read as "â™ª"; Chef's Kiss, English source of the DeepL translation, 2026-11-04).
 */
const MOJIBAKE_NOTES = /â™[©ª«¬]/g;
/** ASS/SSA override blocks left in the text (`{\an8}`, `{\i1}`): the player shows them as is. */
const OVERRIDES = /\{\\[^}]*\}/g;
/** Leading/trailing `#` used as a music mark ("# la la la #"); `#1` or `#hashtag` stay. */
const LEADING_HASH = /^((?:\s|<[^>]*>)*)#+(?=\s|<|$)\s*/;
const TRAILING_HASH = /(?<=\s|>|^)#+((?:\s|<[^>]*>)*)$/;

/** Text of one cue with no unreadable characters or leftover ASS codes; '' when nothing readable is left. */
export function cleanCueText(text: string): string {
  const lines = text
    .replace(MOJIBAKE_NOTES, '')
    .replace(OVERRIDES, '')
    .replace(/\\[Nn]/g, '\n') // ASS line break written out
    .replace(/\\h/g, ' ')
    .replace(UNREADABLE, '')
    .split('\n')
    .map((line) => line.replace(LEADING_HASH, '$1').replace(TRAILING_HASH, '$1').replace(/[ \t]{2,}/g, ' ').trim())
    // A line that only had a music mark (or only empty tags) is gone entirely.
    .filter((line) => line.replace(/<[^>]*>/g, '').trim().length > 0);
  return lines.join('\n');
}

/** Cleans every cue and drops the ones left empty. */
export function cleanCues(cues: Cue[]): Cue[] {
  return cues.flatMap((cue) => {
    const text = cleanCueText(cue.text);
    return text ? [{ ...cue, text }] : [];
  });
}

/** The SRT with unreadable characters removed (a no-op, byte for byte, when there are none). */
export function cleanSrt(srt: Buffer): Buffer {
  const text = decodeSubtitle(srt);
  const cues = parseSrt(text);
  const cleaned = cleanCues(cues);
  const changed = cleaned.length !== cues.length || cleaned.some((cue, i) => cue.text !== cues[i]?.text);
  return changed ? Buffer.from(serializeSrt(cleaned), 'utf8') : srt;
}
