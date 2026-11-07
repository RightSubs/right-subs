/** Runs at most `max` tasks at a time (resources.maxConcurrentJobs); the rest wait in order. */
export class Limiter {
  #max: number;
  #running = 0;
  #queue: (() => void)[] = [];

  constructor(max: number) {
    this.#max = max;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#running >= this.#max) await new Promise<void>((resolve) => this.#queue.push(resolve));
    this.#running += 1;
    try {
      return await task();
    } finally {
      this.#running -= 1;
      this.#queue.shift()?.();
    }
  }
}
