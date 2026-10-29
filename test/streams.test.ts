import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogger } from '../src/logger.ts';
import { StreamProxy } from '../src/streams/proxy.ts';

const torrentio = {
  streams: [
    {
      name: 'Torrentio\n4k',
      title: 'Valkyrie.2008.2160p.mkv\n👤 12 💾 9 GB',
      url: 'https://torrentio.example/resolve/realdebrid/KEY/aaa/null/0/Valkyrie.2008.2160p.mkv',
      behaviorHints: { bingeGroup: 'torrentio|4k', filename: 'Valkyrie.2008.2160p.mkv', videoSize: 9_000_000_000 },
    },
    { name: 'Torrentio\n1080p', title: 'Valkyrie.2008.1080p.BluRay.mkv\n👤 30', url: 'https://torrentio.example/resolve/2' },
  ],
};
const sootio = { streams: [{ name: 'Sootio', description: 'Valkyrie.2008.2160p.mkv', url: 'https://sootio.example/play/3', behaviorHints: { videoSize: 8_000_000_000 } }] };

function proxy(routes: Record<string, () => Promise<Response> | Response>, timeoutMs = 1000) {
  const lines: string[] = [];
  const calls: string[] = [];
  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    calls.push(String(input));
    const route = Object.keys(routes).find((part) => String(input).includes(part));
    if (!route) return new Response('nope', { status: 404 });
    const answer = routes[route] as () => Promise<Response> | Response;
    return Promise.race([
      answer(),
      new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    ]);
  }) as typeof globalThis.fetch;
  const instance = new StreamProxy({
    indexers: [
      { id: 'torrentio', url: 'https://torrentio.example/rd=KEY/manifest.json', timeoutMs },
      { id: 'sootio', url: 'https://sootio.example/u/abc/manifest.json', timeoutMs },
    ],
    fetch,
    logger: createLogger('debug', (line) => lines.push(line)),
    version: '0.1.0',
  });
  return { instance, lines, calls };
}

test('returns every indexer list unchanged, in config order', async () => {
  const { instance, calls } = proxy({ 'torrentio.example': () => Response.json(torrentio), 'sootio.example': () => Response.json(sootio) });
  const { streams } = await instance.streams('series', 'tt26591147:2:12');
  assert.deepEqual(streams, [...torrentio.streams, ...sootio.streams]);
  assert.deepEqual(calls.sort(), [
    'https://sootio.example/u/abc/stream/series/tt26591147:2:12.json',
    'https://torrentio.example/rd=KEY/stream/series/tt26591147:2:12.json',
  ]);
});

test('a failing or slow indexer does not hide the other', async () => {
  const { instance, lines } = proxy(
    { 'torrentio.example': () => new Promise(() => {}), 'sootio.example': () => Response.json(sootio) },
    50,
  );
  assert.deepEqual((await instance.streams('movie', 'tt0985699')).streams, sootio.streams);
  assert.ok(lines.some((line) => line.includes('streams.indexer_failed') && line.includes('sem resposta em 50 ms')));

  const broken = proxy({ 'torrentio.example': () => new Response('x', { status: 500 }), 'sootio.example': () => Response.json({ nope: 1 }) });
  assert.deepEqual((await broken.instance.streams('movie', 'tt0985699')).streams, []);
});

test('remembers file name → URL, telling same-name files apart by size', async () => {
  const { instance } = proxy({ 'torrentio.example': () => Response.json(torrentio), 'sootio.example': () => Response.json(sootio) });
  await instance.streams('movie', 'tt0985699');
  assert.equal(instance.find('Valkyrie.2008.2160p.mkv', 9_000_000_000)?.indexer, 'torrentio');
  assert.equal(instance.find('valkyrie.2008.2160p.MKV', 8_000_000_000)?.url, 'https://sootio.example/play/3');
  assert.equal(instance.find('Valkyrie.2008.1080p.BluRay.mkv')?.url, 'https://torrentio.example/resolve/2', 'from the title line');
  assert.equal(instance.find('Other.mkv'), undefined);
  instance.release();
  assert.equal(instance.find('Valkyrie.2008.2160p.mkv'), undefined);
});

test('never logs stream URLs (they carry the Real-Debrid key)', async () => {
  const { instance, lines } = proxy({ 'torrentio.example': () => Response.json(torrentio), 'sootio.example': () => Response.json(sootio) });
  await instance.streams('movie', 'tt0985699');
  assert.ok(lines.length > 0);
  assert.ok(lines.every((line) => !line.includes('KEY') && !line.includes('resolve')));
});
