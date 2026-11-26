import type { Language } from '../languages/languages.ts';
import type { Translator } from './deepl.ts';

/** Why a provider could not translate: the fallback chain logs it and moves on. */
export type ProviderFailure = 'quota' | 'key' | 'unreachable' | 'bad_response';

export class TranslationProviderError extends Error {
  readonly provider: string;
  readonly reason: ProviderFailure;
  /** The HTTP status behind it, when there was one. */
  readonly status: number | undefined;
  readonly detail: string;

  constructor(provider: string, reason: ProviderFailure, detail: string, status?: number) {
    super(`${provider}: ${detail}`);
    this.provider = provider;
    this.reason = reason;
    this.status = status;
    this.detail = detail;
  }

  /** The same failure saying which model gave it (when a service has more than one). */
  forModel(model: string): TranslationProviderError {
    return new TranslationProviderError(this.provider, this.reason, `${this.detail} [${model}]`, this.status);
  }
}

/** Cues per request. The free tiers count requests, not tokens, so fewer, larger requests stretch the daily allowance. */
export const LLM_BATCH = 200;

export interface LlmOptions {
  apiKey: string;
  /** In order of preference: when one is busy or out of quota, the next one is asked before waiting. */
  models: string[];
  timeoutMs: number;
  fetch: typeof fetch;
  /** Called after every request that went through (the quota reading is dropped, so the next one shows the spend). */
  onRequest?: () => void;
  /** Waits between the attempts after a temporary server error (injected so tests do not sleep). */
  sleep?: (ms: number) => Promise<void>;
}

/** A busy or failing server (Gemini answers 503 "high demand" about half the time on the free tier): every model asked again after these waits. */
const RETRY_AFTER_MS = [2000, 5000, 10_000];
const TEMPORARY = new Set([500, 502, 503, 504]);

export function prompt(target: Language, source: Language): string {
  return [
    `You translate movie and TV subtitles from ${source.name} (${source.tag}) into ${target.name} (${target.tag}).`,
    'The user message is a JSON array of strings, one per subtitle cue, in order.',
    'Answer with ONLY a JSON array of strings: the same number of items, in the same order, item i being the translation of item i.',
    'Never merge, split, drop or reorder items. Keep line breaks (\\n) and the tags <i>, </i>, <b>, </b> exactly where they belong.',
    'Keep names, music and sound cues natural for the target language. Do not add notes, numbering or explanations.',
  ].join('\n');
}

/** Pulls the array out of a model answer, tolerating a Markdown fence around it. Undefined when it is not an array of strings. */
export function parseTranslations(text: string): string[] | undefined {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(body) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? (parsed as string[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Shared by the LLM providers: chunks of LLM_BATCH, one retry when the count comes back wrong. */
export abstract class LlmTranslator implements Translator {
  readonly name: string;
  protected options: LlmOptions;

  constructor(name: string, options: LlmOptions) {
    this.name = name;
    this.options = options;
  }

  async translate(texts: string[], target: Language, source: Language): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < texts.length; i += LLM_BATCH) out.push(...(await this.#chunk(texts.slice(i, i + LLM_BATCH), target, source)));
    return out;
  }

  /**
   * One request. When the model answers with another number of lines (it merged or split cues),
   * asking again would give the same answer (temperature 0): the batch is cut in halves and each
   * half is asked on its own, down to a single cue (asked once more, then the batch fails).
   */
  async #chunk(texts: string[], target: Language, source: Language): Promise<string[]> {
    const answer = parseTranslations(await this.#ask(prompt(target, source), JSON.stringify(texts)));
    if (answer && answer.length === texts.length) return answer;
    if (texts.length > 1) {
      const middle = Math.ceil(texts.length / 2);
      return [...(await this.#chunk(texts.slice(0, middle), target, source)), ...(await this.#chunk(texts.slice(middle), target, source))];
    }
    throw new TranslationProviderError(this.name, 'bad_response', `sent 1 cue, got ${answer ? answer.length : 'something that is not a list of texts'}`);
  }

  /**
   * The answer of the first model that gives one. A model that is busy (5xx), out of quota or
   * silent (timeout, no connection) hands over to the next, which has its own capacity and
   * limits; when all of them were only busy, the round is repeated after a wait. Anything else
   * (a rejected key, a bad answer) ends it.
   */
  async #ask(system: string, user: string): Promise<string> {
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const several = this.options.models.length > 1;
    for (let round = 0; ; round++) {
      let last: TranslationProviderError | undefined;
      let onlyBusy = true;
      for (const model of this.options.models) {
        try {
          return await this.complete(model, system, user);
        } catch (err) {
          if (!(err instanceof TranslationProviderError)) throw err;
          const busy = err.status !== undefined && TEMPORARY.has(err.status);
          // No status at all: the connection failed or timed out. The other model may answer, but asking everything
          // again after a wait would cost another full timeout each.
          const silent = err.reason === 'unreachable' && err.status === undefined;
          if (!busy && !silent && err.reason !== 'quota') throw several ? err.forModel(model) : err;
          if (!busy) onlyBusy = false;
          last = several ? err.forModel(model) : err;
        }
      }
      const wait = RETRY_AFTER_MS[round];
      if (!onlyBusy || wait === undefined) throw last as TranslationProviderError;
      await sleep(wait);
    }
  }

  /** One request to one model: its text answer. Throws TranslationProviderError. */
  protected abstract complete(model: string, system: string, user: string): Promise<string>;

  /** Maps an HTTP status to a failure; undefined when the response is fine. */
  protected failure(status: number, detail = ''): TranslationProviderError | undefined {
    const why = detail ? `: ${detail}` : '';
    if (status === 429 || status === 402) return new TranslationProviderError(this.name, 'quota', `quota used up (${status})${why}`, status);
    if (status === 401 || status === 403) return new TranslationProviderError(this.name, 'key', `key rejected (${status})${why}`, status);
    if (status < 200 || status >= 300) return new TranslationProviderError(this.name, 'unreachable', `answered ${status}${why}`, status);
    return undefined;
  }

  protected async post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.options.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (err) {
      throw new TranslationProviderError(this.name, 'unreachable', (err as Error).message);
    }
    if (response.status < 200 || response.status >= 300) throw this.failure(response.status, await errorDetail(response));
    this.options.onRequest?.();
    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      throw new TranslationProviderError(this.name, 'unreachable', `the answer was cut: ${(err as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // What came back instead (an empty body, an HTML page of a proxy): the start of it says which. Never holds a key.
      throw new TranslationProviderError(this.name, 'bad_response', `the answer is not JSON (${text.length} characters, starts with ${JSON.stringify(text.slice(0, 80))})`);
    }
    // OpenRouter reports a failure of the model behind it as 200 with { error: { code, message } }.
    const error = (parsed as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    if (error) {
      const code = typeof error.code === 'number' ? error.code : 502;
      throw this.failure(code) ?? new TranslationProviderError(this.name, 'unreachable', `error ${code}: ${String(error.message).slice(0, 120)}`, code);
    }
    return parsed;
  }
}

/**
 * Why the service refused, in its own words ("Quota exceeded for metric … per minute"): the
 * `error.message` of the JSON body, cut short. A message never carries the key.
 */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (JSON.parse(await response.text()) as { error?: { message?: unknown } } | null)?.error?.message;
    return typeof body === 'string' ? body.replace(/\s+/g, ' ').slice(0, 200) : '';
  } catch {
    return '';
  }
}

export class GeminiTranslator extends LlmTranslator {
  constructor(options: LlmOptions) {
    super('Gemini', options);
  }

  protected async complete(model: string, system: string, user: string): Promise<string> {
    const { apiKey } = this.options;
    const generationConfig: Record<string, unknown> = { temperature: 0, responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'STRING' } } };
    // Translating needs no thinking. The Gemini 3 models take a level (2.5 ones a token budget, and refuse the level; 3.5 refuses the budget).
    if (model.startsWith('gemini-3')) generationConfig['thinkingConfig'] = { thinkingLevel: 'minimal' };
    // The key goes in a header, never in the URL (URLs end up in logs).
    const body = (await this.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': apiKey },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig,
      },
    )) as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text).filter((part) => typeof part === 'string').join('');
    if (!text) throw new TranslationProviderError(this.name, 'bad_response', 'empty answer');
    return text;
  }
}

export class OpenRouterTranslator extends LlmTranslator {
  constructor(options: LlmOptions) {
    super('OpenRouter', options);
  }

  protected async complete(model: string, system: string, user: string): Promise<string> {
    const { apiKey } = this.options;
    const body = (await this.post(
      'https://openrouter.ai/api/v1/chat/completions',
      { Authorization: `Bearer ${apiKey}` },
      {
        model,
        temperature: 0,
        // Translating needs no reasoning, and the free models spend 5,000 to 10,000 tokens on it: 65-95 s for 130 lines against 20-29 s without (measured 2026-11-25).
        reasoning: { enabled: false },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
    )) as { model?: unknown; choices?: { finish_reason?: unknown; message?: { content?: unknown; reasoning?: unknown } }[] };
    const choice = body.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== 'string' || !text) {
      // The router picks a different free model each time: which one, and why it said nothing (a reasoning model that ran out of room), is what tells.
      const why = `model ${String(body.model).slice(0, 60)}, finish ${String(choice?.finish_reason)}, ${choice?.message?.reasoning ? 'only reasoning' : 'no reasoning'}`;
      throw new TranslationProviderError(this.name, 'bad_response', `empty answer (${why})`);
    }
    return text;
  }
}

/** What an OpenRouter key has left of the free-model requests allowed today. */
export interface RequestsUsage {
  used: number;
  limit: number;
}

/**
 * Reads the key's own counters (`GET /api/v1/key`, free of charge). Only the free tier has a
 * daily request cap (50, or 1000 after buying credits); a paid key has none, so nothing is
 * returned. Throws when the answer cannot be read.
 */
export async function openRouterUsage(options: Pick<LlmOptions, 'apiKey' | 'timeoutMs' | 'fetch'>): Promise<RequestsUsage | undefined> {
  const response = await options.fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${options.apiKey}` },
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) throw new Error(`OpenRouter answered ${response.status}`);
  const data = ((await response.json()) as { data?: { is_free_tier?: unknown; free_model_daily_requests?: { used?: unknown; limit?: unknown } } }).data;
  const daily = data?.free_model_daily_requests;
  if (!data?.is_free_tier) return undefined;
  if (typeof daily?.used !== 'number' || typeof daily.limit !== 'number') throw new Error('unexpected response from OpenRouter');
  return { used: daily.used, limit: daily.limit };
}
