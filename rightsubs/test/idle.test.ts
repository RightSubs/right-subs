import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { createLogger } from '../src/logger.ts';
import { EXIT_CLEAN_RESTART, IdleMonitor } from '../src/resources/idle.ts';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(rssMB = 50) {
  const events: string[] = [];
  const calls = { cleanups: 0, gcs: 0, restarts: [] as number[] };
  const monitor = new IdleMonitor({
    idleAfterMs: 1000,
    maxIdleMemoryMB: 80,
    logger: createLogger('info', (line) => events.push(line.split(/\s+/)[2] ?? '')),
    onIdle: async () => void calls.cleanups++,
    requestRestart: (code) => void calls.restarts.push(code),
    memoryMB: () => rssMB,
    gc: () => void calls.gcs++,
  });
  return { monitor, events, calls };
}

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

test('starts idle and arms no timer until there is activity', async () => {
  const { monitor, calls } = setup();
  assert.equal(monitor.state, 'idle');
  mock.timers.tick(60_000);
  await flush();
  assert.equal(calls.cleanups, 0);
});

test('releases resources once after the idle period, then stays quiet', async () => {
  const { monitor, events, calls } = setup();
  monitor.touch();
  assert.equal(monitor.state, 'active');

  mock.timers.tick(999);
  await flush();
  assert.equal(calls.cleanups, 0);

  mock.timers.tick(1);
  await flush();
  assert.equal(monitor.state, 'idle');
  assert.deepEqual(calls, { cleanups: 1, gcs: 1, restarts: [] });
  assert.deepEqual(events, ['resources.active', 'resources.idle']);

  mock.timers.tick(60_000);
  await flush();
  assert.equal(calls.cleanups, 1);
});

test('each request postpones going idle', async () => {
  const { monitor, calls } = setup();
  monitor.touch();
  mock.timers.tick(800);
  monitor.touch();
  mock.timers.tick(800);
  await flush();
  assert.equal(calls.cleanups, 0);
  mock.timers.tick(200);
  await flush();
  assert.equal(calls.cleanups, 1);
});

test('never goes idle while a job is running', async () => {
  const { monitor, calls } = setup();
  const done = monitor.beginJob();
  mock.timers.tick(10_000);
  await flush();
  assert.equal(calls.cleanups, 0);

  done();
  done(); // idempotent
  mock.timers.tick(1000);
  await flush();
  assert.equal(calls.cleanups, 1);
});

test('restarts cleanly when memory stays high after cleanup', async () => {
  const { monitor, events, calls } = setup(120);
  monitor.touch();
  mock.timers.tick(1000);
  await flush();
  assert.deepEqual(calls.restarts, [EXIT_CLEAN_RESTART]);
  assert.deepEqual(events, ['resources.active', 'resources.idle', 'resources.restart']);
});
