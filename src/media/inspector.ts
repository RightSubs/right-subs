import type { Logger } from '../logger.ts';
import type { Limiter } from '../resources/limiter.ts';
import type { PlayableFile } from '../streams/proxy.ts';
import { probeVideo, type VideoInfo } from './probe.ts';

/** Probed files kept in memory; released when the addon goes idle. */
const MAX_ENTRIES = 50;

export interface InspectorOptions {
  /** Finds the URL of a file Stremio listed (the stream proxy). */
  find: (filename: string, videoSize?: number) => PlayableFile | undefined;
  limiter: Limiter;
  logger: Logger;
  timeoutMs: number;
  probe?: typeof probeVideo;
}

/** Real properties of the file being played (fps, embedded tracks), probed once per file. */
export class VideoInspector {
  #options: InspectorOptions;
  #results = new Map<string, Promise<VideoInfo | undefined>>();

  constructor(options: InspectorOptions) {
    this.#options = options;
  }

  /** Undefined when the file is unknown (not listed through the proxy) or probing fails. */
  inspect(filename: string | undefined, videoSize?: number): Promise<VideoInfo | undefined> {
    const file = filename ? this.#options.find(filename, videoSize) : undefined;
    if (!file) return Promise.resolve(undefined);
    let result = this.#results.get(file.url);
    if (!result) {
      result = this.#probe(file, filename as string);
      this.#results.set(file.url, result);
      if (this.#results.size > MAX_ENTRIES) this.#results.delete(this.#results.keys().next().value as string);
    }
    return result;
  }

  release(): void {
    this.#results.clear();
  }

  async #probe(file: PlayableFile, filename: string): Promise<VideoInfo | undefined> {
    const { limiter, logger, timeoutMs, probe = probeVideo } = this.#options;
    const started = Date.now();
    try {
      const info = await limiter.run(() => probe(file.url, timeoutMs));
      logger.info('video.probed', { filename, indexer: file.indexer, ...info, ms: Date.now() - started });
      return info;
    } catch (err) {
      logger.warn('video.probe_failed', { filename, indexer: file.indexer, message: (err as Error).message });
      return undefined;
    }
  }
}
