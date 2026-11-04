import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogger } from '../src/logger.ts';
import { RealDebridSource } from '../src/streams/realdebrid.ts';

// Real shape of /downloads (The Invite, 2026-10-31): the entry appears once the stream is clicked.
const invite = {
  id: 'D4',
  filename: 'The.Invite.2026.REMUX.mkv',
  mimeType: 'video/x-matroska',
  filesize: 26_762_682_750,
  link: 'https://real-debrid.com/d/SECRETLINK',
  host: 'real-debrid.com',
  chunks: 32,
  download: 'https://abc.download.real-debrid.com/d/SECRETDL/The.Invite.2026.REMUX.mkv',
  streamable: 1,
  generated: '2026-10-31T19:12:37.000Z',
};
const other = { ...invite, id: 'D1', filename: 'Drive.2011.2160p.mkv', filesize: 23_576_705_373, download: 'https://abc.download.real-debrid.com/d/OTHER/Drive.mkv' };

function rd(answer: () => Response | Promise<Response>) {
  const lines: string[] = [];
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), headers: init.headers as Record<string, string> });
    return answer();
  }) as typeof globalThis.fetch;
  const source = new RealDebridSource({ token: 'TOKEN123', lookback: 20, timeoutMs: 1000, fetch, logger: createLogger('debug', (line) => lines.push(line)), version: '0.1.0' });
  return { source, lines, calls };
}

test('finds the played file in the download history by name and size', async () => {
  const { source, calls } = rd(() => Response.json([invite, other]));
  const file = await source.locate({ filename: 'the.invite.2026.remux.mkv', videoSize: 26_762_682_750 });
  assert.deepEqual(file, { url: invite.download, videoSize: 26_762_682_750, source: 'realdebrid' });
  assert.equal(calls[0]?.url, 'https://api.real-debrid.com/rest/1.0/downloads?limit=20');
  assert.equal(calls[0]?.headers['Authorization'], 'Bearer TOKEN123');
});

test('the same name with another size is another release', async () => {
  const { source } = rd(() => Response.json([invite]));
  assert.equal(await source.locate({ filename: invite.filename, videoSize: 1_000 }), undefined);
  assert.equal((await source.locate({ filename: invite.filename }))?.url, invite.download, 'without a size, the name is enough');
});

test('a file not clicked yet is not there', async () => {
  const { source } = rd(() => Response.json([other]));
  assert.equal(await source.locate({ filename: invite.filename, videoSize: invite.filesize }), undefined);
  const empty = rd(() => new Response(null, { status: 204 }));
  assert.equal(await empty.source.locate({ filename: invite.filename }), undefined);
});

test('a rejected token is reported once and the source stops asking', async () => {
  const { source, lines, calls } = rd(() => new Response('', { status: 401 }));
  assert.equal(await source.locate({ filename: invite.filename }), undefined);
  assert.equal(await source.locate({ filename: invite.filename }), undefined);
  assert.equal(calls.length, 1);
  assert.equal(lines.filter((line) => line.includes('realdebrid.token_rejected') && line.includes('RD_TOKEN')).length, 1);
  assert.ok(lines.every((line) => !line.includes('TOKEN123')));
});

test('other failures are errors, for the locator to pass to the next source', async () => {
  await assert.rejects(rd(() => new Response('', { status: 503 })).source.locate({ filename: invite.filename }), /HTTP 503/);
  await assert.rejects(rd(() => Response.json({ error: 'x' })).source.locate({ filename: invite.filename }), /inesperada/);
});
