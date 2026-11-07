# Next steps

> As of 2026-11-07: the addon runs inside the APK (Xiaomi box and phone), in companion mode (Torrentio/Sootio installed directly in Stremio; RightSubs finds the file through Real-Debrid or Stremio's local server). Evidence: [FINDINGS.md](FINDINGS.md). Box, build and install: the root `README.md` and `CLAUDE.md`.

When a title comes **out of sync**: note which one it was (movie/episode and, if possible, the chosen file) and bring it for analysis — the log has the rest (`-debuglog` APK on the box: skill `box`).

## Questions still open

| # | Question | Where it stands |
|---|---|---|
| 3 | Embedded track in the primary language × the addon's track: which one does Stremio pick? | Seen once: the embedded pt-BR won (Ted Lasso). [FINDINGS.md](FINDINGS.md) |
| 4 | How long does the player wait for the `.srt`? | EXO waited ≥ 34 s (Drive); limit unknown |

## Deferred until needed

| Item | Trigger | Starting point |
|---|---|---|
| **Audio syncing** | Titles with `no_reference`/`low_confidence` and no text reference at all | First real case: Enter the Void r00t "Extended" 24 fps (only PGS, wrongly declared fps; expected ×0.999, ~+0.5 s — `FINDINGS.md`). The APK's ffmpeg will need audio decoders. Known answer: Valkyrie/Licdom = +25.5 s |
| Embedded reading 4× slower with the subtitle track | Heavy files taking long to sync | Same window: 9.7 s audio only × 41–44 s with the subtitle; internal ffmpeg cause not found (Drive, `FINDINGS.md`) |
| **Secondary also when the primary fails** (today only when there is none in the primary) | A title with an out-of-sync (or undownloadable) pt-BR and a pt-PT available | `chooseLanguage`/`#prepare` in `src/subtitles/service.ts`; apply `useSecondaryWhen: low_confidence` (already accepted in the config, without effect). Decide first: synced pt-PT × unchecked pt-BR. `CONFIGURATION.md` (`languages`) |
| **Automatic translation (DeepL) — DONE and validated on the box on 2026-11-03** | No subtitle in the primary or the secondary | See [DEEPL-TRANSLATION.md](DEEPL-TRANSLATION.md). **Open, nothing requested:** (1) heavy files (23.6 GB): 6 windows may exceed the 120 s cap and fall into the unchecked path; (2) the "RightSubs: preparing subtitle" entry in the subtitle menu was not seen on screen; (3) `<font color>` in subtitles served **without** translation ignores Stremio's style (remove it?); (4) syncing the stepped English by segments (would need the whole embedded track: out of scope); (5) the provisional message says "about 30 s", short for heavy files (Cat's Eyes 2160p: 45 s; the user got the provisional one twice): consider "about 1 minute" (all 16 translations in `src/i18n/messages.ts`); (6) movies translated **without checking the timing** (maintainers' decision): a cheap duration check (last cue × movie length) would catch gross cuts; (7) measure Stremio's exact wait limit (between 5.9 s and 12.8 s since the 1st request) and, if needed, expose `translationWaitMs`; (8) **sources without Real-Debrid not tested** (Stremio torrent, other debrids): table in DEEPL-TRANSLATION.md; supporting another debrid would need one `FileSource` per service. **Out of scope by the maintainers' decision:** translating the whole embedded track |
| Extra subtitle sources (SubDL, SubSource) | pt-BR missing on OpenSubtitles | [NEW-PROVIDER.md](NEW-PROVIDER.md) |
| OpenSubtitles consumer: untick **Under dev** | When convenient | No effect, since the login is used |
| **Upload corrected subtitles to OpenSubtitles** | The REST API allowing uploads (XML-RPC was shut down for third parties in early 2026) | Only `synced` subtitles with high confidence and **confirmed by the user**; upload with the file's name and hash; credit the translator and the original release. Doing it by hand does not pay off (decision of 2026-10-29) |

## Sharing with others

The APK covers the essentials (credentials on the screen or from a phone, torrents without Real-Debrid). What each person needs to know is in the root README; points to remember:

1. **Stremio's addon list belongs to the account.** RightSubs (`127.0.0.1`) only answers on the device where the APK is; on other devices of the same account it brings no subtitle. The other subtitle addons can stay installed (all APK tests were done that way) and keep serving those devices.
2. Each person uses their **own** accounts: OpenSubtitles (free — username, not e-mail) and, if they have one, Real-Debrid.
3. The repository is public: `FINDINGS.md` and `DEEPL-TRANSLATION.md` record real file names used in the tests (they document the known answers).
