import type { Logger } from '../logger.ts';

/** What Stremio tells about the file being played (it never sends its URL). */
export interface FileQuery {
  filename: string;
  videoSize?: number;
}

export interface PlayableFile {
  url: string;
  videoSize?: number;
  /** Where the URL came from (indexer id, `realdebrid`…), for the logs. */
  source: string;
  /**
   * Served from a torrent still downloading (Stremio's local streaming server):
   * slower to probe, and reading far from the playback position takes bandwidth
   * from the player (box, 2026-11-01: one embedded window ran over 5 min).
   */
  peerToPeer?: boolean;
}

/** One way of finding the URL of the file Stremio is playing. */
export interface FileSource {
  id: string;
  locate(query: FileQuery): Promise<PlayableFile | undefined>;
}

/** Located files kept in memory; released when the addon goes idle. */
const MAX_ENTRIES = 50;

/**
 * Asks each configured source in order (stream proxy, Real-Debrid…) for the
 * URL of the file being played; the first answer wins and a failing source
 * passes to the next. Without sources (or when none finds the file) the addon
 * works in light mode: no probing, no embedded reference.
 *
 * Only hits are remembered: the first Stremio request may arrive before the
 * file exists anywhere, so later requests must ask again.
 */
export class FileLocator {
  #sources: FileSource[];
  #logger: Logger;
  #found = new Map<string, PlayableFile>();
  #running = new Map<string, Promise<PlayableFile | undefined>>();
  #counts = { located: 0, notLocated: 0 };

  constructor(options: { sources: FileSource[]; logger: Logger }) {
    this.#sources = options.sources;
    this.#logger = options.logger;
  }

  get enabled(): boolean {
    return this.#sources.length > 0;
  }

  locate(query: FileQuery): Promise<PlayableFile | undefined> {
    const key = `${query.filename.toLowerCase()}|${query.videoSize ?? ''}`;
    const found = this.#found.get(key);
    if (found) return Promise.resolve(found);
    let running = this.#running.get(key);
    if (!running) {
      running = this.#search(key, query).finally(() => this.#running.delete(key));
      this.#running.set(key, running);
    }
    return running;
  }

  release(): void {
    this.#found.clear();
  }

  status(): Record<string, unknown> {
    return { sources: this.#sources.map((source) => source.id), known: this.#found.size, ...this.#counts };
  }

  async #search(key: string, query: FileQuery): Promise<PlayableFile | undefined> {
    const started = Date.now();
    for (const source of this.#sources) {
      let file: PlayableFile | undefined;
      try {
        file = await source.locate(query);
      } catch (err) {
        this.#logger.warn('file.source_failed', { filename: query.filename, source: source.id, message: (err as Error).message });
        continue;
      }
      if (!file) continue;
      this.#found.set(key, file);
      if (this.#found.size > MAX_ENTRIES) this.#found.delete(this.#found.keys().next().value as string);
      this.#counts.located += 1;
      // Never the URL: it carries the Real-Debrid key.
      this.#logger.info('file.located', { filename: query.filename, source: file.source, ms: Date.now() - started });
      return file;
    }
    this.#counts.notLocated += 1;
    this.#logger.info('file.not_located', { filename: query.filename, tried: this.#sources.map((source) => source.id), ms: Date.now() - started });
    return undefined;
  }
}
