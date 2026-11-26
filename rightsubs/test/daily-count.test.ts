import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SubtitleCache } from '../src/subtitles/cache.ts';
import { DailyCount, quotaDay } from '../src/translation/daily-count.ts';

const cache = () => new SubtitleCache(mkdtempSync(join(tmpdir(), 'rightsubs-count-')));

test('the quota day follows Pacific time, not UTC', () => {
  assert.equal(quotaDay(new Date('2026-11-25T07:59:00Z')), '2026-11-24'); // 23:59 in Los Angeles
  assert.equal(quotaDay(new Date('2026-11-25T08:01:00Z')), '2026-11-25');
});

test('counts requests, keeps them across a restart and starts over on a new day', async () => {
  const store = cache();
  let now = new Date('2026-11-25T20:00:00Z');
  const first = new DailyCount(store, 'gemini', () => now);
  assert.equal(await first.get(), 0);
  await first.increment();
  await first.increment();
  assert.equal(await first.get(), 2);
  // A new process reads what was left on disk.
  const restarted = new DailyCount(store, 'gemini', () => now);
  assert.equal(await restarted.get(), 2);
  await restarted.increment();
  assert.equal(await restarted.get(), 3);
  // After midnight in Los Angeles the count starts again.
  now = new Date('2026-11-26T09:00:00Z');
  assert.equal(await restarted.get(), 0);
  // Another service has its own counter.
  assert.equal(await new DailyCount(store, 'other', () => now).get(), 0);
});

test('concurrent requests are all counted', async () => {
  const count = new DailyCount(cache(), 'gemini');
  await Promise.all(Array.from({ length: 10 }, () => count.increment()));
  assert.equal(await count.get(), 10);
});
