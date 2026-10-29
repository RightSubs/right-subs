import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from './app.ts';
import { ConfigError } from './config/errors.ts';
import { loadConfig, type AppConfig } from './config/load.ts';
import { createLogger } from './logger.ts';
import { VideoInspector } from './media/inspector.ts';
import { detectMediaTools } from './media/tools.ts';
import { createProviders } from './providers/index.ts';
import { Limiter } from './resources/limiter.ts';
import { createResourceManager } from './resources/resources.ts';
import { KitsuResolver } from './stremio/kitsu.ts';
import { EmbeddedReferences } from './sync/embedded-reference.ts';
import { StreamProxy } from './streams/proxy.ts';
import { SubtitleCache } from './subtitles/cache.ts';
import { SubtitleService } from './subtitles/service.ts';

/** sysexits EX_CONFIG: tells scripts/rightsubs.sh not to restart in a loop. */
const EXIT_CONFIG = 78;
/** Reading a container header over HTTP from Real-Debrid takes 1–3 s. */
const PROBE_TIMEOUT_MS = 6000;
/** One window of an embedded subtitle (45 s of a 4K file ≈ 4 s on the box, slower while the movie buffers). */
const EXTRACT_TIMEOUT_MS = 15000;

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const { values: args } = parseArgs({
  options: {
    config: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
});

const configFile = resolve(args.config ?? process.env['RIGHTSUBS_CONFIG'] ?? resolve(ROOT, 'config.yaml'));

let config: AppConfig;
try {
  config = loadConfig({ configFile });
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(EXIT_CONFIG);
  }
  throw err;
}

const version = (JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
const tools = await detectMediaTools();

if (args.check) {
  const { primary, secondary } = config.languages;
  console.log(`Configuração válida: ${config.source.configFile}`);
  console.log(`  idiomas:    ${primary.tag} (principal)${secondary ? `, ${secondary.tag} (secundário)` : ''}`);
  for (const provider of config.providers) {
    console.log(`  provedor:   ${provider.id} [${provider.type}] ${provider.enabled ? 'habilitado' : 'desabilitado'}`);
  }
  // The URL is not printed: it carries the Real-Debrid key.
  for (const indexer of config.streams.indexers) {
    console.log(`  indexador:  ${indexer.id} ${indexer.enabled ? 'habilitado' : 'desabilitado'}`);
  }
  console.log(`  ffmpeg:     ${tools.ffmpeg.available ? (tools.ffmpeg.version ?? 'ok') : 'NÃO encontrado'}`);
  console.log(`  ffprobe:    ${tools.ffprobe.available ? (tools.ffprobe.version ?? 'ok') : 'NÃO encontrado'}`);
  process.exit(0);
}

const logger = createLogger(config.log.level);
if (!tools.ffmpeg.available || !tools.ffprobe.available) {
  logger.warn('tools.missing', { ...tools, hint: 'instale com: pkg install ffmpeg (Termux) ou brew install ffmpeg (Mac)' });
}

const dataDir = process.env['RIGHTSUBS_HOME'] ?? join(homedir(), '.rightsubs');

const shutdown = (code: number) => {
  resources.idle.stop();
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 3000).unref();
};

const resources = createResourceManager({ config, logger, dataDir, requestRestart: shutdown });
await resources.cleanup();

const providers = createProviders(config.providers, { version, logger, fetch: globalThis.fetch });
const streams = new StreamProxy({
  indexers: config.streams.indexers.flatMap(({ id, enabled, url, timeoutMs }) => (enabled && url ? [{ id, url, timeoutMs }] : [])),
  fetch: globalThis.fetch,
  logger,
  version,
});
const limiter = new Limiter(config.resources.maxConcurrentJobs);
const inspector = tools.ffprobe.available
  ? new VideoInspector({
      find: (filename, videoSize) => streams.find(filename, videoSize),
      limiter,
      logger,
      timeoutMs: PROBE_TIMEOUT_MS,
    })
  : undefined;
const cache = new SubtitleCache(config.cache.dir);
const embedded =
  inspector && tools.ffmpeg.available && config.sync.enabled && config.sync.embedded.enabled
    ? new EmbeddedReferences({
        find: (filename, videoSize) => streams.find(filename, videoSize),
        cache,
        limiter,
        logger,
        beginJob: () => resources.idle.beginJob(),
        windows: config.sync.embedded.windows,
        windowSeconds: config.sync.embedded.windowSeconds,
        timeoutMs: EXTRACT_TIMEOUT_MS,
      })
    : undefined;
const kitsu = new KitsuResolver({ fetch: globalThis.fetch, logger, version });
resources.onIdle(() => {
  streams.release();
  inspector?.release();
  kitsu.release();
});
const subtitles = new SubtitleService({
  providers,
  primary: config.languages.primary,
  secondary: config.languages.secondary,
  cache,
  logger,
  budgetMs: config.sync.budgetSeconds * 1000,
  beginJob: () => resources.idle.beginJob(),
  sync: { enabled: config.sync.enabled, minConfidence: config.sync.minConfidence },
  ...(inspector ? { inspect: (filename: string | undefined, videoSize?: number) => inspector.inspect(filename, videoSize) } : {}),
  ...(embedded ? { embedded } : {}),
});
resources.onIdle(() => subtitles.release());

const { host, port } = config.server;
const server = createServer({ config, logger, version, tools, resources, providers, subtitles, streams, kitsu });

server.on('error', (err) => {
  logger.error('server.error', { message: err.message });
  process.exit(1);
});

server.listen(port, host, () => {
  logger.info('server.started', {
    version,
    manifest: `http://${host}:${port}/manifest.json`,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    languages: [config.languages.primary.tag, config.languages.secondary?.tag].filter(Boolean),
    rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info('server.stopping', { signal });
    shutdown(0);
  });
}
