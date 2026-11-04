import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StremioServerSource } from '../src/streams/stremio.ts';

// Real shape of /stats.json (box, 2026-11-01, Ted Lasso by torrent without Real-Debrid), trimmed.
const HASH = '62215a155b82e43f16c6d5d04651eff5bdc5d514';
const NAME = 'Ted Lasso S04E04 2160p ATVP WEB-DL DDP5 1 Atmos DV HDR H 265 DUAL-BiOMA.mkv';
const stats = {
  [HASH]: {
    infoHash: HASH,
    name: `www.UIndex.org    -    ${NAME.replace(/\.mkv$/, '')}`,
    peers: 13,
    files: [
      { path: `x/${NAME}`, name: NAME, length: 8_476_578_524, offset: 0 },
      { path: `x/${NAME}.nfo`, name: `${NAME}.nfo`, length: 4_000, offset: 8_476_578_524 },
    ],
    downloaded: 71_030_926,
  },
};

function server(answer: () => Response | Promise<Response>) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL) => {
    calls.push(String(input));
    return answer();
  }) as typeof globalThis.fetch;
  return { source: new StremioServerSource({ url: 'http://127.0.0.1:11470/', timeoutMs: 1000, fetch }), calls };
}

test('finds the torrent being played by file name and size', async () => {
  const { source, calls } = server(() => Response.json(stats));
  const file = await source.locate({ filename: NAME.toLowerCase(), videoSize: 8_476_578_524 });
  assert.deepEqual(file, { url: `http://127.0.0.1:11470/${HASH}/0`, source: 'stremio', peerToPeer: true, videoSize: 8_476_578_524 });
  assert.deepEqual(calls, ['http://127.0.0.1:11470/stats.json']);
});

test('another size, another file or no torrent playing is not found', async () => {
  const { source } = server(() => Response.json(stats));
  assert.equal(await source.locate({ filename: NAME, videoSize: 1_000 }), undefined);
  assert.equal(await source.locate({ filename: 'Other.mkv' }), undefined);
  assert.equal((await source.locate({ filename: NAME }))?.url, `http://127.0.0.1:11470/${HASH}/0`, 'without a size, the name is enough');
  assert.equal(await server(() => Response.json({})).source.locate({ filename: NAME }), undefined);
});

test('ignores malformed entries and reports a server error', async () => {
  const odd = server(() => Response.json({ x: { infoHash: '../etc', files: [{ name: NAME, length: 1 }] }, y: null }));
  assert.equal(await odd.source.locate({ filename: NAME }), undefined);
  await assert.rejects(server(() => new Response('', { status: 500 })).source.locate({ filename: NAME }), /HTTP 500/);
});
