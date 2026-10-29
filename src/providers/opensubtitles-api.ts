import { z } from 'zod';
import { findByOpenSubtitlesCode } from '../languages/languages.ts';
import { requestFile, requestJson } from './http.ts';
import {
  ProviderError,
  type ProviderContext,
  type ProviderType,
  type SubtitleCandidate,
  type SubtitleProvider,
  type SubtitleQuery,
} from './types.ts';

const API_URL = 'https://api.opensubtitles.com';
/** Tokens last 24 h; renew a little earlier. */
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;
/** After a refused login, do not retry (and hit the 1 req/s login limit) for a while. */
const LOGIN_RETRY_MS = 60 * 60 * 1000;
/** When the quota runs out without a reset time, check again after this long. */
const QUOTA_RETRY_MS = 60 * 60 * 1000;

const optionsSchema = z
  .object({
    apiKey: z.string().min(1),
    username: z
      .string()
      .min(1)
      .refine((value) => !value.includes('@'), 'use o nome de usuário do OpenSubtitles, não o e-mail')
      .optional(),
    password: z.string().min(1).optional(),
    /** Id of another provider used to download files without spending the API quota. */
    downloadVia: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().default(8000),
  })
  .strict()
  .refine((options) => Boolean(options.username) === Boolean(options.password), {
    message: 'username e password devem ser informados juntos',
    path: ['password'],
  });

type Options = z.output<typeof optionsSchema>;

interface SearchResponse {
  data?: {
    attributes: {
      language?: string;
      release?: string;
      fps?: number;
      download_count?: number;
      moviehash_match?: boolean;
      hearing_impaired?: boolean;
      machine_translated?: boolean;
      ai_translated?: boolean;
      legacy_subtitle_id?: number;
      files?: { file_id: number }[];
    };
  }[];
}

interface DownloadResponse {
  link: string;
  remaining?: number;
  reset_time_utc?: string;
}

export const openSubtitlesApi: ProviderType = {
  type: 'opensubtitles-api',
  description: 'API REST do OpenSubtitles (conta gratuita + API key)',
  options: optionsSchema,
  create: (options, context) => new OpenSubtitlesApiProvider(options as Options, context),
};

class OpenSubtitlesApiProvider implements SubtitleProvider {
  readonly id: string;
  #options: Options;
  #context: ProviderContext;
  #session: { token: string; baseUrl: string; expiresAt: number } | undefined;
  #loginBlockedUntil = 0;
  #quota: { remaining?: number; resetAt?: string } = {};

  constructor(options: Options, context: ProviderContext) {
    this.id = context.id;
    this.#options = options;
    this.#context = context;
  }

  async search(query: SubtitleQuery): Promise<SubtitleCandidate[]> {
    const params = new URLSearchParams();
    const imdb = String(Number(query.imdbId.slice(2)));
    if (query.type === 'series') {
      params.set('parent_imdb_id', imdb);
      params.set('season_number', String(query.season));
      params.set('episode_number', String(query.episode));
    } else {
      params.set('imdb_id', imdb);
    }
    params.set('languages', query.languages.map((lang) => lang.opensubtitles).sort().join(','));
    if (query.videoHash) params.set('moviehash', query.videoHash);
    // The API redirects requests whose parameters are not sorted.
    params.sort();

    const body = await requestJson<SearchResponse>(this.#context, `${API_URL}/api/v1/subtitles?${params}`, {
      headers: this.#headers(),
      timeoutMs: this.#options.timeoutMs,
    });

    const wanted = new Set(query.languages.map((lang) => lang.tag));
    const candidates: SubtitleCandidate[] = [];
    for (const { attributes: item } of body.data ?? []) {
      const language = item.language ? findByOpenSubtitlesCode(item.language) : undefined;
      const fileId = item.files?.[0]?.file_id;
      if (!language || !wanted.has(language.tag) || fileId === undefined) continue;
      if (item.machine_translated || item.ai_translated) continue;
      const candidate: SubtitleCandidate = { providerId: this.id, ref: String(fileId), language, metered: true };
      if (item.release) candidate.releaseName = item.release;
      if (item.fps) candidate.fps = item.fps;
      if (item.download_count !== undefined) candidate.downloads = item.download_count;
      if (item.moviehash_match) candidate.hashMatch = true;
      if (item.hearing_impaired) candidate.hearingImpaired = true;
      if (this.#options.downloadVia && item.legacy_subtitle_id) {
        candidate.sameAs = { providerId: this.#options.downloadVia, sourceId: String(item.legacy_subtitle_id) };
      }
      candidates.push(candidate);
    }
    return candidates;
  }

  async download(candidate: SubtitleCandidate): Promise<Buffer> {
    const { remaining, resetAt } = this.#quota;
    if (remaining === 0 && resetAt && Date.now() < Date.parse(resetAt)) {
      throw new ProviderError(this.id, `cota diária de downloads esgotada (renova em ${resetAt})`, 406);
    }
    const link = await this.#downloadLink(Number(candidate.ref), true);
    return requestFile(this.#context, link, this.#options.timeoutMs);
  }

  status(): Record<string, unknown> {
    return {
      login: !this.#options.username ? 'sem conta' : this.#session ? 'ok' : this.#loginBlockedUntil > Date.now() ? 'recusado' : 'pendente',
      quota: { remaining: this.#quota.remaining ?? null, resetAt: this.#quota.resetAt ?? null },
    };
  }

  async #downloadLink(fileId: number, retryOnExpiredToken: boolean): Promise<string> {
    const session = await this.#ensureSession();
    try {
      const body = await requestJson<DownloadResponse>(this.#context, `${session?.baseUrl ?? API_URL}/api/v1/download`, {
        method: 'POST',
        headers: this.#headers(session?.token),
        body: { file_id: fileId },
        timeoutMs: this.#options.timeoutMs,
      });
      this.#quota = {};
      if (body.remaining !== undefined) this.#quota.remaining = body.remaining;
      if (body.reset_time_utc) this.#quota.resetAt = body.reset_time_utc;
      this.#context.logger.info('opensubtitles.quota', { provider: this.id, ...this.#quota });
      return body.link;
    } catch (err) {
      if (err instanceof ProviderError && err.status === 401 && session && retryOnExpiredToken) {
        this.#session = undefined;
        return this.#downloadLink(fileId, false);
      }
      if (err instanceof ProviderError && err.status === 406) {
        this.#quota = { remaining: 0, resetAt: new Date(Date.now() + QUOTA_RETRY_MS).toISOString() };
        this.#context.logger.warn('opensubtitles.quota_exhausted', { provider: this.id, ...this.#quota });
      }
      throw err;
    }
  }

  /** Logs in once and reuses the token; without an account, downloads are anonymous. */
  async #ensureSession(): Promise<{ token: string; baseUrl: string } | undefined> {
    const { username, password } = this.#options;
    if (!username || !password) return undefined;
    if (this.#session && this.#session.expiresAt > Date.now()) return this.#session;
    if (this.#loginBlockedUntil > Date.now()) return undefined;
    try {
      const body = await requestJson<{ token: string; base_url?: string }>(this.#context, `${API_URL}/api/v1/login`, {
        method: 'POST',
        headers: this.#headers(),
        body: { username, password },
        timeoutMs: this.#options.timeoutMs,
      });
      this.#session = {
        token: body.token,
        baseUrl: body.base_url ? `https://${body.base_url}` : API_URL,
        expiresAt: Date.now() + TOKEN_TTL_MS,
      };
      return this.#session;
    } catch (err) {
      this.#loginBlockedUntil = Date.now() + LOGIN_RETRY_MS;
      this.#context.logger.warn('opensubtitles.login_failed', {
        provider: this.id,
        message: (err as Error).message,
        hint: 'confira OPENSUBTITLES_USER (nome de usuário, não e-mail) e OPENSUBTITLES_PASSWORD no .env; downloads seguem como anônimos',
      });
      return undefined;
    }
  }

  #headers(token?: string): Record<string, string> {
    return { 'Api-Key': this.#options.apiKey, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }
}
