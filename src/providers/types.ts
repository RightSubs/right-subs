import type { z } from 'zod';
import type { Language } from '../languages/languages.ts';
import type { Logger } from '../logger.ts';

export interface SubtitleQuery {
  type: 'movie' | 'series';
  imdbId: string;
  season?: number;
  episode?: number;
  videoHash?: string;
  videoSize?: number;
  filename?: string;
  languages: Language[];
}

export interface SubtitleCandidate {
  providerId: string;
  /** Provider-specific reference used to download the file; opaque to the rest of the app. */
  ref: string;
  language: Language;
  /** Id of the subtitle in the provider's own catalog (e.g. the v3 addon `id`). */
  sourceId?: string;
  /**
   * The same subtitle as listed by another provider (`downloadVia`), when that
   * provider can download it more cheaply (e.g. without spending the API quota).
   */
  sameAs?: { providerId: string; sourceId: string };
  /** Downloading it spends a limited quota (e.g. the OpenSubtitles API's 20/day). */
  metered?: boolean;
  releaseName?: string;
  fps?: number;
  hashMatch?: boolean;
  /** SDH: includes sound descriptions ("[door slams]"). */
  hearingImpaired?: boolean;
  downloads?: number;
}

export interface SubtitleProvider {
  readonly id: string;
  search(query: SubtitleQuery): Promise<SubtitleCandidate[]>;
  download(candidate: SubtitleCandidate): Promise<Buffer>;
  /** Extra state shown in /health (e.g. remaining quota). Must not expose secrets. */
  status?(): Record<string, unknown>;
}

export interface ProviderContext {
  id: string;
  version: string;
  logger: Logger;
  fetch: typeof fetch;
}

/**
 * A kind of subtitle source that can be declared in config.yaml (`type: <name>`).
 * Adding a new source = one file exporting a ProviderType + one line in providers/index.ts.
 */
export interface ProviderType {
  type: string;
  description: string;
  /** Validates the type-specific options of a config entry (everything besides id/type/enabled). */
  options: z.ZodTypeAny;
  /** Builds the provider from options already validated by `options`. */
  create(options: Record<string, unknown>, context: ProviderContext): SubtitleProvider;
}

/** The source answered, but with something unusable (HTTP error, bad JSON, quota…). */
export class ProviderError extends Error {
  readonly providerId: string;
  readonly status: number | undefined;

  constructor(providerId: string, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.providerId = providerId;
    this.status = status;
  }
}
