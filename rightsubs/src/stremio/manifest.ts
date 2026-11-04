import type { AppConfig } from '../config/load.ts';

export const ADDON_ID = 'community.rightsubs';

export function buildManifest(config: AppConfig, version: string) {
  const { primary, secondary } = config.languages;
  const languages = secondary ? `${primary.name} (secundária: ${secondary.name})` : primary.name;
  return {
    id: ADDON_ID,
    version,
    name: 'RightSubs',
    description: `Legenda certa, sincronizada automaticamente — ${languages}.`,
    resources: [
      // Anime catalogs (Anime Kitsu addon) use Kitsu ids; they are mapped to IMDb.
      { name: 'subtitles', types: ['movie', 'series'], idPrefixes: ['tt', 'kitsu'] },
      // Stream lists come from the indexers, which also serve anime (Kitsu) ids.
      ...(config.streams.indexers.some((indexer) => indexer.enabled)
        ? [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'kitsu'] }]
        : []),
    ],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'kitsu'],
    catalogs: [],
  };
}
