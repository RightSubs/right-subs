import type { Language } from '../languages/languages.ts';
import { serializeSrt, type Cue } from '../subtitles/srt.ts';
import { trackPath } from './track.ts';
import type { SubtitlesRequest } from './request.ts';

/**
 * A second, informative entry in Stremio's subtitle list while a translated subtitle is
 * still being prepared (the first time an episode needs the DeepL, the .srt takes longer
 * than the 10 s Stremio waits, and all it shows is "10000 ms sem responder").
 *
 * Stremio has no way for an addon to show a message, so this is a subtitle track whose
 * name says what is going on and whose text says it again on screen. Its content is
 * decided when it is requested, so it never says "preparing" about a subtitle that is ready.
 */

/** The status track lives next to the real one: `/status/…` instead of `/sub/…`. */
export function statusPath(request: SubtitlesRequest, language: Language): string {
  return trackPath(request, language).replace(/^\/sub\//, '/status/');
}

const portuguese = (language: Language) => language.tag.startsWith('pt-');

/** What Stremio lists the entry as (it shows the `lang` field as the track's name). */
export function statusLabel(language: Language): string {
  return portuguese(language) ? 'RightSubs: legenda em preparo, aguarde 30 s' : 'RightSubs: preparing subtitle, wait 30 s';
}

function statusText(language: Language, pending: boolean): string {
  if (portuguese(language)) {
    return pending
      ? '[RightSubs] Preparando a legenda traduzida (primeira vez deste vídeo).\nAguarde cerca de 30 s. Se ela não aparecer, saia e abra o vídeo de novo.'
      : '[RightSubs] A legenda traduzida já está pronta.\nEscolha-a no menu de legendas ou saia e abra o vídeo de novo.';
  }
  return pending
    ? '[RightSubs] Preparing the translated subtitle (first time for this video).\nWait about 30 s. If it does not show up, leave and open the video again.'
    : '[RightSubs] The translated subtitle is ready.\nPick it in the subtitle menu or leave and open the video again.';
}

/**
 * What the real track answers when the translation is not ready in time: Stremio gives up
 * on the request after 10 s and, on some clients, does not even open the video (box, Android
 * TV, 2026-11-03). The video opens with this message instead, and the translation goes on
 * in the background: opening the video again a little later gets it from the cache.
 */
export function placeholderSrt(language: Language): Buffer {
  const text = portuguese(language)
    ? '[RightSubs] Preparando a legenda traduzida (primeira vez deste vídeo).\nSaia do vídeo e abra de novo em cerca de 30 s.'
    : '[RightSubs] Preparing the translated subtitle (first time for this video).\nLeave the video and open it again in about 30 s.';
  return repeated(text);
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
  return portuguese(language)
    ? 'RightSubs: o vídeo já tem legenda embutida no seu idioma, escolha-a no menu'
    : 'RightSubs: the video already has an embedded subtitle in your language, pick it in the menu';
}

/** What the notice entry shows if it is picked: for a few seconds, then it gets out of the way. */
export function embeddedNoticeSrt(language: Language): Buffer {
  const text = portuguese(language)
    ? '[RightSubs] Este vídeo contém a legenda embutida no seu idioma.\nEscolha-a no menu de legendas (a do próprio vídeo).'
    : '[RightSubs] This video contains an embedded subtitle in your language.\nPick it in the subtitle menu (the one from the video itself).';
  return Buffer.from(serializeSrt([{ startMs: 500, endMs: 20_000, text }]), 'utf8');
}
