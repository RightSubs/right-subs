import { LANGUAGES, type Language } from '../languages/languages.ts';
import type { Logger } from '../logger.ts';
import { pickLanguageTrack, type EmbeddedTrack } from '../media/embedded.ts';
import { standardRate, type VideoInfo } from '../media/probe.ts';
import type { SubtitleCandidate, SubtitleProvider, SubtitleQuery } from '../providers/types.ts';
import type { SubtitlesRequest } from '../stremio/request.ts';
import { align, type Alignment } from '../sync/align.ts';
import { checkConsistency } from '../sync/consistency.ts';
import type { EmbeddedReferences } from '../sync/embedded-reference.ts';
import { nearReference } from '../sync/windows.ts';
import { translateCues, type Translator } from '../translation/deepl.ts';
import { withTranslationNotice } from '../translation/notice.ts';
import type { SubtitleCache } from './cache.ts';
import { isExact, parseRelease, sameFps, score, type RankContext } from './rank.ts';
import { cleanSrt } from './clean.ts';
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
/**
 * …or this much more lines starting together. Dense dialogue (the embedded
 * windows are picked where people talk most) overlaps at any offset: Drive
 * (2011) at −12.8 s scored 0.93 against 0.85 unshifted, but 77% of lines
 * started together against 32%.
 */
const MIN_STARTS_GAIN = 0.25;
/** Largest frame-rate ratio treated as a speed-up (PAL 25 vs 23.976 is 4.3%). */
const MAX_SPEEDUP = 0.05;
/** Translation source: candidates with a distinct timing examined, in any language. */
const MAX_TRANSLATION_CANDIDATES = 8;
/** …and downloads allowed to find them (identical copies are skipped after the download). */
const MAX_TRANSLATION_DOWNLOADS = 16;
/**
 * Windows read from the video to check a candidate before translating it: enough cues
 * for checkConsistency to align each half (3 windows were not: the stepped English
 * subtitle of Generation Z S01E01 passed with confidence 0.98).
 */
const TRANSLATION_WINDOWS = 6;
/** Confidences this close are a tie: English wins it, then the best ranked. */
const CONFIDENCE_TIE = 0.02;
/** A correction smaller than this (ms) is leaving the subtitle as it is, even when both halves agree on it. */
const MIN_REAL_SHIFT_MS = 500;
/** …and a rescale smaller than this (0.05%) is noise: 23.976 vs 24 fps is 0.1%, about 3 s by the end of an episode. */
const MIN_REAL_RESCALE = 0.0005;
/** Lines starting together gained over the unshifted subtitle, enough once both halves agree. */
const MIN_AGREED_STARTS_GAIN = 0.1;
/**
 * Share of the video's lines that must start together with a line of the subtitle, after
 * the correction. In dense dialogue about a third do by chance (0.37 for the English
 * subtitle of Generation Z, which fits nowhere); the German one that fits had 0.53–0.58,
 * even with another language's way of splitting lines. Below this "already synced" or
 * "synced" is not evidence, and a tie in confidence could pick the wrong subtitle.
 */
const MIN_AGREEING_STARTS = 0.45;

/** Whether enough lines start together for an alignment to count as real agreement (see MIN_AGREEING_STARTS). */
export function startsAgreeEnough(starts: number): boolean {
  return starts >= MIN_AGREEING_STARTS;
}

/**
 * Whether an alignment that #judge left as "already synced" is in fact a real correction.
 * #judge is cautious (it must never make a subtitle worse), and in dense dialogue the
 * unshifted subtitle already overlaps 89% of the time: Generation Z's German subtitle
 * (+6.0 s, both halves agree within 80 ms) gained 0.2487 in lines starting together,
 * a hair under MIN_STARTS_GAIN, and was served 6 s off. Once checkConsistency has
 * confirmed one correction all over the movie, a smaller gain is enough.
 */
export function agreedShiftIsReal(alignment: Pick<Alignment, 'offsetMs' | 'scale' | 'starts' | 'startsBaseline'>): boolean {
  const moves = Math.abs(alignment.offsetMs) >= MIN_REAL_SHIFT_MS || Math.abs(alignment.scale - 1) >= MIN_REAL_RESCALE;
  return moves && alignment.starts - alignment.startsBaseline >= MIN_AGREED_STARTS_GAIN;
}

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
  /** Searched only to sync the chosen subtitle (`sync.referenceLanguages`): never served. */
  references?: Language[];
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
  /** Last resort: when nothing exists in the primary or secondary language, translates a synced reference subtitle into the primary one. */
  translator?: Translator;
  /** TEST: translate always, from these languages only, whatever exists in the primary and secondary ones. */
  forceFrom?: Language[];
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
    const { chosen, translatable, forced } = this.#plan(candidates);
    this.#options.logger.info('subtitles.choice', {
      id: request.id,
      hash: Boolean(request.videoHash),
      candidates: countByLanguage(candidates),
      language: chosen?.tag ?? null,
      ...(translatable ? { translate: true } : {}),
      ...(forced ? { forced: this.#options.forceFrom?.map((lang) => lang.tag) } : {}),
    });
    // Stremio's second request (with the hash) comes ~1 s before the player asks
    // for the track: start preparing it now (download, sync references).
    if (chosen && request.videoHash) void this.prepare({ ...request, language: chosen }, { warm: true }).catch(() => {});
    return chosen;
  }

  /** Which language is offered, and whether it is a translation (last resort) or a forced one (test). */
  #plan(candidates: SubtitleCandidate[]): { chosen: Language | undefined; translatable: boolean; forced: boolean } {
    const { primary, secondary } = this.#options;
    const has = (language: Language) => candidates.some((c) => c.language.tag === language.tag);
    let chosen = has(primary) ? primary : secondary && has(secondary) ? secondary : undefined;
    // TEST: translation is forced, so the primary language is offered whatever exists in it.
    const forced = this.#forcedSources(candidates.map((c) => c.language)).length > 0;
    if (forced) chosen = undefined;
    // Last resort: offer the primary language when a reference subtitle exists to translate from.
    const translatable = !chosen && (forced || this.#translatable(candidates));
    if (translatable) chosen = primary;
    return { chosen, translatable, forced };
  }

  /**
   * The wanted language the file itself already has a subtitle track in (primary first, then
   * secondary), when it has one. The probe lists the tracks from the file's header: it costs
   * about a second and no search, no quota and no reading of the video. The player lists those
   * tracks on its own, so the addon only has to say so (see embeddedNoticeSrt).
   */
  async embeddedLanguage(request: SubtitlesRequest): Promise<Language | undefined> {
    const { primary, secondary, inspect } = this.#options;
    if (!inspect) return undefined;
    const video = await inspect(request.filename, request.videoSize ?? this.#hashes.get(videoKey(request))?.videoSize);
    const language = [primary, ...(secondary ? [secondary] : [])].find((lang) => pickLanguageTrack(video?.subtitleTracks ?? [], [lang]));
    if (language) this.#options.logger.info('subtitles.embedded_language', { id: request.id, language: language.tag });
    return language;
  }

  /**
   * Whether the offered subtitle is a translation that is not ready yet, i.e. asking for
   * it will take a while (reading the video, the DeepL) and Stremio may give up before.
   */
  async translationPending(request: SubtitlesRequest): Promise<boolean> {
    const { translatable, forced } = this.#plan(await this.#search(request));
    if (!translatable) return false;
    const prefix = forced ? 'translated-forced' : 'translated';
    return !(await this.#options.cache.has(`${prefix}:${this.#options.primary.tag}:${videoKey(request)}`));
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
      // Whatever its source (online, embedded, translated), nothing unreadable reaches the screen.
      pending = this.#prepare(track).then(cleaned).finally(() => {
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
    // TEST: forced translation skips what exists in the wanted language and translates from the chosen ones only.
    const forcedTags = new Set(this.#forcedSources(ranked.map((entry) => entry.candidate.language)).map((lang) => lang.tag));
    if (forcedTags.size > 0 && track.language.tag === this.#options.primary.tag) {
      const sources = ranked.filter((entry) => forcedTags.has(entry.candidate.language.tag));
      this.#options.logger.info('translation.forced', { id: track.id, from: [...forcedTags], sources: sources.length });
      const forced = await this.#translate(track, sources, deadline, new Set(), video, videoSize, 'translated-forced');
      return forced ?? { srt: undefined, candidates: sources.length };
    }
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
    if (fallback) return fallback;
    if (this.#options.translator && track.language.tag === this.#options.primary.tag) {
      const translated = await this.#translate(track, ranked, deadline, failed, video, videoSize);
      if (translated) return translated;
    }
    return { srt: undefined, candidates: wanted.length };
  }

  /** TEST: the candidates' languages that forceFrom allows as source (none when not forcing). */
  #forcedSources(languages: Language[]): Language[] {
    const { translator, forceFrom } = this.#options;
    if (!translator || !forceFrom?.length) return [];
    return languages.filter((language) => forceFrom.some((lang) => lang.tag === language.tag));
  }

  /** Whether any subtitle exists, in any language, to translate from (the search covers every language when a translator is configured). */
  #translatable(candidates: SubtitleCandidate[]): boolean {
    return Boolean(this.#options.translator) && candidates.length > 0;
  }

  /**
   * Last resort (DeepL): translates a subtitle whose timing is confirmed, in whatever
   * language it exists — a translation of an out-of-sync subtitle would be out of sync
   * too, and the English ones are often timed for another cut of the video. See
   * #translationSource for how the source is chosen. The result is cached, so replaying
   * costs no quota.
   */
  async #translate(
    track: TrackRequest,
    ranked: Ranked[],
    deadline: number,
    failed: Set<string>,
    video: VideoInfo | undefined,
    videoSize: number | undefined,
    cachePrefix = 'translated',
  ): Promise<Prepared | undefined> {
    const { translator, cache, logger, primary } = this.#options;
    if (!translator) return undefined;
    const cacheKey = `${cachePrefix}:${primary.tag}:${videoKey(track)}`;
    const cachedSrt = await cache.get(cacheKey);
    if (cachedSrt) {
      return { srt: cachedSrt, sync: { status: 'translated', cache: true }, details: { language: primary.tag, provider: 'deepl', cache: true } };
    }
    const source = await this.#translationSource(track, ranked, deadline, failed, video, videoSize);
    if (!source) return undefined;
    const { entry, fetched, checked } = source;
    try {
      const { cues: translated, characters } = await translateCues(
        translator,
        parseSrt(decodeSubtitle(checked.srt)),
        primary,
        entry.candidate.language,
      );
      if (translated.length === 0) return undefined;
      const srt = Buffer.from(serializeSrt(withTranslationNotice(translated, primary, source.unconfirmed)), 'utf8');
      await cache.put(cacheKey, srt);
      logger.info('translation.done', { id: track.id, from: entry.candidate.language.tag, to: primary.tag, cues: translated.length, characters });
      return {
        srt,
        sync: { ...checked.sync, status: 'translated', sourceSync: checked.sync['status'], from: entry.candidate.language.tag, characters },
        details: { ...describe(entry, fetched.source), language: primary.tag, provider: 'deepl', cache: false },
      };
    } catch (err) {
      logger.warn('translation.failed', { id: track.id, message: (err as Error).message });
      return undefined; // quota, key or network: another source would fail the same way
    }
  }

  /**
   * The subtitle to translate: a perfect match (made for this exact file) if it checks
   * out, otherwise the best of the candidates in every language, each checked against the
   * timing of the text track embedded in the video (a few short windows, never the whole
   * video). Free candidates (the v3 addon) are examined first and the metered ones (API
   * quota) only when none works, at most MAX_TRANSLATION_CANDIDATES in all. A candidate
   * is accepted only when one offset and scale fit it all over the movie
   * (checkConsistency); the one with the highest confidence wins, English on a tie.
   * Without an embedded track to compare with, see #translationSourceUnchecked.
   */
  async #translationSource(
    track: TrackRequest,
    ranked: Ranked[],
    deadline: number,
    failed: Set<string>,
    video: VideoInfo | undefined,
    videoSize: number | undefined,
  ): Promise<TranslationSource | undefined> {
    const { logger, sync } = this.#options;
    if (!sync.enabled) return this.#translationSourceUnchecked(track, ranked, deadline, failed, video, videoSize);
    const stages = [ranked.filter((entry) => !metered(entry)), ranked.filter(metered)];
    const accepted: TranslationSource[] = [];
    const seen = new Set<string>();
    let examined = 0;
    let downloads = 0;
    // Reading the video windows takes a while (24 s on the box) and has its own timeout: it must not
    // eat the time left to check the candidates, or the first request fails and the player retries.
    let limit = deadline;
    search: for (const stage of stages) {
      if (accepted.length > 0) break;
      for (const entry of stage) {
        if (examined >= MAX_TRANSLATION_CANDIDATES || downloads >= MAX_TRANSLATION_DOWNLOADS) break search;
        downloads += 1;
        const fetched = await this.#fetch(entry, track, limit, failed);
        if (fetched === 'deadline') break search;
        if (!fetched) continue;
        const cues = parseSrt(decodeSubtitle(fetched.srt));
        // Copies of the same subtitle (the same release from several uploaders) are judged once.
        const print = timingFingerprint(cues);
        if (seen.has(print)) continue;
        seen.add(print);
        examined += 1;
        const verdict = await this.#checkForTranslation(fetched.srt, cues, track, video, videoSize);
        limit = Math.max(limit, Date.now() + this.#options.budgetMs);
        if (verdict === 'no_ruler') return this.#translationSourceUnchecked(track, ranked, deadline, failed, video, videoSize);
        logger.info('translation.candidate', {
          id: track.id,
          from: entry.candidate.language.tag,
          release: entry.candidate.releaseName ?? null,
          provider: fetched.source.providerId,
          ...verdict.sync,
        });
        if (!verdict.accepted) continue;
        const source = { entry, fetched, checked: { srt: verdict.srt, sync: verdict.sync }, confidence: verdict.confidence };
        // A perfect match that checks out needs no comparison with the others.
        if (exact(entry, track.filename)) return source;
        accepted.push(source);
      }
    }
    if (accepted.length === 0) logger.info('translation.skipped', { id: track.id, status: 'no_confirmed_source', examined });
    return bestSource(accepted);
  }

  /**
   * One candidate against the embedded track. 'no_ruler' = there is none to compare with.
   * Accepted only when the alignment is trusted and the same all over the movie.
   */
  async #checkForTranslation(
    srt: Buffer,
    cues: Cue[],
    track: TrackRequest,
    video: VideoInfo | undefined,
    videoSize: number | undefined,
  ): Promise<'no_ruler' | { accepted: false; sync: Record<string, unknown> } | { accepted: true; srt: Buffer; sync: Record<string, unknown>; confidence: number }> {
    const embedded = await this.#embedded(track, video, videoSize, cues, TRANSLATION_WINDOWS);
    if (!embedded || embedded === 'pending') return 'no_ruler';
    const reference = { reference: 'embedded', referenceLanguage: embedded.track.language ?? null, referenceCues: embedded.cues.length };
    const result = align(embedded.cues, nearReference(cues, embedded.cues, EMBEDDED_MARGIN_MS));
    if (!result) return { accepted: false, sync: { status: 'low_confidence', ...reference } };
    const judged = this.#judge(srt, cues, result, reference);
    const status = judged.sync['status'];
    if (status !== 'synced' && status !== 'already_synced') return { accepted: false, sync: judged.sync };
    const consistency = checkConsistency(embedded.cues, cues, result, EMBEDDED_MARGIN_MS);
    if (!consistency.ok) {
      const deviation = 'deviationMs' in consistency ? { deviationMs: consistency.deviationMs } : {};
      return { accepted: false, sync: { ...judged.sync, status: consistency.reason === 'steps' ? 'inconsistent' : 'unconfirmed', ...deviation } };
    }
    if (!startsAgreeEnough(result.starts)) {
      return { accepted: false, sync: { ...judged.sync, status: 'weak_agreement', deviationMs: consistency.deviationMs } };
    }
    if (status === 'already_synced' && agreedShiftIsReal(result)) {
      const fixed = Buffer.from(serializeSrt(retime(cues, result.scale, result.offsetMs)), 'utf8');
      return { accepted: true, srt: fixed, sync: { ...judged.sync, status: 'synced', deviationMs: consistency.deviationMs }, confidence: result.confidence };
    }
    return { accepted: true, srt: judged.srt, sync: { ...judged.sync, deviationMs: consistency.deviationMs }, confidence: result.confidence };
  }

  /**
   * No embedded track to check against (or sync is off): the best-ranked candidates go
   * through the normal sync, and only an outcome that does not rest on trust alone is
   * translated. A subtitle made for this exact file is used as is.
   *
   * **Movies only, last of the last resorts:** when nothing could be confirmed, the best
   * candidate whose frame rate is the video's is translated anyway, and the notice on
   * screen says its timing was not confirmed. A movie is one cut, so a subtitle for another
   * release of it is usually right; an episode is not (Generation Z S01E01: ad breaks), so
   * series get nothing. Chosen by the user (2026-11-03, A Murder Between Friends: a WEB file
   * with no embedded subtitles and only English subtitles for another WEB release).
   */
  async #translationSourceUnchecked(
    track: TrackRequest,
    ranked: Ranked[],
    deadline: number,
    failed: Set<string>,
    video: VideoInfo | undefined,
    videoSize: number | undefined,
  ): Promise<TranslationSource | undefined> {
    const { logger, sync } = this.#options;
    const order = [...ranked.filter((entry) => !metered(entry)), ...ranked.filter(metered)];
    const unconfirmed: TranslationSource[] = [];
    for (const entry of order.slice(0, MAX_ATTEMPTS)) {
      const fetched = await this.#fetch(entry, track, deadline, failed);
      if (fetched === 'deadline') break;
      if (!fetched) continue;
      const checked =
        sync.enabled && exact(entry, track.filename)
          ? { srt: fetched.srt, sync: { status: 'exact', verified: false } }
          : await this.#sync(entry, fetched.srt, ranked, track, deadline, failed, video, videoSize);
      if (TRANSLATABLE.has(checked.sync['status'] as string)) return { entry, fetched, checked, confidence: 0 };
      logger.info('translation.skipped', { id: track.id, from: entry.candidate.language.tag, status: checked.sync['status'] });
      if (track.type === 'movie' && declaresVideoFps(entry, video?.fps)) {
        unconfirmed.push({
          entry,
          fetched,
          checked: { srt: checked.srt, sync: { status: 'unconfirmed', verified: false, fps: video?.fps ?? null } },
          confidence: 0,
          unconfirmed: true,
        });
      }
    }
    // Same preference as elsewhere: English first, then the best ranked.
    const fallback = unconfirmed.find((source) => source.entry.candidate.language.tag === 'en') ?? unconfirmed[0];
    if (fallback) {
      logger.info('translation.unconfirmed', {
        id: track.id,
        from: fallback.entry.candidate.language.tag,
        release: fallback.entry.candidate.releaseName ?? null,
        fps: video?.fps ?? null,
        candidates: unconfirmed.length,
      });
    }
    return fallback;
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
    const exactOnes = references(ranked, (other) => other !== entry && exact(other, track.filename));
    const byExact = await this.#alignTo(exactOnes, srt, cues, track, deadline, failed);
    if (byExact === 'deadline') return { srt, sync: { status: 'budget_exceeded' } };
    if (byExact) return byExact;

    // 2. Same cut, source and resolution as the file (BluRay 2160p for a BluRay 2160p):
    // such subtitles have matched in every case seen so far. Reading the
    // embedded reference costs seconds the player waits for: not worth it here.
    if (sameEdit(entry, track.filename)) return { srt, sync: { status: 'likely_synced' } };

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

    // 4. A subtitle made for another release of the same cut, source and
    // resolution (a DC BluRay 1080p from another group): the timing that
    // likely_synced trusts, used here as a reference instead.
    const sameEditOnes = references(ranked, (other) => other !== entry && !exact(other, track.filename) && sameEdit(other, track.filename));
    const bySameEdit = await this.#alignTo(sameEditOnes, srt, cues, track, deadline, failed, { referenceMatch: 'same_edit' });
    if (bySameEdit && bySameEdit !== 'deadline') return bySameEdit;

    // 5. Nothing to compare with: at most a frame-rate fix.
    const fallback = fpsOnly(entry, srt, video?.fps);
    return embedded === 'pending' ? { srt: fallback.srt, sync: { ...fallback.sync, embedded: 'pending' } } : fallback;
  }

  /** Aligns to the first reference subtitle that can be downloaded and matched. */
  async #alignTo(
    candidates: Ranked[],
    srt: Buffer,
    cues: Cue[],
    track: TrackRequest,
    deadline: number,
    failed: Set<string>,
    extra: Record<string, unknown> = {},
  ): Promise<{ srt: Buffer; sync: Record<string, unknown> } | 'deadline' | undefined> {
    for (const reference of candidates) {
      const fetched = await this.#fetch(reference, track, deadline, failed);
      if (fetched === 'deadline') return 'deadline';
      if (!fetched) continue;
      const result = align(parseSrt(decodeSubtitle(fetched.srt)), cues);
      if (!result) continue;
      return this.#judge(srt, cues, result, {
        reference: reference.candidate.releaseName ?? null,
        referenceLanguage: reference.candidate.language.tag,
        ...extra,
      });
    }
    return undefined;
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
      starts: round2(result.starts),
      startsBaseline: round2(result.startsBaseline),
    };
    const gains = result.confidence - result.baseline >= MIN_SYNC_GAIN || result.starts - result.startsBaseline >= MIN_STARTS_GAIN;
    if (result.baseline >= minConfidence && !gains) {
      return { srt, sync: { status: 'already_synced', ...details } };
    }
    if (result.confidence < minConfidence || !gains) {
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
    windows?: number,
  ): Promise<{ cues: Cue[]; track: EmbeddedTrack } | 'pending' | undefined> {
    const { embedded } = this.#options;
    if (!embedded) return undefined;
    const options = windows ? { windows } : {};
    let lookup = await embedded.lookup(track.filename, videoSize, video, cues, options);
    if (lookup.state === 'pending') {
      await lookup.done;
      lookup = await embedded.lookup(track.filename, videoSize, video, cues, options);
    }
    if (lookup.state === 'ready') return { cues: lookup.cues, track: lookup.track };
    return lookup.state === 'pending' ? 'pending' : undefined;
  }

  /** Searches every provider in parallel; one failing or slow provider does not block the others. */
  #search(request: SubtitlesRequest): Promise<SubtitleCandidate[]> {
    const learned = request.videoHash
      ? { videoHash: request.videoHash, videoSize: request.videoSize }
      : this.#hashes.get(videoKey(request));
    const { primary, secondary, references = [], translator } = this.#options;
    // One search for every language: the reference ones cost no quota (only downloads do).
    // With a translator any language can be the source of the last resort (the best
    // timed one is not always English), so then all of them are searched.
    const languages = translator
      ? [...LANGUAGES]
      : [primary, ...(secondary ? [secondary] : []), ...references].filter(
          (lang, index, all) => all.findIndex((other) => other.tag === lang.tag) === index,
        );
    const query: SubtitleQuery = { type: request.type, imdbId: request.imdbId, languages };
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

function cleaned(prepared: Prepared): Prepared {
  return prepared.srt ? { ...prepared, srt: cleanSrt(prepared.srt) } : prepared;
}

/** Outcomes where the timing was not checked against anything: phase 4 material. */
const UNSYNCED = new Set(['no_reference', 'low_confidence', 'budget_exceeded']);
const MAX_UNSYNCED = 10;

/**
 * Sync outcomes that make a subtitle worth translating when there is no embedded track to
 * check it against (and spending DeepL quota on). `likely_synced` is not one of them: it
 * only means "looks like the file", and Generation Z S01E01's English subtitle looked like it.
 */
const TRANSLATABLE = new Set(['exact', 'synced', 'already_synced', 'disabled']);

/** A subtitle chosen to be translated, with the sync that was applied to it. */
interface TranslationSource {
  entry: Ranked;
  fetched: Fetched;
  checked: { srt: Buffer; sync: Record<string, unknown> };
  /** Alignment confidence (0 when it was not measured). */
  confidence: number;
  /** Translated without any check of its timing (movies only, see #translationSourceUnchecked). */
  unconfirmed?: boolean;
}

/** Whether a candidate declares the same standard frame rate as the video. Unknown on either side: no. */
function declaresVideoFps(entry: Ranked, videoFps: number | undefined): boolean {
  const declared = standardRate([entry.candidate, ...entry.cheaper].find((c) => c.fps)?.fps);
  const real = standardRate(videoFps);
  return Boolean(declared && real && sameFps(real, declared));
}

/** The accepted source with the highest confidence; within CONFIDENCE_TIE of it, English wins. */
function bestSource(accepted: TranslationSource[]): TranslationSource | undefined {
  if (accepted.length === 0) return undefined;
  const top = Math.max(...accepted.map((source) => source.confidence));
  const tied = accepted.filter((source) => top - source.confidence <= CONFIDENCE_TIE);
  return tied.find((source) => source.entry.candidate.language.tag === 'en') ?? [...tied].sort((a, b) => b.confidence - a.confidence)[0];
}

/** Identifies a subtitle by its timing: copies of one release share it whatever their language or uploader. */
function timingFingerprint(cues: Cue[]): string {
  const at = (index: number) => cues[index]?.startMs ?? 0;
  return [cues.length, at(0), at(Math.floor(cues.length / 2)), at(cues.length - 1)].join(':');
}

/** Sync outcomes good enough to stop looking at other candidates. */
const TRUSTED = new Set(['exact', 'synced', 'already_synced', 'likely_synced', 'disabled', 'no_reference', 'fps_corrected']);

/** Subtitle from another release of the same source and resolution as the file (see #sync). */
/** Made from the same cut, source and resolution as the file (any release group). */
function sameEdit(entry: Ranked, filename: string | undefined): boolean {
  if (!filename) return false;
  const file = parseRelease(filename);
  if (!file.source || !file.resolution) return false;
  return [entry.candidate, ...entry.cheaper].some((c) => {
    if (!c.releaseName) return false;
    const release = parseRelease(c.releaseName);
    return release.source === file.source && release.resolution === file.resolution && release.edition === file.edition;
  });
}

/** Reference candidates: free downloads first, then the best match. */
function references(ranked: Ranked[], keep: (entry: Ranked) => boolean): Ranked[] {
  return ranked
    .filter(keep)
    .sort((a, b) => Number(metered(a)) - Number(metered(b)) || b.score - a.score)
    .slice(0, MAX_REFERENCES);
}

/**
 * Without a reference, the one fix that needs no comparison: a subtitle timed
 * for another frame rate (e.g. 25 fps PAL) is rescaled to the file's real fps.
 */
function fpsOnly(entry: Ranked, srt: Buffer, realFps: number | undefined): { srt: Buffer; sync: Record<string, unknown> } {
  // Subtitle sites store fps loosely (23.98, 23.976, 0): trust only standard rates.
  const declared = standardRate([entry.candidate, ...entry.cheaper].find((c) => c.fps)?.fps);
  const scale = realFps && declared ? declared / realFps : 1;
  // A different rate changes the timing only for a sped-up release (25 vs 23.976: 4%).
  // Frame interpolation (60 fps from 23.976, 48 from 24) keeps the duration: leave it alone.
  if (!realFps || !declared || sameFps(realFps, declared) || Math.abs(scale - 1) > MAX_SPEEDUP) {
    return { srt, sync: { status: 'no_reference', fps: realFps ?? null } };
  }
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
