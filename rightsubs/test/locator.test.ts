import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogger } from '../src/logger.ts';
import { FileLocator, type FileQuery, type FileSource, type PlayableFile } from '../src/streams/locator.ts';

function source(id: string, answer: (query: FileQuery) => PlayableFile | undefined | Promise<PlayableFile | undefined>) {
  const calls: FileQuery[] = [];
  const instance: FileSource = {
    id,
    locate: async (query) => {
      calls.push(query);
      return answer(query);
    },
  };
  return { instance, calls };
}

function locator(sources: FileSource[]) {
  const lines: string[] = [];
  return { instance: new FileLocator({ sources, logger: createLogger('debug', (line) => lines.push(line)) }), lines };
}

const valkyrie = { filename: 'Valkyrie.2008.2160p.mkv', videoSize: 9_000_000_000 };

test('without sources the addon is in light mode', async () => {
  const { instance } = locator([]);
  assert.equal(instance.enabled, false);
  assert.equal(await instance.locate(valkyrie), undefined);
});

test('asks the sources in order and the first answer wins', async () => {
  const proxy = source('proxy', () => undefined);
  const rd = source('realdebrid', () => ({ url: 'https://rd/valkyrie', source: 'realdebrid' }));
  const last = source('last', () => ({ url: 'https://other', source: 'last' }));
  const { instance, lines } = locator([proxy.instance, rd.instance, last.instance]);
  assert.equal((await instance.locate(valkyrie))?.url, 'https://rd/valkyrie');
  assert.equal(proxy.calls.length, 1);
  assert.equal(last.calls.length, 0);
  assert.ok(lines.some((line) => line.includes('file.located') && line.includes('"source":"realdebrid"')));
  assert.ok(lines.every((line) => !line.includes('https://')), 'never logs the URL');
});

test('a failing source passes to the next', async () => {
  const broken = source('broken', () => Promise.reject(new Error('HTTP 503')));
  const rd = source('realdebrid', () => ({ url: 'https://rd/valkyrie', source: 'realdebrid' }));
  const { instance, lines } = locator([broken.instance, rd.instance]);
  assert.equal((await instance.locate(valkyrie))?.source, 'realdebrid');
  assert.ok(lines.some((line) => line.includes('file.source_failed') && line.includes('HTTP 503')));
});

test('remembers hits, but asks again after a miss', async () => {
  // The first Stremio request can arrive before the file exists in the debrid account.
  let ready = false;
  const rd = source('realdebrid', () => (ready ? { url: 'https://rd/valkyrie', source: 'realdebrid' } : undefined));
  const { instance } = locator([rd.instance]);
  assert.equal(await instance.locate(valkyrie), undefined);
  ready = true;
  assert.equal((await instance.locate(valkyrie))?.url, 'https://rd/valkyrie');
  assert.equal((await instance.locate({ ...valkyrie, filename: valkyrie.filename.toUpperCase() }))?.url, 'https://rd/valkyrie');
  assert.equal(rd.calls.length, 2);
  assert.deepEqual(instance.status(), { sources: ['realdebrid'], known: 1, located: 1, notLocated: 1 });

  instance.release();
  await instance.locate(valkyrie);
  assert.equal(rd.calls.length, 3, 'released when idle');
});

test('simultaneous requests for the same file share one search', async () => {
  const rd = source('realdebrid', async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { url: 'https://rd/valkyrie', source: 'realdebrid' };
  });
  const { instance } = locator([rd.instance]);
  const [a, b] = await Promise.all([instance.locate(valkyrie), instance.locate(valkyrie)]);
  assert.equal(a, b);
  assert.equal(rd.calls.length, 1);
});
