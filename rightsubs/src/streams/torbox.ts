import type { Logger } from '../logger.ts';
import { userAgent } from '../providers/http.ts';
import type { FileQuery, FileSource, PlayableFile } from './locator.ts';

const API = 'https://api.torbox.app/v1/api';

export interface TorBoxOptions {
  token: string;
  /** Most recent torrents searched. */
  lookback: number;
  timeoutMs: number;
  fetch: typeof fetch;
  logger: Logger;
  version: string;
}

interface TbFile {
  id?: number;
  name?: string;
  short_name?: string;
  size?: number;
}

interface TbTorrent {
  id?: number;
  files?: TbFile[];
}

/**
 * Finds the file being played among the user's TorBox torrents. When a stream addon
 * (Torrentio…) resolves the stream the user clicked, TorBox adds the torrent to the account
 * (or it was there already, cached); the file is matched by name and size and its direct link
 * is asked for only then. That link carries the account's token, so it is never logged.
 */
export class TorBoxSource implements FileSource {
  readonly id = 'torbox';
  #options: TorBoxOptions;
  /** Set when the token is rejected: skipped until restart, so the log is not flooded. */
  #rejected = false;

  constructor(options: TorBoxOptions) {
    this.#options = options;
  }

  async locate(query: FileQuery): Promise<PlayableFile | undefined> {
    if (this.#rejected) return undefined;
    const { token, lookback, timeoutMs, fetch, version } = this.#options;
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': userAgent(version) };
    const listed = await fetch(`${API}/torrents/mylist?limit=${lookback}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (this.#checkToken(listed.status)) return undefined;
    if (!listed.ok) throw new Error(`HTTP ${listed.status}`);
    const body = (await listed.json()) as { data?: unknown };
    if (body.data === null || body.data === undefined) return undefined; // empty account
    if (!Array.isArray(body.data)) throw new Error('unexpected response from /torrents/mylist');

    const found = findFile(body.data as TbTorrent[], query);
    if (!found) return undefined;

    // The token goes in the query string (the API's only way); the answer is the direct link.
    const asked = await fetch(
      `${API}/torrents/requestdl?token=${encodeURIComponent(token)}&torrent_id=${found.torrent}&file_id=${found.file.id}&zip_link=false`,
      { headers: { Accept: 'application/json', 'User-Agent': userAgent(version) }, signal: AbortSignal.timeout(timeoutMs) },
    );
    if (this.#checkToken(asked.status)) return undefined;
    if (!asked.ok) throw new Error(`HTTP ${asked.status}`);
    const link = ((await asked.json()) as { data?: unknown }).data;
    if (typeof link !== 'string' || !/^https:\/\//.test(link)) throw new Error('unexpected response from /torrents/requestdl');
    const file: PlayableFile = { url: link, source: this.id };
    if (typeof found.file.size === 'number') file.videoSize = found.file.size;
    return file;
  }

  /** True (after saying so once) when TorBox refuses the token. */
  #checkToken(status: number): boolean {
    if (status !== 401 && status !== 403) return false;
    this.#rejected = true;
    this.#options.logger.warn('torbox.token_rejected', {
      status,
      hint: 'TorBox token invalid or expired — copy another from the TorBox settings (API), update TORBOX_TOKEN and restart',
    });
    return true;
  }
}

/** The file with this name (and size, when Stremio sent it); the same name with another size is another release. */
function findFile(torrents: TbTorrent[], query: FileQuery): { torrent: number; file: TbFile & { id: number } } | undefined {
  const name = query.filename.toLowerCase();
  for (const torrent of torrents) {
    if (typeof torrent.id !== 'number') continue;
    for (const file of torrent.files ?? []) {
      if (typeof file.id !== 'number') continue;
      const names = [file.short_name, file.name?.slice(file.name.lastIndexOf('/') + 1)];
      if (!names.some((candidate) => candidate?.toLowerCase() === name)) continue;
      if (query.videoSize !== undefined && file.size !== query.videoSize) continue;
      return { torrent: torrent.id, file: file as TbFile & { id: number } };
    }
  }
  return undefined;
}
