import { createHash } from 'node:crypto';
import { access, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Ready-to-serve SRT files on disk. Every hit refreshes the file's mtime:
 * the janitor (resources/janitor.ts) expires and evicts by mtime.
 */
export class SubtitleCache {
  #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async get(key: string): Promise<Buffer | undefined> {
    const path = this.#path(key);
    try {
      const data = await readFile(path);
      const now = new Date();
      await utimes(path, now, now);
      return data;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  /** Whether the file is cached, without counting as a use. */
  async has(key: string): Promise<boolean> {
    return access(this.#path(key)).then(
      () => true,
      () => false,
    );
  }

  async put(key: string, data: Buffer): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    await writeFile(this.#path(key), data);
  }

  #path(key: string): string {
    return join(this.#dir, `${createHash('sha1').update(key).digest('hex')}.srt`);
  }
}
