# DeepL translation — how it works and what was measured

**Status:** implemented and validated on the box (Xiaomi TV Box S, Generation Z S01E01, 2026-11-03): subtitle translated from German, with the right timing and Stremio's style. This is the reference document; the short decision is in `CLAUDE.md`, the numbers of the real cases in [FINDINGS.md](FINDINGS.md) and the options in [CONFIGURATION.md](CONFIGURATION.md#translationdeepl).

## What it is and what the maintainers decided

DeepL is the **last resort**: it only comes in when there is no subtitle at all in the primary language (pt-BR) or the secondary (pt-PT). In that case RightSubs makes the subtitle in the primary language from a subtitle **in any language** whose timing was **confirmed** against the video.

Maintainers' decisions (do not reopen without a reason):

- The source can be in **any language** on OpenSubtitles, not only the reference one (English). With no "perfect match" (a subtitle made for the exact file), the best one is taken, synced by sampling against the embedded track and translated.
- **Only a small part of the video** is read (6 windows of 45 s), never the whole movie.
- **Out of scope:** translating the whole embedded track (it would need downloading the whole movie). If no candidate is confirmed, nothing is served.
- Up to **8** candidates; the free ones (v3 addon) first, the API ones (quota of 20 downloads/day) only if no free one works.
- Order when more than one passes: **highest confidence**; on a tie, **English**, then the others.
- The translated subtitle must **say** it is by AI, and the text comes without the original subtitle's color (Stremio's style applies).

## How it works

`#translate` → `#translationSource` → `#checkForTranslation` in `src/subtitles/service.ts`:

1. **Search in every language** when there is a translator (`LANGUAGES`; searching uses no quota, only downloading does). The track offered to Stremio is the primary language's (`chooseLanguage`, log `translate: true`).
2. **Candidates:** up to 8 with **distinct timing** (`timingFingerprint`: copies of the same release, in any language or from any uploader, count once); cap of 16 downloads. Free ones first.
3. **Checking each one** against the embedded text track (`EmbeddedReferences.lookup` with 6 windows; own cache `…|w6`): aligns (`align`: offset and fps scale), judges (`#judge`) and requires **consistency** (`src/sync/consistency.ts`): applies the joint correction and aligns the 1st and 2nd half of the windows separately, on the residual only. Refuses subtitles made for **another cut** (stepped offset), which would pass the joint alignment.
4. **If the alignment says "already synced" but the correction is real** (≥ 0.5 s or scale ≥ 0.05%, gain in cues starting together ≥ 0.1) and the halves agree, the correction is **applied** (`agreedShiftIsReal`). The "never make it worse" rule of `#judge` is too cautious in dense dialogue.
5. **Choice:** an exact one (hash/release) that checks out wins at once; otherwise, the highest confidence (tie ≤ 0.02 = English, then the others).
6. Translates with the source language (`deeplSource`), adds the AI notice and caches it (`translated:<language>:<id>|<file>`, 10 days).
7. **No embedded track to check against** (no text track, only PGS, P2P torrent, sync off): `#translationSourceUnchecked`: the exact one as it is (`verified:false`) or synced by another subtitle. **`likely_synced` does not count** for translating.
8. **Last resort, MOVIES only** (`type: movie`; maintainers' decision on 2026-11-03): if nothing above worked, translates the best candidate whose **declared fps is the file's** (`declaresVideoFps`; unknown fps on either side = no), English first, **with the "timing not confirmed" notice** (`translation.unconfirmed`, `sourceSync: unconfirmed`). A movie is a single cut, so a subtitle from another release of it usually fits; an episode does not (ads, cuts: Generation Z), so series are left out. **Only when there is no ruler**: if the embedded track exists and refused the candidate, nothing is translated. The result goes into the same cache (`translated:`).

## Limits and why each one

| Constant | Value | Where | Measurement behind it |
|---|---|---|---|
| `TRANSLATION_WINDOWS` | 6 | `service.ts` | with 3 windows (12–17 cues each) the stepped EN **passed** (conf. 0.98); 4–6 give ≥ 27 cues per half |
| `MAX_HALF_DEVIATION_MS` | 750 ms | `consistency.ts` | the DE that fits: 0–120 ms; EN from another cut: ≥ 1000 ms (3.5–13.6 s in most) |
| `RESIDUAL_RANGE_MS` | ±15 s | `consistency.ts` | ±2 min let noise win (a 28 s "deviation" on the DE) |
| `MIN_HALF_STARTS` | 0.40 | `consistency.ts` | DE: 0.49–0.62 per half; no match: 0.2–0.35 (chance in dense dialogue) |
| `MIN_AGREEING_STARTS` | 0.45 | `service.ts` | DE: 0.53–0.58; EN that does not fit: 0.37 (= chance) |
| `CONFIDENCE_TIE` | 0.02 | `service.ts` | tie → English |
| `MIN_REAL_SHIFT_MS` / `MIN_REAL_RESCALE` / `MIN_AGREED_STARTS_GAIN` | 500 ms / 0.05% / 0.1 | `service.ts` | the DE on the box had a gain of 0.2487, just below the normal 0.25, and was served 6 s off |
| `TRANSLATION_BITS_PER_SECOND` | 25 Mbit/s | `embedded-reference.ts` | the 1st reading of 6 windows ran out of time (48.7 s at 50 Mbit/s) with the player buffering the same file; the next one took 20 s |
| `CONCURRENCY` | 4 batches | `deepl.ts` | ~13 batches of 50 cues per episode: ~10 s queued, ~4 s in parallel |
| `translationWaitMs` | 3 s | `app.ts` | see the next section |

All were chosen by measuring **10 different window positions** over the real data (the choice of windows depends on the 1st subtitle examined). In all of them, the DE gets in with +6.0 s and the EN/ES is refused.

## First playback: Stremio's 10 s limit and the provisional subtitle

A translation still to be made takes 20 to 60 s (reading the windows 20–27 s; DeepL ~4 s). Stremio gives up on a request after **10 s**, and **on this box (Android TV) the video does not even open** while it waits. How it went:

| Attempt | `.srt` requested → answered | Result |
|---|---|---|
| No handling | 13:01:54 → 13:02:26 (32 s) | 10000 ms error, the video did not open; reopening 21 s later got the cache |
| Provisional after **8 s** | 13:23:52.76 → 13:24:00.77 | error anyway: the answer came 12.8 s after Stremio's **1st** request (13:23:47.96) |
| Provisional after **3 s** | 13:38:34.20 → 13:38:37.20 (`delivered: true`), 5.9 s after the 1st request (13:38:31.32) | **worked**: the video opened with the message |

Conclusion (consistent with the three cases, **not** proven otherwise): the 10 s clock counts **from Stremio's first request to the addon**, and the search with the hash of the 2nd request already takes ~2.5 s. So, when a translation is pending (`SubtitleService.translationPending`), the `/sub/…` route waits at most `translationWaitMs` (3 s) and answers with a **provisional subtitle** (`placeholderSrt`, log `subtitles.placeholder`): "Leave the video and open it again in about 30 s", in the primary language, 25 s on screen every 30 s. The translation finishes in the background; opening again gets the cache (9 ms). If the user reopens while it is still translating, the request waits up to 3 s and, if it finished in the meantime, gets the real one (13:38:57: 0.55 s). The cost: whoever does not reopen keeps the provisional one for that session (the player keeps the first subtitle it gets). Waiting longer than 3 s gains nothing: a translation still to be made never finishes before ~20 s.

The `subtitles.track_closed` log (`elapsedMs`, `delivered`) says whether Stremio was still there when the answer went out. The same guidance is in the app in `first_time_note`.

## What the translated subtitle looks like

- **AI notice** (`src/translation/notice.ts`, texts in `src/i18n/messages.ts`): "[Subtitles machine-translated by AI (DeepL)]" in the translation's language (with "- timing not confirmed" for the unchecked translation), 4 s, at 0.5 s, again at 60 s and every 15 min, always in a free gap between cues (shortened, postponed up to 30 s or left out if there is no room). Added before caching.
- **Stremio's color/outline:** Generation Z's DE has `<font color="#FFFFFF">` on **every** cue (2006 tags) and the player obeys the file's color, ignoring the user's style (yellow with a black outline). `translateCues` removes `<font …>`; `<i>`/`<b>` stay. It also lowers the quota used (characters sent 49,693 → 21,505). **Subtitles served without translation** may carry `<font color>`: they were not changed (to be decided).
- **The "RightSubs: preparing subtitle, wait 30 s" entry** in the subtitle list (`src/stremio/status.ts`, route `/status/…`, in the primary language): shows while the translation is pending; the track's text is decided on request ("preparing" or "ready"). **Not checked on screen**: with the provisional subtitle, the video opens before the menu is of any use, and the track's name depends on how Stremio shows the `lang` field.
- There is no pop-up: Stremio's addon protocol only accepts the `{id, url, lang}` list.

## What depends on how you watch (Real-Debrid, torrent, others)

The translation itself (search in every language, DeepL, AI notice, Stremio's color, provisional subtitle) **does not depend on a debrid**. What does is the **timing check**: it reads 6 windows of the embedded track, and for that the addon needs the file's direct link, which it only gets through the **Real-Debrid** API (`/downloads`, `RealDebridSource`) or, for a torrent played by Stremio itself, through its local server (`StremioServerSource`, without reading the embedded track: `peerToPeer`). Proxy mode (indexers) is not used in the APK.

| How you watch | Does the addon find the file? | Ruler (embedded track) | What the translation does |
|---|---|---|---|
| **Real-Debrid** | yes (`/downloads`) | **yes** (6 windows) | full flow: picks among the languages, refuses subtitles from another cut, applies the offset |
| **Torrent through Stremio itself, no debrid** | yes (Stremio's local server, `/stats.json`) | **no**: reading windows of a torrent would take bandwidth from the video | ffprobe only (fps, up to 15 s). Exact subtitle by hash: translated as it is. **Movie:** "timing not confirmed" if the fps matches. **Series:** nothing |
| **Another debrid** (AllDebrid, Premiumize, TorBox…) | **no**: there is no `FileSource` for them, and Stremio does not use the torrent server for those streams | no | no fps and no embedded track: only the **exact subtitle by hash** would be translated (as it is) |
| Direct link or another source | no | no | the same as the case above |

**Test status:** only the **Real-Debrid** row was measured on the box (Generation Z, Cat's Eyes, A Murder Between Friends). The other three are a reading of the code (`FileLocator` and its sources; `EmbeddedReferences.lookup` returns "unavailable" for `peerToPeer`; `declaresVideoFps` needs ffprobe's fps) and **were not tested**.

**To support another debrid:** one `FileSource` per service (a history/links API equivalent to Real-Debrid's `/downloads`), plus the token field on the screen and in `ConfigWriter`. Only worth it if someone uses the service.

## Real cases on the box (2026-11-03)

| File | Situation | Path | Result |
|---|---|---|---|
| Generation Z S01E01 MULTI (series, 3.2 GB) | EN/ES from another cut, DE with +6.0 s | check against the embedded FR | DE translated, +6.0 s, Stremio's color |
| Cat's Eyes S01E01 2160p (series, 7.2 GB) | only FR, DE and PL; **neither PT nor EN**; embedded ITA/ENG/FRE-SDH | check against the embedded **ENG** (3 candidates accepted: DE −3.76 s conf. 0.91; FR −11.08 s 0.86; PL +0.96 s 0.75) | DE translated; first proof that "any language" was needed |
| A Murder Between Friends (MP4 movie, 1.7 GB) | only 2 EN (AMZN WEB-DL 1080p, found by IMDb), **no embedded track**, same fps 23.976 | no ruler → item 8 | before: 404 without a notice; after: 1,684 cues, "timing not confirmed" notice |
| Narco Mennonites S01E01 1080p WEB (series, 2.2 GB) | only 1 EN (AMZN WEB-DL RAWR); embedded ENG-Forced, ENG, FRE, FRE-Forced | check against the **full ENG** embedded track (the Forced one is ignored): 422 cues in 6 windows, 42 s; the EN already matches (`already_synced`, 60 ms, cues together 1.00, deviation 20 ms), no offset | translated 50 s after the 1st request (947 cues, 31,389 characters); 2 provisional ones before, because the 1st reopening came at 15 s |

**Where the source subtitles come from:** always OpenSubtitles. For A Murder Between Friends, the 4 English candidates are the same 2 subtitles listed by the API (`opensubtitles-api`, 20 downloads/day) and by the v3 addon (`legacy_subtitle_id` 13476158 and 13476159, downloaded through v3 without using quota). They were found by **IMDb** (`m: i` in v3, `moviehash_match` false in the API): none is registered with this file's hash. The hash and the embedded track are the two ways of knowing the timing matches **this file**; with neither, checking the timing is impossible and item 8 comes in (movies only).

## DeepL client

`src/translation/deepl.ts`: `api-free` host if the key ends in `:fx`; batches of 50 (4 in parallel, in order); repeated cues sent once; `{\an8}` and `<font>` removed; 429 retried once; 456 = quota used up; 401/403 = key rejected; the key only goes in the header. An episode uses ~21,000 characters of the free quota (500,000/month).

## Forced test (`translation.deepl.forceFrom`)

Only in the `config.yaml` of an addon running on a computer (it does not exist in the app): `forceFrom: [en]` ignores the existing primary/secondary subtitle and always translates, only from the given languages, along the same path. Separate cache (`translated-forced:`); logs `translation.forced` and `choice` with `forced`. Measured case: Creature Commandos S01E03 (`tt26545355:1:3`, 259 MB, embedded EN [SDH], 4 existing pt-BR): 3 distinct EN candidates (conf. 0.85 / 1.00 / 1.00), the 1.00 one chosen; 430 cues, 11,615 characters, windows read in 3.0 s. To run it: `node --env-file=.env src/server.ts --config <file>` and a request with `videoHash`, `videoSize` and `filename` from the box log.

## App (APK)

- DeepL key field (optional) on the screen and in the "Fill in on your phone" form; "Remove the key" on the screen. `SecretStore` keeps it (`deepl_key`, AES-GCM/Keystore), Node only gets it through `DEEPL_API_KEY`, the `Redactor` masks it. `ConfigWriter` turns `translation.deepl.enabled` on when there is a key.
- Test builds (never distribute): `WORKING_TREE=1 PREFILL=1 DEBUG_LOG=1 sh build.sh` = the addon from the working directory (without committing), `.env` credentials inside the APK (plain text) and a log readable by adb. Details in the root `CLAUDE.md`.

## Logs

| Event | When |
|---|---|
| `translation.candidate` | one per candidate examined: language, release, `status` (`synced`, `already_synced`, `inconsistent`, `unconfirmed`, `weak_agreement`, `low_confidence`), `offsetMs`, `confidence`, `starts`, `deviationMs` |
| `translation.skipped` | no candidate confirmed (`no_confirmed_source`) or no ruler (`status`) |
| `translation.billed` | characters of each batch sent to DeepL (never the text) |
| `translation.done` / `translation.failed` | end of the translation / error (quota, key, network) without the text |
| `translation.unconfirmed` | movie translated without checking the timing (language, release, fps, number of candidates with the file's fps) |
| `translation.forced` | test mode |
| `subtitles.placeholder` / `subtitles.track_closed` | provisional subtitle sent (`waitedMs`) / connection closed (`elapsedMs`, `delivered`) |
| `subtitles.status_requested` | "preparing" entry opened (`pending`) |
| `subtitles.served` | `status: translated`, `sourceSync`, `from`, `offsetMs`, `characters` |

## How it was validated (a reusable method)

1. Extract the whole embedded track on a computer (container with `apt install ffmpeg`, the Real-Debrid direct link without printing it) and align each candidate in 4-minute windows: shows whether the offset is constant.
2. Simulate what the addon reads: the same 6 windows (each one's start in the `embedded.extracted` log), in **several positions**, and run `SubtitleService` end to end with the real subtitles and a fake translator. That is how the two weaknesses showed up (offset not applied; stepped EN passing by luck).
3. Only then test on the box with the `WORKING_TREE`/`PREFILL`/`DEBUG_LOG` APK and read the log.

## Limitations and pending items

- **Without Real-Debrid there is no timing check** (Stremio torrent, other debrids, direct link): table in "What depends on how you watch". The cases without Real-Debrid were not tested.
- **Heavy files:** 6 windows read twice as much as 3; the per-window limit is capped at 120 s (`windowTimeoutMs`). On a file like Drive (23.6 GB) it may run out and fall into the unchecked path. Not measured.
- **Stremio's limit:** between 5.9 s (worked) and 12.8 s (failed) since the 1st request; the exact value was not measured. `translationWaitMs` stays at 3 s and is not a `config.yaml` option.
- **No embedded text track** (PGS only) or a P2P torrent: there is no way to confirm the timing; only the exact one (as it is) or one synced by another subtitle is translated. **Movies** fall into item 8 (translation with "timing not confirmed"); **series** get no subtitle (404 in 0.2 s, without telling the user).
- **Unconfirmed timing may come out wrong:** the risk accepted by the maintainers for movies. There is no duration check (last cue × movie length), which would catch gross cuts; that would be the next cheap step.
- **Quota:** a movie uses much more than an episode (A Murder Between Friends: 48,251 characters, ~10% of the free month).
- **Heavy files, measured:** Cat's Eyes S01E01 2160p H.265 (7.2 GB, 59.6 min): the 6 windows read in **38.2 s** (cap 120 s), 64 reference cues, translation ready 45 s after the 1st request. The provisional message says "about 30 s": for files like that it is short (the user got the provisional one twice); consider "about 1 minute".
- **Stepped English:** could be synced by segments, but would need the whole embedded track as the ruler (out of scope).
- The status entry in the menu was not seen on screen; `<font color>` in untranslated subtitles stays as it came.
