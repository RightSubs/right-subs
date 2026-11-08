# RightSubs — Development plan

> **History.** Written for the old install (Termux, deployed from the computer). Today the addon runs inside the APK (root `README.md`); the scripts and guides mentioned here were removed on 2026-11-01.

> Status: **approved** — phase 0 ready on the computer; validation on the box postponed (see [NEXT-STEPS.md](NEXT-STEPS.md))
> Last update: 2026-10-28

## 1. Goal

A Stremio addon, running on the box itself (Chromecast with Google TV 4K, through Termux), that guarantees:

> Search a title → pick **any** file → press play → watch with a **synced** subtitle in the primary language (pt-BR) or, if there is none, the secondary (EN) — without choosing a player, without choosing a subtitle, without adjusting the delay.

### Premises
- **Minimal use of the box's resources:** uses memory/CPU/disk only while Stremio uses the addon; idle, it stays at the floor (see §6.1).
- **Free services only.**
- **Everything configurable by file:** languages, subtitle sources, syncing — without touching code.
- Player: EXO fixed in Stremio (MPV as a manual alternative; the addon works the same with both).

### Out of scope (for now)
- Automatic translation — documented as a future evolution (§10).
- Controlling the player (that is the Stremio app's configuration).
- Replacing Real-Debrid or Torrentio (they remain the source of the streams).
- Running in the cloud.

## 2. How the addon fits into Stremio

The addon does not override Stremio — it takes part in the official addon protocol:

```
Stremio (EXO, default subtitle pt-BR, secondary EN)
  │
  ├─ GET /stream/{type}/{id}.json
  │     → the addon queries the indexers (Torrentio and Sootio, with your RD key) and returns the SAME lists
  │     → records filename/size → URL of each file (to read the video later)
  │
  ├─ GET /subtitles/{type}/{id}/{videoHash,videoSize,filename}.json
  │     → answers AT ONCE with 1 track: pt-BR if it exists; otherwise EN
  │     → starts the preparation (syncing) in the background
  │
  └─ The player downloads GET /sub/<key>.srt
        → the addon serves the ready subtitle, waiting for the sync
          within the time budget
```

Stremio's preferences (primary pt-BR, secondary EN) stay as they are and match what the addon returns. If the addon is down, Stremio carries on with embedded tracks — the worst case is the same as today.

## 3. Languages: primary and secondary

```yaml
languages:
  primary: pt-BR
  secondary: en-US
  useSecondaryWhen: [not_found]     # optional: [not_found, low_confidence]
```

| Situation | What the addon serves |
|---|---|
| There is a subtitle in the primary language | The primary, synced |
| There is none in the primary | The secondary, synced |
| The primary exists but the sync ended with low confidence | By default, the primary anyway. With `low_confidence` on, prefers the well-synced secondary. |

- Each service's codes (Stremio, OpenSubtitles) derived automatically from a language table. E.g.: `en-US` becomes `en`/`eng` in searches — subtitle sources do not tell regional English variants apart.
- Changing language = editing two lines and restarting the service.

## 4. Subtitle sources: pluggable providers

### OpenSubtitles: free account + v3 addon, combined

| Provider | Account | Use |
|---|---|---|
| **OpenSubtitles API** (free account + free API key) | Yes, free | **Search**: returns release, fps, whether it matches by hash. Searching does not use the download quota. |
| **Stremio's OpenSubtitles v3 addon** | No | **Download without quota**, if the IDs match the API's (to be confirmed in phase 1). Also the fallback when the API quota runs out. |

**Free quota (confirm the current values when creating the account):** around 20 downloads/day with login, fewer without. Estimated typical use: 1–3 downloads per new file (the chosen subtitle + a possible reference), zero for repeated files (cache). Movies fit easily; a series binge is the risky scenario — covered by downloading through the v3 addon and by the cache.

`/health` shows the daily quota use.

### Provider types

| Type | How to add | Examples |
|---|---|---|
| `stremio-addon` | **Configuration only:** the manifest URL of any Stremio subtitle addon | OpenSubtitles v3, SubDL, SubSource (addon versions) |
| Native (API) | A file in `src/providers/` implementing `SubtitleProvider` + an entry in the config | OpenSubtitles API |

```ts
interface SubtitleProvider {
  id: string;
  search(query: SubtitleQuery): Promise<SubtitleCandidate[]>; // imdb, season/ep, hash, size, filename, languages
  download(candidate: SubtitleCandidate): Promise<Buffer>;
}
```

## 5. Configuration

A single YAML file (accepts comments, editable in Termux with `nano`). Secrets in `.env`, referenced by `${VAR}`. Both outside git; the repository has `config.example.yaml` and `.env.example`.

```yaml
server:
  port: 7000

languages:
  primary: pt-BR
  secondary: en-US
  useSecondaryWhen: [not_found]

providers:                       # order = priority
  - id: opensubtitles-api
    type: opensubtitles-api
    enabled: true
    apiKey: ${OPENSUBTITLES_API_KEY}
    username: ${OPENSUBTITLES_USER}
    password: ${OPENSUBTITLES_PASSWORD}
    downloadVia: opensubtitles-v3   # downloads through the addon (no quota) when possible
  - id: opensubtitles-v3
    type: stremio-addon
    url: https://opensubtitles-v3.strem.io/manifest.json
    enabled: true
  # - id: subdl
  #   type: stremio-addon
  #   url: <SubDL addon manifest>
  #   enabled: true

streams:
  indexers:                      # Torrentio + Sootio, already set up with Real-Debrid (phase 3)
    - id: torrentio
      url: ${TORRENTIO_URL}
    - id: sootio
      url: ${SOOTIO_URL}

sync:
  enabled: true
  budgetSeconds: 15              # how long to wait before serving the best available
  minConfidence: 0.7
  audio:
    samples: 8
    sampleSeconds: 45

resources:
  idleAfterMinutes: 10           # no Stremio requests → frees memory and clears temporary files
  maxIdleMemoryMB: 80            # above this when idle → restarts clean
  maxConcurrentJobs: 1
  lowPriority: true              # Stremio always wins the CPU

cache:
  dir: ~/.rightsubs/cache
  maxSizeMB: 50
  maxAgeDays: 10

log:
  level: info
```

Validation on start, with a readable error (e.g. `languages.primary: unknown language "pt-BRR" — valid examples: pt-BR, pt-PT, es, en-US`).

## 6. Technical decisions

| Topic | Decision | Reason |
|---|---|---|
| Language | TypeScript (Node.js LTS) | the official `stremio-addon-sdk`; Node available in Termux |
| Dependencies | Pure JS only (no native modules) | Compiling native modules on Termux/ARM is fragile |
| External tools | `ffmpeg`/`ffprobe` as subprocesses | Reading headers and audio windows |
| Syncing | Own engine in TS (text×text and audio×text) | Avoids packaging `alass`/`ffsubsync` in Termux; testable |
| Persistence | Files on disk + JSON index with LRU | No native SQLite; respects the storage limit |
| Development | On the Mac, with Stremio Desktop pointing at `127.0.0.1` | Fast cycle; the box only for validation |
| Deploying to the box | `git clone`/`git pull` in Termux + scripts | Updating in 1 command |

### 6.1 Resource use (a cross-cutting requirement)

The addon must be listening when Stremio calls, and on Android 10+ a Termux app cannot know whether Stremio is open. So the process stays resident, but **minimal**: all heavy work is on demand and released right after.

**Targets (measured on the box):**

| State | Memory (RSS) | CPU | Disk |
|---|---|---|---|
| Idle (Stremio unused for 10 min) | ≤ 60 MB | ~0% (no active timer) | no writes |
| In use (syncing) | peak ≤ 200 MB, ffmpeg included | 1 core, low priority | subtitle cache only |
| Total on disk | — | — | ≤ 60 MB besides Node/ffmpeg (50 MB cache + 4 MB logs + code) |

**Mechanisms:**

| Resource | Mechanism | Since |
|---|---|---|
| Code memory | TypeScript compiled to JS at install time; the compiler removed right after (running TS directly cost ~20 MB more) | Phase 0 |
| Node memory | Limited heap (`--max-old-space-size=128`, `--max-semi-space-size=2`) | Phase 0 |
| Idle mode | No Stremio requests for `idleAfterMinutes` → frees in-memory caches, clears temporary files, forces garbage collection. If still above `maxIdleMemoryMB`, restarts clean (the supervisor brings it back in 1 s). | Phase 0 |
| Idle CPU | No periodic timer: the only timer is armed by activity and fires once | Phase 0 |
| Priority | Service and ffmpeg run at low priority (`nice 10`): Stremio always wins the CPU | Phase 0 |
| Disk — cache | Size cap (`maxSizeMB`, default 50) + age limit (`maxAgeDays`, default 10), applied on start and when going idle | Phase 0 |
| Disk — temporary files | `tmp` folder emptied on start, when going idle and at the end of each task | Phase 0 |
| Disk — logs | Rotated at 2 MB, at most 2 files (4 MB) | Phase 0 |
| Disk — install | npm cache cleared after installing/updating; runtime dependencies only | Phase 0 |
| Uninstall | `scripts/uninstall-termux.sh` removes service, boot, cache and logs (`--all` removes everything) | Phase 0 |
| Heavy tasks | At most `maxConcurrentJobs` (default 1) simultaneous syncs; ffmpeg with 1 thread; child processes ended by timeout and when the service stops | Phases 3–4 |
| Audio | Read in windows through HTTP range and processed as a stream (pipe), with no temporary files; the video is never written to disk | Phase 4 |
| In-memory structures | Maps (e.g. file → URL) with an item limit and expiry, released in idle mode | Phase 3 |

`/health` shows the state (`active`/`idle`), memory and cache use, to check the targets in practice.

**Acceptance criterion in every phase:** the targets above are still met, measured on the box.

### Chromecast with Google TV 4K specifics
- **2 GB of RAM, modest ARM CPU:** Node memory limit, 16 kHz mono audio in short windows, text×text before audio.
- **Little free storage:** cache with a configurable cap.
- **Possibly a 32-bit (ARM) system:** confirm in phase 0 that Termux's Node and ffmpeg run on the box — the first test.
- **Picture/sound (a reference for choosing files, does not affect the addon):** Dolby Vision profiles 5 and 8 work; profile 7 (dual-layer UHD remux) does not. Atmos over DD+ (EAC3) is usually passed through; TrueHD generally not.

## 7. Repository layout

```
right-subs/
├── README.md
├── config.example.yaml
├── .env.example
├── docs/
│   ├── DEVELOPMENT-PLAN.md
│   ├── INSTALACAO-BOX.md          # phase 0
│   ├── CONFIGURATION.md           # every YAML option explained
│   ├── NEW-PROVIDER.md            # how to add a subtitle source
│   ├── FINDINGS.md                # Stremio's real behavior (phase 1)
│   └── FUTURO-TRADUCAO.md         # design of the optional translation (§10)
├── src/
│   ├── server.ts
│   ├── config/                    # loading, validation, ${VAR}
│   ├── languages/                 # language table + code mapping
│   ├── stremio/                   # handlers: stream, subtitles, /sub/*.srt
│   ├── streams/                   # Torrentio proxy + filename→URL map
│   ├── providers/                 # registry + stremio-addon + opensubtitles-api
│   ├── ranking/
│   ├── subtitle/                  # parse/serialize SRT, encoding, fps
│   ├── sync/                      # text and audio alignment, confidence
│   ├── media/                     # ffprobe/ffmpeg
│   └── cache/
├── test/
│   ├── unit/
│   └── fixtures/
└── scripts/
    ├── install-termux.sh
    ├── update.sh
    └── boot/start-rightsubs
```

## 8. Phases

Each phase ends with an **approval gate**: I show the result, you validate it on the TV and approve the next.

---

### Phase 0 — Foundation, configuration and infrastructure on the box
**Scope**
- TypeScript repository (build, lint, tests, `.gitignore` for secrets).
- Configuration system (YAML + `.env` + validation) and language table.
- Provider registry (interface, no implementation yet).
- Server with `manifest.json` and `/health`.
- `scripts/install-termux.sh`: Node, ffmpeg, git, Termux:Boot, `termux-wake-lock`.
- `docs/INSTALACAO-BOX.md` and `docs/CONFIGURATION.md`.

**Acceptance criteria**
- Node and ffmpeg running on the box.
- Addon installed in the box's Stremio, comes back by itself after a restart and stays up for 24 h.
- An invalid config gives a clear error message.
- Idle: ≤ 60 MB RSS in `/health` (`state: idle`).

**Plan B** if Termux does not hold up: a small device on the same network (Raspberry Pi), same code.

---

### Phase 1 — Stremio integration + first useful subtitle
**Scope**
- Providers `opensubtitles-api` (with your free account) and `stremio-addon` (OpenSubtitles v3).
- `/subtitles` returning **one** track: the primary if it exists, otherwise the secondary (not synced yet).
- Conversion to UTF-8 SRT (fixes accents of old subtitles).
- `/sub/*.srt` with on-demand preparation and a time budget.
- API quota control (counter in `/health`, automatic fallback to the v3 addon).
- Structured logs for every request.
- `docs/FINDINGS.md` answering, with evidence:
  1. The language code Stremio associates with "Portuguese (Brazil)".
  2. Do EXO and MPV show the addon's external track?
  3. Which does Stremio prefer: an embedded track or an addon track in the same language?
  4. How long the player waits for the `.srt` before giving up.
  5. Does Stremio send `videoHash` for Real-Debrid HTTP streams?
  6. Do the v3 addon's IDs match the API's (download without quota)?
- Removing OpenSubtitles v3 from your Stremio install.

**Acceptance criteria**
- On play, RightSubs' track shows **selected automatically** on EXO (and tested on MPV).
- A title without pt-BR gets the EN track automatically.
- The 6 questions answered; later phases adjusted if anything contradicts the premises.

---

### Phase 2 — Smart choice + cheap fixes
**Scope**
- Ranking: hash > release name (group, source, resolution) > matching fps > downloads/rating.
- Frame rate correction (25 ↔ 23.976 ↔ 24).
- **Text × text syncing (brought forward from phase 4, decision of 2026-10-29):** when the chosen subtitle is not for the exact file, align it against a **reference** for the exact file (match by hash or the same release name, in any language searched) and fix **offset + fps**. Reason: Valkyrie (Licdom) showed a fixed offset of +25.5 s, measured with 91–95% matching from text alone — cheap (no ffmpeg, milliseconds) and reliable. With no reference or low confidence, serves the subtitle as it is. Cost: +1 download of the quota when the reference is not in v3 (once per file, cached).
- **Golden set:** 15 real titles that cause trouble today, with the expected result recorded (1st: Valkyrie/Licdom, +25.5 s — [FINDINGS.md](FINDINGS.md)).

**Acceptance criteria**
- ≥ 70% of the golden set without any manual adjustment.

---

### Phase 3 — Stream proxy (Torrentio + Sootio + Real-Debrid)
**Scope**
- **Multiple indexers** (decision of 2026-10-28): the user uses Torrentio and Sootio, both with Real-Debrid. If only one went through the proxy, the other's streams would get no audio syncing (no filename → URL map) — inconsistent behavior depending on the indexer chosen.
  - Config: `streams.upstream` (one URL) becomes a list of indexers; `.env` gets `SOOTIO_URL` next to `TORRENTIO_URL`.
  - Indexers queried in parallel; a slow or down one does not block the others (timeout per indexer).
- `/stream` returning each indexer's lists **identically** (names, order, links).
- `filename + size → URL` map, fed by all indexers.
- On-demand `ffprobe`: real fps, embedded tracks (language, format).
- Torrentio and Sootio uninstalled from Stremio.

**Acceptance criteria**
- Lists equal to the original indexers', overhead < 1 s overall.
- An indexer that is down does not keep the others' results away.
- The fps correction starts using the file's real fps.

---

### Phase 4 — Automatic sync engine
**Scope**
- **Text × text:** the basic version (offset + fps against an exact-release candidate) comes in phase 2. Here: the **embedded** text track as reference, non-linear drift and cuts.
- **Audio × text:** windows of the file through HTTP range (without downloading the movie), speech detection, offset + drift adjustment, cut detection.
- Confidence score; the `useSecondaryWhen: low_confidence` rule starts working.
- Applies to the primary and the secondary language.
- Cache per file.

**Acceptance criteria**
- ≥ 90% of the golden set without manual adjustment (in pt-BR or, failing that, EN).
- Subtitle available in < 15 s on the first play, measured on the box.

---

### Phase 5 — Robustness, extra sources and publishing
**Scope**
- Additional sources through configuration (SubDL/SubSource addons) + `docs/NEW-PROVIDER.md`.
- Watchdog, log rotation, `scripts/update.sh`.
- `docs/FUTURO-TRADUCAO.md`.
- Complete README, license, secrets review — ready for GitHub.

**Acceptance criteria**
- 1 week of real use without intervention.
- Adding a `stremio-addon` provider only requires editing the YAML.

## 9. Decisions

| # | Decision | Status |
|---|---|---|
| 1 | Project name | ✅ RightSubs (`right-subs`) |
| 2 | Box | ✅ Chromecast with Google TV 4K |
| 3 | Subtitle sources | ✅ OpenSubtitles API (free account) for search + v3 addon for downloads without quota / fallback |
| 4 | Languages | ✅ Primary pt-BR, secondary EN |
| 5 | Translation | ✅ Out of the current scope; documented for the future |
| 6 | OpenSubtitles account + API key | ⏳ Before phase 1 — you create it; credentials only in `.env` |
| 7 | Indexer URLs (Torrentio + Sootio) | ✅ Both go through the proxy (phase 3); URLs only in `.env` |
| 8 | Golden set (15 titles) | ⏳ Phase 2 |

## 10. Future: automatic translation (optional)

Not to be implemented now: with a synced secondary language, most cases are covered. If usage data shows many titles falling to the secondary, translation comes in as a new phase:

- A new `useSecondaryWhen` option → `translate`: translates the **already synced** secondary subtitle into the primary language, keeping the timings.
- A pluggable translation provider (same model as the subtitle providers); initial candidate: **DeepL API Free** (free account, a monthly character quota — a few movies a month).
- Translations cached; quota use in `/health`.
- To help: RightSubs logs how many times it served the secondary — that number decides whether the phase is worth it.

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Android kills Termux | The addon disappears | Wake lock, Termux:Boot, no battery optimization; plan B Raspberry Pi |
| 32-bit box / little RAM | Node or ffmpeg do not run well | Validated right in phase 0 |
| OpenSubtitles API daily quota | No new download that day | Download through the v3 addon, cache, counter in `/health` |
| The v3 addon's IDs do not match the API's | Downloading through v3 does not work | Downloads through the API (quota) + v3 as an independent search/download |
| Change in the v3 addon's format | The provider breaks | Isolated provider + contract tests; other sources through config |
| The player gives up before the subtitle is ready | No subtitle on the 1st play | Budget measured in phase 1; serve the best available; cache |
| Stremio does not send `videoHash` for HTTP | Loses the hash match | filename→URL map (phase 3) and the addon computing the hash |
| Real-Debrid and IP | Account blocked | Everything runs on the box (same IP as the TV) |

## 12. Approval

Project approved on 2026-10-28. With no access to the box for now, the phases are developed and tested on the computer (Stremio Desktop) and validated on the box in a single round afterwards. Status: **ready on the computer** → **accepted** (after testing on the box).

| Phase | Approved | Status |
|---|---|---|
| 0 — Foundation, configuration and infrastructure on the box | ✅ | **Accepted** on the box (2026-10-29; 24 h uptime still to be confirmed) |
| 1 — Stremio integration + first useful subtitle | ✅ | **Accepted** on the box (2026-10-29) — [FINDINGS.md](FINDINGS.md) |
| 2 — Smart choice + cheap fixes | ✅ | **Accepted** (2026-10-29): Valkyrie validated on the TV; golden set replaced by on-demand analysis (personal use) |
| 3 — Stream proxy | ✅ | **Accepted** (2026-10-29): identical lists, on-demand ffprobe, indexers uninstalled from Stremio |
| 4 — Automatic sync engine | ✅ | — (time/memory only count when measured on the box) |
| 5 — Robustness, extra sources and publishing | ✅ | — |
