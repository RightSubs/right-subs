import type { SubtitleCandidate } from '../providers/types.ts';

export interface RankContext {
  filename: string | undefined;
  /** Frame rate of the video, when known (inferred from subtitles made for this exact file). */
  videoFps?: number | undefined;
}

/** What a release name says about the video it was made from. */
export interface ReleaseInfo {
  tokens: string[];
  source?: 'bluray' | 'web' | 'hdtv' | 'dvd';
  resolution?: string;
  group?: string;
}

const SOURCES: [NonNullable<ReleaseInfo['source']>, RegExp][] = [
  ['bluray', /^(bluray|bdrip|brrip|bdremux|remux|bd|bdr)$/],
  ['web', /^(web|webdl|webrip|amzn|nf|dsnp|hmax|atvp|hulu|pcok|max)$/],
  ['hdtv', /^(hdtv|pdtv|dsr)$/],
  ['dvd', /^(dvd|dvdrip|dvdr|dvd9|dvd5)$/],
];

/**
 * Subtitle timing follows the edit of the video: the release group and the
 * source (a WEB edit often has different logos than the BluRay) matter most;
 * resolution and popularity only break ties. Exact matches (hash or release
 * name) dominate everything.
 */
export function score(candidate: SubtitleCandidate, context: RankContext): number {
  let total = 0;
  if (candidate.hashMatch) total += 1000;
  if (isExact(candidate, context.filename)) total += 500;
  else if (context.filename && candidate.releaseName) {
    const file = parseRelease(context.filename);
    const release = parseRelease(candidate.releaseName);
    if (file.group && file.group === release.group) total += 80;
    if (file.source && release.source) total += file.source === release.source ? 40 : -20;
    if (file.resolution && file.resolution === release.resolution) total += 10;
    const common = release.tokens.filter((token) => file.tokens.includes(token)).length;
    total += Math.round((common / Math.max(file.tokens.length, 1)) * 50);
  }
  if (context.videoFps && candidate.fps) total += sameFps(context.videoFps, candidate.fps) ? 30 : -30;
  if (candidate.hearingImpaired) total -= 10;
  // Tie-breaker only: 0–10 points.
  total += Math.min(Math.log10((candidate.downloads ?? 0) + 1) * 2, 10);
  return total;
}

/** Fewer tokens than this ("Movie.2008.BluRay") describe many releases, not one. */
const MIN_RELEASE_TOKENS = 5;

/**
 * The subtitle was made for this exact file: same hash, or same release. File
 * names often wrap the release name in extra words (`Operazione Valchiria -
 * Varkyrie (2008) UpScaled 2160p … Licdom` for `Varkyrie.2008.UpScaled.2160p.H265.Licdom`),
 * so a specific enough release name contained in the file name also counts.
 */
export function isExact(candidate: SubtitleCandidate, filename: string | undefined): boolean {
  if (candidate.hashMatch) return true;
  if (!filename || !candidate.releaseName) return false;
  const file = tokens(stripExtension(filename));
  const release = tokens(stripExtension(candidate.releaseName));
  if (file.join('.') === release.join('.')) return true;
  // Every token, including the release group (usually last), must be in the file name.
  return release.length >= MIN_RELEASE_TOKENS && release.every((token) => file.includes(token));
}

export function parseRelease(name: string): ReleaseInfo {
  const base = stripExtension(name);
  const info: ReleaseInfo = { tokens: tokens(base) };
  // "WEB-DL" would split into "web" + "dl": glue the pair before matching.
  const words = tokens(base.replace(/-(dl|rip)\b/gi, '$1'));
  for (const word of words) {
    const source = SOURCES.find(([, pattern]) => pattern.test(word))?.[0];
    if (source && !info.source) info.source = source;
    if (/^(2160|1080|720|576|480)p$/.test(word)) info.resolution ??= word;
  }
  // Scene naming puts the group last, after a hyphen: `…x265-ELiTE`, `… - GEGE`.
  const group = /-\s*([A-Za-z0-9]{2,})\s*$/.exec(base)?.[1];
  if (group) info.group = group.toLowerCase();
  return info;
}

/** Frame rates within 0.1% (23.976 vs 23.98). */
export function sameFps(a: number, b: number): boolean {
  return Math.abs(a - b) / Math.max(a, b) < 0.001;
}

function stripExtension(name: string): string {
  return name.replace(/\.(mkv|mp4|avi|m4v|mov|wmv|ts|webm|srt)$/i, '');
}

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
