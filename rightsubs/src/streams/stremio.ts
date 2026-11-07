import type { FileQuery, FileSource, PlayableFile } from './locator.ts';

export interface StremioServerOptions {
  /** Stremio's streaming server on the same device, e.g. `http://127.0.0.1:11470`. */
  url: string;
  timeoutMs: number;
  fetch: typeof fetch;
}

interface TorrentFile {
  name?: string;
  length?: number;
}

interface TorrentEngine {
  infoHash?: string;
  files?: TorrentFile[];
}

/**
 * Finds a torrent being played without a debrid service. Stremio downloads it
 * with its own streaming server, which lists the active torrents and their
 * files in `/stats.json` and serves each file at `/{infoHash}/{index}`. Only
 * the device running Stremio can reach it (the RightSubs APK, or a PC running
 * both).
 */
export class StremioServerSource implements FileSource {
  readonly id = 'stremio';
  #options: StremioServerOptions;

  constructor(options: StremioServerOptions) {
    this.#options = options;
  }

  async locate(query: FileQuery): Promise<PlayableFile | undefined> {
    const { url, timeoutMs, fetch } = this.#options;
    const base = url.replace(/\/+$/, '');
    const res = await fetch(`${base}/stats.json`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const engines = (await res.json()) as unknown;
    if (!engines || typeof engines !== 'object') throw new Error('unexpected response from /stats.json');

    const name = query.filename.toLowerCase();
    for (const engine of Object.values(engines as Record<string, TorrentEngine>)) {
      if (!/^[0-9a-f]{40}$/i.test(engine?.infoHash ?? '') || !Array.isArray(engine.files)) continue;
      // Same name with another size is another release: not this file.
      const index = engine.files.findIndex(
        (file) => file?.name?.toLowerCase() === name && (query.videoSize === undefined || file.length === query.videoSize),
      );
      if (index === -1) continue;
      const file: PlayableFile = { url: `${base}/${engine.infoHash}/${index}`, source: this.id, peerToPeer: true };
      const length = engine.files[index]?.length;
      if (typeof length === 'number') file.videoSize = length;
      return file;
    }
    return undefined;
  }
}
