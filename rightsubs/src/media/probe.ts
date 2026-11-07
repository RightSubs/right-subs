import { spawn } from 'node:child_process';

export interface VideoInfo {
  fps?: number;
  durationMs?: number;
  /** Embedded subtitle tracks (text ones can serve as sync references in phase 4). */
  subtitleTracks: { index: number; codec: string; language?: string; title?: string }[];
}

interface ProbeOutput {
  streams?: {
    index: number;
    codec_type?: string;
    codec_name?: string;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    tags?: { language?: string; title?: string };
  }[];
  format?: { duration?: string };
}

/** Header reads only: enough for stream info, small enough not to compete with playback. */
const PROBE_SIZE = String(2 * 1024 * 1024);

/**
 * Reads stream info from the video URL with ffprobe. Only the container header
 * is fetched over HTTP (nothing is written to disk); the process inherits the
 * service's low CPU priority and is killed on timeout.
 */
export function probeVideo(url: string, timeoutMs: number, command = 'ffprobe'): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      command,
      [
        '-v', 'error',
        '-probesize', PROBE_SIZE,
        '-analyzeduration', '0',
        '-rw_timeout', String(timeoutMs * 1000),
        '-show_entries', 'stream=index,codec_type,codec_name,avg_frame_rate,r_frame_rate:stream_tags=language,title:format=duration',
        '-of', 'json',
        url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-500)));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    timer.unref();
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (signal) return reject(new Error(`ffprobe sem resposta em ${timeoutMs} ms`));
      if (code !== 0) return reject(new Error(`ffprobe saiu com código ${code}: ${stderr.trim().split('\n').at(-1) ?? ''}`));
      try {
        resolve(parseProbe(JSON.parse(stdout) as ProbeOutput));
      } catch (err) {
        reject(err);
      }
    });
  });
}

export function parseProbe(output: ProbeOutput): VideoInfo {
  const info: VideoInfo = { subtitleTracks: [] };
  for (const stream of output.streams ?? []) {
    if (stream.codec_type === 'video' && info.fps === undefined) {
      // The declared rate (r_frame_rate) is exact; the average is estimated from the
      // few frames a header-only probe sees (23.81 for a 23.976 file). Anything that
      // is not a real video frame rate — including cover art "video" streams — is unknown.
      const fps = standardRate(rate(stream.r_frame_rate)) ?? standardRate(rate(stream.avg_frame_rate));
      if (fps) info.fps = fps;
    }
    if (stream.codec_type === 'subtitle') {
      const track: VideoInfo['subtitleTracks'][number] = { index: stream.index, codec: stream.codec_name ?? 'unknown' };
      if (stream.tags?.language) track.language = stream.tags.language;
      if (stream.tags?.title) track.title = stream.tags.title;
      info.subtitleTracks.push(track);
    }
  }
  const duration = Number(output.format?.duration);
  if (Number.isFinite(duration) && duration > 0) info.durationMs = Math.round(duration * 1000);
  return info;
}

/** Frame rates real videos use. */
const STANDARD_RATES = [23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60];

/** Snaps to a standard rate within 0.1%; undefined for anything else. */
export function standardRate(fps: number | undefined): number | undefined {
  if (!fps) return undefined;
  return STANDARD_RATES.find((standard) => Math.abs(fps - standard) / standard < 0.001);
}

/** "24000/1001" → 23.976 */
function rate(value: string | undefined): number | undefined {
  const [num, den] = (value ?? '').split('/').map(Number);
  if (!num || !den) return undefined;
  return Math.round((num / den) * 1000) / 1000;
}
