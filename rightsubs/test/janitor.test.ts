import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { emptyDir, sweepDir } from '../src/resources/janitor.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 28);

/** Writes `bytes` to dir/name with an mtime `ageDays` before NOW. */
function file(dir: string, name: string, bytes: number, ageDays: number): string {
  const path = join(dir, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, Buffer.alloc(bytes));
  const time = new Date(NOW - ageDays * DAY);
  utimesSync(path, time, time);
  return path;
}

const tempDir = () => mkdtempSync(join(tmpdir(), 'rightsubs-janitor-'));

test('removes expired files even when under the size limit', async () => {
  const dir = tempDir();
  const old = file(dir, 'old.srt', 10, 31);
  const recent = file(dir, 'recent.srt', 10, 1);
  const result = await sweepDir(dir, { maxBytes: 1000, maxAgeMs: 30 * DAY, now: NOW });
  assert.deepEqual(result, { removedFiles: 1, freedBytes: 10, remainingBytes: 10 });
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(recent), true);
});

test('evicts least recently used files until under the size limit', async () => {
  const dir = tempDir();
  const a = file(dir, 'a.srt', 40, 3);
  const b = file(dir, 'b.srt', 40, 2);
  const c = file(dir, 'c.srt', 40, 1);
  const result = await sweepDir(dir, { maxBytes: 80, maxAgeMs: 30 * DAY, now: NOW });
  assert.deepEqual(result, { removedFiles: 1, freedBytes: 40, remainingBytes: 80 });
  assert.deepEqual([a, b, c].map(existsSync), [false, true, true]);
});

test('walks subdirectories and removes the ones left empty', async () => {
  const dir = tempDir();
  file(dir, 'tt0062622/pob.srt', 10, 40);
  file(dir, 'tt0903747/pob.srt', 10, 1);
  await sweepDir(dir, { maxBytes: 1000, maxAgeMs: 30 * DAY, now: NOW });
  assert.deepEqual(readdirSync(dir), ['tt0903747']);
});

test('treats a missing cache dir as empty', async () => {
  const result = await sweepDir(join(tempDir(), 'missing'), { maxBytes: 1, maxAgeMs: DAY, now: NOW });
  assert.deepEqual(result, { removedFiles: 0, freedBytes: 0, remainingBytes: 0 });
});

test('emptyDir wipes leftovers and leaves an empty directory', async () => {
  const dir = join(tempDir(), 'tmp');
  file(dir, 'audio/sample-1.pcm', 100, 0);
  await emptyDir(dir);
  assert.deepEqual(readdirSync(dir), []);
});
