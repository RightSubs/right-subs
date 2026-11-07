import { createServer as createHttpServer, type Server } from 'node:http';
import type { AppConfig } from './config/load.ts';
import { redirect, sendJson } from './http/respond.ts';
import { Router, type RouteContext } from './http/router.ts';
import type { Logger } from './logger.ts';
import type { MediaTools } from './media/tools.ts';
import type { ResourceManager } from './resources/resources.ts';
import type { SubtitleProvider } from './providers/types.ts';
import type { FileLocator } from './streams/locator.ts';
import type { StreamProxy } from './streams/proxy.ts';
import { buildManifest } from './stremio/manifest.ts';
import type { KitsuResolver } from './stremio/kitsu.ts';
import { parseSubtitlesRequest, type SubtitlesRequest } from './stremio/request.ts';
import { embeddedLabel, embeddedNoticeSrt, placeholderSrt, statusLabel, statusPath, statusSrt } from './stremio/status.ts';
import { parseTrackPath, trackPath } from './stremio/track.ts';
import type { SubtitleService } from './subtitles/service.ts';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  version: string;
  tools: MediaTools;
  resources: Pick<ResourceManager, 'idle' | 'lastSweep'>;
  providers: SubtitleProvider[];
  subtitles: Pick<SubtitleService, 'chooseLanguage' | 'prepare' | 'status'> & Partial<Pick<SubtitleService, 'translationPending' | 'embeddedLanguage'>>;
  streams?: Pick<StreamProxy, 'enabled' | 'streams' | 'status'>;
  /** Finds the URL of the file being played; null in /health means light mode. */
  locator?: Pick<FileLocator, 'enabled' | 'status'>;
  /** Maps anime (Kitsu) ids to IMDb; without it, Kitsu requests get no subtitles. */
  kitsu?: Pick<KitsuResolver, 'resolve'>;
  /**
   * How long a translation that is not ready yet is waited for before answering with a placeholder.
   * Stremio gives up after 10 s (and some clients then do not open the video) and the clock seems to
   * start with its first request to the addon, not with the .srt one: on the box an answer 8 s after
   * the .srt request (12.8 s after the first request) came too late. A translation still to be made
   * takes 20 s or more, so little is lost by answering early: default 3 s.
   */
  translationWaitMs?: number;
}

export function createServer(deps: AppDeps): Server {
  const { config, logger, version, tools, resources, providers, subtitles, streams, locator, kitsu, translationWaitMs = 3000 } = deps;
  const resolve = async <T extends SubtitlesRequest>(request: T): Promise<T | undefined> => {
    if (!request.kitsu) return request;
    const resolved = await kitsu?.resolve(request);
    return resolved && { ...request, ...resolved };
  };
  const startedAt = Date.now();
  const manifest = buildManifest(config, version);

  const handleSubtitles = async ({ req, res, params }: RouteContext) => {
    const request = parseSubtitlesRequest(params);
    // Logged in full on purpose: these lines document real Stremio behavior (docs/DESCOBERTAS.md).
    logger.info('subtitles.request', {
      ...(request ?? { params }),
      userAgent: req.headers['user-agent'],
    });
    const resolved = request && (await resolve(request));
    // The file already has a subtitle in the user's language: the player lists it, the addon only says so.
    const inFile = resolved && (await subtitles.embeddedLanguage?.(resolved));
    if (resolved && inFile) {
      const host = req.headers.host ?? `${config.server.host}:${config.server.port}`;
      sendJson(res, 200, { subtitles: [{ id: 'rightsubs-embedded', url: `http://${host}${statusPath(resolved, inFile)}`, lang: embeddedLabel(inFile) }] });
      return;
    }
    const language = resolved && (await subtitles.chooseLanguage(resolved));
    if (!request || !language) {
      sendJson(res, 200, { subtitles: [] });
      return;
    }
    // A single track, so the player has nothing to choose: the addon already chose.
    const url = `http://${req.headers.host ?? `${config.server.host}:${config.server.port}`}${trackPath(request, language)}`;
    const tracks = [{ id: `rightsubs-${language.tag}`, url, lang: language.stremio }];
    // A translation not ready yet takes longer than Stremio waits: say so in the subtitle menu too.
    if (resolved && (await subtitles.translationPending?.(resolved))) {
      const base = url.slice(0, url.length - trackPath(request, language).length);
      tracks.push({ id: 'rightsubs-status', url: `${base}${statusPath(request, language)}`, lang: statusLabel(language) });
    }
    sendJson(res, 200, { subtitles: tracks });
  };

  const handleStatus = async ({ res, params }: RouteContext) => {
    const track = parseTrackPath(params);
    if (!track) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    const resolved = await resolve(track);
    const inFile = resolved && (await subtitles.embeddedLanguage?.(resolved));
    if (inFile) {
      const notice = embeddedNoticeSrt(inFile);
      res.writeHead(200, { 'Content-Type': 'application/x-subrip; charset=utf-8', 'Content-Length': notice.length, 'Cache-Control': 'no-store' });
      res.end(res.req.method === 'HEAD' ? undefined : notice);
      return;
    }
    // Decided now, not when the entry was listed: the subtitle may be ready by then.
    const pending = Boolean(resolved && (await subtitles.translationPending?.(resolved)));
    logger.info('subtitles.status_requested', { id: track.id, language: track.language.tag, pending });
    const srt = statusSrt(track.language, pending);
    res.writeHead(200, { 'Content-Type': 'application/x-subrip; charset=utf-8', 'Content-Length': srt.length, 'Cache-Control': 'no-store' });
    res.end(res.req.method === 'HEAD' ? undefined : srt);
  };

  const handleStreams = async ({ res, params }: RouteContext) => {
    if (!streams?.enabled || (params['type'] !== 'movie' && params['type'] !== 'series')) {
      sendJson(res, 200, { streams: [] });
      return;
    }
    sendJson(res, 200, await streams.streams(params['type'], params['id'] ?? ''));
  };

  const handleTrack = async ({ res, params }: RouteContext) => {
    const track = parseTrackPath(params);
    if (!track) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    logger.info('subtitles.track_requested', { id: track.id, language: track.language.tag, filename: track.filename });
    // Whether the player was still there when the answer went out (Stremio's 10 s limit): see DESCOBERTAS.
    const requestedAt = Date.now();
    res.on('close', () =>
      logger.info('subtitles.track_closed', { id: track.id, elapsedMs: Date.now() - requestedAt, delivered: res.writableFinished }),
    );
    const resolved = await resolve(track);
    // A translation still to be made takes longer than Stremio waits: answer in time, let it finish in the background.
    const slow = Boolean(resolved && (await subtitles.translationPending?.(resolved)));
    const preparing = resolved ? subtitles.prepare(resolved) : Promise.resolve(undefined);
    let srt: Buffer | undefined;
    if (slow) {
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<'late'>((resolveLate) => {
        timer = setTimeout(() => resolveLate('late'), translationWaitMs);
      });
      const first = await Promise.race([preparing, late]);
      clearTimeout(timer);
      if (first === 'late') {
        preparing.catch(() => {}); // keeps running; a failure is logged by the service
        logger.info('subtitles.placeholder', { id: track.id, language: track.language.tag, waitedMs: translationWaitMs });
        const message = placeholderSrt(track.language);
        res.writeHead(200, { 'Content-Type': 'application/x-subrip; charset=utf-8', 'Content-Length': message.length, 'Cache-Control': 'no-store' });
        res.end(res.req.method === 'HEAD' ? undefined : message);
        return;
      }
      srt = first;
    } else {
      srt = await preparing;
    }
    if (!srt) {
      sendJson(res, 404, { error: 'subtitle_unavailable' });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/x-subrip; charset=utf-8', 'Content-Length': srt.length });
    res.end(res.req.method === 'HEAD' ? undefined : srt);
  };

  const router = new Router()
    .get('/', ({ res }) => redirect(res, '/manifest.json'))
    .get('/manifest.json', ({ res }) => sendJson(res, 200, manifest))
    .get('/health', ({ res }) => {
      const memory = process.memoryUsage();
      const sweep = resources.lastSweep();
      sendJson(res, 200, {
        status: 'ok',
        name: manifest.name,
        version,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        runtime: {
          node: process.version,
          platform: `${process.platform}/${process.arch}`,
        },
        resources: {
          state: resources.idle.state,
          rssMB: toMB(memory.rss),
          heapUsedMB: toMB(memory.heapUsed),
          cacheMB: sweep ? toMB(sweep.remainingBytes) : null,
          cacheLimitMB: config.cache.maxSizeMB,
        },
        tools,
        languages: {
          primary: config.languages.primary.tag,
          secondary: config.languages.secondary?.tag ?? null,
          useSecondaryWhen: config.languages.useSecondaryWhen,
        },
        providers: config.providers.map(({ id, type, enabled }) => ({
          id,
          type,
          enabled,
          ...providers.find((provider) => provider.id === id)?.status?.(),
        })),
        subtitles: subtitles.status(),
        streams: streams?.enabled ? streams.status() : null,
        locator: locator?.enabled ? locator.status() : null,
      });
    })
    .get('/subtitles/:type/:id.json', handleSubtitles)
    .get('/subtitles/:type/:id/:extra.json', handleSubtitles)
    .get('/stream/:type/:id.json', handleStreams)
    .get('/sub/:type/:id/:lang/:file.srt', handleTrack)
    .get('/status/:type/:id/:lang/:file.srt', handleStatus);

  return createHttpServer(async (req, res) => {
    // Stremio clients (including web) fetch addons cross-origin.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    // Health checks are not Stremio activity and must not keep the addon awake.
    if (url.pathname !== '/health') resources.idle.touch();
    const match = router.match(req.method ?? 'GET', url.pathname);
    if (!match) {
      logger.debug('http.not_found', { method: req.method, path: url.pathname });
      sendJson(res, 404, { error: 'not_found' });
      return;
    }

    try {
      await match.handler({ req, res, url, params: match.params });
    } catch (err) {
      logger.error('http.error', { path: url.pathname, message: (err as Error).message, stack: (err as Error).stack });
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
    }
  });
}

const toMB = (bytes: number) => Math.round(bytes / 1024 / 1024);
