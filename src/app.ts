import { createServer as createHttpServer, type Server } from 'node:http';
import type { AppConfig } from './config/load.ts';
import { redirect, sendJson } from './http/respond.ts';
import { Router, type RouteContext } from './http/router.ts';
import type { Logger } from './logger.ts';
import type { MediaTools } from './media/tools.ts';
import type { ResourceManager } from './resources/resources.ts';
import type { SubtitleProvider } from './providers/types.ts';
import type { StreamProxy } from './streams/proxy.ts';
import { buildManifest } from './stremio/manifest.ts';
import type { KitsuResolver } from './stremio/kitsu.ts';
import { parseSubtitlesRequest, type SubtitlesRequest } from './stremio/request.ts';
import { parseTrackPath, trackPath } from './stremio/track.ts';
import type { SubtitleService } from './subtitles/service.ts';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  version: string;
  tools: MediaTools;
  resources: Pick<ResourceManager, 'idle' | 'lastSweep'>;
  providers: SubtitleProvider[];
  subtitles: Pick<SubtitleService, 'chooseLanguage' | 'prepare' | 'status'>;
  streams?: Pick<StreamProxy, 'enabled' | 'streams' | 'status'>;
  /** Maps anime (Kitsu) ids to IMDb; without it, Kitsu requests get no subtitles. */
  kitsu?: Pick<KitsuResolver, 'resolve'>;
}

export function createServer(deps: AppDeps): Server {
  const { config, logger, version, tools, resources, providers, subtitles, streams, kitsu } = deps;
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
    const language = resolved && (await subtitles.chooseLanguage(resolved));
    if (!request || !language) {
      sendJson(res, 200, { subtitles: [] });
      return;
    }
    // A single track, so the player has nothing to choose: the addon already chose.
    const url = `http://${req.headers.host ?? `${config.server.host}:${config.server.port}`}${trackPath(request, language)}`;
    sendJson(res, 200, { subtitles: [{ id: `rightsubs-${language.tag}`, url, lang: language.stremio }] });
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
    const resolved = await resolve(track);
    const srt = resolved && (await subtitles.prepare(resolved));
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
      });
    })
    .get('/subtitles/:type/:id.json', handleSubtitles)
    .get('/subtitles/:type/:id/:extra.json', handleSubtitles)
    .get('/stream/:type/:id.json', handleStreams)
    .get('/sub/:type/:id/:lang/:file.srt', handleTrack);

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
