# Findings

Answers to the plan's open questions, with evidence (the ones still open are also in [NEXT-STEPS.md](NEXT-STEPS.md)). Since 2026-10-31 the tests are done on the APK (Xiaomi TV Box S, Wi-Fi, EXO; phone). Each item says where it was observed: **box** (Chromecast, EXO) or **desktop** (Stremio Desktop — an approximation, to be confirmed on the TV).

| # | Question | Status |
|---|---|---|
| 1 | Stremio's language code for "Portuguese (Brazil)" | ✅ `pob` — Stremio selects RightSubs' `pob` track by itself |
| 2 | Do EXO and MPV show the addon's external track? | ✅ EXO: yes, selected by itself. MPV: works (user report); EXO stays as the player |
| 3 | Does Stremio prefer an embedded track or an addon track in the same language? | 🟡 The preferred language wins: the addon's pt-BR was chosen with EN/ITA embedded. Embedded **pt-BR** × addon: observe when it happens (2026-11-04: with an embedded pt-BR, RightSubs stopped offering the track and only shows the notice; Stremio showed the file's track and did not pick the notice). **Addon × addon (OpenSubtitles installed too):** RightSubs' track was **not** selected by itself on the desktop; it had to be picked in the menu (see "Companion mode") |
| 4 | How long does the player wait for the `.srt`? | 🟡 It asks ~1 s after the answer; 0.95 s of preparation worked. Limit still unknown |
| 5 | Does Stremio send `videoHash` for Real-Debrid HTTP streams? | ✅ Yes, in a second request (see below) |
| 6 | Do the v3 addon's IDs match the OpenSubtitles API's? | ✅ Yes (v3 `id` = the API's `legacy_subtitle_id`), but v3 only returns part of the subtitles |
| 7 | Real format of the v3 addon's response | ✅ See below |

## Real test cases (known answers)

Titles already played and measured, one per situation RightSubs must handle. When changing sync or ranking, repeat the ones that cover the changed code and compare with the "Expected" column. The user's measurements are "line in the audio × subtitle on screen".

| Title / file | Situation | Expected | Where | Details |
|---|---|---|---|---|
| Valkyrie (2008) `…UpScaled 2160p … Licdom.mkv` | Subtitle from another release with an opening ~25 s longer; an **exact** (EN) subtitle exists on OpenSubtitles | text×text `synced`, **+25.5 s**, conf. ~0.93 | box, EXO (proxy) | [below](#valkyrie-licdom-fixed-offset-of-about-255-s) |
| Halloween (1978) QTZ BluRay 2160p | No exact subtitle; fre/eng SRT **embedded** | `already_synced` through the embedded track, −0.1 s, conf. 0.96 (the YTS one already matched) | box (proxy) | phase 4 in the original project |
| Halloween (1978) `(2160p BluRay x265 10bit HDR Tigole).mkv` | Different release, **same source and resolution** as the subtitle (YTS BluRay 2160p) | `likely_synced`, without reading the video | Windows (RD) | [companion mode](#companion-mode-windows-real-debrid-2026-10-31) |
| Drive (2011) `…OpenMatte.DV.HDR10+Ai-Upscaled…RIFE.4.18v2-60fps-DirtyHippie.mkv` | No exact subtitle; BluRay REMUX subtitle **~13 s late** (line at 1:13, subtitle at 1:26); video **interpolated to 59.94 fps**; dense dialogue | `synced` through the embedded eng, **−12.82 s**; never rescale by fps | Windows (RD) | [companion mode](#companion-mode-windows-real-debrid-2026-10-31); timings in `test/fixtures/drive-2011-timings.json` |
| The White Ribbon (2009) `1080p BluRay x264-OFT.mkv` | Different release, same source and resolution (VXT BluRay 1080p); 1st request before the link existed in RD | `likely_synced`; RD finds it on the 2nd request | Windows (RD) | [companion mode](#companion-mode-windows-real-debrid-2026-10-31) |
| The Invite (2026) `REMUX.mkv` | A title new to the RD account (measure when the link shows up) | link in `/downloads` on the 2nd request (5.5 s) | Windows (RD) | `COMPANION-PLAN.md`, step B |
| Death Note ep. 1 `[Nep_Blanc]` (Kitsu) | Anime Kitsu catalog, absolute numbering, embedded ASS | RightSubs' track selected, `no_reference` but synced | box, EXO | [below](#anime-through-the-anime-kitsu-catalog) |
| Matlock ETHEL WEB 1080p | WEB with an embedded eng SDH SRT | `likely_synced` (same source and resolution) | box | phase 4 in the original project |
| Enter the Void (2009) `DC.1080p.BluRay.DDP5.1.x265.10bit-GalaxyRG265.mkv` | **25 fps** (DC); Release-Lounge pt-BR made for **23.976** (the site says 25); only PGS embedded | `synced` against EN `DC…x265-RBG`: **×0.95904, +0.44 s**, conf. 0.86 | box (APK) | [below](#enter-the-void-2009-dc-25-fps-apk-on-the-box-2026-11-01) |
| Enter the Void (2009) `DC.1080p.BluRay.H264.AAC-RARBG.mp4` | Same cut at 25 fps; the EN of the **theatrical version** (`…1080p.BluRay.H264.AAC-RARBG`, no "DC") passed as exact | `synced` against another DC (`same_edit`), **×0.95904**, ~+0.5 s; **never** ×0.999 | box (APK) | [below](#enter-the-void-2009-dc-25-fps-apk-on-the-box-2026-11-01) |
| Valkyrie (2008) YIFY, torrent **without Real-Debrid** | File found through Stremio's local server (`source: stremio`); subtitle made for the file | exact by hash, without reading the video | box (APK) | [below](#torrent-without-real-debrid-through-stremios-local-server-box-apk-2026-11-01) |
| Ted Lasso S04E04 2160p ATVP WEB-DL BiOMA, torrent | No RD; 19 embedded SRT (3 pt-BR) | ffprobe 5.6 s; embedded track **not** read (P2P); the player used the embedded pt-BR | box (APK) | [below](#torrent-without-real-debrid-through-stremios-local-server-box-apk-2026-11-01) |
| Generation Z (2024) S01E01 `MULTI 1080p WEB H264-HiggsBoson.mkv` | No PT; 4 EN + ES + ES-LA made for **another cut** (steps +11 / +6.5 / −2.8 s), 1 DE with a **fixed +6.0 s** (and `<font color>` on every cue); only FR embedded (3.2 GB, RD) | translation of the **DE** (`translated`, `sourceSync: synced`, +6.0 s), EN/ES `inconsistent`; no 10 s error (provisional at 3 s) | box (APK) | [below](#generation-z-2024-s01e01-multi-higgsboson-deepl-translation-2026-11-03) |
| Creature Commandos S01E03 `Cheers to the Tin Man.mkv` (`tt26545355:1:3`) | Already has 4 pt-BR; **forced test** (`forceFrom: [en]`) to see the translation from English; embedded EN [SDH] | 3 distinct EN, all `already_synced` (conf. 0.85 / 1.00 / 1.00); the 1.00 one chosen; 430 cues, 11,615 characters | PC (local addon) | [`DEEPL-TRANSLATION.md`](DEEPL-TRANSLATION.md#forced-test-translationdeeplforcefrom) |
| Cat's Eyes (2024) S01E01 `2160p.FRE.ITA.H265-TheBlackKing.mkv` | Heavy series (7.2 GB, 2160p H.265); no PT **or EN** (only FR, DE, PL); embedded ITA/ENG/FRE-SDH | check against the embedded ENG in 38 s; DE −3.76 s (conf. 0.91) chosen; FR −11.08 s and PL +0.96 s also accepted | box (APK) | [`DEEPL-TRANSLATION.md`](DEEPL-TRANSLATION.md#real-cases-on-the-box-2026-11-03) |
| A Murder Between Friends (2026) `WEB H264-RGB.mp4` | 1.7 GB MP4 movie, **no embedded track**; only 2 EN (AMZN WEB-DL 1080p, by IMDb); same fps 23.976 | before: `no_reference`, 404; after: translated "timing not confirmed" (1,684 cues, 48,251 characters) | box → PC | [`DEEPL-TRANSLATION.md`](DEEPL-TRANSLATION.md#real-cases-on-the-box-2026-11-03) |
| Narco Mennonites S01E01 `1080p.web.h264-cbfm.mkv` | Series with only 1 EN (AMZN WEB-DL) that already matches the embedded ENG (the Forced one is ignored) | `already_synced` (60 ms, 1.00 of cues together), no offset; translated in 50 s, 2 provisional ones before | box (APK) | [`DEEPL-TRANSLATION.md`](DEEPL-TRANSLATION.md#real-cases-on-the-box-2026-11-03) |
| Chef's Kiss (2026) `1080p.ROKU.WEB.h264-NoRBiT.mkv` (`tt38608731`) | No PT online; **embedded PT track** (`por`, index 6); Real-Debrid slow that day (probe 43 s on the RGB, ffmpeg ran out at 46 s) | before: `unavailable` and the provisional subtitle; after: **only the notice** for the embedded track (no search or video reading) | box (APK) | addon `CLAUDE.md`, item 0 |
| Chef's Kiss (2026) `1080p WEB H264-RGB.mkv` | No PT online or embedded; only EN/ES online; the DeepL translation came with a corrupted `♪` (`â™ª`, 10 times) inherited from the English source | the cleanup removes the 10 (100,561 → 98,830 characters); the other accents stay intact | box (APK) | `src/subtitles/clean.ts` |
| Creature Commandos S01E03 `Cheers to the Tin Man.mkv` (`tt26545355:1:3`) | 259 MB episode with many embedded SRT tracks, **pt-BR among them** | embedded-track notice on both Stremio requests, probe in 0.4 s, nothing searched. Before (15:42) the box's network went down (`fetch failed`): without a located file there is no probe, and the normal flow failed too | box (APK) | addon `CLAUDE.md`, item 0 |
| Enter the Void (2010) `Extended (1080p BluRay x265 r00t).mkv` | Same cut as the DC at **24 fps**, called "Extended"; only PGS; the pt-BR declares 24 but is 23.976 | **Known limitation:** `no_reference` (expected ×0.999, ~+0.5 s; ~+9 s at the end). A case for audio syncing | phone (APK) | [below](#known-limitation-r00t-extended-phone-vlc-2026-11-01) |

## 5. `videoHash` on Real-Debrid streams — ✅ yes, in two requests

**Where:** box, EXO, 2026-10-29. Movie through an indexer + Real-Debrid.

Stremio makes **two** `/subtitles` requests for the same play:

```
09:00:54.040 subtitles.request {"type":"movie","id":"tt0985699","filename":"Valkyrie (2008) [1080p BluRay x265 10bit MULTILANG MULTISUB] - GEGE.mkv"}
09:00:56.278 subtitles.request {"type":"movie","id":"tt0985699","videoHash":"e3af0d1b729cc9fe","videoSize":10978737004,"filename":"Valkyrie (2008) [1080p BluRay x265 10bit MULTILANG MULTISUB] - GEGE.mkv"}
```

Same pattern on an episode (09:01:57.950 → 09:02:00.902):

```
subtitles.request {"type":"series","id":"tt26591147:2:12","imdbId":"tt26591147","season":2,"episode":12,"filename":"Matlock.2024.S02E12.1080p.x265-ELiTE.mkv"}
subtitles.request {"type":"series","id":"tt26591147:2:12","imdbId":"tt26591147","season":2,"episode":12,"videoHash":"a4421889410a40f6","videoSize":623569379,"filename":"Matlock.2024.S02E12.1080p.x265-ELiTE.mkv"}
```

- 1st request: immediate, `filename` only.
- 2nd request: **2.2–3 s** later, with `videoHash` (OpenSubtitles hash, 16 hex) and `videoSize` — computed by Stremio's streaming server reading the file (the delay varies with Real-Debrid's response).
- Series: `id` in the `imdb:season:episode` format, already split correctly by the parser.
- `filename` arrives complete in both (group, source, codec): useful for ranking.

**Consequences:**
- Answer both requests fast; treat the pair as **the same play** (same `id` + `filename`) so the subtitle is not prepared twice.
- The hash only exists on the 2nd request: the preparation started by the 1st must be refinable when the hash arrives (exact match by hash > release name).
- To find out: which of the two answers the player uses (does it replace the list or merge both?).

**To confirm:** another indexer (Sootio) and MPV — so far, two samples (movie and episode) on EXO.

## OpenSubtitles API quota (free account)

**Where:** Mac, 2026-10-29, `POST /api/v1/login` + `GET /api/v1/infos/user`.

- Login with a free account: `allowed_downloads: 20`, level "Sub leecher", `vip: false`. The quota is per **user** (with a JWT token).
- The login **needs the username, not the e-mail** — with an e-mail it returns 400 "invalid username/password". `check-config` warns if `OPENSUBTITLES_USER` contains `@`.
- `/login` has its own limit of **1 request/s** (`x-ratelimit-limit-second: 1`). Log in once and reuse the token (valid for 24 h).
- The consumer has "Under dev" (100 downloads/day **without** authentication) and "Allow anonymous downloads" ticked. "Under dev" is for the development period; do not count on it in normal use.

## 6 and 7. v3 addon × API

**Where:** Mac, 2026-10-29. Same titles and hashes as the samples of question 5. API search with `languages=en,pt-br` + `moviehash` (searching uses no quota).

### Format of the v3 response (question 7)

`GET https://opensubtitles-v3.strem.io/subtitles/{type}/{id}/videoHash=…&videoSize=…&filename=….json` → `{ "subtitles": [...] }`, each item:

```json
{"id":"13677413","url":"https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/1962244852",
 "SubEncoding":"UTF-8","lang":"eng","m":"h","g":"","subtitleFileName":"Matlock.2024.S02E12.1080p.x265-ELiTE.srt",
 "movieReleaseName":"Matlock.2024.S02E12.1080p.x265-ELiTE","releaseGroup":"ELiTE","fpsMilli":23976,"season":2,"episode":12}
```

- `lang` in ISO 639-2: `pob` = Brazilian Portuguese, `por` = Portuguese, `eng` = English.
- `m`: match type — `h` = by hash, `i` = by IMDb.
- `SubEncoding`: the **original** encoding (e.g. `CP1252` on old subtitles); the `url` (`subencoding-stremio-utf8`) already delivers it converted to **UTF-8** (`application/x-subrip; charset=utf-8`).
- `fpsMilli`: fps × 1000 (23976, 25000) — useful for the fps correction.
- `movieReleaseName`, `releaseGroup`, `releaseOther`: optional, not always present or well filled in.
- v3 returns **few items per language** (at most ~5) and for every language, unfiltered.

### IDs (question 6)

- The v3 `id` **is the API's `legacy_subtitle_id`** (Matlock: 3 of 3 match — 13677413, 13677399, 13949003).
- The number at the end of the v3 `url` is **not** the API's `file_id` and cannot be derived from it: the `subs5.strem.io` server answers **HTTP 469** for API `file_id`s. Only a subtitle that **v3 itself listed** can be downloaded without quota.

### v3 alone is not enough

| Title | v3 | API |
|---|---|---|
| Valkyrie (2008), movie | 31 items; **0 `pob`**, 3 `por`, 1 `eng` — all from old releases (R5/XviD) | 50 items: **16 pt-BR**, 34 en (none with `moviehash_match`) |
| Matlock S02E12, recent episode | 15 items; 1 `pob`, 2 `eng` (one with `m:"h"`) | 3 items: 1 pt-BR, 2 en (1 with `moviehash_match: true`) — **all present in v3** |

- For old titles, v3 returns a small and worse selection: for Valkyrie, **no pt-BR subtitle**, when the API has 16. The v3 items do not show on the first page of the API.
- For recent releases, the sets match and downloading through v3 (no quota) works.

**Consequences:**
- The API is the main **search** source; v3 complements it (and is the fallback without an account).
- Download: if the chosen subtitle is in v3 (`legacy_subtitle_id` = v3 `id`), download through the v3 `url` (**no quota**, already UTF-8); otherwise, the API's `POST /download` (**1 of the 20/day quota**).
- Estimate: recent releases and episodes almost always come out without quota; older movies use 1 download per new title. With a 10-day cache, 20/day covers the expected use.

## 2, 3 and 4. First test on EXO

**Where:** box, EXO, 2026-10-29, with the OpenSubtitles v3 addon **still installed** in Stremio.

**Matlock S02E12** (09:21 and 09:22, two plays): RightSubs offered the pt-BR track on both requests, but the player **never asked** for `/sub/…srt`. A synced subtitle showed up — almost certainly the v3 addon's `pob` track (the same subtitle, the episode's only pt-BR). The user saw "disabled" in the subtitle menu (to investigate).

**Valkyrie, file `UpScaled 2160p … Licdom`** (09:25): v3 had no `pob` for this movie; the player asked for RightSubs' track **by itself**:

```
09:25:14.530 subtitles.choice        {"hash":true,"candidates":{"en":35,"pt-BR":16},"language":"pt-BR"}
09:25:15.549 subtitles.track_requested
09:25:16.498 subtitles.served        {"provider":"opensubtitles-api","release":"Operação.Valquíria.2008.1080p.BluRay.5.1.x264.DUAL-BLUDV","score":19}
```

- EXO shows and **automatically selects** the addon's external track when it is the only one in the preferred language.
- With another addon offering the same language, Stremio picks **the other addon's** track (installed earlier). → Remove the other subtitle addons from Stremio (RightSubs already uses v3 underneath).
- The player asks for the `.srt` ~1 s after the answer to the 2nd request; 0.95 s of preparation (search already cached + download through the API) was accepted.
- **Out-of-sync** subtitle: there is no pt-BR for the `Licdom` release; the chosen one is from another release (score 19). There is an EN for the exact release (`Varkyrie.2008.UpScaled.2160p.H265.Licdom.mkv`) — a reference for text×text syncing.

## Without other subtitle addons (OpenSubtitles v3 removed from Stremio)

**Where:** box, EXO, 2026-10-29 09:32. Matlock S02E12, file `Matlock.2024.S02E12.1080p.WEB.h264-ETHEL.mkv`.

```
09:32:43.965 subtitles.request (no hash)    → subtitles.choice pt-BR
09:32:45.845 subtitles.request (with hash)  → subtitles.choice pt-BR
09:32:46.551 subtitles.track_requested
09:32:46.726 subtitles.served {"provider":"opensubtitles-v3","release":"Matlock.(2024).S02E12…AMZN.WEB-DL…Vyndros","score":75}
```

- The "RightSubs" track shows in the menu and is **selected automatically**; synced subtitle (a different WEB release, same timing).
- Confirms question 1: with Stremio's subtitle language set to Portuguese (Brazil), it picks the `lang: "pob"` track.
- Play → subtitle ready in ~2.8 s, almost all of it waiting for Stremio's hash; preparation in RightSubs: 0.18 s (download through v3, no quota).
- Decision (2026-10-29): the user removed OpenSubtitles v3 from Stremio — RightSubs is the only subtitle source.

## Valkyrie (Licdom): fixed offset of about 25.5 s

**Where:** box, EXO, 2026-10-29 09:36; measured on the Mac.

- File `Operazione Valchiria - Varkyrie (2008) UpScaled 2160p … sub ita eng Licdom.mkv` (EN and ITA embedded). Stremio selected **RightSubs' pt-BR** track (question 3: the preferred language beats an embedded track in another language).
- User: "the subtitle shows before the audio".
- Measurement: the pt-BR served (`BluRay … DUAL-BLUDV`) × the EN of the exact release (`Varkyrie.2008.UpScaled.2160p.H265.Licdom`, API `file_id` 10452316 — not in v3, it cost 1 of the quota), correlation of speech intervals in 100 ms steps:

| Stretch | Offset to add to the pt-BR | Matching cues |
|---|---|---|
| 5–25 min | +25.7 s | 95% |
| 50–70 min | +25.5 s | 91% |
| last 20 min | +25.4 s | 95% |

**Conclusions:**
- **It is not fps** (the offset does not grow): this release has an opening ~25 s longer (intro/logo).
- **Text×text** syncing against a subtitle of the exact release (any language, same hash or name) solves it: cheap (no ffmpeg, milliseconds), reliable (91–95% matching). Cost: possibly +1 download of the quota for the reference.
- First known-answer title: `tt0985699`, Licdom file, expected offset ≈ +25.5 s.

**Validated on the TV (2026-10-29):** with text×text syncing, the Valkyrie/Licdom pt-BR was corrected by +25.46 s (reference: EN `Varkyrie.2008.UpScaled.2160p.H265.Licdom`, confidence 0.93, without correction 0.49) and the user confirmed: **synced**.

## Anime through the Anime Kitsu catalog

**Where:** box, EXO, 2026-10-29 10:51. Death Note opened through the Anime Kitsu catalog, file `[Nep_Blanc] Death Note 01 .mkv` (Torrentio).

- Stremio asks for subtitles with the Kitsu id (`kitsu:1376:1`), also in two requests (the 2nd with the hash, ~2.5 s later).
- The Anime Kitsu addon's meta maps each episode to IMDb + season/episode (`tt0877057` S1E1) — including long series with absolute numbering.
- The Anime Kitsu addon also declares `subtitles` (it redirects to `opensubtitles-v3.strem.io`). Installed **after** RightSubs, RightSubs' track was the one selected.
- Subtitle served: pt-BR `[Anime Time] Death Note - 001 - Rebirth` (another release), `sync: no_reference` — no reference for the exact file, but synced (confirmed by the user).
- ffprobe (3.3 s): embedded `eng` tracks in **ASS** (`English Subs`, `Signs & Songs`) — ffmpeg converts ASS to SRT when extracting.

## Companion mode (Windows, Real-Debrid), 2026-10-31

**Where:** desktop — Windows 11, Stremio desktop, a test account with **Torrentio + RD installed directly** (no proxy), RightSubs on `npm run dev` with `streams.realdebrid` on. Context: [COMPANION-PLAN.md](COMPANION-PLAN.md).

### When the file shows up in Real-Debrid

- 1st subtitle request (no hash, no `videoSize`): the link **does not exist yet** in `/downloads`.
- 2nd request (with the hash, 3.5 to 5.5 s later on the desktop): the link **is already** in `/downloads`, by name and size. That is the request on which RightSubs prepares the subtitle, so there is time to read the video.
- RD's times (`generated`, `added`) come one hour ahead (France time marked as UTC).

### Drive (2011) OpenMatte 60 fps: two defects found

1. **Without the URL (light mode):** `no_reference`, FraMeSToR subtitle (BluRay REMUX) ~13 s late, measured by the user.
2. **With the URL, before the fix:** RD found the file (132 ms), ffprobe read 59.94 fps, embedded eng read (44 cues, 3 windows of 45 s), offset **−12.82 s** — but served unadjusted (`already_synced`): speech overlap 0.85 unadjusted × 0.93 adjusted, gain < 0.1. In dense-dialogue stretches any offset overlaps speech.
3. **Fix:** also measure the cues that **start together** (±0.5 s): 32% unadjusted × 77% with −12.82 s (wrong offsets: 25–36%). A gain ≥ 0.25 on that measure applies the correction.
4. **Risk avoided:** with no reference, RightSubs would rescale the subtitle by 23.976 ÷ 59.94 = 0.4. Interpolation keeps the length; now it only rescales up to 5% (PAL speed-up).
5. **Result:** `synced`, embedded eng, −12.82 s. User: **perfect**.

### Drive (2011) OpenMatte 60 fps on the APK (Xiaomi box, Wi-Fi), 2026-10-31

- **Symptom:** `no_reference`, subtitle ~13 s late. RD found the file (1.4 s), ffprobe read the 3 embedded eng tracks (1.5 s), but the extraction ran out of time on all 5 attempts: `ffmpeg gave no response in 15000 ms` (failures at 15.1 s).
- **Cause:** volume read × Real-Debrid bandwidth. 23.6 GB in 100 min = 31 Mbit/s → each 45 s window is ~175 MB. RD delivered 113 Mbit/s on the PC and 142–151 Mbit/s on the box (once 83); reading in parallel **does not add bandwidth**. ffmpeg (the APK's minimal 7.1.1) is not the cause: on the PC it took 16.5 s on a window against 14.0 s for a full ffmpeg (Debian 5.1).
- **A window with little dialogue reads far past its end:** with `-ss … -i … -to`, ffmpeg only stops when a subtitle after the end of the window arrives. On the box (fixed windows, not the ones RightSubs picks): 21 cues → 11.7 s; 10 → 22.5 s; 3 → 41.1 s; 0 → 48.7 s. The last three in parallel: 86 s; in sequence: 112 s. `-t 45` on the input (with or without `-copyts`) did **not** make it stop: the subtitle track only ends when it sees a subtitle past the limit.
- **EXO waited ≥ 34 s** for the `.srt`, repeating the request every ~10 s (question 4, partial).
- **Smaller windows do not work** (Drive fixture, best N s of each window): 45 s/44 cues → −12.82 s (right); 20 s/25 → −8.64 s (wrong); 15 s/20 → −8.72 s (wrong); ≤ 12 s → no result.
- **Fix 1:** per-window time limit proportional to the bitrate (`windowTimeoutMs`: read all windows at ≥ 50 Mbit/s in total, between 15 s and 2 min). Drive: ~85 s (35 s per window still failed). Halloween QTZ: 18 s. The `embedded.extracted`/`embedded.failed` logs record the windows and the limit.
- **Why it worked on the PC and the Shield:** probably a faster RD server at that moment and cues right after each window; without the logs of those sessions, a hypothesis.
- **Open:** how long EXO waits for the `.srt` (question 4). If it gives up before, the extraction finishes, goes into the cache and the next time comes out synced.
- **Validated on the TV (2026-11-01), with fix 1:** `embedded.extracted` with windows `[1221, 3436, 4582]` s × 45 s, 44 cues, limit 84.6 s, reading **60.2 s** → `synced`, −12.82 s, conf. 0.93. Before: fixed 15 s limit (5 failures) and 35.3 s (2 failures) → `no_reference`.

### Valkyrie (Licdom) revalidated on the APK, 2026-11-01

- Box, APK (Node 24.22.1): same BLUDV pt-BR, same Licdom EN reference → `synced` **+25.46 s**, conf. 0.93 (0.49 unadjusted), equal to the known answer. Subtitle ready 2.4 s after the request (including downloading the reference: 1 of the quota).
- Same pt-BR on `Valkyrie.2008.1080p.REMUX…-BEN.THE.MEN.mkv` (only PGS embedded): `likely_synced` (BluRay 1080p × REMUX 1080p), unadjusted — consistent with the delay being from the Licdom upscale, not the subtitle. The user has not confirmed it on screen yet.

### Enter the Void (2009) DC 25 fps, APK on the box, 2026-11-01

- The Director's Cut on BluRay is **25 fps** (9278 s; the r00t "Extended" is the same cut at 24 fps, 9661 s). Embedded: only PGS or none.
- The chosen pt-BR (`Enter.the.Void.2010.BRRip.[A.Release-Lounge.H264]`, v3) **declares 25 fps on OpenSubtitles, but was made for 23.976**: aligned to two independent DC references it gave ×0.95904 (= 23.976 ÷ 25) — GalaxyRG265 against `DC…x265-RBG`: +0.44 s, conf. 0.86; `DC…x265-RARBG` against its own EN: +0.58 s, conf. 0.87. **The declared fps is not reliable**: with no reference, the fps-only correction would not fix it (it would say 25 = 25).
- **Defect found** on `DC.1080p.BluRay.H264.AAC-RARBG.mp4`: the EN `Enter.The.Void.2009.1080p.BluRay.H264.AAC-RARBG` (theatrical version, 23.98) has every word of the file name except "DC" and passed as exact. Since it and the pt-BR run at the same pace, the alignment gave ×0.999, +0.42 s, conf. 0.91 (0.70 unadjusted) → `synced`, and the subtitle slipped ~2.5 s per minute. User: out of sync.
- **Fix:** the edition (DC/Director's Cut, Extended, Uncut, Unrated, Theatrical, IMAX) goes into `isExact` and `likely_synced`; and, with no exact or embedded reference, a release of the same edition, source and resolution serves as reference (`referenceMatch: same_edit`). Test with this case in `test/service.test.ts`. **Validated on the box** (16:23): reference `DC…x265-RARBG` (`same_edit`), ×0.95904, +0.58 s, conf. 0.87.

#### Known limitation: r00t "Extended" (phone, VLC, 2026-11-01)

- File `Enter the Void (2010) Extended (1080p BluRay x265 r00t).mkv`: **24 fps**, 9661 s, only PGS embedded. Chosen pt-BR `Enter.The.Void.LIMITED.720p.BluRay.x264-REFiNED` (v3, 61,376 bytes — the same size as the Release-Lounge one: probably the same file under another name), **declares 24 fps** → `no_reference`, served unadjusted. User: out of sync.
- No step applies: (1) no r00t subtitle; (2) 720p × 1080p; (3) only PGS; (4) the file says "Extended" and the BluRay 1080p subtitles say "DC" — **the same cut under another name**, which RightSubs has no way to know; (5) declared fps 24 = video 24, but the subtitle is 23.976 (**a second wrongly declared fps** for this title).
- Expected from the DC measurements (9661 s at 24 fps ≈ 9278 s at 25 fps): ×0.999, ~+0.5 s. Without it, estimated: −0.5 s at the start, ~+3 s at 1 h, ~+9 s at the end. The exact symptom on screen was not recorded.
- **Decision (2026-11-01):** not fixing it now. Treating "Extended" = "DC" would reopen the RARBG defect on other movies; using the 25 fps DC reference while compensating the fps assumes the same cut. The first real case for **audio syncing** (deferred).

### Reference language separate from the watched languages (box, APK), 2026-11-01

- The APK started letting the user pick the languages; default pt-BR + **pt-PT**. On the box, Enter the Void `DC…H264.AAC-RARBG` went back to `no_reference` (before `same_edit`, ×0.95904): the search only asked for the two watched languages (`candidates: {pt-BR: 13, pt-PT: 9}`, before `{en: 31, pt-BR: 13}`), and the DC reference was **English**. The `en` secondary was, without anyone noticing, playing the role of the reference language. Drive stayed right (its reference is the embedded track).
- **Fix:** `sync.referenceLanguages` (default `[en]`): they go into the same search, are never served, and the embedded track in these languages is preferred (Halloween QTZ now reads the ENG Full instead of the FR Full; same timing, same file). In the APK, a third list "Reference for syncing". **Validated on the box** (18:42): Enter the Void RARBG `synced` ×0.95904, +0.58 s (`candidates: {en: 31, pt-BR: 13, pt-PT: 9}`, pt-BR served); Drive `synced` −12.82 s through the embedded track.
- **Known limitation — when the secondary comes in:** only when the search finds **no** subtitle in the primary (`chooseLanguage`, before downloading). With a pt-BR that exists but is out of sync (`no_reference`/`low_confidence`) or cannot be downloaded (quota, not SRT), it does **not** switch to pt-PT: it serves the best pt-BR or no subtitle. `useSecondaryWhen: low_confidence` is accepted in the config but not applied. An open decision for the maintainers (details in `CONFIGURATION.md`, `languages`).

### Torrent without Real-Debrid through Stremio's local server (box, APK), 2026-11-01

- **Goal:** serve friends without RD. Without a link, RightSubs stays in light mode (no real fps or embedded track).
- Stremio on the box runs a streaming server at `127.0.0.1:11470` (`/heartbeat`, `/settings`, `/stats.json`). With a torrent playing (Ted Lasso S04E04 2160p ATVP WEB-DL BiOMA, 8.5 GB, P2P), `/stats.json` lists the torrent with `infoHash` and `files[]` (`name`, `length`): **name and size identical** to the subtitle request's `filename`/`videoSize`. The file is served at `/{infoHash}/{index}`.
- **ffprobe** through the local server (the APK's ffprobe): **5.6 s** (RD: ~1.5–2 s) → 23.976 fps, 2633 s, 19 embedded SRT (3 pt-BR among them).
- **Embedded track: not viable.** A 45 s window in the middle of the episode **did not finish in 5 min** (killed by hand): the torrent downloaded at ~15 Mbit/s, below the video's ~26 Mbit/s, and ffmpeg pulled ~540 MB from that point (a stretch with little dialogue, like Drive). The torrent started downloading the middle of the file in parallel with playback.
- The player **did not ask** for RightSubs' track: it used the embedded pt-BR (question 3: embedded pt-BR × addon → embedded, at least here).
- **Implemented:** `stremio` source (`src/streams/stremio.ts`), after RD; its files carry `peerToPeer: true` → ffprobe with a 15 s limit, embedded reference off. The APK always turns the source on. Gain: real fps in ranking and in the fps correction for those without RD.
- **Validated on the box:** Valkyrie YIFY by torrent → `source: stremio`, exact subtitle by hash.

### Real-Debrid link instead of the file name (box, APK), 2026-11-01

- **Symptom:** on some subtitle requests Stremio sends the **RD link** in `filename` (raw or encoded, `https%3A%2F%2F…download.real-debrid.com%2Fd%2F…`) or an id like `realdebrid:ID:1`. The link ended up in the log (it gives access to the file) and the name was useless for ranking.
- **Fix:** `normalizeFilename` (`src/stremio/request.ts`) decodes it and uses only the last part of the path (the file name); `provider:ID[:n]` ids become "no name". In the APK, the `Redactor` also masks `…real-debrid.com/d/…` links on any log line (extra defense). Tests in `test/request.test.ts`.

### Generation Z (2024) S01E01 MULTI HiggsBoson: DeepL translation, 2026-11-03

The case that started the DeepL translation. The final design, the constants and the reason behind each one are in [DEEPL-TRANSLATION.md](DEEPL-TRANSLATION.md); here are the measurements and the order in which the defects showed up.

- **File:** `Generation Z 2024 S01E01 MULTI 1080p WEB H264-HiggsBoson[EZTVx.to].mkv`, 3.18 GB, 25 fps, 46 min 56 s, RD; only **FR** embedded (index 3 normal, 4 SDH). OpenSubtitles (`tt29540551:1:1`): no subtitle in PT; v3 lists DE 1, EN 4, ES 1, ES-LA 1 (the API found the same EN).
- **Measurement** (whole FR track extracted on the PC, 238 s; alignment in 4-minute windows):

| Stretch | EN / ES (6 copies, 721 cues) | DE (641 cues) |
|---|---|---|
| 0–14 min | **+11 s** | +6.0 s |
| 16–26 min | **+6.5 s** | +6.0 s |
| 28–38 min | **−2.8 s** | +6.0 s |
| 40–46 min | −4.1 s and −6.6 s | ≈ +6 s |

  The EN/ES comes from **another cut** (commercials/opening): it comes out in **steps**, scale ~1.0 in each. Overall: EN −2.76 s conf. 0.80 (wrong outside the last third); DE +6.000 s conf. 0.97, scale 1.0 (97% of the FR cues have a DE cue within ≤ 2 s, median 0.3 s).
- **Why 721 × 641 cues:** it is how each subtitle's author segmented it, not missing content. The EN has more short cues (117 under 1.5 s against 75 in the DE) and 13 song-lyric cues (♪); the embedded FR track has 677 (255 short). The number of cues measures neither quality nor sync.

**Defects, in the order they showed up (each became a rule or a test):**

1. **`likely_synced` translated unchecked** (1st test on the box): the EN `Generation Z S01E01 1080p WEB-DL H264 BONE - NH` looked like the file (WEB, 1080p, H264) and was translated **early**. → `likely_synced` is no longer enough to translate; every candidate is checked against the embedded track.
2. **3 windows do not tell them apart:** the stepped EN **passed** the joint alignment (+13.6 s, conf. 0.98 = the DE's); speech overlap hardly discriminates in dense dialogue (baseline 0.96). The best offset of **each** window does not work either (noisy: even the DE swings between 4 and 6 s). → 6 windows and comparing the **1st × 2nd half** (`checkConsistency`): DE deviation 0.0–0.2 s; EN/ES 2.5 s to 137 s.
3. **The right DE was chosen, but served without the +6 s** (2nd test on the box): `#judge` called it `already_synced` (baseline overlap 0.89; gain in cues together 0.2487, just below 0.25). → with the halves agreeing, the real correction is applied (`agreedShiftIsReal`).
4. **The stepped EN passing by luck** (varying the position of the 6 windows, 10 positions): in one of them it came out `already_synced` (conf. 0.96, deviation 1000 ms) and **tied** with the DE (0.97); the tie-break for English picked it. → deviation ≤ 0.75 s, ≥ 0.40 of cues together per half, ≥ 0.45 overall, residual within ±15 s. In all 10 positions, the DE gets in with +6.0 s and the EN/ES is refused.
5. **Wrong color** (box): the subtitle stayed white, without Stremio's yellow with a black outline, because the DE has `<font color="#FFFFFF">` on every cue (2006 tags; the EN, none) and the player obeys the file's color. → `<font>` removed before translating (and outside the quota: 49,693 → 21,505 characters).
6. **10000 ms error and a video that does not open** (box, Android TV): the 1st reading of the 6 windows took 27 s (once 48.7 s, with the player buffering the file) and Stremio gives up after 10 s. Provisional after 8 s: **not enough** (answer 12.8 s after the 1st request). After 3 s: **worked** (5.9 s after the 1st request, `delivered: true`). Table and hypothesis in DEEPL-TRANSLATION.md.
7. **The AI notice only at 0.5 s went unnoticed** because the subtitle arrived ~40 s after play. → repeats at 60 s and every 15 min.

**Final result on the box** (13:38, test APK with `WORKING_TREE`, `PREFILL`, `DEBUG_LOG`): `.srt` requested 13:38:34.2 → provisional 13:38:37.2 (`delivered: true`, the video opened); windows read in 20 s; EN `inconsistent` (deviation 3501 ms), DE `synced` (+6.0 s, conf. 0.97, deviation 80 ms); `translation.done` 13:38:57.6 (641 cues, 21,505 characters); the reopening at 13:38:57.1 waited 0.55 s for the translation in progress and got the real one. User: "worked perfectly" (right timing, right color, notice).

### Living with OpenSubtitles addons (step E)

- **Where:** desktop (Windows, Stremio desktop), 2026-10-31, with OpenSubtitles addon(s) installed alongside RightSubs.
- **Result:** RightSubs' subtitle worked, but **was not selected automatically**: the user opened the Portuguese subtitles and picked RightSubs' track by hand. "It was fine."
- **On the APK (box and phone, 2026-10-31 to 11-01):** all tests were done **with the subtitle addons installed**, without problems; uninstalling them is not needed (the README does not ask for it).
- **Conclusion (desktop):** with other subtitle addons in the same language, RightSubs did not win the automatic choice. To press play without choosing anything, keep only RightSubs; whoever accepts picking the track can keep the others.
- **Not recorded:** which addons exactly and in what order they were installed; whether the TV's EXO behaves the same.

### Halloween (1978) Tigole and The White Ribbon (2009) OFT

- Halloween Tigole BluRay 2160p: RD found it, 24 fps, YTS BluRay 2160p subtitle → `likely_synced`. User: right.
- The White Ribbon OFT BluRay 1080p: 1st request did not find it, the 2nd found it 3.6 s later, 23.976 fps, VXT BluRay 1080p subtitle → `likely_synced`. User: right. Supports the conservative rule of not reading the video when source and resolution match.
