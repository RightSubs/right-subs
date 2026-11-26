import { createHash } from 'node:crypto';
import type { Language } from '../languages/languages.ts';
import type { Logger } from '../logger.ts';
import type { SubtitleCache } from '../subtitles/cache.ts';
import { batches, CONCURRENCY, type Translator } from './deepl.ts';

export interface ResumableOptions {
  cache: SubtitleCache;
  logger: Logger;
  /** Characters the key can still translate this month; undefined when unknown. */
  remaining?: () => Promise<number | undefined>;
  /** Texts per stored batch (default 50, DeepL's request size; LLM providers take more per request, DeepL splits it again). */
  batchSize?: number;
}

/**
 * Keeps every translated batch on disk the moment DeepL answers, so a translation that is
 * interrupted (the addon restarts, the phone kills the app, the quota runs out halfway) picks
 * up where it stopped instead of paying for the same lines again; and refuses to start a
 * translation the quota cannot finish, so characters are not spent on a subtitle that would
 * never be completed. Batches are cut exactly as DeepL's own requests are (one request each).
 */
export class ResumableTranslator implements Translator {
  #inner: Translator;
  #options: ResumableOptions;

  constructor(inner: Translator, options: ResumableOptions) {
    this.#inner = inner;
    this.#options = options;
  }

  async translate(texts: string[], target: Language, source: Language, onProvider?: (name: string) => void): Promise<string[]> {
    const { cache, logger, remaining, batchSize } = this.#options;
    const groups = batches(texts, batchSize);
    const keys = groups.map((group) => batchKey(group, target, source));
    const done: (string[] | undefined)[] = await Promise.all(keys.map((key) => this.#read(key)));

    const missing = groups.map((_, index) => index).filter((index) => !done[index]);
    const characters = missing.reduce((sum, index) => sum + (groups[index] as string[]).reduce((n, text) => n + text.length, 0), 0);
    if (missing.length < groups.length) {
      logger.info('translation.resumed', { batches: groups.length, cached: groups.length - missing.length, characters });
    }
    const left = missing.length > 0 ? await remaining?.() : undefined;
    if (left !== undefined && left < characters) {
      throw new Error(`DeepL quota too low for this subtitle (needs ${characters} characters, ${Math.max(0, left)} left)`);
    }

    // A few requests at a time, as DeepL's own translate() does; whatever finishes is kept even if another batch fails.
    let failure: Error | undefined;
    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      const wave = missing.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        wave.map(async (index) => {
          const translated = await this.#inner.translate(groups[index] as string[], target, source, onProvider);
          await cache.put(keys[index] as string, Buffer.from(JSON.stringify(translated), 'utf8'));
          done[index] = translated;
        }),
      );
      failure ??= (settled.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined)?.reason as Error | undefined;
      if (failure) break;
    }
    if (failure) throw failure;
    return done.flat() as string[];
  }

  async #read(key: string): Promise<string[] | undefined> {
    const data = await this.#options.cache.get(key);
    if (!data) return undefined;
    try {
      const parsed = JSON.parse(data.toString('utf8')) as unknown;
      return Array.isArray(parsed) && parsed.every((text) => typeof text === 'string') ? (parsed as string[]) : undefined;
    } catch {
      return undefined;
    }
  }
}

/** The same texts into the same language always give the same key (stored in the subtitle cache, 10 days). */
function batchKey(texts: string[], target: Language, source: Language): string {
  return `translated-batch:${source.tag}>${target.tag}:${createHash('sha256').update(JSON.stringify(texts)).digest('hex')}`;
}
