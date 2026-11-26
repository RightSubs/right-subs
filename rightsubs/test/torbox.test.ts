import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogger } from '../src/logger.ts';
import { TorBoxSource } from '../src/streams/torbox.ts';

// Real shape of /torrents/mylist (2026-11-25): `name` carries the folder, `short_name` does not.
const movie = {
  id: 77,
  name: 'The.Invite.2026',
  files: [
    { id: 1, name: 'The.Invite.2026/Sample/sample.mkv', short_name: 'sample.mkv', size: 50_000_000 },
    { id: 2, name: 'The.Invite.2026/The.Invite.2026.REMUX.mkv', short_name: 'The.Invite.2026.REMUX.mkv', size: 26_762_682_750 },
  ],
};
const other = { id: 5, name: 'Drive', files: [{ id: 9, name: 'Drive/Drive.2011.mkv', short_name: 'Drive.2011.mkv', size: 23_576_705_373 }] };
const DIRECT = 'https://store-1.example-cdn.tb/dld/abc?token=ACCOUNTSECRET';

function torbox(list: () => Response | Promise<Response> = () => Response.json({ success: true, data: [other, movie] })) {
  const lines: string[] = [];
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
    return url.includes('/requestdl') ? Response.json({ success: true, data: DIRECT }) : list();
  }) as typeof globalThis.fetch;
  const source = new TorBoxSource({ token: 'TBTOKEN123', lookback: 20, timeoutMs: 1000, fetch, logger: createLogger('debug', (line) => lines.push(line)), version: '0.1.0' });
  return { source, lines, calls };
}

test('finds the played file by name and size and asks for its direct link', async () => {
  const { source, calls } = torbox();
  const file = await source.locate({ filename: 'the.invite.2026.remux.mkv', videoSize: 26_762_682_750 });
  assert.deepEqual(file, { url: DIRECT, videoSize: 26_762_682_750, source: 'torbox' });
  assert.equal(calls[0]?.url, 'https://api.torbox.app/v1/api/torrents/mylist?limit=20');
  assert.equal(calls[0]?.headers['Authorization'], 'Bearer TBTOKEN123');
  assert.equal(calls[1]?.url, 'https://api.torbox.app/v1/api/torrents/requestdl?token=TBTOKEN123&torrent_id=77&file_id=2&zip_link=false');
});

test('the same name with another size is another release; without a size the name is enough', async () => {
  const { source, calls } = torbox();
  assert.equal(await source.locate({ filename: 'The.Invite.2026.REMUX.mkv', videoSize: 1_000 }), undefined);
  assert.equal(calls.length, 1, 'no link is asked for a file that is not the one');
  assert.equal((await source.locate({ filename: 'The.Invite.2026.REMUX.mkv' }))?.url, DIRECT);
});

test('a file that is not in the account, or an empty account, is not found', async () => {
  assert.equal(await torbox(() => Response.json({ success: true, data: [other] })).source.locate({ filename: 'The.Invite.2026.REMUX.mkv' }), undefined);
  assert.equal(await torbox(() => Response.json({ success: true, data: null })).source.locate({ filename: 'x.mkv' }), undefined);
});

test('a rejected token is reported once and the source stops asking, never printing the token', async () => {
  const { source, lines, calls } = torbox(() => new Response('', { status: 403 }));
  assert.equal(await source.locate({ filename: 'x.mkv' }), undefined);
  assert.equal(await source.locate({ filename: 'x.mkv' }), undefined);
  assert.equal(calls.length, 1);
  assert.equal(lines.filter((line) => line.includes('torbox.token_rejected') && line.includes('TORBOX_TOKEN')).length, 1);
  assert.ok(lines.every((line) => !line.includes('TBTOKEN123')));
});

test('a server error is reported to the locator, which tries the next source', async () => {
  const { source } = torbox(() => new Response('', { status: 502 }));
  await assert.rejects(source.locate({ filename: 'x.mkv' }), /HTTP 502/);
});
