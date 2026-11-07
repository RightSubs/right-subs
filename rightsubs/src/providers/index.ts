import type { ProviderConfig } from '../config/load.ts';
import { openSubtitlesApi } from './opensubtitles-api.ts';
import { stremioAddon } from './stremio-addon.ts';
import type { ProviderContext, ProviderType, SubtitleProvider } from './types.ts';

export const PROVIDER_TYPES: readonly ProviderType[] = [openSubtitlesApi, stremioAddon];

export function findProviderType(type: string): ProviderType | undefined {
  return PROVIDER_TYPES.find((provider) => provider.type === type);
}

/** Instantiates the enabled providers, keeping the config order (= priority). */
export function createProviders(
  providers: ProviderConfig[],
  context: Omit<ProviderContext, 'id'>,
): SubtitleProvider[] {
  return providers
    .filter((provider) => provider.enabled)
    .map((provider) => {
      // Config validation already rejected unknown types.
      const type = findProviderType(provider.type) as ProviderType;
      return type.create(provider.options, { ...context, id: provider.id });
    });
}
