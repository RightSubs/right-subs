# RightSubs as a companion (without uninstalling Torrentio, Sootio or other addons)

> **History.** Written for the old install (Termux, deployed from the computer). Today the addon runs inside the APK (root `README.md`); the scripts and guides mentioned here were removed on 2026-11-01.

Context from a conversation on 2026-10-30. This was the next topic: **using RightSubs as an ordinary subtitle addon, next to the addons the user already has**, without the stream lists going through it.

## The user's goal

- Install RightSubs as a **companion**: keep Torrentio and Sootio installed directly in Stremio.
- More agility: not repeating the one-off setup of the living-room TV (stream proxy, a single Stremio user).
- Accepts keeping **their own RD credentials** on the box, the TV or another device of theirs (never on a shared service).
- Preference: **not having to remove** the OpenSubtitles addons and the like (see "Coexistence" below).

## Why the proxy exists today

Stremio does not send the video URL to the subtitle addon. It sends the title ID, the file name, `videoSize` and `videoHash` (the OpenSubtitles hash over the bytes, not the torrent infohash). Only by passing the stream list through RightSubs does it learn "file name → URL" (`src/streams/proxy.ts`).

The URL is needed for two functions that look inside the file:

- **ffprobe** (`src/media/probe.ts`): real fps (`r_frame_rate`, standard rates only) and the list of embedded tracks. Feeds the ranking (±30) and the `fps_corrected` correction.
- **Embedded reference** (`src/sync/embedded-reference.ts`): 3 windows of 45 s of the embedded text track, used as the sync reference when OpenSubtitles has no exact subtitle.

Without a URL, the ranking infers the fps from the **exact** candidates (`videoFps()` in `src/subtitles/service.ts`), which is less reliable, and there is no embedded reference. Text×text syncing against an exact subtitle, ranking by release and `likely_synced` keep working.

## Alternatives considered to get the URL

| Path | Keeps Torrentio/Sootio direct | Real fps and embedded | Credential |
|---|---|---|---|
| Proxy (today) | No | Yes | RD key only inside the URLs |
| Querying the indexers itself | Yes | Yes | indexer URL (with key) in the config |
| **Real-Debrid API (proposal)** | Yes | Yes | RD token in the device's `.env` |
| Light mode (no URL) | Yes | No | none |

## Proposal: the Real-Debrid API

When Torrentio resolves the stream, RD records the link in `/downloads` (with `filename`, `filesize` and the direct link). RightSubs would look in that list for the file with the same name and size Stremio reports and use that link in `VideoInspector`.

Plan:

1. A new module (e.g. `src/streams/realdebrid.ts`) that queries `/downloads` with the token; results in a small cache, released in `resources.onIdle`.
2. `VideoInspector.find` tries, in order: the proxy map (if on) → RD. The rest (ffprobe, embedded, ranking) does not change.
3. Optional config `streams.realdebrid` with `token: ${RD_TOKEN}` in `.env` (outside git). Indexers off.
4. Tests with simulated API responses. Never log the URL or the token.

### Hypothesis (confirmed on 2026-10-31, see COMPANION-PLAN.md)

Stremio's 2nd request (the one carrying `videoHash`) should only happen after the player opened the stream, because the hash is computed over the file's bytes. If so, the link is already in `/downloads` at that moment, which is where the code already starts `prepare(..., { warm: true })`. The 1st request (no hash) may arrive before the link exists.

**First step:** a test with a temporary log. On the subtitle request, query `/downloads` and record only whether the file showed up and after how many ms (no URL). One or two plays on the TV are enough. Needs the RD token in the box's `.env`, put there by the user.

### Known limitations

- If the 1st request does not find the file, real fps and embedded only count from the 2nd.
- The token lives where RightSubs runs. For another device, RightSubs needs to run on it (or on an always-reachable machine). Away from home, the public IP changes and RD's IP restrictions come back.
- The RD API had not been tested in this project; the fields and limits above come from general knowledge and needed checking.

## Coexistence with other subtitle addons (OpenSubtitles v3 etc.)

- **Technically there is no need to remove them.** RightSubs queries OpenSubtitles v3 on its own (through the manifest URL, in `providers`), so it does not depend on the addon installed in Stremio.
- **The effect of keeping them:** Stremio shows the tracks of every addon, and the player may select an OpenSubtitles v3 track (unsynced) by itself instead of RightSubs'.
- **What was validated:** phase 1 (RightSubs' track selected by itself on EXO) was accepted **after removing** OpenSubtitles v3. Coexistence **was not tested**. Question 3 (preference between addon tracks in the same language) stays open for this scenario.
- **An existing clue:** Anime Kitsu also offers subtitles (redirecting to OpenSubtitles v3) and the recommendation is to install it **after** RightSubs, suggesting the install order influences the selection.
- **Suggested test:** reinstall OpenSubtitles v3 **after** RightSubs, play 2 or 3 titles on EXO and note which track comes selected. If v3's wins, the alternative is to remove only it; the other addons can stay.

### The user's addons today and recommendation

The user has 3 subtitle addons installed: **OpenSubtitles**, **OpenSubtitles v3** and **OpenSubtitles Pro**. They all have the same source RightSubs already queries (API + v3), so they add no coverage, only unsynced tracks.

- **Recommendation for the living-room TV:** keep only RightSubs. It is the validated scenario (phase 1) and fits the goal of pressing play without choosing a subtitle.
- **Caveats:** it is unknown what "OpenSubtitles Pro" offers beyond v3/API (if it depends on the user's subscription, RightSubs does not use that account); coexistence stays untested.
- **Safe removal:** note each one's manifest URL first (reinstalling is by URL). Gradually: remove OpenSubtitles and v3 first (redundant), Pro last. On other devices or profiles without RightSubs, keep what they use.

### Can the player always prefer RightSubs?

**Not in a guaranteed way.** Stremio/the player chooses the track; the addon only influences it.

- The automatic selection follows the preferred language in the settings. The tie-break between addons with the same language is unknown (install order? order of arrival?): question 3, open for coexistence.
- **What RightSubs already does in its favor:** offers a single track, in the primary language (`pob` for pt-BR), without cluttering the list. It was selected by itself on EXO, but **without** other addons installed.
- **What the user can do:** install RightSubs **last** (the only clue, from the Anime Kitsu recommendation; not a guarantee) and set Stremio's subtitle language to RightSubs' primary.
- If RightSubs' track does not win consistently, the safe path is to remove the competitors.
- The result of the coexistence test should be noted here and in question 3 of `docs/FINDINGS.md`.
- **Result (2026-10-31, Stremio desktop):** with OpenSubtitles addon(s) installed, RightSubs' track worked but was **not** selected by itself; it had to be picked in the Portuguese subtitle menu. On the TV (EXO), not tested yet.

## What exactly the "proxy" is

It is the `StreamProxy` class ([src/streams/proxy.ts](../src/streams/proxy.ts)): an intermediary for **stream lists**, not video (the player downloads from RD directly).

1. The manifest declares `stream`, and Stremio asks RightSubs for `GET /stream/:type/:id.json`.
2. The proxy forwards the request to Torrentio and Sootio in parallel (URLs in `.env`, with the RD key) and returns the lists **unchanged**, in config order.
3. Along the way, `#remember()` keeps **file name → URL** (name from `behaviorHints.filename` or the title's 1st line; `videoSize` breaks ties). In memory: up to 500 files, 5 URLs per name, cleared when the addon goes idle. Streams without a `url` are ignored.
4. On the subtitle request, `find(filename, videoSize)` returns the URL for ffprobe and ffmpeg.

That is why Torrentio and Sootio must leave Stremio: if they stayed, every stream would show up twice.

## How the real fps is obtained today

- `VideoInspector.inspect()` ([src/media/inspector.ts](../src/media/inspector.ts)) finds the URL through `find`; without it, it returns `undefined` and the real fps is not used.
- `probeVideo()` ([src/media/probe.ts](../src/media/probe.ts)) runs `ffprobe` on the URL reading only the header (`-probesize 2MB`, `-analyzeduration 0`), with a timeout and `SIGKILL`; goes through the `limiter`; result in memory (up to 50 files). ~1.5 s on the box.
- `parseProbe()` uses `r_frame_rate` (exact) and, if needed, `avg_frame_rate` (estimated: it gave 23.81 on a 23.976 file, a bug already fixed), filtered by `standardRate()` (23.976 / 24 / 25 / 29.97 / 30 / 47.952 / 48 / 50 / 59.94 / 60, tolerance 0.1%).
- Use: `#rank()` prefers `realFps ?? videoFps(candidates)`; `fpsOnly()` rescales the subtitle when it declares another fps (`fps_corrected`). The **subtitle's** fps is still the one declared on the site (the `.srt` carries no fps).

## What is lost without indexers and without embedded

Syncing is lost only when **there is no exact subtitle** for the file on OpenSubtitles:

| Situation | With URL (proxy/RD) | Without URL |
|---|---|---|
| An exact subtitle exists | Syncs | Syncs (the same) |
| No exact one, but embedded text | Uses the embedded track and corrects | No reference: serves the best one unadjusted (`no_reference`) |
| The subtitle's fps differs from the video's, no reference | Reads the real fps and corrects | Only infers the fps from the exact ones, if any |
| Ranking | Real fps | Inferred fps |

Inferred fps ([src/subtitles/service.ts](../src/subtitles/service.ts), `videoFps()`): comes from the **exact** candidates that declare an fps and agree among themselves; otherwise it stays undefined and the ±30 bonus of [src/subtitles/rank.ts](../src/subtitles/rank.ts) does not even apply. It is what someone typed on the site, not the file's. WEB files usually have an embedded text subtitle, so they are the most affected. How often this happens in real use: `grep subtitles.served ~/.rightsubs/logs/rightsubs.log*` on the box.

## RD's `/downloads`: when the file shows up

`/downloads` is the history of links generated on the account (the "Downloads" page of the RD site). RightSubs only **reads** it; RD creates the item when the stream addon resolves the clicked stream. Streams listed and not clicked create nothing (a deduction, to be confirmed by the test). A point to check: depending on the addon and the cache, Torrentio/Sootio may add the torrent to `/torrents` and not create an item in `/downloads`; the test with the log should look at **both lists**. RightSubs should not call `unrestrict` on its own (it would create history of unclicked files).

## If the user stops using Real-Debrid

| Source | Proxy | Through the API (proposal) |
|---|---|---|
| Another debrid (AllDebrid, Premiumize, TorBox) | Works if the stream carries a direct `url` | Needs an adapter per service |
| Direct torrent in Stremio | Does not work: the stream carries `infoHash`, no `url` (`#remember()` ignores it) | Not applicable |
| Addon with a direct HTTP link | Works | Not applicable |

Without RD the IP restriction goes away too, which makes hosting away from home easier.

## Decision: a hybrid solution (RD and without RD)

The user wants to serve both scenarios, including **only Torrentio installed, without RD**. Design: a **file-location chain**, where each step only runs if configured and a failure passes on to the next:

1. **Proxy** (optional, as today).
2. **RD API** (if there is a token), by name and size; designed as an interface, with adapters per service in the future.
3. **Stremio's local server** (direct torrent): *an experiment, no promise.*
4. **Nothing found → light mode** (search, ranking and text×text against an exact subtitle). It is the floor and always works.

Uncertainties of item 3: the subtitle request carries neither `infoHash` nor the file index (Torrentio would have to be queried by ID and matched by name and size); it is unknown whether Stremio's server (port 11470) is reachable from Termux on Android TV; and reading the header and 3 windows of 45 s from a torrent forces pieces out of order and may compete with playback.

## Decisions already made that still hold

Free services only; EXO as the player; languages `pt-BR` / `en-US`; nothing in the cloud; minimal resources when idle. See `CLAUDE.md`.

## Next steps

Detailed execution plan: [COMPANION-PLAN.md](COMPANION-PLAN.md).

1. Reorganize the file locator as an interface with the hybrid chain (optional proxy → RD → Stremio's local server → light mode), first with only proxy and light mode; testable right away.
2. Test RD's `/downloads` and `/torrents` with a temporary log (hypothesis above); if it holds, implement `src/streams/realdebrid.ts` and the `streams.realdebrid` config.
3. Test coexistence with OpenSubtitles v3 installed after RightSubs (and, for the living-room TV, remove OpenSubtitles, v3 and Pro if RightSubs' track does not win).
4. Investigate, without commitment, Stremio's local server on the box (direct torrent).
5. Only then decide on the hostable light mode (see `docs/NEXT-STEPS.md` for multi-device and the guide for friends).
