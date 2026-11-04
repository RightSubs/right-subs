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
import { FileLocator, type FileSource } from './streams/locator.ts';
import { StreamProxy } from './streams/proxy.ts';
import { RealDebridSource } from './streams/realdebrid.ts';
import { StremioServerSource } from './streams/stremio.ts';
import { DeepL } from './translation/deepl.ts';
import { SubtitleCache } from './subtitles/cache.ts';
import { SubtitleService } from './subtitles/service.ts';

/** sysexits EX_CONFIG: tells the supervisor (AddonService in the APK) not to restart in a loop. */
const EXIT_CONFIG = 78;
/** Reading a container header over HTTP from Real-Debrid takes 1–3 s. */
const PROBE_TIMEOUT_MS = 6000;
/** From a torrent through Stremio's local server: 5.6 s on the box (Ted Lasso 2160p, 15 Mbit/s). */
const P2P_PROBE_TIMEOUT_MS = 15000;
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
  if (config.streams.realdebrid) {
    console.log(`  realdebrid: ${config.streams.realdebrid.enabled ? 'habilitado' : 'desabilitado'}`);
  }
  if (config.streams.stremio) {
    console.log(`  stremio:    ${config.streams.stremio.enabled ? 'habilitado' : 'desabilitado'}`);
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
// Where the URL of the file being played comes from, in order (docs/PLANO-COMPLEMENTO.md).
const sources: FileSource[] = [];
if (streams.enabled) sources.push(streams);
const realdebrid = config.streams.realdebrid;
if (realdebrid?.enabled && realdebrid.token) {
  const { token, lookback, timeoutMs } = realdebrid;
  sources.push(new RealDebridSource({ token, lookback, timeoutMs, fetch: globalThis.fetch, logger, version }));
}
const stremio = config.streams.stremio;
if (stremio?.enabled) {
  sources.push(new StremioServerSource({ url: stremio.url, timeoutMs: stremio.timeoutMs, fetch: globalThis.fetch }));
}
const locator = new FileLocator({ sources, logger });
const limiter = new Limiter(config.resources.maxConcurrentJobs);
const inspector = tools.ffprobe.available && locator.enabled
  ? new VideoInspector({
      locate: (query) => locator.locate(query),
      limiter,
      logger,
      timeoutMs: PROBE_TIMEOUT_MS,
      peerToPeerTimeoutMs: P2P_PROBE_TIMEOUT_MS,
    })
  : undefined;
const cache = new SubtitleCache(config.cache.dir);
const embedded =
  inspector && tools.ffmpeg.available && config.sync.enabled && config.sync.embedded.enabled
    ? new EmbeddedReferences({
        locate: (query) => locator.locate(query),
        cache,
        limiter,
        logger,
        beginJob: () => resources.idle.beginJob(),
        windows: config.sync.embedded.windows,
        windowSeconds: config.sync.embedded.windowSeconds,
        timeoutMs: EXTRACT_TIMEOUT_MS,
        preferredLanguages: config.sync.referenceLanguages,
      })
    : undefined;
const kitsu = new KitsuResolver({ fetch: globalThis.fetch, logger, version });
resources.onIdle(() => {
  streams.release();
  locator.release();
  inspector?.release();
  kitsu.release();
});
const deeplConfig = config.translation.deepl;
const translator =
  deeplConfig.enabled && deeplConfig.apiKey
    ? new DeepL({
        apiKey: deeplConfig.apiKey,
        timeoutMs: deeplConfig.timeoutMs,
        fetch: globalThis.fetch,
        onCharacters: (count) => logger.info('translation.billed', { characters: count }),
      })
    : undefined;
const subtitles = new SubtitleService({
  providers,
  primary: config.languages.primary,
  secondary: config.languages.secondary,
  references: config.sync.referenceLanguages,
  cache,
  logger,
  budgetMs: config.sync.budgetSeconds * 1000,
  beginJob: () => resources.idle.beginJob(),
  sync: { enabled: config.sync.enabled, minConfidence: config.sync.minConfidence },
  ...(inspector ? { inspect: (filename: string | undefined, videoSize?: number) => inspector.inspect(filename, videoSize) } : {}),
  ...(embedded ? { embedded } : {}),
  ...(translator ? { translator } : {}),
  ...(translator && deeplConfig.forceFrom.length > 0 ? { forceFrom: deeplConfig.forceFrom } : {}),
});
resources.onIdle(() => subtitles.release());

const { host, port } = config.server;
const server = createServer({ config, logger, version, tools, resources, providers, subtitles, streams, locator, kitsu });

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
