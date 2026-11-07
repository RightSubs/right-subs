import type { Language } from '../languages/languages.ts';
import type { Cue } from '../subtitles/srt.ts';

/** Translates texts between languages. The only implementation is DeepL; tests use doubles. */
export interface Translator {
  /** Translates every text (same order, same length). Throws when the service refuses or is unreachable. */
  translate(texts: string[], target: Language, source: Language): Promise<string[]>;
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
      throw new Error(`DeepL inacessível: ${(err as Error).message}`);
    }
    if (response.status === 429 && !retried) {
      const wait = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 10) * 1000 : 2000);
      return this.#request(texts, target, source, true);
    }
    if (response.status === 456) throw new Error('cota mensal do DeepL esgotada');
    if (response.status === 403 || response.status === 401) throw new Error('chave do DeepL recusada');
    if (!response.ok) throw new Error(`DeepL respondeu ${response.status}`);
    const body = (await response.json()) as { translations?: { text?: unknown }[] };
    const translated = body.translations?.map((item) => item.text);
    if (!translated || translated.length !== texts.length || translated.some((text) => typeof text !== 'string')) {
      throw new Error('resposta inesperada do DeepL');
    }
    onCharacters?.(texts.reduce((sum, text) => sum + text.length, 0));
    return translated as string[];
  }
}

/** Requests in flight at once (DeepL Free accepts a few; a 429 is retried once anyway). */
const CONCURRENCY = 4;

/** Splits into requests within the API limits. */
function batches(texts: string[]): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const text of texts) {
    const size = Buffer.byteLength(text);
    if (current.length > 0 && (current.length >= MAX_TEXTS || bytes + size > MAX_BYTES)) {
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
export async function translateCues(translator: Translator, cues: Cue[], target: Language, source: Language): Promise<{ cues: Cue[]; characters: number }> {
  const clean = cues.map((cue) => cue.text.replace(OVERRIDES, '').replace(FONT_TAGS, '').trim());
  const unique = [...new Set(clean.filter((text) => text.length > 0))];
  const translated = await translator.translate(unique, target, source);
  const byText = new Map(unique.map((text, index) => [text, translated[index] as string]));
  const out: Cue[] = [];
  cues.forEach((cue, index) => {
    const text = byText.get(clean[index] as string);
    if (text && text.trim()) out.push({ ...cue, text: text.trim() });
  });
  return { cues: out, characters: unique.reduce((sum, text) => sum + text.length, 0) };
}
