import { mkdir, readdir, rm, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface SweepOptions {
  maxBytes: number;
  maxAgeMs: number;
  now?: number;
}

export interface SweepResult {
  removedFiles: number;
  freedBytes: number;
  remainingBytes: number;
}

interface FileEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * Enforces the cache limits: deletes files older than `maxAgeMs`, then the
 * least recently used ones (by mtime — the cache touches files on every hit)
 * until the directory fits in `maxBytes`. Empty subdirectories are removed.
 */
export async function sweepDir(dir: string, { maxBytes, maxAgeMs, now = Date.now() }: SweepOptions): Promise<SweepResult> {
  // Oldest first: expired files come first, and the first file that is neither
  // expired nor needed to get under the limit ends the sweep.
  const files = (await listFiles(dir)).sort((a, b) => a.mtimeMs - b.mtimeMs);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  let removedFiles = 0;
  let freedBytes = 0;

  for (const file of files) {
    const expired = now - file.mtimeMs > maxAgeMs;
    if (!expired && total <= maxBytes) break;
    await rm(file.path, { force: true });
    total -= file.size;
    freedBytes += file.size;
    removedFiles += 1;
  }
  await removeEmptyDirs(dir, false);
  return { removedFiles, freedBytes, remainingBytes: total };
}

/** Deletes everything inside `dir` (creating it if needed). */
export async function emptyDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

async function listFiles(dir: string): Promise<FileEntry[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const nested = await Promise.all(
    entries.map(async (entry): Promise<FileEntry[]> => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(path);
      if (!entry.isFile()) return [];
      const info = await stat(path);
      return [{ path, size: info.size, mtimeMs: info.mtimeMs }];
    }),
  );
  return nested.flat();
}

async function removeEmptyDirs(dir: string, removeSelf: boolean): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await removeEmptyDirs(join(dir, entry.name), true);
  }
  if (removeSelf && (await readdir(dir)).length === 0) await rmdir(dir);
}
