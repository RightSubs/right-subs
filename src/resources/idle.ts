import type { Logger } from '../logger.ts';

/** sysexits EX_TEMPFAIL: asks scripts/rightsubs.sh for a quick, clean restart. */
export const EXIT_CLEAN_RESTART = 75;

export interface IdleMonitorOptions {
  idleAfterMs: number;
  /** Above this resident memory once idle, the process restarts to hand memory back to the OS. */
  maxIdleMemoryMB: number;
  logger: Logger;
  /** Releases everything that is only useful while Stremio is in use. */
  onIdle: () => Promise<void>;
  requestRestart: (code: number) => void;
  memoryMB?: () => number;
  gc?: () => void;
}

export type IdleState = 'active' | 'idle';

/**
 * Tracks whether Stremio is using the addon. No timers run while idle: the only
 * timer is armed by activity and fires once, when the last activity is
 * `idleAfterMs` old and no job is running.
 */
export class IdleMonitor {
  #options: IdleMonitorOptions;
  #state: IdleState = 'idle';
  #jobs = 0;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: IdleMonitorOptions) {
    this.#options = options;
  }

  get state(): IdleState {
    return this.#state;
  }

  /** Records activity (every HTTP request). */
  touch(): void {
    if (this.#state === 'idle') {
      this.#state = 'active';
      this.#options.logger.info('resources.active', { rssMB: this.#memoryMB() });
    }
    this.#arm();
  }

  /** Marks a long-running job; the process cannot go idle until the returned function is called. */
  beginJob(): () => void {
    this.#jobs += 1;
    this.touch();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.#jobs -= 1;
      this.#arm();
    };
  }

  stop(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #arm(): void {
    clearTimeout(this.#timer);
    if (this.#jobs > 0) {
      this.#timer = undefined;
      return;
    }
    this.#timer = setTimeout(() => void this.#enterIdle(), this.#options.idleAfterMs);
    this.#timer.unref();
  }

  async #enterIdle(): Promise<void> {
    this.#timer = undefined;
    const { logger, onIdle, gc, maxIdleMemoryMB, requestRestart } = this.#options;
    this.#state = 'idle';
    try {
      await onIdle();
    } catch (err) {
      logger.warn('resources.cleanup_failed', { message: (err as Error).message });
    }
    gc?.();
    const rssMB = this.#memoryMB();
    // Activity may have resumed while cleaning up.
    if (this.#state !== 'idle') return;
    logger.info('resources.idle', { rssMB });
    if (rssMB > maxIdleMemoryMB) {
      logger.info('resources.restart', { rssMB, maxIdleMemoryMB, reason: 'devolver memória ao sistema' });
      requestRestart(EXIT_CLEAN_RESTART);
    }
  }

  #memoryMB(): number {
    return this.#options.memoryMB?.() ?? Math.round(process.memoryUsage().rss / 1024 / 1024);
  }
}
