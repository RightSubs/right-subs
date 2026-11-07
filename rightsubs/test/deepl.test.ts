import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findLanguage, type Language } from '../src/languages/languages.ts';
import { DeepL, deeplSource, deeplTarget, translateCues } from '../src/translation/deepl.ts';

const ptBR = findLanguage('pt-BR') as Language;
const en = findLanguage('en') as Language;

function api(handler: (body: { text: string[] }, call: number) => { status?: number; texts?: string[]; headers?: Record<string, string> }) {
  const requests: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
  const fetchDouble = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { text: string[] };
    requests.push({ url, auth: new Headers(init.headers).get('authorization'), body });
    const reply = handler(body, requests.length);
    return new Response(JSON.stringify({ translations: (reply.texts ?? body.text.map((t) => `PT ${t}`)).map((text) => ({ text })) }), {
      status: reply.status ?? 200,
      headers: reply.headers ?? {},
    });
  }) as unknown as typeof fetch;
  return { requests, fetch: fetchDouble };
}

test('language codes follow DeepL (variants only for the target)', () => {
  assert.equal(deeplTarget(ptBR), 'PT-BR');
  assert.equal(deeplTarget(en), 'EN-US');
  assert.equal(deeplSource(ptBR), 'PT');
  assert.equal(deeplTarget(findLanguage('zh-CN') as Language), 'ZH-HANS');
});

test('free keys use the free host; the key goes in the header only', async () => {
  const free = api(() => ({}));
  await new DeepL({ apiKey: 'abc:fx', timeoutMs: 1000, fetch: free.fetch }).translate(['Hi'], ptBR, en);
  assert.equal(free.requests[0]?.url, 'https://api-free.deepl.com/v2/translate');
  assert.equal(free.requests[0]?.auth, 'DeepL-Auth-Key abc:fx');
  assert.ok(!JSON.stringify(free.requests[0]?.body).includes('abc'));
  const paid = api(() => ({}));
  await new DeepL({ apiKey: 'abc', timeoutMs: 1000, fetch: paid.fetch }).translate(['Hi'], ptBR, en);
  assert.equal(paid.requests[0]?.url, 'https://api.deepl.com/v2/translate');
});

test('splits into requests of at most 50 texts and keeps the order', async () => {
  const double = api(() => ({}));
  const texts = Array.from({ length: 120 }, (_, i) => `line ${i}`);
  const out = await new DeepL({ apiKey: 'k:fx', timeoutMs: 1000, fetch: double.fetch }).translate(texts, ptBR, en);
  assert.deepEqual(double.requests.map((r) => (r.body['text'] as string[]).length), [50, 50, 20]);
  assert.equal(out[119], 'PT line 119');
});

test('quota, key and retry-after errors', async () => {
  const make = (status: number, extra: Record<string, string> = {}) => {
    let calls = 0;
    const double = api(() => ((calls += 1), { status, headers: extra, texts: [] }));
    return { calls: () => calls, deepl: new DeepL({ apiKey: 'k', timeoutMs: 1000, fetch: double.fetch, sleep: async () => {} }) };
  };
  await assert.rejects(make(456).deepl.translate(['a'], ptBR, en), /cota mensal/);
  await assert.rejects(make(403).deepl.translate(['a'], ptBR, en), /chave do DeepL recusada/);
  const limited = make(429, { 'retry-after': '1' });
  await assert.rejects(limited.deepl.translate(['a'], ptBR, en), /429/);
  assert.equal(limited.calls(), 2, 'one retry');
});

test('counts billed characters', async () => {
  let billed = 0;
  const double = api(() => ({}));
  await new DeepL({ apiKey: 'k', timeoutMs: 1000, fetch: double.fetch, onCharacters: (n) => (billed += n) }).translate(['abc', 'de'], ptBR, en);
  assert.equal(billed, 5);
});

test('translateCues keeps the timing, sends repeated lines once and drops ASS overrides', async () => {
  const sent: string[][] = [];
  const translator = {
    translate: async (texts: string[]) => {
      sent.push(texts);
      return texts.map((t) => t.toUpperCase());
    },
  };
  const cues = [
    { startMs: 1000, endMs: 2000, text: '{\\an8}Yes.' },
    { startMs: 3000, endMs: 4000, text: 'Yes.' },
    { startMs: 5000, endMs: 6000, text: 'No\nway' },
  ];
  const { cues: out, characters } = await translateCues(translator, cues, ptBR, en);
  assert.deepEqual(sent, [['Yes.', 'No\nway']]);
  assert.deepEqual(out.map((c) => [c.startMs, c.text]), [[1000, 'YES.'], [3000, 'YES.'], [5000, 'NO\nWAY']]);
  assert.equal(characters, 10);
});

test('translateCues drops <font> tags, so the player applies the viewer\'s own subtitle style', async () => {
  const sent: string[][] = [];
  const translator = {
    translate: async (texts: string[]) => {
      sent.push(texts);
      return texts.map((t) => t.toUpperCase());
    },
  };
  const cues = [
    { startMs: 1000, endMs: 2000, text: '<font color="#FFFFFF">Hallo.</font>' },
    { startMs: 3000, endMs: 4000, text: '<FONT face="x" color="#ffff00"><i>Nein</i>\nweg</FONT>' },
  ];
  const { cues: out } = await translateCues(translator, cues, ptBR, en);
  assert.deepEqual(sent, [['Hallo.', '<i>Nein</i>\nweg']], 'italics stay, colour goes');
  assert.deepEqual(out.map((c) => c.text), ['HALLO.', '<I>NEIN</I>\nWEG']);
});

test('many batches are translated a few at a time and come back in order', async () => {
  let inFlight = 0;
  let peak = 0;
  const calls: number[] = [];
  const slow = {
    fetch: async (_url: unknown, init: { body: string }) => {
      const { text } = JSON.parse(init.body) as { text: string[] };
      calls.push(Number(text[0]));
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return new Response(JSON.stringify({ translations: text.map((t) => ({ text: `PT ${t}` })) }), { status: 200 });
    },
  };
  // 12 batches of 50 texts (the API's limit per request).
  const texts = Array.from({ length: 600 }, (_, i) => String(i));
  const out = await new DeepL({ apiKey: 'k', timeoutMs: 1000, fetch: slow.fetch as unknown as typeof fetch }).translate(texts, ptBR, en);
  assert.deepEqual(out, texts.map((t) => `PT ${t}`), 'order kept');
  assert.ok(peak > 1 && peak <= 4, `peak ${peak}`);
});
