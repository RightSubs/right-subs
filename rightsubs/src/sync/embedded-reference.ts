import type { Language } from '../languages/languages.ts';
import type { Logger } from '../logger.ts';
import { extractWindows, pickTextTrack, type EmbeddedTrack } from '../media/embedded.ts';
import type { VideoInfo } from '../media/probe.ts';
import type { Limiter } from '../resources/limiter.ts';
import type { FileQuery, PlayableFile } from '../streams/locator.ts';
import type { SubtitleCache } from '../subtitles/cache.ts';
import { parseSrt, serializeSrt, type Cue } from '../subtitles/srt.ts';
import { decodeSubtitle } from '../subtitles/text.ts';
import { pickWindows } from './windows.ts';

/**
 * The windows of a heavy file do not fit the base timeout (Drive 2011 OpenMatte:
 * 23.6 GB, 31 Mbit/s → ~175 MB per 45 s window). The windows are read at once but
 * share the Real-Debrid bandwidth (~110–150 Mbit/s measured, not more in parallel),
 * so each one gets the time to read all of them at this total rate. Shorter windows
 * do not help: with fewer than ~44 cues the alignment picks a wrong offset.
 */
const MIN_TOTAL_BITS_PER_SECOND = 50e6;
const MAX_WINDOW_TIMEOUT_MS = 120_000;

/** Per-window timeout: the base one, or longer when the file's bitrate needs it. */
export function windowTimeoutMs(
  baseMs: number,
  windowSeconds: number,
  windows: number,
  videoSize: number | undefined,
  durationMs: number,
  minBitsPerSecond = MIN_TOTAL_BITS_PER_SECOND,
): number {
  if (!videoSize || durationMs <= 0) return baseMs;
  const totalBits = ((videoSize * 8) / (durationMs / 1000)) * windowSeconds * windows;
  return Math.round(Math.min(MAX_WINDOW_TIMEOUT_MS, Math.max(baseMs, (totalBits / minBitsPerSecond) * 1000)));
}

/**
 * Rate assumed for the extra windows the translation path asks for. They are read right
 * when playback starts, so the player is buffering the same file from the same server:
 * the first read of Generation Z on the box (6 windows, 48.7 s allowed at 50 Mbit/s)
 * timed out while the next one, a few seconds later, took 20 s.
 */
const TRANSLATION_BITS_PER_SECOND = 25e6;

export interface EmbeddedOptions {
  locate: (query: FileQuery) => Promise<PlayableFile | undefined>;
  cache: SubtitleCache;
  limiter: Limiter;
  logger: Logger;
  /** Keeps the addon awake while extracting. */
  beginJob: () => () => void;
  windows: number;
  windowSeconds: number;
  /** Per window, for light files; heavy ones get more (see windowTimeoutMs). */
  timeoutMs: number;
  /** Reference languages: their tracks are read first (`sync.referenceLanguages`). */
  preferredLanguages?: Language[];
  extract?: typeof extractWindows;
}

export type EmbeddedLookup =
  | { state: 'ready'; cues: Cue[]; track: EmbeddedTrack }
  /** `done` settles when the extraction finishes (successfully or not). */
  | { state: 'pending'; done: Promise<void> }
  | { state: 'unavailable' };

/**
 * Timing reference read from a text subtitle track embedded in the video
 * itself (made for this exact file). Reading it means fetching a few minutes of
 * the video: the first lookup starts the extraction and answers "pending" with
 * a promise the caller may wait on (within its time budget). Once done, the
 * cues are cached on disk (a few KB), so later lookups are instant.
 */
export class EmbeddedReferences {
  #options: EmbeddedOptions;
  #running = new Map<string, Promise<void>>();

  constructor(options: EmbeddedOptions) {
    this.#options = options;
  }

  /**
   * `options.windows` asks for more windows than configured (never fewer): the translation
   * path needs enough cues to check the timing in two halves. They are cached apart.
   */
  async lookup(
    filename: string | undefined,
    videoSize: number | undefined,
    video: VideoInfo | undefined,
    subtitle: Cue[],
    options: { windows?: number } = {},
  ): Promise<EmbeddedLookup> {
    const track = video && pickTextTrack(video.subtitleTracks, this.#options.preferredLanguages);
    if (!filename || !track || !video?.durationMs) return { state: 'unavailable' };

    const windows = Math.max(this.#options.windows, options.windows ?? 0);
    const key = `embedded:${filename.toLowerCase()}|${videoSize ?? ''}|${track.index}${windows === this.#options.windows ? '' : `|w${windows}`}`;
    const cached = await this.#options.cache.get(key);
    if (cached) {
      const cues = parseSrt(decodeSubtitle(cached));
      return cues.length > 0 ? { state: 'ready', cues, track } : { state: 'unavailable' };
    }
    const running = this.#running.get(key);
    if (running) return { state: 'pending', done: running };
    const query: FileQuery = { filename };
    if (videoSize !== undefined) query.videoSize = videoSize;
    const file = await this.#options.locate(query);
    // A torrent would fetch the windows ahead of the player, slower than the video itself.
    if (!file || file.peerToPeer) return { state: 'unavailable' };

    const job = this.#extract(key, file, filename, track, video.durationMs, file.videoSize ?? videoSize, subtitle, windows).finally(() => this.#running.delete(key));
    this.#running.set(key, job);
    return { state: 'pending', done: job };
  }

  /** Resolves when every running extraction is done (tests). */
  async settled(): Promise<void> {
    await Promise.all(this.#running.values());
  }

  async #extract(
    key: string,
    file: PlayableFile,
    filename: string,
    track: EmbeddedTrack,
    durationMs: number,
    videoSize: number | undefined,
    subtitle: Cue[],
    windows: number,
  ): Promise<void> {
    const { cache, limiter, logger, beginJob, windowSeconds, timeoutMs, extract = extractWindows } = this.#options;
    const endJob = beginJob();
    const started = Date.now();
    const chosen = pickWindows(subtitle, durationMs, windows, windowSeconds);
    const extra = windows > this.#options.windows;
    const windowTimeout = windowTimeoutMs(timeoutMs, windowSeconds, chosen.length, videoSize, durationMs, extra ? TRANSLATION_BITS_PER_SECOND : undefined);
    try {
      const text = await limiter.run(() => extract(file.url, track.index, chosen, { timeoutMs: windowTimeout }));
      const cues = parseSrt(decodeSubtitle(Buffer.from(text, 'utf8')));
      // Stored even when empty: an empty entry means "tried, nothing usable", so it is not read again.
      await cache.put(key, Buffer.from(cues.length > 0 ? serializeSrt(cues) : '', 'utf8'));
      logger.info('embedded.extracted', {
        filename,
        track: { index: track.index, codec: track.codec, language: track.language ?? null },
        windows: chosen.map((w) => w.startSeconds),
        windowSeconds,
        cues: cues.length,
        timeoutMs: windowTimeout,
        ms: Date.now() - started,
      });
    } catch (err) {
      // Which windows: one with little dialogue reads far past its end (ffmpeg stops at the next cue).
      logger.warn('embedded.failed', {
        filename,
        message: (err as Error).message,
        windows: chosen.map((w) => w.startSeconds),
        windowSeconds,
        timeoutMs: windowTimeout,
        ms: Date.now() - started,
      });
    } finally {
      endJob();
    }
  }
}
