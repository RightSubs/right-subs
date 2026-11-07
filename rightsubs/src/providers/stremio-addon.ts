import { z } from 'zod';
import { findByStremioCode } from '../languages/languages.ts';
import { requestFile, requestJson } from './http.ts';
import type { ProviderContext, ProviderType, SubtitleCandidate, SubtitleProvider, SubtitleQuery } from './types.ts';

const optionsSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine((url) => url.endsWith('/manifest.json'), 'must be the URL of the addon\'s manifest.json'),
    timeoutMs: z.number().int().positive().default(8000),
  })
  .strict();

type Options = z.output<typeof optionsSchema>;

/** One entry of a Stremio `/subtitles` response. Fields besides id/url/lang are addon-specific (OpenSubtitles v3 shown). */
interface AddonSubtitle {
  id?: string | number;
  url?: string;
  lang?: string;
  /** v3: match type, `h` = by video hash. */
  m?: string;
  movieReleaseName?: string;
  subtitleFileName?: string;
  fpsMilli?: number;
}

export const stremioAddon: ProviderType = {
  type: 'stremio-addon',
  description: 'Any Stremio subtitle addon, from its manifest URL',
  options: optionsSchema,
  create: (options, context) => new StremioAddonProvider(options as Options, context),
};

class StremioAddonProvider implements SubtitleProvider {
  readonly id: string;
  #base: string;
  #options: Options;
  #context: ProviderContext;

  constructor(options: Options, context: ProviderContext) {
    this.id = context.id;
    this.#options = options;
    this.#context = context;
    this.#base = options.url.slice(0, -'/manifest.json'.length);
  }

  async search(query: SubtitleQuery): Promise<SubtitleCandidate[]> {
    const body = await requestJson<{ subtitles?: AddonSubtitle[] }>(this.#context, this.#searchUrl(query), {
      timeoutMs: this.#options.timeoutMs,
    });
    const wanted = new Set(query.languages.map((lang) => lang.tag));
    const candidates: SubtitleCandidate[] = [];
    for (const item of body.subtitles ?? []) {
      const language = item.lang ? findByStremioCode(item.lang) : undefined;
      if (!language || !wanted.has(language.tag) || !item.url) continue;
      const candidate: SubtitleCandidate = { providerId: this.id, ref: item.url, language };
      if (item.id !== undefined) candidate.sourceId = String(item.id);
      const releaseName = item.movieReleaseName || item.subtitleFileName?.replace(/\.[a-z0-9]{2,4}$/i, '');
      if (releaseName) candidate.releaseName = releaseName;
      if (item.fpsMilli) candidate.fps = item.fpsMilli / 1000;
      if (query.videoHash && item.m === 'h') candidate.hashMatch = true;
      candidates.push(candidate);
    }
    return candidates;
  }

  download(candidate: SubtitleCandidate): Promise<Buffer> {
    return requestFile(this.#context, candidate.ref, this.#options.timeoutMs);
  }

  #searchUrl(query: SubtitleQuery): string {
    const id = query.type === 'series' ? `${query.imdbId}:${query.season}:${query.episode}` : query.imdbId;
    // Same shape Stremio itself sends: `key=value&…` with percent-encoded values.
    const extra = [
      ['videoHash', query.videoHash],
      ['videoSize', query.videoSize?.toString()],
      ['filename', query.filename],
    ]
      .filter((pair): pair is [string, string] => Boolean(pair[1]))
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    return `${this.#base}/subtitles/${query.type}/${id}${extra ? `/${extra}` : ''}.json`;
  }
}
