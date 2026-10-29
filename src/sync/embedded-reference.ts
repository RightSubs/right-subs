import type { Logger } from '../logger.ts';
import { extractWindows, pickTextTrack, type EmbeddedTrack } from '../media/embedded.ts';
import type { VideoInfo } from '../media/probe.ts';
import type { Limiter } from '../resources/limiter.ts';
import type { PlayableFile } from '../streams/proxy.ts';
import type { SubtitleCache } from '../subtitles/cache.ts';
import { parseSrt, serializeSrt, type Cue } from '../subtitles/srt.ts';
import { decodeSubtitle } from '../subtitles/text.ts';
import { pickWindows } from './windows.ts';

export interface EmbeddedOptions {
  find: (filename: string, videoSize?: number) => PlayableFile | undefined;
  cache: SubtitleCache;
  limiter: Limiter;
  logger: Logger;
  /** Keeps the addon awake while extracting. */
  beginJob: () => () => void;
  windows: number;
  windowSeconds: number;
  /** Per window. */
  timeoutMs: number;
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

  async lookup(filename: string | undefined, videoSize: number | undefined, video: VideoInfo | undefined, subtitle: Cue[]): Promise<EmbeddedLookup> {
    const track = video && pickTextTrack(video.subtitleTracks);
    const file = filename && this.#options.find(filename, videoSize);
    if (!filename || !track || !video?.durationMs) return { state: 'unavailable' };

    const key = `embedded:${filename.toLowerCase()}|${videoSize ?? ''}|${track.index}`;
    const cached = await this.#options.cache.get(key);
    if (cached) {
      const cues = parseSrt(decodeSubtitle(cached));
      return cues.length > 0 ? { state: 'ready', cues, track } : { state: 'unavailable' };
    }
    const running = this.#running.get(key);
    if (running) return { state: 'pending', done: running };
    if (!file) return { state: 'unavailable' };

    const job = this.#extract(key, file, filename, track, video.durationMs, subtitle).finally(() => this.#running.delete(key));
    this.#running.set(key, job);
    return { state: 'pending', done: job };
  }

  /** Resolves when every running extraction is done (tests). */
  async settled(): Promise<void> {
    await Promise.all(this.#running.values());
  }

  async #extract(key: string, file: PlayableFile, filename: string, track: EmbeddedTrack, durationMs: number, subtitle: Cue[]): Promise<void> {
    const { cache, limiter, logger, beginJob, windows, windowSeconds, timeoutMs, extract = extractWindows } = this.#options;
    const endJob = beginJob();
    const started = Date.now();
    const chosen = pickWindows(subtitle, durationMs, windows, windowSeconds);
    try {
      const text = await limiter.run(() => extract(file.url, track.index, chosen, { timeoutMs }));
      const cues = parseSrt(decodeSubtitle(Buffer.from(text, 'utf8')));
      // Stored even when empty: an empty entry means "tried, nothing usable", so it is not read again.
      await cache.put(key, Buffer.from(cues.length > 0 ? serializeSrt(cues) : '', 'utf8'));
      logger.info('embedded.extracted', {
        filename,
        track: { index: track.index, codec: track.codec, language: track.language ?? null },
        windows: chosen.map((w) => w.startSeconds),
        cues: cues.length,
        ms: Date.now() - started,
      });
    } catch (err) {
      logger.warn('embedded.failed', { filename, message: (err as Error).message, ms: Date.now() - started });
    } finally {
      endJob();
    }
  }
}
