import { setPriority } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '../config/load.ts';
import type { Logger } from '../logger.ts';
import { IdleMonitor } from './idle.ts';
import { emptyDir, sweepDir, type SweepResult } from './janitor.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Niceness for the service and every ffmpeg it spawns: Stremio always gets the CPU first. */
const LOW_PRIORITY = 10;

export interface ResourceManager {
  idle: IdleMonitor;
  /** Registers something to release when the addon goes idle (in-memory caches, maps…). */
  onIdle(release: () => void | Promise<void>): void;
  /** Startup cleanup: leftovers from a previous run and cache limits. */
  cleanup(): Promise<void>;
  tmpDir: string;
  lastSweep(): SweepResult | undefined;
}

export interface ResourceDeps {
  config: AppConfig;
  logger: Logger;
  dataDir: string;
  requestRestart: (code: number) => void;
}

export function createResourceManager({ config, logger, dataDir, requestRestart }: ResourceDeps): ResourceManager {
  const { resources, cache } = config;
  const tmpDir = join(dataDir, 'tmp');
  const releasers: (() => void | Promise<void>)[] = [];
  let lastSweep: SweepResult | undefined;

  if (resources.lowPriority) {
    try {
      setPriority(LOW_PRIORITY);
    } catch (err) {
      logger.warn('resources.priority_failed', { message: (err as Error).message });
    }
  }

  const cleanup = async () => {
    await emptyDir(tmpDir);
    lastSweep = await sweepDir(cache.dir, { maxBytes: cache.maxSizeMB * 1024 * 1024, maxAgeMs: cache.maxAgeDays * DAY_MS });
    if (lastSweep.removedFiles > 0) logger.info('cache.swept', { ...lastSweep });
  };

  const idle = new IdleMonitor({
    idleAfterMs: resources.idleAfterMinutes * 60 * 1000,
    maxIdleMemoryMB: resources.maxIdleMemoryMB,
    logger,
    requestRestart,
    gc: (globalThis as { gc?: () => void }).gc,
    onIdle: async () => {
      for (const release of releasers) await release();
      await cleanup();
    },
  });

  return {
    idle,
    onIdle: (release) => void releasers.push(release),
    cleanup,
    tmpDir,
    lastSweep: () => lastSweep,
  };
}
