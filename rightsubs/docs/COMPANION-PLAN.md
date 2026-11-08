# Implementation plan — RightSubs as a companion (no proxy)

> **History.** Written for the old install (Termux, deployed from the computer). Today the addon runs inside the APK (root `README.md`); the scripts and guides mentioned here were removed on 2026-11-01.

> Started: 2026-10-31. Context and decisions: [COMPANION-MODE.md](COMPANION-MODE.md). This file is the execution plan and the record of what was done; the other one keeps the why.

**Goal:** RightSubs working as an ordinary subtitle addon, with Torrentio/Sootio installed directly in Stremio, without losing the real fps or the embedded reference when there is a way to find the file's URL. The proxy scenario (dedicated TV) stays the same.

## Status (2026-10-31)

| Step | What | Status |
|---|---|---|
| A | File-location chain (`FileLocator`) | **Done** |
| B | Experiment with RD's `/downloads` + `/torrents` | **Done; hypothesis confirmed; code removed** |
| C | `realdebrid` source + `streams.realdebrid` | **Accepted** (Drive, Halloween, The White Ribbon) |
| — | Fixes found along the way (interpolated fps, dense dialogue) | **Done and validated** |
| D | Companion mode documentation | Pending |
| E | Coexistence with OpenSubtitles v3 | **Done on the desktop:** works, but RightSubs' track is not selected by itself (manual choice). Missing on the TV |
| F | Stremio's local server (direct torrent) | No commitment |
| G | Hostable light mode | Decide after E and F |

Tests: 124 → **140** (`npm test`), clean typecheck. Validated on **Windows** (Stremio desktop), not on the box: this user's box had not been set up yet.

---

## 0. Test environment on Windows (before installing on the box)

The script followed on 2026-10-31. A general version (test on the PC and install/update the box from Windows): `WINDOWS.md` (removed). Real test cases: [FINDINGS.md](FINDINGS.md#real-test-cases-known-answers).

1. Tools: `winget install OpenJS.NodeJS.LTS` and `winget install Gyan.FFmpeg` (ffmpeg is optional: without it, light mode only). Reopen VS Code for the PATH to apply. Used: Node 26.13.0, ffmpeg 9.0.2.
2. `npm install` and `npm test` (126 tests passed on Windows without changes).
3. `copy config.example.yaml config.yaml` and `copy .env.example .env`; fill in the **free** OpenSubtitles account in `.env` (username, not e-mail).
4. `npm run dev` → check `http://127.0.0.1:7000/manifest.json` and `/health`. `login: "pending"` is normal until the 1st request.
5. Stremio desktop on a **test account** (the addon list belongs to the account: installing `127.0.0.1` on the TV's account breaks the addon there) → Addons → paste `http://127.0.0.1:7000/manifest.json`.
6. Torrentio installed directly on the test account, **set up with Real-Debrid** (`torrentio.strem.fun/configure` → Debrid provider RealDebrid → API key). RightSubs' indexers off, otherwise the streams show up twice.
7. Log to a file, for Claude to read: `npm run dev | Tee-Object -FilePath "$env:USERPROFILE\.rightsubs\dev.log"` (PowerShell writes **UTF-16**; read it with `open(..., encoding='utf-16')`).

Windows notes:

- `npm run build` used `rm -rf` and did not run in npm's cmd; fixed (deletes `dist/` with Node itself). Deploying from Windows: `scripts/deploy-from-windows.ps1` (tar + scp + ssh from Windows). `.gitattributes` forces LF (the `.sh` files break on Termux with CRLF).
- The PC on the home network has the same public IP as the TV: RD's IP restriction does not get in the way.
- Never paste Torrentio stream links in the chat: `/resolve/realdebrid/<key>/…` contains the RD key. If it happens, create another at https://real-debrid.com/apitoken and set Torrentio up again.
- 1st test (light mode, no URL): Spider-Man Brand New Day worked; Drive OpenMatte came out `no_reference` (~13 s late).

---

## Step A — File-location chain (done)

**Why:** the proxy's `find` was synchronous and called from two independent places (`VideoInspector` and `EmbeddedReferences`). The RD lookup is asynchronous, so it became a single, asynchronous, cached locator used by both.

### Design implemented ([src/streams/locator.ts](../src/streams/locator.ts))

```ts
export interface FileQuery { filename: string; videoSize?: number }
export interface PlayableFile { url: string; videoSize?: number; source: string }
export interface FileSource { id: string; locate(query: FileQuery): Promise<PlayableFile | undefined> }
export class FileLocator {
  constructor(options: { sources: FileSource[]; logger: Logger });
  get enabled(): boolean;   // false = light mode
  locate(query: FileQuery): Promise<PlayableFile | undefined>;
  release(): void;          // onIdle
  status(): Record<string, unknown>;  // { sources, known, located, notLocated }
}
```

Rules:

- Sources in a fixed order (proxy → RD); the first that finds it wins. An exception in a source → `file.source_failed` and on to the next.
- **Only hits are cached** (up to 50, key `filename|videoSize` lowercased, released in `onIdle`). Misses are not: Stremio's 1st request arrives before the link exists in RD.
- Simultaneous requests for the same file share a single lookup.
- Logs `file.located {filename, source, ms}` and `file.not_located {filename, tried, ms}`. Never the URL.
- `PlayableFile.indexer` became `source` (RD is not an indexer); `video.probed` and `video.probe_failed` show `source`.

### Changes

| File | Change |
|---|---|
| `src/streams/locator.ts` | new; `PlayableFile` moved here from `proxy.ts` |
| `src/streams/proxy.ts` | `StreamProxy implements FileSource` (`id = 'proxy'`, `locate()` wraps `find`) |
| `src/media/inspector.ts` | synchronous `find` → asynchronous `locate`; `inspect()` became `async` |
| `src/sync/embedded-reference.ts` | same; `lookup` only calls `locate` after checking the cache and the extractions in progress |
| `src/server.ts` | builds `sources` from the config; without sources, creates neither inspector nor embedded (explicit light mode) |
| `src/app.ts` | `/health` got `locator` (`null` in light mode) |
| `test/locator.test.ts` | new: light mode, order, failing source, hit cached and miss not, burst, `release` |
| `test/probe.test.ts`, `test/embedded.test.ts`, `test/streams.test.ts` | adapted to `locate` / `source` |

---

## Step B — Real-Debrid experiment (done, code removed)

**Question:** is the file's link already in RD when the 2nd subtitle request arrives?

### How it was done

- `src/streams/rd-experiment.ts` (temporary): a `FileSource` that **never returned a file**, only logged `rd.experiment` on each query. Turned on by `RD_EXPERIMENT=1` + `RD_TOKEN` in `.env` (read in `server.ts` with `readEnvFile`).
- It queried `GET /rest/1.0/downloads?limit=20` and `GET /rest/1.0/torrents?limit=20` in parallel (`Authorization: Bearer`) and `/torrents/info/{id}` of the 3 most recent torrents (for season packs). It logged: call number, ms since the 1st, found by name / name+size, age, torrent status, the field **names**. Never `link`, `download` or the token.
- Run on Windows (Stremio desktop + Torrentio with RD), not on the TV.

### Result

The Invite (2026), **never played before** on that account:

| Request | Moment | In `/downloads` (name + size)? |
|---|---|---|
| 1st (no hash, no `videoSize`) | 0 s | No (3 items) |
| 2nd (with hash, `videoSize` 26,762,682,750) | 5.5 s | **Yes** (4th item) |
| 3rd (choice with hash) | 8.4 s | Yes |
| `.srt` (player) | 10.6 s | Yes |

Findings:

- The item also shows in `/torrents` (`downloaded`, the file in `files` with the same size, 1 link), but `/downloads` is enough: it already carries the direct link (`download`).
- `/downloads` fields: `id, filename, mimeType, filesize, link, host, host_icon, chunks, download, streamable, generated`. `/torrents`: `id, filename, hash, bytes, host, split, progress, status, added, links, ended`.
- **RD's times come one hour ahead** (`generated`/`added` in France time marked as UTC): do not use age.
- Stremio desktop: the 2nd request (with hash) arrives ~3.5 to 5.5 s after the 1st. That is when RightSubs starts `prepare(..., { warm: true })`, so the RD source is in time.

Decision: on to step C, with `/downloads` only. The experiment was deleted (code, test and `RD_EXPERIMENT` from `.env.example`).

---

## Step C — `realdebrid` source (accepted)

### Implementation ([src/streams/realdebrid.ts](../src/streams/realdebrid.ts))

- `RealDebridSource implements FileSource`, `id = 'realdebrid'`.
- One query to `GET /rest/1.0/downloads?limit={lookback}` per lookup. Matches by name (case-insensitive) and, when Stremio sends `videoSize`, by `filesize === videoSize`. Same name with a different size = another release = not found. Without a size (1st request), the name is enough.
- Returns `{ url: download, videoSize: filesize, source: 'realdebrid' }`.
- **No cache of its own** (a deviation from the plan): `FileLocator` already keeps hits and merges bursts; keeping RD's list would make the 2nd request reuse a list without the file.
- 204 → empty list. 401/403 → one `realdebrid.token_rejected` with guidance and the source stops querying until restart. Other errors (HTTP 5xx, a response that is not a list) → exception, the locator logs it and moves on.
- Read-only: never calls `unrestrict` nor creates items on the account.

### Configuration

[src/config/schema.ts](../src/config/schema.ts): optional `streams.realdebrid`, `.strict()`, token required when `enabled`.

```yaml
streams:
  indexers: [...]        # off in companion mode
  realdebrid:
    enabled: true        # false in config.example.yaml
    token: ${RD_TOKEN}   # .env; token at https://real-debrid.com/apitoken
    # lookback: 20       # /downloads items (1–100)
    # timeoutMs: 3000
```

- `.env.example`: `RD_TOKEN=` (and the duplicated `SOOTIO_URL=` line was removed).
- `server.ts --check` shows `realdebrid: enabled|disabled` (without the token).
- `server.ts`: `sources = [proxy (if there are indexers), realdebrid (if enabled)]`.

### Tests

- `test/realdebrid.test.ts`: hit by name+size (response in the real format), same name with another size, no size, file missing, 204, rejected token (warns once and stops), 5xx and an unexpected response become errors, token and links never in the log.
- `test/config.test.ts`: token required, with a clear message; the example comes off.

---

## Fixes found along the way

### 1. Fps of interpolated video (Drive 60 fps)

**Risk:** with no reference, step 4 of `#sync` (`fpsOnly` in [src/subtitles/service.ts](../src/subtitles/service.ts)) rescaled the subtitle by `declared fps ÷ real fps`. Drive RIFE 60 fps with a 23.976 subtitle → scale 0.4: the subtitle shrunk to 40% of the time. Interpolation keeps the length; an fps difference only changes SRT timing when the release was sped up (25 ÷ 23.976 = 4.3%).

**Fix:** `MAX_SPEEDUP = 0.05`: ratios above 5% do not rescale (`no_reference` with the real `fps`). Test: "leaves the timing alone for frame-interpolated video". In practice ffprobe read 59.94 fps on Drive.

### 2. Dense dialogue fooled the decision (Drive −12.8 s)

**Symptom (1st test of C):** RD found the file (132 ms), English embedded track read (44 cues in 3 windows of 45 s), measured offset **−12.82 s** (the user's known answer: line at 1:13, subtitle at 1:26). But it came out `already_synced`: unadjusted overlap 0.85, adjusted 0.93, gain 0.08 < `MIN_SYNC_GAIN` 0.1.

**Cause:** the embedded windows are chosen where there is the most dialogue. With dense dialogue, almost any offset overlaps cue with cue, and time overlap hardly tells right from wrong.

**Diagnosis** (with the subtitle and the embedded track from the local cache):

| Offset | Overlap | Cues starting together (±0.5 s) |
|---|---|---|
| 0 | 0.85 | 32% |
| −12.82 s | 0.93 | **77%** |
| ±5 s, +20 s | — | 25–36% |

**Fix:**

- [src/sync/align.ts](../src/sync/align.ts): `Alignment` got `starts` and `startsBaseline` (the fraction of reference cues with a subtitle cue starting within ±500 ms, with and without the correction). Linear cost.
- `#judge`: the correction counts if the overlap gain is ≥ 0.1 **or** the starts gain is ≥ `MIN_STARTS_GAIN` (0.25). `already_synced` only when neither gains. `starts`/`startsBaseline` show in the `subtitles.served` log.
- Test with Drive's **real timings**, numbers only, no text: [test/fixtures/drive-2011-timings.json](../test/fixtures/drive-2011-timings.json) (read by `loadTimings` in `test/helpers.ts`), in `test/srt.test.ts` (alignment) and `test/service.test.ts` (end to end). Checked that the service test **fails without the rule** and passes with it. A synthetic test was tried first and dropped: it passed even without the rule.

---

## Validation (Windows, Stremio desktop, Torrentio with RD directly)

| Movie / file | Location | Result | On screen |
|---|---|---|---|
| Drive (2011) OpenMatte DV RIFE 60 fps DirtyHippie | RD, 188 ms; ffprobe 59.94 fps | `synced` through the embedded eng, −12.82 s (starts 32% → 77%) | Perfect |
| Halloween (1978) 2160p BluRay x265 Tigole | RD; 24 fps | `likely_synced` (YTS BluRay 2160p subtitle) | Right |
| The White Ribbon (2009) 1080p BluRay x264-OFT | 1st request did not find it; the 2nd found it 3.6 s later; 23.976 fps | `likely_synced` (VXT BluRay 1080p subtitle) | Right |
| The Invite (2026) REMUX (step B) | experiment, no URL | `no_reference`: v3 subtitle (YTS BluRay 1080p) served unadjusted | Perfect |

The "no exact subtitle but embedded text" case (C's acceptance) was covered by Drive; "different release with the same source and resolution" by Halloween Tigole and The White Ribbon; "1st request before the link exists" by The White Ribbon and The Invite.

---

## Step D — Companion mode documentation (pending)

- `docs/INSTALACAO-BOX.md` (removed): a "Companion mode" section (indexers off, `streams.realdebrid` on, `RD_TOKEN`; Torrentio/Sootio stay installed; do **not** turn indexers on with the addons installed, otherwise the streams show up twice).
- `docs/GUIA.md` (removed): both modes side by side (dedicated TV with proxy × companion); limits (RightSubs runs on a device with RD's IP; away from home the IP changes).
- The Windows script (section 0 above) as a way to test before installing on the box.
- `.env.example` and `config.example.yaml`: **done** in step C.

## Step E — Coexistence with OpenSubtitles v3 (pending, user)

Independent of the code. Script in [COMPANION-MODE.md](COMPANION-MODE.md#coexistence-with-other-subtitle-addons-opensubtitles-v3-etc): reinstall v3 **after** RightSubs, play 2–3 titles and note which track came selected. Can be done in Stremio desktop. Result in question 3 of `docs/FINDINGS.md`.

## Step F — Stremio's local server (no commitment)

Investigation only, no code in the addon:

1. With a direct torrent playing: `curl -s http://127.0.0.1:11470/stats.json` (does the server exist and is it reachable? on the PC and in the box's Termux).
2. If so: find the file by name/size without `infoHash` and measure how much an ffprobe disturbs playback.

Becomes a source (`id: 'stremio-server'`) only with the user's decision.

## Step G — Hostable light mode

Decide after E and F, together with the guide for friends ([NEXT-STEPS.md](NEXT-STEPS.md#sharing-with-others)).

---

## Rules for every step

Those in `CLAUDE.md`: erasable syntax, no new dependencies, `node:test` for every new behavior, no URL/token in logs, memory with a limit and released in `onIdle`, no `setInterval`, free services only.
