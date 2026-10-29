import type { Logger } from '../logger.ts';
import { userAgent } from '../providers/http.ts';

export interface IndexerConfig {
  id: string;
  url: string;
  timeoutMs: number;
}

/** A Stremio stream object. Only the fields used here are typed; the rest passes through untouched. */
interface Stream {
  url?: string;
  title?: string;
  description?: string;
  behaviorHints?: { filename?: string; videoSize?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface PlayableFile {
  url: string;
  videoSize?: number;
  indexer: string;
}

/** Remembered files; released when the addon goes idle. */
const MAX_FILES = 500;

/**
 * Passes stream requests through to the configured indexers (Torrentio,
 * Sootio…) and returns their lists unchanged, in config order. On the way it
 * remembers file name → URL, so the file being played can be probed later.
 */
export class StreamProxy {
  #indexers: IndexerConfig[];
  #fetch: typeof fetch;
  #logger: Logger;
  #version: string;
  #files = new Map<string, PlayableFile[]>();

  constructor(options: { indexers: IndexerConfig[]; fetch: typeof fetch; logger: Logger; version: string }) {
    this.#indexers = options.indexers;
    this.#fetch = options.fetch;
    this.#logger = options.logger;
    this.#version = options.version;
  }

  get enabled(): boolean {
    return this.#indexers.length > 0;
  }

  async streams(type: string, id: string): Promise<{ streams: Stream[] }> {
    const started = Date.now();
    const lists = await Promise.all(this.#indexers.map((indexer) => this.#query(indexer, type, id)));
    for (const [index, list] of lists.entries()) {
      for (const stream of list) this.#remember(stream, (this.#indexers[index] as IndexerConfig).id);
    }
    this.#logger.info('streams.request', {
      type,
      id,
      counts: Object.fromEntries(this.#indexers.map((indexer, index) => [indexer.id, lists[index]?.length ?? 0])),
      ms: Date.now() - started,
    });
    return { streams: lists.flat() };
  }

  /** The URL of a file listed earlier, by name (and size, when two releases share a name). */
  find(filename: string, videoSize?: number): PlayableFile | undefined {
    const candidates = this.#files.get(filename.toLowerCase());
    if (!candidates) return undefined;
    return candidates.find((file) => videoSize !== undefined && file.videoSize === videoSize) ?? candidates[0];
  }

  release(): void {
    this.#files.clear();
  }

  status(): Record<string, unknown> {
    return { indexers: this.#indexers.map((indexer) => indexer.id), knownFiles: this.#files.size };
  }

  async #query(indexer: IndexerConfig, type: string, id: string): Promise<Stream[]> {
    const base = indexer.url.slice(0, -'/manifest.json'.length);
    try {
      // `id` is passed exactly as Stremio sent it (still percent-encoded).
      const res = await this.#fetch(`${base}/stream/${type}/${id}.json`, {
        headers: { 'User-Agent': userAgent(this.#version), Accept: 'application/json' },
        signal: AbortSignal.timeout(indexer.timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { streams?: unknown };
      return Array.isArray(body.streams) ? (body.streams as Stream[]) : [];
    } catch (err) {
      const message = (err as Error).name === 'TimeoutError' ? `sem resposta em ${indexer.timeoutMs} ms` : (err as Error).message;
      this.#logger.warn('streams.indexer_failed', { indexer: indexer.id, type, id, message });
      return [];
    }
  }

  #remember(stream: Stream, indexer: string): void {
    const filename = stream.behaviorHints?.filename ?? firstLine(stream.title ?? stream.description);
    if (!stream.url || !filename) return;
    const key = filename.toLowerCase();
    const file: PlayableFile = { url: stream.url, indexer };
    if (typeof stream.behaviorHints?.videoSize === 'number') file.videoSize = stream.behaviorHints.videoSize;
    const known = (this.#files.get(key) ?? []).filter((other) => other.url !== file.url);
    this.#files.delete(key);
    this.#files.set(key, [file, ...known].slice(0, 5));
    if (this.#files.size > MAX_FILES) this.#files.delete(this.#files.keys().next().value as string);
  }
}

/** Torrentio-style titles start with the file name: `Movie.2008.1080p.mkv\n👤 12 💾 2 GB`. */
function firstLine(text: string | undefined): string | undefined {
  const line = text?.split('\n')[0]?.trim();
  return line && /\.(mkv|mp4|avi|m4v|mov|ts|webm)$/i.test(line) ? line : undefined;
}
