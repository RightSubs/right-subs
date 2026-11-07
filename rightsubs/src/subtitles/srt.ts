export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

const TIMING = /^\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

/** Parses SRT text (as produced by decodeSubtitle: `\n` line breaks). Malformed blocks are skipped. */
export function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex === -1) continue;
    const m = TIMING.exec(lines[timingIndex] as string) as RegExpExecArray;
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);
    const body = lines.slice(timingIndex + 1).join('\n').trim();
    if (endMs > startMs && body) cues.push({ startMs, endMs, text: body });
  }
  return cues.sort((a, b) => a.startMs - b.startMs);
}

/** Serializes to UTF-8-ready SRT with CRLF line breaks, renumbering cues. */
export function serializeSrt(cues: Cue[]): string {
  return cues
    .map((cue, index) => `${index + 1}\r\n${format(cue.startMs)} --> ${format(cue.endMs)}\r\n${cue.text.replace(/\n/g, '\r\n')}\r\n`)
    .join('\r\n')
    .concat('\r\n');
}

/** Applies `t' = t × scale + offsetMs` to every cue; cues pushed before 0 are dropped or trimmed. */
export function retime(cues: Cue[], scale: number, offsetMs: number): Cue[] {
  const out: Cue[] = [];
  for (const cue of cues) {
    const endMs = Math.round(cue.endMs * scale + offsetMs);
    if (endMs <= 0) continue;
    out.push({ ...cue, startMs: Math.max(0, Math.round(cue.startMs * scale + offsetMs)), endMs });
  }
  return out;
}

function toMs(h = '0', m = '0', s = '0', ms = '0'): number {
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms.padEnd(3, '0'));
}

function format(totalMs: number): string {
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const pad = (n: number, size = 2) => String(n).padStart(size, '0');
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)},${pad(ms, 3)}`;
}
