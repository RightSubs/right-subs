export interface SubtitlesRequest {
  type: 'movie' | 'series';
  /** Raw Stremio id, e.g. `tt0062622`, `tt0903747:1:2` or `kitsu:1376:5`. */
  id: string;
  /** Empty for Kitsu ids until resolved (see stremio/kitsu.ts). */
  imdbId: string;
  /** Anime catalog ids (Anime Kitsu addon): `kitsu:{id}` or `kitsu:{id}:{episode}`. */
  kitsu?: { id: number; episode?: number };
  season?: number;
  episode?: number;
  videoHash?: string;
  videoSize?: number;
  filename?: string;
}

/**
 * Parses `/subtitles/{type}/{id}/{extra}.json`, where `extra` is a querystring
 * such as `videoHash=8e24...&videoSize=1460000000&filename=Movie.1968.mkv`.
 * Returns undefined for requests this addon does not handle.
 */
export function parseSubtitlesRequest(params: Record<string, string>): SubtitlesRequest | undefined {
  const type = params['type'];
  if (type !== 'movie' && type !== 'series') return undefined;

  const id = safeDecode(params['id'] ?? '');
  const [prefix = '', second, third] = id.split(':');
  let request: SubtitlesRequest;
  if (prefix === 'kitsu') {
    // `kitsu:{id}:{episode}`: no season, episodes are numbered per anime entry.
    const kitsuId = toInt(second);
    if (kitsuId === undefined) return undefined;
    const episode = toInt(third);
    request = { type, id, imdbId: '', kitsu: episode === undefined ? { id: kitsuId } : { id: kitsuId, episode } };
  } else if (/^tt\d+$/.test(prefix)) {
    request = { type, id, imdbId: prefix };
    if (type === 'series') {
      const season = toInt(second);
      const episode = toInt(third);
      if (season === undefined || episode === undefined) return undefined;
      request.season = season;
      request.episode = episode;
    }
  } else {
    return undefined;
  }

  const extra = new URLSearchParams(params['extra'] ?? '');
  const videoHash = extra.get('videoHash');
  const videoSize = toInt(extra.get('videoSize') ?? undefined);
  const filename = extra.get('filename');
  if (videoHash) request.videoHash = videoHash;
  if (videoSize !== undefined) request.videoSize = videoSize;
  if (filename) request.filename = filename;
  return request;
}

function toInt(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
