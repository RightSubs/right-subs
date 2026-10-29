import type { Logger } from '../logger.ts';
import { userAgent } from '../providers/http.ts';
import type { SubtitlesRequest } from './request.ts';

/** The Anime Kitsu addon's metadata maps every Kitsu episode to an IMDb id + season/episode. */
export const KITSU_ADDON_URL = 'https://anime-kitsu.strem.fun';
/** Anime entries kept in memory; released when the addon goes idle. */
const MAX_ENTRIES = 100;

interface KitsuMeta {
  imdb_id?: string;
  videos?: { id: string; imdb_id?: string; imdbSeason?: number; imdbEpisode?: number }[];
}

/**
 * Turns Kitsu ids (anime catalogs) into the IMDb id, season and episode that
 * subtitle sources understand. It also fixes the numbering: anime files and
 * Kitsu count episodes per entry (`kitsu:12:1000`), IMDb by season.
 */
export class KitsuResolver {
  #fetch: typeof fetch;
  #logger: Logger;
  #version: string;
  #timeoutMs: number;
  #baseUrl: string;
  #metas = new Map<number, Promise<KitsuMeta | undefined>>();

  constructor(options: { fetch: typeof fetch; logger: Logger; version: string; timeoutMs?: number; baseUrl?: string }) {
    this.#fetch = options.fetch;
    this.#logger = options.logger;
    this.#version = options.version;
    this.#timeoutMs = options.timeoutMs ?? 8000;
    this.#baseUrl = options.baseUrl ?? KITSU_ADDON_URL;
  }

  /** IMDb ids pass through; Kitsu ids get imdbId/season/episode, or undefined when there is no IMDb match. */
  async resolve(request: SubtitlesRequest): Promise<SubtitlesRequest | undefined> {
    if (!request.kitsu) return request;
    const meta = await this.#meta(request.kitsu.id, request.type);
    const video = meta?.videos?.find((v) => v.id === request.id);
    const resolved: SubtitlesRequest = { ...request };
    if (video?.imdb_id && video.imdbSeason !== undefined && video.imdbEpisode !== undefined) {
      Object.assign(resolved, { type: 'series', imdbId: video.imdb_id, season: video.imdbSeason, episode: video.imdbEpisode });
    } else if (request.kitsu.episode === undefined && meta?.imdb_id) {
      // A movie (or a one-off special): the entry itself maps to an IMDb title.
      resolved.type = 'movie';
      resolved.imdbId = meta.imdb_id;
      delete resolved.season;
      delete resolved.episode;
    } else {
      this.#logger.info('kitsu.unmapped', { id: request.id });
      return undefined;
    }
    return resolved;
  }

  release(): void {
    this.#metas.clear();
  }

  #meta(kitsuId: number, type: SubtitlesRequest['type']): Promise<KitsuMeta | undefined> {
    let meta = this.#metas.get(kitsuId);
    if (!meta) {
      meta = this.#load(kitsuId, type);
      this.#metas.set(kitsuId, meta);
      if (this.#metas.size > MAX_ENTRIES) this.#metas.delete(this.#metas.keys().next().value as number);
    }
    return meta;
  }

  async #load(kitsuId: number, type: SubtitlesRequest['type']): Promise<KitsuMeta | undefined> {
    try {
      const res = await this.#fetch(`${this.#baseUrl}/meta/${type}/kitsu:${kitsuId}.json`, {
        headers: { 'User-Agent': userAgent(this.#version), Accept: 'application/json' },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as { meta?: KitsuMeta }).meta;
    } catch (err) {
      this.#logger.warn('kitsu.lookup_failed', { kitsuId, message: (err as Error).message });
      // Forget the failure so the next request tries again.
      this.#metas.delete(kitsuId);
      return undefined;
    }
  }
}
