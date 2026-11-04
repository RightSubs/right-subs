import type { Logger } from '../logger.ts';
import { userAgent } from '../providers/http.ts';
import type { FileQuery, FileSource, PlayableFile } from './locator.ts';

const API = 'https://api.real-debrid.com/rest/1.0';

export interface RealDebridOptions {
  token: string;
  /** Most recent `/downloads` entries searched. */
  lookback: number;
  timeoutMs: number;
  fetch: typeof fetch;
  logger: Logger;
  version: string;
}

interface RdDownload {
  filename?: string;
  filesize?: number;
  download?: string;
}

/**
 * Finds the file being played in the Real-Debrid download history. When a
 * stream addon (Torrentio…) resolves the stream the user clicked, RD records
 * its direct link in `/downloads`; it is there by Stremio's second subtitles
 * request (the one with the video hash). Read-only: never unrestricts or adds
 * anything to the account.
 */
export class RealDebridSource implements FileSource {
  readonly id = 'realdebrid';
  #options: RealDebridOptions;
  /** Set when the token is rejected: skipped until restart, so the log is not flooded. */
  #rejected = false;

  constructor(options: RealDebridOptions) {
    this.#options = options;
  }

  async locate(query: FileQuery): Promise<PlayableFile | undefined> {
    if (this.#rejected) return undefined;
    const { token, lookback, timeoutMs, fetch, logger, version } = this.#options;
    const res = await fetch(`${API}/downloads?limit=${lookback}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': userAgent(version) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 || res.status === 403) {
      this.#rejected = true;
      logger.warn('realdebrid.token_rejected', {
        status: res.status,
        hint: 'token do Real-Debrid inválido ou expirado — gere outro em https://real-debrid.com/apitoken, atualize RD_TOKEN no .env e reinicie',
      });
      return undefined;
    }
    // 204: empty history.
    if (res.status === 204) return undefined;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = (await res.json()) as unknown;
    if (!Array.isArray(list)) throw new Error('resposta inesperada de /downloads');

    const name = query.filename.toLowerCase();
    // Same name with another size is another release: not this file.
    const match = (list as RdDownload[]).find(
      (item) => item.filename?.toLowerCase() === name && (query.videoSize === undefined || item.filesize === query.videoSize),
    );
    if (!match?.download) return undefined;
    const file: PlayableFile = { url: match.download, source: this.id };
    if (typeof match.filesize === 'number') file.videoSize = match.filesize;
    return file;
  }
}
