import type { Language } from '../languages/languages.ts';
import type { Logger } from '../logger.ts';
import type { Translator } from './deepl.ts';
import { TranslationProviderError } from './llm.ts';

export interface ChainedProvider {
  /** Display name, also used in the AI notice ("DeepL", "Gemini"…). */
  name: string;
  translator: Translator;
}

/**
 * Tries the providers in the user's order. A provider that fails (quota used up, key
 * rejected, unreachable, a wrong answer) hands the same texts to the next one, so the
 * subtitle is finished by whoever still can. Throws the last failure when none can.
 * `onProvider` reports who served each request, for the notice and the logs.
 */
export class FallbackTranslator implements Translator {
  #providers: ChainedProvider[];
  #logger: Logger;

  constructor(providers: ChainedProvider[], logger: Logger) {
    this.#providers = providers;
    this.#logger = logger;
  }

  async translate(texts: string[], target: Language, source: Language, onProvider?: (name: string) => void): Promise<string[]> {
    let last: Error | undefined;
    for (const { name, translator } of this.#providers) {
      try {
        const out = await translator.translate(texts, target, source);
        onProvider?.(name);
        this.#logger.info('translation.provider', { provider: name, texts: texts.length });
        return out;
      } catch (err) {
        last = err as Error;
        const reason = err instanceof TranslationProviderError ? err.reason : 'failed';
        this.#logger.warn('translation.provider_failed', { provider: name, reason, message: last.message });
      }
    }
    throw last ?? new Error('no translation provider configured');
  }
}

/**
 * Wraps a provider whose quota is known in advance (DeepL): a request that needs more
 * characters than are left is refused before it is sent, so the next provider takes it.
 */
export class QuotaGuard implements Translator {
  #inner: Translator;
  #name: string;
  #remaining: () => Promise<number | undefined>;

  constructor(inner: Translator, name: string, remaining: () => Promise<number | undefined>) {
    this.#inner = inner;
    this.#name = name;
    this.#remaining = remaining;
  }

  async translate(texts: string[], target: Language, source: Language): Promise<string[]> {
    const needed = texts.reduce((sum, text) => sum + text.length, 0);
    const left = await this.#remaining();
    if (left !== undefined && left < needed) {
      throw new TranslationProviderError(this.#name, 'quota', `quota too low (needs ${needed} characters, ${Math.max(0, left)} left)`);
    }
    return this.#inner.translate(texts, target, source);
  }
}
