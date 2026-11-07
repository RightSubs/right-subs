import { messagesFor } from '../i18n/messages.ts';
import type { Language } from '../languages/languages.ts';
import { serializeSrt, type Cue } from '../subtitles/srt.ts';
import { trackPath } from './track.ts';
import type { SubtitlesRequest } from './request.ts';

/**
 * A second, informative entry in Stremio's subtitle list while a translated subtitle is
 * still being prepared (the first time an episode needs the DeepL, the .srt takes longer
 * than the 10 s Stremio waits, and all it shows is a timeout error).
 *
 * Stremio has no way for an addon to show a message, so this is a subtitle track whose
 * name says what is going on and whose text says it again on screen. Its content is
 * decided when it is requested, so it never says "preparing" about a subtitle that is ready.
 *
 * The texts are in the viewer's primary language (`src/i18n/messages.ts`): the `language`
 * of the functions below is the language to write in, not the language of the subtitle.
 */

/** The status track lives next to the real one: `/status/…` instead of `/sub/…`. */
export function statusPath(request: SubtitlesRequest, language: Language): string {
  return trackPath(request, language).replace(/^\/sub\//, '/status/');
}

/** What Stremio lists the entry as (it shows the `lang` field as the track's name). */
export function statusLabel(language: Language): string {
  return messagesFor(language).statusLabel;
}

function statusText(language: Language, pending: boolean): string {
  const messages = messagesFor(language);
  return pending ? messages.statusPending : messages.statusReady;
}

/**
 * What the real track answers when the translation is not ready in time: Stremio gives up
 * on the request after 10 s and, on some clients, does not even open the video (box, Android
 * TV, 2026-11-03). The video opens with this message instead, and the translation goes on
 * in the background: opening the video again a little later gets it from the cache.
 */
export function placeholderSrt(language: Language): Buffer {
  return repeated(messagesFor(language).placeholder);
}

const REPEAT_EVERY_MS = 30_000;
/** On screen almost all the time (5 s off in every 30): the message is the only thing telling what to do. */
const SHOW_FOR_MS = 25_000;
/** An hour of playback: whenever the entry is picked, the message comes up within 30 s. */
const REPEATS = 120;

/** The text of the status track, repeated so it shows up wherever playback is when it is picked. */
export function statusSrt(language: Language, pending: boolean): Buffer {
  return repeated(statusText(language, pending));
}

function repeated(text: string): Buffer {
  const cues: Cue[] = Array.from({ length: REPEATS }, (_, i) => ({ startMs: 500 + i * REPEAT_EVERY_MS, endMs: 500 + i * REPEAT_EVERY_MS + SHOW_FOR_MS, text }));
  return Buffer.from(serializeSrt(cues), 'utf8');
}

/**
 * The file already has a subtitle track in the user's language: the player lists it by itself
 * (Stremio shows the file's own tracks), so the addon offers nothing to download, only this
 * entry saying so. Its name is the message (the menu shows the `lang` field), and not a
 * language code on purpose, so the player never picks it instead of the file's own track.
 */
export function embeddedLabel(language: Language): string {
  return messagesFor(language).embeddedLabel;
}

/** What the notice entry shows if it is picked: for a few seconds, then it gets out of the way. */
export function embeddedNoticeSrt(language: Language): Buffer {
  const text = messagesFor(language).embeddedNotice;
  return Buffer.from(serializeSrt([{ startMs: 500, endMs: 20_000, text }]), 'utf8');
}
