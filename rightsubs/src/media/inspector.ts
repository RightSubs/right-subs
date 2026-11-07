import type { Logger } from '../logger.ts';
import type { Limiter } from '../resources/limiter.ts';
import type { FileQuery, PlayableFile } from '../streams/locator.ts';
import { probeVideo, type VideoInfo } from './probe.ts';

/** Probed files kept in memory; released when the addon goes idle. */
const MAX_ENTRIES = 50;

export interface InspectorOptions {
  /** Finds the URL of the file being played (`FileLocator`). */
  locate: (query: FileQuery) => Promise<PlayableFile | undefined>;
  limiter: Limiter;
  logger: Logger;
  timeoutMs: number;
  /** For files served from a torrent (~5.6 s on the box against ~1.5 s from Real-Debrid). */
  peerToPeerTimeoutMs?: number;
  probe?: typeof probeVideo;
}

/** Real properties of the file being played (fps, embedded tracks), probed once per file. */
export class VideoInspector {
  #options: InspectorOptions;
  #results = new Map<string, Promise<VideoInfo | undefined>>();

  constructor(options: InspectorOptions) {
    this.#options = options;
  }

  /** Undefined when the file cannot be located or probing fails. */
  async inspect(filename: string | undefined, videoSize?: number): Promise<VideoInfo | undefined> {
    if (!filename) return undefined;
    const query: FileQuery = { filename };
    if (videoSize !== undefined) query.videoSize = videoSize;
    const file = await this.#options.locate(query);
    if (!file) return undefined;
    let result = this.#results.get(file.url);
    if (!result) {
      result = this.#probe(file, filename);
      this.#results.set(file.url, result);
      if (this.#results.size > MAX_ENTRIES) this.#results.delete(this.#results.keys().next().value as string);
    }
    return result;
  }

  release(): void {
    this.#results.clear();
  }

  async #probe(file: PlayableFile, filename: string): Promise<VideoInfo | undefined> {
    const { limiter, logger, timeoutMs, peerToPeerTimeoutMs = timeoutMs, probe = probeVideo } = this.#options;
    const started = Date.now();
    try {
      const info = await limiter.run(() => probe(file.url, file.peerToPeer ? peerToPeerTimeoutMs : timeoutMs));
      logger.info('video.probed', { filename, source: file.source, ...info, ms: Date.now() - started });
      return info;
    } catch (err) {
      logger.warn('video.probe_failed', { filename, source: file.source, message: (err as Error).message });
      return undefined;
    }
  }
}
