# RightSubs (addon)

The Stremio addon that goes inside the APK: it serves the **right subtitle, in your language and synced** for any file, without choosing a player or subtitle, or adjusting the delay. To install it, use the APK: [root README](../README.md).

- Offers Stremio **a single track**, already chosen: the player selects it by itself.
- Picks the best subtitle in the primary language (default pt-BR) by the file's hash, release name, **edition** (DC, Extended…), group, source, resolution and fps. With none in the primary, serves the secondary (default pt-PT).
- Syncs by itself when the subtitle is from another release, against a reference: a subtitle made for the exact file (any language; English searched only as a reference), the subtitle **embedded** in the file, or a subtitle from another release of the same edition, source and resolution. Fixes offset and fps; with no reference, fixes only the fps from the file's real value.
- Finds the file that is playing through Real-Debrid or, in a torrent without Real-Debrid, through Stremio's local server.
- Converts to UTF-8 (accents of old subtitles) and caches.
- Pluggable subtitle sources (default: OpenSubtitles — free API + the v3 addon, which uses no quota).
- Anime through the Anime Kitsu catalog (maps the ids to IMDb, absolute numbering included).
- Talks to the viewer (subtitle menu entries, on-screen notices) in the primary language, in [16 languages](src/i18n/messages.ts).

How each step works and the known limitations: [docs/CONFIGURATION.md](docs/CONFIGURATION.md#sync).

## Development

Needs Node.js ≥ 22.18 and ffmpeg. In the `rightsubs/` folder:

```sh
npm install
cp config.example.yaml config.yaml && cp .env.example .env   # fill in .env
npm run dev               # runs the TypeScript directly: http://127.0.0.1:7000/manifest.json
npm test
npm run typecheck
npm run build             # builds dist/ (JavaScript) — what goes into the APK
```

Stremio Desktop accepts the local addon at the same URL, to test without the TV. `config.yaml` and `.env` stay outside git and never get into the APK.

The device runs only the compiled JavaScript (TypeScript directly would cost ~20 MB more memory), with the `yaml` and `zod` dependencies — pure JavaScript, no native modules.

**Translations:** the viewer messages are in [src/i18n/messages.ts](src/i18n/messages.ts), one block per language. Fixes from native speakers are welcome; `npm test` checks that every language keeps every text and placeholder.

## Documentation

| Document | Contents |
|---|---|
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Every `config.yaml` option, how syncing decides, limitations |
| [FINDINGS.md](docs/FINDINGS.md) | Real Stremio and OpenSubtitles behavior, measurements and real test cases |
| [DEEPL-TRANSLATION.md](docs/DEEPL-TRANSLATION.md) | The last-resort DeepL translation: rules, measured constants, logs |
| [NEXT-STEPS.md](docs/NEXT-STEPS.md) | Pending items and what was deferred |
| [NEW-PROVIDER.md](docs/NEW-PROVIDER.md) | How to add a subtitle source |
| [DEVELOPMENT-PLAN.md](docs/DEVELOPMENT-PLAN.md), [COMPANION-PLAN.md](docs/COMPANION-PLAN.md), [COMPANION-MODE.md](docs/COMPANION-MODE.md) | History: architecture and plans (written for the old Termux install) |
