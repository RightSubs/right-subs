// Node builds without full ICU only know latin1, which differs from windows-1252
// just in 0x80–0x9F (curly quotes, ellipsis): an acceptable fallback.
const windows1252 = (() => {
  try {
    return new TextDecoder('windows-1252');
  } catch {
    return new TextDecoder('latin1');
  }
})();

/**
 * Decodes a downloaded subtitle into text. Old subtitles are often Windows-1252
 * (accents become "Ã©" or "�" when read as UTF-8), some come as UTF-16 with BOM.
 */
export function decodeSubtitle(buffer: Buffer): string {
  let text: string;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) text = new TextDecoder('utf-16le').decode(buffer);
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) text = new TextDecoder('utf-16be').decode(buffer);
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      // Not valid UTF-8: windows-1252 is the usual encoding of Western subtitles
      // and decodes any byte sequence.
      text = windows1252.decode(buffer);
    }
  }
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

const SRT_TIMING = /^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/m;

/** True when the text has at least one SRT cue timing line. */
export function looksLikeSrt(text: string): boolean {
  return SRT_TIMING.test(text);
}

/** Normalizes to what every player accepts: UTF-8, CRLF line breaks, `,` before milliseconds, trailing blank line. */
export function toSrt(text: string): string {
  const body = text
    .replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2')
    .trim();
  return `${body.replace(/\n/g, '\r\n')}\r\n\r\n`;
}
