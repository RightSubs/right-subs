import type { SubtitleCache } from '../subtitles/cache.ts';

/**
 * Google's day for a free key ends at midnight Pacific time. `Intl` may lack the zone on a
 * stripped Node build: UTC then, which is off by a few hours at worst.
 */
export function quotaDay(now: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Counts the requests the addon made today to a service that reports no usage of its own
 * (Gemini). It is an **estimate**: it only sees this device's requests, not other apps using
 * the same key. Kept on disk (the subtitle cache), so a restart does not forget it; the
 * previous days' counters age out with the cache.
 */
export class DailyCount {
  #cache: SubtitleCache;
  #name: string;
  #now: () => Date;
  #loaded: Promise<{ day: string; count: number }> | undefined;
  #writing: Promise<void> = Promise.resolve();

  constructor(cache: SubtitleCache, name: string, now: () => Date = () => new Date()) {
    this.#cache = cache;
    this.#name = name;
    this.#now = now;
  }

  /** Requests made today. */
  async get(): Promise<number> {
    return (await this.#today()).count;
  }

  /** One more request (called after each request that reached the service). */
  async increment(): Promise<void> {
    const today = await this.#today();
    today.count += 1;
    const key = this.#key(today.day);
    const data = Buffer.from(String(today.count), 'utf8');
    // Writes go one after the other, so the last count is the one left on disk.
    this.#writing = this.#writing.then(() => this.#cache.put(key, data)).catch(() => undefined);
    await this.#writing;
  }

  async #today(): Promise<{ day: string; count: number }> {
    const day = quotaDay(this.#now());
    // One shared load per day: callers arriving together must update the same counter.
    let loaded = this.#loaded;
    if (!loaded || (await loaded).day !== day) {
      loaded = this.#cache.get(this.#key(day)).then((data) => {
        const stored = Number(data?.toString('utf8'));
        return { day, count: Number.isInteger(stored) && stored > 0 ? stored : 0 };
      });
      this.#loaded = loaded;
    }
    return loaded;
  }

  #key(day: string): string {
    return `requests:${this.#name}:${day}`;
  }
}
