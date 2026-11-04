import { spawn } from 'node:child_process';
import { isTrackLanguage, type Language } from '../languages/languages.ts';

/** Embedded subtitle codecs that are text, i.e. that ffmpeg can turn into SRT (PGS/VobSub are images). */
const TEXT_CODECS = ['subrip', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'];

export interface EmbeddedTrack {
  index: number;
  codec: string;
  language?: string;
  title?: string;
}

/**
 * The embedded text track best suited as a timing reference: full (not forced) text tracks
 * first, in the reference languages when there is one (every track of a file has the same
 * timing, so any other language still works).
 */
export function pickTextTrack(tracks: EmbeddedTrack[], preferred: Language[] = []): EmbeddedTrack | undefined {
  const text = tracks.filter((track) => TEXT_CODECS.includes(track.codec));
  const forced = (track: EmbeddedTrack) => /forc|sign|song/i.test(track.title ?? '');
  const full = text.filter((track) => !forced(track));
  for (const lang of preferred) {
    const match = full.find((track) => isTrackLanguage(lang, track.language));
    if (match) return match;
  }
  return full[0] ?? text[0];
}

/**
 * A full (not forced) subtitle track in one of these languages, tried in order; undefined
 * when the file has none. Any codec counts (text or image: the player draws both), and it
 * never falls back to another language: unlike pickTextTrack this is not a timing ruler,
 * it is the track the user can pick in the player.
 */
export function pickLanguageTrack(tracks: EmbeddedTrack[], languages: Language[]): EmbeddedTrack | undefined {
  const forced = (track: EmbeddedTrack) => /forc|sign|song/i.test(track.title ?? '');
  const full = tracks.filter((track) => !forced(track));
  for (const lang of languages) {
    const match = full.find((track) => isTrackLanguage(lang, track.language));
    if (match) return match;
  }
  return undefined;
}

/**
 * Reads one embedded subtitle track in a few time windows, straight from the
 * video URL: ffmpeg seeks with HTTP range requests, keeps only the subtitle
 * packets and writes SRT text to a pipe. Nothing is written to disk; each
 * process is killed on timeout or abort.
 *
 * The windows are read at the same time: the player is waiting for this track,
 * and in parallel it takes the time of one window (4.6 s vs 12.4 s for three
 * 45 s windows of a 4K file on the box) for the same total CPU — spent at the
 * service's low priority, so Stremio still comes first.
 */
export function extractWindows(
  url: string,
  trackIndex: number,
  windows: { startSeconds: number; seconds: number }[],
  options: { timeoutMs: number; signal?: AbortSignal; command?: string },
): Promise<string> {
  return Promise.all(windows.map((window) => extractOne(url, trackIndex, window, options))).then((parts) => parts.join('\n'));
}

function extractOne(
  url: string,
  trackIndex: number,
  { startSeconds, seconds }: { startSeconds: number; seconds: number },
  { timeoutMs, signal, command = 'ffmpeg' }: { timeoutMs: number; signal?: AbortSignal; command?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('cancelado'));
    const child = spawn(
      command,
      [
        '-v', 'error',
        '-threads', '1',
        // No -readrate: after a seek it throttles far below the asked rate (24× took
        // 21 s for 60 s of video on the box, unthrottled 5 s). The track is awaited.
        // Keep the movie's own timestamps, so cues come out at their real times.
        '-copyts',
        '-ss', String(startSeconds),
        '-i', url,
        '-to', String(startSeconds + seconds),
        '-map', `0:${trackIndex}`,
        '-c:s', 'srt',
        '-f', 'srt',
        '-',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-500)));
    const kill = () => child.kill('SIGKILL');
    const timer = setTimeout(kill, timeoutMs);
    timer.unref();
    signal?.addEventListener('abort', kill, { once: true });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, killed) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      if (killed) return reject(new Error(signal?.aborted ? 'cancelado' : `ffmpeg sem resposta em ${timeoutMs} ms`));
      if (code !== 0) return reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.trim().split('\n').at(-1) ?? ''}`));
      resolve(stdout);
    });
  });
}
