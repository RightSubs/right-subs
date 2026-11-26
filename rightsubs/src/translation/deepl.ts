import type { Language } from '../languages/languages.ts';
import type { Cue } from '../subtitles/srt.ts';

/** Translates texts between languages: DeepL, Gemini, OpenRouter, a fallback chain of them; tests use doubles. */
export interface Translator {
  /**
   * Translates every text (same order, same length). Throws when the service refuses or is unreachable.
   * `onProvider` is told the name of the provider that served a request (only chains report it).
   */
  translate(texts: string[], target: Language, source: Language, onProvider?: (name: string) => void): Promise<string[]>;
}

/** The API takes up to 50 texts and 128 KiB per request. */
const MAX_TEXTS = 50;
const MAX_BYTES = 100_000;

export interface DeepLOptions {
  apiKey: string;
  timeoutMs: number;
  fetch: typeof fetch;
  /** Waits before the single retry after a 429 (injected so tests do not sleep). */
  sleep?: (ms: number) => Promise<void>;
  /** Called with the characters billed by each request (a quota counter, never the text). */
  onCharacters?: (count: number) => void;
}

/** DeepL target codes differ from ours for English and Chinese; Portuguese is already split in PT-BR / PT-PT. */
export function deeplTarget(language: Language): string {
  switch (language.tag) {
    case 'en':
      return 'EN-US';
    case 'zh-CN':
      return 'ZH-HANS';
    case 'zh-TW':
      return 'ZH-HANT';
    default:
      return language.tag.toUpperCase();
  }
}

/** Source codes have no regional variant (PT, EN, ZH). */
export function deeplSource(language: Language): string {
  return language.tag.split('-')[0]?.toUpperCase() ?? language.tag.toUpperCase();
}

/** What a DeepL key has used this billing period, in characters. */
export interface DeepLUsage {
  used: number;
  limit: number;
}

export class DeepL implements Translator {
  #options: DeepLOptions;
  /** Free keys end in ":fx" and use another host. */
  #base: string;

  constructor(options: DeepLOptions) {
    this.#options = options;
    this.#base = options.apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  }

  async translate(texts: string[], target: Language, source: Language): Promise<string[]> {
    const out: string[] = [];
    const all = batches(texts);
    // A few requests at a time: a feature film is ~13 batches, and the player is waiting (~10 s sequentially).
    for (let i = 0; i < all.length; i += CONCURRENCY) {
      const group = all.slice(i, i + CONCURRENCY);
      for (const part of await Promise.all(group.map((batch) => this.#request(batch, target, source)))) out.push(...part);
    }
    return out;
  }

  /** Characters used and allowed this month. Free of charge: it does not count against the quota. */
  async usage(): Promise<DeepLUsage> {
    const { apiKey, timeoutMs } = this.#options;
    const response = await this.#options.fetch(`${this.#base}/v2/usage`, {
      headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`DeepL respondeu ${response.status}`);
    const body = (await response.json()) as { character_count?: unknown; character_limit?: unknown };
    if (typeof body.character_count !== 'number' || typeof body.character_limit !== 'number') throw new Error('unexpected response from DeepL');
    return { used: body.character_count, limit: body.character_limit };
  }

  async #request(texts: string[], target: Language, source: Language, retried = false): Promise<string[]> {
    const { apiKey, timeoutMs, onCharacters, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = this.#options;
    let response: Response;
    try {
      response = await this.#options.fetch(`${this.#base}/v2/translate`, {
        method: 'POST',
        headers: { Authorization: `DeepL-Auth-Key ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: texts,
          target_lang: deeplTarget(target),
          source_lang: deeplSource(source),
          // Cue breaks are kept; <i> and friends are left alone.
          preserve_formatting: true,
          split_sentences: 'nonewlines',
          tag_handling: 'html',
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new Error(`DeepL unreachable: ${(err as Error).message}`);
    }
    if (response.status === 429 && !retried) {
      const wait = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 10) * 1000 : 2000);
      return this.#request(texts, target, source, true);
    }
    if (response.status === 456) throw new Error('DeepL monthly quota used up');
    if (response.status === 403 || response.status === 401) throw new Error('DeepL key rejected');
    if (!response.ok) throw new Error(`DeepL respondeu ${response.status}`);
    const body = (await response.json()) as { translations?: { text?: unknown }[] };
    const translated = body.translations?.map((item) => item.text);
    if (!translated || translated.length !== texts.length || translated.some((text) => typeof text !== 'string')) {
      throw new Error('unexpected response from DeepL');
    }
    onCharacters?.(texts.reduce((sum, text) => sum + text.length, 0));
    return translated as string[];
  }
}

/** How long a usage reading is reused (the screen asks every time it opens). */
const USAGE_TTL_MS = 10 * 60_000;
/** After a failed reading (offline, key rejected) nothing is asked again for this long. */
const USAGE_RETRY_MS = 60_000;

/**
 * The key's usage, read when someone asks and kept for a while: no timers, and a translation
 * drops it (`invalidate`) so the next reading shows what it just spent. Never throws.
 */
export class UsageCache {
  #read: () => Promise<DeepLUsage>;
  #now: () => number;
  #value: { usage: DeepLUsage | undefined; until: number } | undefined;
  #inFlight: Promise<DeepLUsage | undefined> | undefined;

  constructor(read: () => Promise<DeepLUsage>, now: () => number = Date.now) {
    this.#read = read;
    this.#now = now;
  }

  invalidate(): void {
    this.#value = undefined;
  }

  async get(): Promise<DeepLUsage | undefined> {
    if (this.#value && this.#value.until > this.#now()) return this.#value.usage;
    this.#inFlight ??= this.#read().then(
      (usage) => {
        this.#value = { usage, until: this.#now() + USAGE_TTL_MS };
        return usage;
      },
      () => {
        this.#value = { usage: undefined, until: this.#now() + USAGE_RETRY_MS };
        return undefined;
      },
    );
    try {
      return await this.#inFlight;
    } finally {
      this.#inFlight = undefined;
    }
  }
}

/** Requests in flight at once (DeepL Free accepts a few; a 429 is retried once anyway). */
export const CONCURRENCY = 4;

/** Splits into requests within the API limits (`maxTexts` can only be lower than DeepL's own 50 per request unless DeepL splits it again, as its translate() does). */
export function batches(texts: string[], maxTexts = MAX_TEXTS): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const text of texts) {
    const size = Buffer.byteLength(text);
    if (current.length > 0 && (current.length >= maxTexts || bytes + size > MAX_BYTES)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(text);
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** ASS/SSA override blocks (`{\an8}`) survive badly in a translation and mean nothing to the translator. */
const OVERRIDES = /\{\\[^}]*\}/g;

/**
 * `<font color="#FFFFFF">` on every line (the German subtitle of Generation Z has 2006) makes
 * the player ignore the viewer's own subtitle style (colour, outline): dropped. It also
 * spares the quota, since the tags are sent to the translator as text.
 */
const FONT_TAGS = /<\/?font\b[^>]*>/gi;

/**
 * Translates the text of every cue and keeps the timing. Repeated lines ("- Yes.")
 * are sent once, which also spares the monthly quota.
 */
export async function translateCues(
  translator: Translator,
  cues: Cue[],
  target: Language,
  source: Language,
): Promise<{ cues: Cue[]; characters: number; providers: string[] }> {
  const clean = cues.map((cue) => cue.text.replace(OVERRIDES, '').replace(FONT_TAGS, '').trim());
  const unique = [...new Set(clean.filter((text) => text.length > 0))];
  const providers = new Set<string>();
  const translated = await translator.translate(unique, target, source, (name) => providers.add(name));
  const byText = new Map(unique.map((text, index) => [text, translated[index] as string]));
  const out: Cue[] = [];
  cues.forEach((cue, index) => {
    const text = byText.get(clean[index] as string);
    if (text && text.trim()) out.push({ ...cue, text: text.trim() });
  });
  return { cues: out, characters: unique.reduce((sum, text) => sum + text.length, 0), providers: [...providers] };
}
