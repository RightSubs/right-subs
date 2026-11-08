# Changelog

Versions of the **APK** (the [VERSION](VERSION) file); the addon gets the same version at build time. Each `## [X.Y.Z]` section becomes the notes of its GitHub release. How to release: [README › Releases](README.md#releases).

## [Unreleased]

## [0.2.0] — 2026-11-08

First public release. Everything in [0.1.0](#010--2026-11-04) below is included.

- **Releases on GitHub:** pushing a `vX.Y.Z` tag builds, signs (organization key) and publishes the APKs, with `SHA256SUMS.txt`, `BUILD-INFO.txt` and a build provenance attestation. Fixed file names (`rightsubs-armeabi-v7a.apk`, `rightsubs-arm64-v8a.apk`, `rightsubs-universal.apk`), so `releases/latest/download/…` always points at the newest version.
- **CI:** the unit tests run on every pull request and push to `main`.
- **App in English and Portuguese:** follows the device language (on Android 13+ it can be set per app), the phone form and the credential errors included.
- **Messages in Stremio in the primary language:** the subtitle menu entries, the on-screen notices, the translation notice and the addon description follow the primary subtitle language, in all 16 languages offered (English for any other). Before, only Portuguese or English, and following the language of the subtitle served.
- Code, logs, configuration errors, scripts and documentation in English.

## [0.1.0] — 2026-11-04

First version.

- RightSubs in an APK for Android TV/Google TV and phones, without Termux: Node 24 LTS (Termux), minimal ffmpeg/ffprobe 7.1.1, a foreground service that starts on boot.
- OpenSubtitles credentials and Real-Debrid token encrypted with the Android Keystore; filling them in on a phone (QR code + temporary form on the local network).
- Languages on screen: primary and secondary (default Brazilian and European Portuguese) and the reference for syncing (default English).
- Torrents without Real-Debrid found through Stremio's local server.
- **Install in Stremio:** on a phone it opens Stremio Web in the browser; on a TV it shows where to type the address (Addons › Add addon), because Stremio turns `stremio://` into `https://` and the local addon only answers on `http`.
- **DeepL translation** as a last resort (optional key on the screen and in "Fill in on your phone"): with no Portuguese subtitle, translates the best subtitle in any language whose timing the embedded track confirms; movies without an embedded track too, if the subtitle's fps is the file's ("timing not confirmed" notice). The first time takes 20 to 60 s, so the video opens with a provisional subtitle.
- **Subtitle embedded in the video itself:** if the file already has a track in the primary or secondary language, RightSubs neither searches nor downloads anything.
- **Text cleanup** of every subtitle served: musical notes, replacement character, control characters, `#` music marks and leftover ASS.
- **Stremio-like look:** dark background, purple `#7B5BF5`, Plus Jakarta Sans font and a clearly visible remote focus; on opening, focus starts on **Install in Stremio**.
- Icon and TV banner; screen adapted to phones in portrait.
- The addon's version is the APK's (injected at build time, which checks it).
- Testing only: `-Prefill` (`.env` credentials in the APK), `-WorkingTree` (addon with uncommitted changes) and `translation.deepl.forceFrom`. Never distribute those APKs.
