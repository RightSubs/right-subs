import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findLanguage, type Language } from '../src/languages/languages.ts';
import { createLogger } from '../src/logger.ts';
import type { Translator } from '../src/translation/deepl.ts';
import { FallbackTranslator, QuotaGuard } from '../src/translation/fallback.ts';
import { GeminiTranslator, LLM_BATCH, openRouterUsage, OpenRouterTranslator, parseTranslations, TranslationProviderError } from '../src/translation/llm.ts';
import { noticeText } from '../src/translation/notice.ts';

const ptBR = findLanguage('pt-BR') as Language;
const en = findLanguage('en') as Language;
const logger = createLogger('debug', () => {});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const geminiAnswer = (items: string[]) => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(items) }] } }] });
const routerAnswer = (items: string[], fence = false) =>
  json({ choices: [{ message: { content: fence ? '```json\n' + JSON.stringify(items) + '\n```' : JSON.stringify(items) } }] });

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const fakeFetch = (handler: Handler) => (async (url: string, init: RequestInit) => handler(url, init)) as typeof fetch;
const noSleep = async () => {};
const gemini = (handler: Handler) => new GeminiTranslator({ apiKey: 'SECRET', models: ['m'], timeoutMs: 1000, fetch: fakeFetch(handler), sleep: noSleep });
const router = (handler: Handler) => new OpenRouterTranslator({ apiKey: 'SECRET', models: ['m'], timeoutMs: 1000, fetch: fakeFetch(handler), sleep: noSleep });

test('parseTranslations accepts a fenced array and refuses anything else', () => {
  assert.deepEqual(parseTranslations('```json\n["a","b"]\n```'), ['a', 'b']);
  assert.equal(parseTranslations('{"a":1}'), undefined);
  assert.equal(parseTranslations('[1,2]'), undefined);
  assert.equal(parseTranslations('not json'), undefined);
});

test('Gemini: key in a header only, same count and order, 200 cues per request', async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const translator = gemini((url, init) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    const request = JSON.parse(init.body as string) as { contents: { parts: { text: string }[] }[] };
    const sent = JSON.parse(request.contents[0]!.parts[0]!.text) as string[];
    return geminiAnswer(sent.map((text) => `PT ${text}`));
  });
  const texts = Array.from({ length: LLM_BATCH + 5 }, (_, i) => `line ${i}`);
  assert.deepEqual(await translator.translate(texts, ptBR, en), texts.map((text) => `PT ${text}`));
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.headers['x-goog-api-key'], 'SECRET');
  assert.ok(!calls[0]?.url.includes('SECRET'));
});

test('Gemini: a wrong count splits the batch in halves; a cue that still fails fails the batch', async () => {
  // The model merges the first two cues whenever they are asked together.
  const requests: number[] = [];
  const merging = gemini((_url, init) => {
    const request = JSON.parse(init.body as string) as { contents: { parts: { text: string }[] }[] };
    const sent = JSON.parse(request.contents[0]!.parts[0]!.text) as string[];
    requests.push(sent.length);
    return geminiAnswer(sent.length === 4 ? ['merged', 'c', 'd'] : sent.map((text) => `PT ${text}`));
  });
  assert.deepEqual(await merging.translate(['a', 'b', 'c', 'd'], ptBR, en), ['PT a', 'PT b', 'PT c', 'PT d']);
  assert.deepEqual(requests, [4, 2, 2]);

  const never = gemini(() => geminiAnswer(['x', 'y']));
  await assert.rejects(never.translate(['a'], ptBR, en), (err: TranslationProviderError) => err.reason === 'bad_response' && /sent 1 cue, got 2/.test(err.message));
});

test('statuses map to quota, key and unreachable (no secret in the message)', async () => {
  for (const [status, reason] of [[429, 'quota'], [402, 'quota'], [401, 'key'], [403, 'key'], [500, 'unreachable']] as const) {
    await assert.rejects(gemini(() => json({}, status)).translate(['a'], ptBR, en), (err: TranslationProviderError) => err.reason === reason && !err.message.includes('SECRET'));
    await assert.rejects(router(() => json({}, status)).translate(['a'], ptBR, en), (err: TranslationProviderError) => err.reason === reason);
  }
  const down = gemini(() => {
    throw new Error('offline');
  });
  await assert.rejects(down.translate(['a'], ptBR, en), (err: TranslationProviderError) => err.reason === 'unreachable');
});

test('OpenRouter: bearer key, fenced answer accepted', async () => {
  let auth = '';
  const translator = router((_url, init) => {
    auth = (init.headers as Record<string, string>)['Authorization'] as string;
    return routerAnswer(['A', 'B'], true);
  });
  assert.deepEqual(await translator.translate(['a', 'b'], ptBR, en), ['A', 'B']);
  assert.equal(auth, 'Bearer SECRET');
});

test('FallbackTranslator moves to the next provider and reports who served', async () => {
  const quota: Translator = {
    translate: async () => {
      throw new TranslationProviderError('DeepL', 'quota', 'used up');
    },
  };
  const ok: Translator = { translate: async (texts) => texts.map((text) => `PT ${text}`) };
  const chain = new FallbackTranslator(
    [
      { name: 'DeepL', translator: quota },
      { name: 'Gemini', translator: ok },
    ],
    logger,
  );
  const served: string[] = [];
  assert.deepEqual(await chain.translate(['a'], ptBR, en, (name) => served.push(name)), ['PT a']);
  assert.deepEqual(served, ['Gemini']);
  const none = new FallbackTranslator([{ name: 'DeepL', translator: quota }], logger);
  await assert.rejects(none.translate(['a'], ptBR, en), /used up/);
});

test('QuotaGuard refuses a request the quota cannot finish and lets the rest through', async () => {
  const inner: Translator = { translate: async (texts) => texts };
  const guard = (left: number | undefined) => new QuotaGuard(inner, 'DeepL', async () => left);
  await assert.rejects(guard(3).translate(['hello'], ptBR, en), (err: TranslationProviderError) => err.reason === 'quota');
  assert.deepEqual(await guard(5).translate(['hello'], ptBR, en), ['hello']);
  assert.deepEqual(await guard(undefined).translate(['hello'], ptBR, en), ['hello']);
});

test('the AI notice names the provider that translated', () => {
  assert.match(noticeText(ptBR), /DeepL/);
  assert.match(noticeText(ptBR, false, ['Gemini']), /\(Gemini\)/);
  assert.match(noticeText(ptBR, true, ['DeepL', 'Gemini']), /DeepL \+ Gemini/);
});

test('OpenRouter usage: the free tier shows requests today; a paid key has no daily cap', async () => {
  const key = (body: unknown, status = 200) => ({ apiKey: 'SECRET', timeoutMs: 1000, fetch: fakeFetch(() => json(body, status)) });
  assert.deepEqual(
    await openRouterUsage(key({ data: { is_free_tier: true, free_model_daily_requests: { used: 12, limit: 50, remaining: 38 } } })),
    { used: 12, limit: 50 },
  );
  assert.equal(await openRouterUsage(key({ data: { is_free_tier: false } })), undefined);
  await assert.rejects(openRouterUsage(key({}, 401)), /401/);
  await assert.rejects(openRouterUsage(key({ data: { is_free_tier: true } })), /unexpected/);
});

test('a request that went through tells the quota reader to look again', async () => {
  let calls = 0;
  const translator = new GeminiTranslator({ apiKey: 'SECRET', models: ['m'], timeoutMs: 1000, fetch: fakeFetch(() => geminiAnswer(['A'])), onRequest: () => calls++ });
  await translator.translate(['a'], ptBR, en);
  assert.equal(calls, 1);
});

test('a busy server (503) is asked again after a wait; quota and key errors are not', async () => {
  const waits: number[] = [];
  let calls = 0;
  const translator = new GeminiTranslator({
    apiKey: 'SECRET',
    models: ['m'],
    timeoutMs: 1000,
    fetch: fakeFetch(() => (++calls < 3 ? json({}, 503) : geminiAnswer(['A']))),
    sleep: async (ms) => void waits.push(ms),
  });
  assert.deepEqual(await translator.translate(['a'], ptBR, en), ['A']);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 5000]);

  // Never recovers: gives up after the last wait, as unreachable (the chain moves on).
  calls = 0;
  const down = gemini(() => (calls++, json({}, 503)));
  await assert.rejects(down.translate(['a'], ptBR, en), (err: TranslationProviderError) => err.reason === 'unreachable' && /503/.test(err.message));
  assert.equal(calls, 4);

  // 429 and 401 answer at once.
  for (const status of [429, 401]) {
    calls = 0;
    await assert.rejects(gemini(() => (calls++, json({}, status))).translate(['a'], ptBR, en));
    assert.equal(calls, 1);
  }
});

test('an answer that is not JSON says what it started with; an error inside a 200 is treated by its code', async () => {
  await assert.rejects(
    router(() => new Response('<html>Bad gateway</html>', { status: 200 })).translate(['a'], ptBR, en),
    (err: TranslationProviderError) => err.reason === 'bad_response' && /24 characters, starts with "<html>Bad gateway<\/html>"/.test(err.message),
  );
  await assert.rejects(router(() => new Response('', { status: 200 })).translate(['a'], ptBR, en), /0 characters/);
  // { error: { code: 429 } } in a 200: quota, not a bad answer.
  await assert.rejects(
    router(() => json({ error: { code: 429, message: 'rate limited' } })).translate(['a'], ptBR, en),
    (err: TranslationProviderError) => err.reason === 'quota',
  );
  await assert.rejects(
    router(() => json({ error: { code: 502, message: 'provider returned error' } })).translate(['a'], ptBR, en),
    (err: TranslationProviderError) => err.reason === 'unreachable' && /502/.test(err.message),
  );
});

test('a refusal carries the reason the service gave, so the log says which quota it was', async () => {
  const body = { error: { code: 429, message: 'Quota exceeded for metric generate_content_free_tier_requests, limit: 5 per minute' } };
  await assert.rejects(
    gemini(() => json(body, 429)).translate(['a'], ptBR, en),
    (err: TranslationProviderError) => err.reason === 'quota' && /429\): Quota exceeded .* 5 per minute/.test(err.message),
  );
  await assert.rejects(gemini(() => new Response('not json', { status: 401 })).translate(['a'], ptBR, en), (err: TranslationProviderError) => err.reason === 'key' && !/:/.test(err.message.split('(401)')[1] ?? ''));
});

test('OpenRouter: an empty answer says which model gave it and why it is empty', async () => {
  const empty = json({ model: 'some/free-model:free', choices: [{ finish_reason: 'length', message: { content: null, reasoning: 'thinking…' } }] });
  await assert.rejects(
    router(() => empty).translate(['a'], ptBR, en),
    (err: TranslationProviderError) => err.reason === 'bad_response' && /some\/free-model:free, finish length, only reasoning/.test(err.message),
  );
});

test('OpenRouter is asked not to reason: it only makes a translation slower', async () => {
  let sent: { model?: string; reasoning?: unknown } = {};
  const translator = router((_url, init) => {
    sent = JSON.parse(init.body as string) as typeof sent;
    return routerAnswer(['A']);
  });
  await translator.translate(['a'], ptBR, en);
  assert.deepEqual(sent.reasoning, { enabled: false });
  assert.equal(sent.model, 'm');
});

/** A Gemini translator with a list of models, recording which model each request went to. */
function geminiModels(models: string[], handler: (model: string, body: Record<string, any>) => Response) {
  const asked: string[] = [];
  const waits: number[] = [];
  const bodies: Record<string, any>[] = [];
  const translator = new GeminiTranslator({
    apiKey: 'SECRET',
    models,
    timeoutMs: 1000,
    fetch: fakeFetch((url, init) => {
      const model = /models\/([^:]+):/.exec(url)?.[1] as string;
      const body = JSON.parse(init.body as string) as Record<string, any>;
      asked.push(model);
      bodies.push(body);
      return handler(model, body);
    }),
    sleep: async (ms) => void waits.push(ms),
  });
  return { translator, asked, waits, bodies };
}

test('Gemini: a busy or out-of-quota model hands the request to the next one at once, without waiting', async () => {
  const busy = geminiModels(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'], (model) => (model === 'gemini-3.5-flash-lite' ? json({}, 503) : geminiAnswer(['A'])));
  assert.deepEqual(await busy.translator.translate(['a'], ptBR, en), ['A']);
  assert.deepEqual(busy.asked, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  assert.deepEqual(busy.waits, []);

  const quota = geminiModels(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'], (model) => (model === 'gemini-3.5-flash-lite' ? json({}, 429) : geminiAnswer(['A'])));
  assert.deepEqual(await quota.translator.translate(['a'], ptBR, en), ['A']);
  assert.deepEqual(quota.asked, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
});

test('Gemini: when every model is busy the round is repeated after a wait; when every one is out of quota it fails at once', async () => {
  let calls = 0;
  const recovering = geminiModels(['one', 'two'], () => (++calls < 4 ? json({}, 503) : geminiAnswer(['A'])));
  assert.deepEqual(await recovering.translator.translate(['a'], ptBR, en), ['A']);
  assert.deepEqual(recovering.asked, ['one', 'two', 'one', 'two']);
  assert.deepEqual(recovering.waits, [2000]);

  const down = geminiModels(['one', 'two'], () => json({}, 503));
  await assert.rejects(down.translator.translate(['a'], ptBR, en), (err: TranslationProviderError) => err.reason === 'unreachable' && /\[two\]/.test(err.message));
  assert.equal(down.asked.length, 8, 'two models, four rounds');
  assert.deepEqual(down.waits, [2000, 5000, 10_000]);

  const noQuota = geminiModels(['one', 'two'], () => json({}, 429));
  await assert.rejects(noQuota.translator.translate(['a'], ptBR, en), (err: TranslationProviderError) => err.reason === 'quota');
  assert.deepEqual(noQuota.asked, ['one', 'two']);
  assert.deepEqual(noQuota.waits, []);

  // A rejected key does not try the other model: it would be rejected too.
  const badKey = geminiModels(['one', 'two'], () => json({}, 403));
  await assert.rejects(badKey.translator.translate(['a'], ptBR, en), (err: TranslationProviderError) => err.reason === 'key');
  assert.deepEqual(badKey.asked, ['one']);
});

test('Gemini 3 models are asked for minimal thinking; older ones are left alone (they refuse the level)', async () => {
  const three = geminiModels(['gemini-3.5-flash-lite'], () => geminiAnswer(['A']));
  await three.translator.translate(['a'], ptBR, en);
  assert.deepEqual(three.bodies[0]?.['generationConfig'].thinkingConfig, { thinkingLevel: 'minimal' });
  const older = geminiModels(['gemini-2.5-flash'], () => geminiAnswer(['A']));
  await older.translator.translate(['a'], ptBR, en);
  assert.equal(older.bodies[0]?.['generationConfig'].thinkingConfig, undefined);
});

test('Gemini: a timeout hands over to the next model, but is not repeated after a wait', async () => {
  const asked: string[] = [];
  const waits: number[] = [];
  const make = (silentModels: string[]) =>
    new GeminiTranslator({
      apiKey: 'SECRET',
      models: ['one', 'two'],
      timeoutMs: 1000,
      fetch: (async (url: string) => {
        const model = /models\/([^:]+):/.exec(url)?.[1] as string;
        asked.push(model);
        if (silentModels.includes(model)) throw new Error('The operation was aborted due to timeout');
        return geminiAnswer(['A']);
      }) as typeof fetch,
      sleep: async (ms) => void waits.push(ms),
    });
  assert.deepEqual(await make(['one']).translate(['a'], ptBR, en), ['A']);
  assert.deepEqual(asked, ['one', 'two']);
  asked.length = 0;
  await assert.rejects(make(['one', 'two']).translate(['a'], ptBR, en), (err: TranslationProviderError) => err.reason === 'unreachable' && /timeout \[two\]/.test(err.message));
  assert.deepEqual(asked, ['one', 'two']);
  assert.deepEqual(waits, []);
});
