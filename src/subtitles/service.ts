import type { Language } from '../languages/languages.ts';
import type { Logger } from '../logger.ts';
import type { EmbeddedTrack } from '../media/embedded.ts';
import { standardRate, type VideoInfo } from '../media/probe.ts';
import type { SubtitleCandidate, SubtitleProvider, SubtitleQuery } from '../providers/types.ts';
import type { SubtitlesRequest } from '../stremio/request.ts';
import { align, type Alignment } from '../sync/align.ts';
import type { EmbeddedReferences } from '../sync/embedded-reference.ts';
import { nearReference } from '../sync/windows.ts';
import type { SubtitleCache } from './cache.ts';
import { isExact, parseRelease, sameFps, score, type RankContext } from './rank.ts';
import { parseSrt, retime, serializeSrt, type Cue } from './srt.ts';
import { decodeSubtitle, looksLikeSrt, toSrt } from './text.ts';

const SEARCH_TTL_MS = 30 * 60 * 1000;
/** In-memory entries (searches, learned hashes); released when the addon goes idle. */
const MAX_ENTRIES = 50;
/** Candidates tried per track before giving up. */
const MAX_ATTEMPTS = 3;
/** Reference subtitles tried for syncing. */
const MAX_REFERENCES = 2;
/** Score bonus for subtitles that can be downloaded without spending quota: wins ties, never beats a better match. */
const FREE_BONUS = 15;
/** Embedded references are read in windows: compare only the subtitle cues this close to them. */
const EMBEDDED_MARGIN_MS = 120_000;
/** A correction must beat leaving the subtitle as is by this much: speech covers so much of a movie that even a wrong timing overlaps ~45%. */
const MIN_SYNC_GAIN = 0.1;

/** What the player asks for: the video (as Stremio described it) and one language. */
export type TrackRequest = SubtitlesRequest & { language: Language };

/** A candidate plus copies of the same subtitle that other providers can download more cheaply. */
interface Ranked {
  candidate: SubtitleCandidate;
  cheaper: SubtitleCandidate[];
  score: number;
  /** The candidate's file is already in the disk cache. */
  cached?: boolean;
}

export interface SubtitleServiceOptions {
  providers: SubtitleProvider[];
  primary: Language;
  secondary: Language | undefined;
  cache: SubtitleCache;
  logger: Logger;
  /** Overall time allowed to produce a track once the player asks for it. */
  budgetMs: number;
  /** Keeps the addon from going idle while a track is being prepared. */
  beginJob: () => () => void;
  sync: { enabled: boolean; minConfidence: number };
  /** Real properties of the file being played, when it can be probed (phase 3 stream proxy). */
  inspect?: (filename: string | undefined, videoSize?: number) => Promise<VideoInfo | undefined>;
  /** Timing references read from text subtitles embedded in the video (needs the stream proxy and ffmpeg). */
  embedded?: Pick<EmbeddedReferences, 'lookup'>;
}

type Prepared =
  | { srt: Buffer; sync: Record<string, unknown>; details: Record<string, unknown> }
  | { srt: undefined; candidates: number };

interface Fetched {
  srt: Buffer;
  source: SubtitleCandidate;
  cached: boolean;
}

export class SubtitleService {
  #options: SubtitleServiceOptions;
  #providers: Map<string, SubtitleProvider>;
  #searches = new Map<string, { expiresAt: number; result: Promise<SubtitleCandidate[]> }>();
  /** The 1st Stremio request has no hash; the 2nd (2–3 s later) does. Remembered per video. */
  #hashes = new Map<string, { videoHash: string; videoSize?: number }>();
  #preparing = new Map<string, Promise<Prepared>>();
  /** How each served track was synced, since start (shown in /health). Fixed size: not released on idle. */
  #stats = { since: new Date().toISOString(), served: {} as Record<string, number>, unavailable: 0 };
  /** Last tracks served without a trusted timing: the cases phase 4 (embedded/audio sync) would handle. */
  #unsynced: { at: string; id: string; filename: string | null; language: string; status: string }[] = [];

  constructor(options: SubtitleServiceOptions) {
    this.#options = options;
    this.#providers = new Map(options.providers.map((provider) => [provider.id, provider]));
  }

  /** Picks the language of the single track offered to Stremio: primary if it exists, else secondary. */
  async chooseLanguage(request: SubtitlesRequest): Promise<Language | undefined> {
    if (request.videoHash) {
      const learned: { videoHash: string; videoSize?: number } = { videoHash: request.videoHash };
      if (request.videoSize !== undefined) learned.videoSize = request.videoSize;
      remember(this.#hashes, videoKey(request), learned);
    }
    // Start probing the file now: the player asks for the track a second or two later.
    void this.#options.inspect?.(request.filename, request.videoSize);
    const candidates = await this.#search(request);
    const { primary, secondary } = this.#options;
    const has = (language: Language) => candidates.some((c) => c.language.tag === language.tag);
    const chosen = has(primary) ? primary : secondary && has(secondary) ? secondary : undefined;
    this.#options.logger.info('subtitles.choice', {
      id: request.id,
      hash: Boolean(request.videoHash),
      candidates: countByLanguage(candidates),
      language: chosen?.tag ?? null,
    });
    // Stremio's second request (with the hash) comes ~1 s before the player asks
    // for the track: start preparing it now (download, sync references).
    if (chosen && request.videoHash) void this.prepare({ ...request, language: chosen }, { warm: true }).catch(() => {});
    return chosen;
  }

  /**
   * Produces the SRT for a track (cache → best candidate → next ones), at most
   * once at a time per track. `warm` prepares ahead of the player (see
   * chooseLanguage) without counting it as served.
   */
  async prepare(track: TrackRequest, options: { warm?: boolean } = {}): Promise<Buffer | undefined> {
    const key = `${videoKey(track)}|${track.language.tag}`;
    let pending = this.#preparing.get(key);
    if (!pending) {
      const endJob = this.#options.beginJob();
      pending = this.#prepare(track).finally(() => {
        this.#preparing.delete(key);
        endJob();
      });
      this.#preparing.set(key, pending);
    }
    const result = await pending;
    if (options.warm) return result.srt;
    const { logger } = this.#options;
    if (!result.srt) {
      this.#stats.unavailable += 1;
      logger.warn('subtitles.unavailable', { id: track.id, language: track.language.tag, candidates: result.candidates });
      return undefined;
    }
    this.#record(track, result.sync);
    logger.info('subtitles.served', { id: track.id, ...result.details, sync: result.sync, bytes: result.srt.length });
    return result.srt;
  }

  /** Drops everything kept in memory (called when the addon goes idle). */
  status(): Record<string, unknown> {
    return { ...this.#stats, recentUnsynced: this.#unsynced };
  }

  release(): void {
    this.#searches.clear();
    this.#hashes.clear();
  }

  async #prepare(track: TrackRequest): Promise<Prepared> {
    const { budgetMs } = this.#options;
    const deadline = Date.now() + budgetMs;
    // Probing the file and searching run in parallel.
    const videoSize = track.videoSize ?? this.#hashes.get(videoKey(track))?.videoSize;
    const [candidates, video] = await Promise.all([
      this.#search(track),
      this.#options.inspect?.(track.filename, videoSize) ?? Promise.resolve(undefined),
    ]);
    // Ranked across all languages: other languages can serve as sync references.
    const ranked = await this.#preferCached(this.#rank(candidates, track.filename, video?.fps));
    const wanted = ranked.filter((entry) => entry.candidate.language.tag === track.language.tag);
    // Sources that already failed here (quota, not SRT…) are not retried as references.
    const failed = new Set<string>();
    const done = (entry: Ranked, fetched: Fetched, srt: Buffer, sync: Record<string, unknown>): Prepared => ({
      srt,
      sync,
      details: { ...describe(entry, fetched.source), cache: fetched.cached },
    });

    // The first usable subtitle is kept as a fallback; while its timing is not
    // trusted, the next ones are tried — only free ones, to spare the quota.
    let fallback: Prepared | undefined;
    let attempts = 0;
    for (const entry of wanted) {
      if (attempts >= MAX_ATTEMPTS) break;
      if (fallback && metered(entry)) continue;
      attempts += 1;
      const fetched = await this.#fetch(entry, track, deadline, failed);
      if (fetched === 'deadline') break;
      if (!fetched) continue;
      const { srt, sync } = await this.#sync(entry, fetched.srt, ranked, track, deadline, failed, video, videoSize);
      if (TRUSTED.has(sync['status'] as string) || sync['status'] === 'budget_exceeded') return done(entry, fetched, srt, sync);
      fallback ??= done(entry, fetched, srt, sync);
    }
    return fallback ?? { srt: undefined, candidates: wanted.length };
  }

  #record(track: TrackRequest, sync: Record<string, unknown>): void {
    const status = String(sync['status']);
    this.#stats.served[status] = (this.#stats.served[status] ?? 0) + 1;
    if (!UNSYNCED.has(status)) return;
    this.#unsynced.unshift({ at: new Date().toISOString(), id: track.id, filename: track.filename ?? null, language: track.language.tag, status });
    this.#unsynced.length = Math.min(this.#unsynced.length, MAX_UNSYNCED);
  }

  /** Gets the file of a ranked entry: disk cache, then cheaper copies (no quota), then the candidate itself. */
  async #fetch(entry: Ranked, track: TrackRequest, deadline: number, failed: Set<string>): Promise<Fetched | undefined | 'deadline'> {
    const { logger, cache, budgetMs } = this.#options;
    for (const source of [...entry.cheaper, entry.candidate]) {
      if (Date.now() > deadline) {
        logger.warn('subtitles.budget_exceeded', { id: track.id, language: track.language.tag, budgetMs });
        return 'deadline';
      }
      const cacheKey = `${source.providerId}:${source.ref}`;
      if (failed.has(cacheKey)) continue;
      const cached = await cache.get(cacheKey);
      if (cached) return { srt: cached, source, cached: true };
      const provider = this.#providers.get(source.providerId);
      if (!provider) continue;
      try {
        const text = decodeSubtitle(await provider.download(source));
        if (!looksLikeSrt(text)) {
          logger.warn('subtitles.not_srt', { id: track.id, provider: source.providerId, ref: source.ref });
          for (const copy of [...entry.cheaper, entry.candidate]) failed.add(`${copy.providerId}:${copy.ref}`);
          return undefined; // same file from another source would not be SRT either
        }
        const srt = Buffer.from(toSrt(text), 'utf8');
        await cache.put(cacheKey, srt);
        return { srt, source, cached: false };
      } catch (err) {
        failed.add(cacheKey);
        logger.warn('subtitles.download_failed', { id: track.id, provider: source.providerId, message: (err as Error).message });
      }
    }
    return undefined;
  }

  /**
   * When the chosen subtitle was not made for this exact file, aligns it to one
   * that was (any language) and corrects offset and frame rate. Never makes it
   * worse: without a reference, or with low confidence, it is served as is.
   */
  async #sync(
    entry: Ranked,
    srt: Buffer,
    ranked: Ranked[],
    track: TrackRequest,
    deadline: number,
    failed: Set<string>,
    video: VideoInfo | undefined,
    videoSize: number | undefined,
  ): Promise<{ srt: Buffer; sync: Record<string, unknown> }> {
    const { enabled } = this.#options.sync;
    if (!enabled) return { srt, sync: { status: 'disabled' } };
    if (exact(entry, track.filename)) return { srt, sync: { status: 'exact' } };
    const cues = parseSrt(decodeSubtitle(srt));

    // 1. A subtitle made for this exact file, from the subtitle sources.
    const references = ranked
      .filter((other) => other !== entry && exact(other, track.filename))
      // Free downloads first, then the best match.
      .sort((a, b) => Number(metered(a)) - Number(metered(b)) || b.score - a.score)
      .slice(0, MAX_REFERENCES);
    for (const reference of references) {
      const fetched = await this.#fetch(reference, track, deadline, failed);
      if (fetched === 'deadline') return { srt, sync: { status: 'budget_exceeded' } };
      if (!fetched) continue;
      const result = align(parseSrt(decodeSubtitle(fetched.srt)), cues);
      if (!result) continue;
      return this.#judge(srt, cues, result, {
        reference: reference.candidate.releaseName ?? null,
        referenceLanguage: reference.candidate.language.tag,
      });
    }

    // 2. Same source and resolution as the file (BluRay 2160p for a BluRay 2160p):
    // such subtitles have matched in every case seen so far. Reading the
    // embedded reference costs seconds the player waits for: not worth it here.
    if (likelySynced(entry, track.filename)) return { srt, sync: { status: 'likely_synced' } };

    // 3. A text subtitle embedded in the video file itself.
    const embedded = await this.#embedded(track, video, videoSize, cues);
    if (embedded && embedded !== 'pending') {
      const result = align(embedded.cues, nearReference(cues, embedded.cues, EMBEDDED_MARGIN_MS));
      if (result) {
        return this.#judge(srt, cues, result, {
          reference: 'embedded',
          referenceLanguage: embedded.track.language ?? null,
          referenceCues: embedded.cues.length,
        });
      }
    }

    // 4. Nothing to compare with: at most a frame-rate fix.
    const fallback = fpsOnly(entry, srt, video?.fps);
    return embedded === 'pending' ? { srt: fallback.srt, sync: { ...fallback.sync, embedded: 'pending' } } : fallback;
  }

  /** Applies an alignment only when it is trusted and clearly better than leaving the subtitle as is. */
  #judge(srt: Buffer, cues: Cue[], result: Alignment, reference: Record<string, unknown>): { srt: Buffer; sync: Record<string, unknown> } {
    const { minConfidence } = this.#options.sync;
    const details = {
      ...reference,
      offsetMs: result.offsetMs,
      scale: Number(result.scale.toFixed(5)),
      confidence: round2(result.confidence),
      baseline: round2(result.baseline),
    };
    if (result.baseline >= minConfidence && result.confidence - result.baseline < MIN_SYNC_GAIN) {
      return { srt, sync: { status: 'already_synced', ...details } };
    }
    if (result.confidence < minConfidence || result.confidence - result.baseline < MIN_SYNC_GAIN) {
      return { srt, sync: { status: 'low_confidence', ...details } };
    }
    return { srt: Buffer.from(serializeSrt(retime(cues, result.scale, result.offsetMs)), 'utf8'), sync: { status: 'synced', ...details } };
  }

  /**
   * The embedded reference. The player keeps the first subtitle it gets for the
   * whole movie, so this waits for the extraction to finish (it has its own
   * per-window timeout) rather than serving an unchecked subtitle early.
   */
  async #embedded(
    track: TrackRequest,
    video: VideoInfo | undefined,
    videoSize: number | undefined,
    cues: Cue[],
  ): Promise<{ cues: Cue[]; track: EmbeddedTrack } | 'pending' | undefined> {
    const { embedded } = this.#options;
    if (!embedded) return undefined;
    let lookup = await embedded.lookup(track.filename, videoSize, video, cues);
    if (lookup.state === 'pending') {
      await lookup.done;
      lookup = await embedded.lookup(track.filename, videoSize, video, cues);
    }
    if (lookup.state === 'ready') return { cues: lookup.cues, track: lookup.track };
    return lookup.state === 'pending' ? 'pending' : undefined;
  }

  /** Searches every provider in parallel; one failing or slow provider does not block the others. */
  #search(request: SubtitlesRequest): Promise<SubtitleCandidate[]> {
    const learned = request.videoHash
      ? { videoHash: request.videoHash, videoSize: request.videoSize }
      : this.#hashes.get(videoKey(request));
    const query: SubtitleQuery = {
      type: request.type,
      imdbId: request.imdbId,
      languages: [this.#options.primary, ...(this.#options.secondary ? [this.#options.secondary] : [])],
    };
    if (request.season !== undefined) query.season = request.season;
    if (request.episode !== undefined) query.episode = request.episode;
    if (request.filename) query.filename = request.filename;
    if (learned?.videoHash) query.videoHash = learned.videoHash;
    if (learned?.videoSize !== undefined) query.videoSize = learned.videoSize;

    const key = `${videoKey(request)}|${query.videoHash ?? ''}`;
    const hit = this.#searches.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.result;

    const result = Promise.all(
      this.#options.providers.map(async (provider) => {
        try {
          return await provider.search(query);
        } catch (err) {
          this.#options.logger.warn('provider.search_failed', { provider: provider.id, message: (err as Error).message });
          return [];
        }
      }),
    ).then((lists) => lists.flat());
    remember(this.#searches, key, { expiresAt: Date.now() + SEARCH_TTL_MS, result });
    return result;
  }

  /**
   * A metered subtitle already on disk costs nothing: give it the free bonus too.
   * Besides saving quota, replays keep getting the same (already checked) subtitle.
   */
  async #preferCached(ranked: Ranked[]): Promise<Ranked[]> {
    const { cache } = this.#options;
    const adjusted = await Promise.all(
      ranked.map(async (entry) => {
        if (!metered(entry) || !(await cache.has(`${entry.candidate.providerId}:${entry.candidate.ref}`))) return entry;
        return { ...entry, score: entry.score + FREE_BONUS, cached: true };
      }),
    );
    return adjusted.sort((a, b) => b.score - a.score);
  }

  /** Folds copies of the same subtitle (`sameAs`) into one entry and sorts best first. */
  #rank(candidates: SubtitleCandidate[], filename: string | undefined, realFps: number | undefined): Ranked[] {
    const context: RankContext = { filename, videoFps: realFps ?? videoFps(candidates, filename) };
    const bySource = new Map<string, SubtitleCandidate>();
    for (const c of candidates) if (c.sourceId) bySource.set(`${c.providerId}:${c.sourceId}`, c);

    const folded = new Set<SubtitleCandidate>();
    const entries: Ranked[] = [];
    for (const candidate of candidates) {
      const copy = candidate.sameAs && bySource.get(`${candidate.sameAs.providerId}:${candidate.sameAs.sourceId}`);
      if (copy) folded.add(copy);
      entries.push({ candidate, cheaper: copy ? [copy] : [], score: 0 });
    }
    return entries
      .filter((entry) => !folded.has(entry.candidate))
      .map((entry) => {
        // A copy may know something the original does not (e.g. the v3 addon flags hash matches).
        const best = Math.max(score(entry.candidate, context), ...entry.cheaper.map((c) => score(c, context)));
        return { ...entry, score: best + (metered(entry) ? 0 : FREE_BONUS) };
      })
      .sort((a, b) => b.score - a.score);
  }
}

/** Outcomes where the timing was not checked against anything: phase 4 material. */
const UNSYNCED = new Set(['no_reference', 'low_confidence', 'budget_exceeded']);
const MAX_UNSYNCED = 10;

/** Sync outcomes good enough to stop looking at other candidates. */
const TRUSTED = new Set(['exact', 'synced', 'already_synced', 'likely_synced', 'disabled', 'no_reference', 'fps_corrected']);

/** Subtitle from another release of the same source and resolution as the file (see #sync). */
function likelySynced(entry: Ranked, filename: string | undefined): boolean {
  if (!filename) return false;
  const file = parseRelease(filename);
  if (!file.source || !file.resolution) return false;
  return [entry.candidate, ...entry.cheaper].some((c) => {
    if (!c.releaseName) return false;
    const release = parseRelease(c.releaseName);
    return release.source === file.source && release.resolution === file.resolution;
  });
}

/**
 * Without a reference, the one fix that needs no comparison: a subtitle timed
 * for another frame rate (e.g. 25 fps PAL) is rescaled to the file's real fps.
 */
function fpsOnly(entry: Ranked, srt: Buffer, realFps: number | undefined): { srt: Buffer; sync: Record<string, unknown> } {
  // Subtitle sites store fps loosely (23.98, 23.976, 0): trust only standard rates.
  const declared = standardRate([entry.candidate, ...entry.cheaper].find((c) => c.fps)?.fps);
  if (!realFps || !declared || sameFps(realFps, declared)) return { srt, sync: { status: 'no_reference', fps: realFps ?? null } };
  const scale = declared / realFps;
  const fixed = Buffer.from(serializeSrt(retime(parseSrt(decodeSubtitle(srt)), scale, 0)), 'utf8');
  return { srt: fixed, sync: { status: 'fps_corrected', subtitleFps: declared, videoFps: realFps, scale: Number(scale.toFixed(5)) } };
}

/**
 * The video's frame rate, as declared by the subtitles made for this exact file
 * (hash matches first). Undefined when none of them declares one, or they disagree.
 */
function videoFps(candidates: SubtitleCandidate[], filename: string | undefined): number | undefined {
  const exactOnes = candidates.filter((c) => c.fps && isExact(c, filename)).sort((a, b) => Number(Boolean(b.hashMatch)) - Number(Boolean(a.hashMatch)));
  const first = exactOnes[0]?.fps;
  return first && exactOnes.every((c) => sameFps(c.fps as number, first)) ? first : undefined;
}

function exact(entry: Ranked, filename: string | undefined): boolean {
  return [entry.candidate, ...entry.cheaper].some((c) => isExact(c, filename));
}

/** Getting this entry spends quota (no free copy). */
function metered(entry: Ranked): boolean {
  return !entry.cached && entry.cheaper.length === 0 && Boolean(entry.candidate.metered);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function videoKey(request: { id: string; filename?: string }): string {
  return `${request.id}|${request.filename ?? ''}`;
}

/** Map with a size cap: the oldest entry goes first. */
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value as string);
}

function countByLanguage(candidates: SubtitleCandidate[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of candidates) counts[c.language.tag] = (counts[c.language.tag] ?? 0) + 1;
  return counts;
}

function describe(entry: Ranked, source: SubtitleCandidate) {
  return {
    language: source.language.tag,
    provider: source.providerId,
    release: entry.candidate.releaseName ?? source.releaseName ?? null,
    hashMatch: Boolean(entry.candidate.hashMatch || entry.cheaper.some((c) => c.hashMatch)),
    score: Math.round(entry.score),
  };
}
