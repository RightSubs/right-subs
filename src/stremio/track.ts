import { findLanguage, type Language } from '../languages/languages.ts';
import { parseSubtitlesRequest, type SubtitlesRequest } from './request.ts';

/**
 * Path of the single subtitle track offered to Stremio:
 * `/sub/{type}/{id}/{language}/{filename as base64url, or "_"}.srt`.
 *
 * It carries everything needed to redo the search, so it keeps working after a
 * restart. It deliberately leaves the video hash out: Stremio's two requests for
 * the same play (without and with hash) get the same URL, and the hash learned
 * from the second one is looked up in memory.
 */
export function trackPath(request: SubtitlesRequest, language: Language): string {
  const file = request.filename ? Buffer.from(request.filename, 'utf8').toString('base64url') : '_';
  return `/sub/${request.type}/${request.id}/${language.tag}/${file}.srt`;
}

export function parseTrackPath(params: Record<string, string>): (SubtitlesRequest & { language: Language }) | undefined {
  const language = findLanguage(params['lang'] ?? '');
  const file = params['file'] ?? '';
  if (!language || !/^(_|[A-Za-z0-9_-]+)$/.test(file)) return undefined;
  const extra = file === '_' ? '' : new URLSearchParams({ filename: Buffer.from(file, 'base64url').toString('utf8') }).toString();
  const request = parseSubtitlesRequest({ type: params['type'] ?? '', id: params['id'] ?? '', extra });
  return request && { ...request, language };
}
