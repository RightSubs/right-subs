# Changelog

Versions of the **APK** (the [VERSION](VERSION) file); the addon gets the same version at build time. Each `## [X.Y.Z]` section becomes the notes of its GitHub release. How to release: [README › Releases](README.md#releases).

## [Unreleased]

- **TorBox:** like Real-Debrid, a TorBox token lets RightSubs find the video you are playing in your account (by name and size) and read its fps and embedded subtitle. Token field in the credentials form and in "Fill in on your phone"; both services can be filled in.
- **More translation services:** Gemini and OpenRouter join DeepL as the last-resort translator. A new **AI translation** page (main screen) explains how it works, sets the order (1st/2nd/3rd) and holds the three keys; when a service runs out of quota or fails, the next one finishes the subtitle (what it already translated is kept). Keys go in the credentials form and in "Fill in on your phone". The AI notice in the subtitle names the service that translated, and the status line shows OpenRouter's free requests used today.
- **Wrong-episode subtitles skipped:** a subtitle whose last line ends before 60% of the video's length is from another episode or cut, so it is skipped and the next one is tried.
- **Background on phones:** the first start asks Android once to let RightSubs run in the background (some phones stop the addon otherwise); the README explains autostart and locking the app in recents.
- **Translation quota and resume:** the main screen shows the DeepL characters used this month; an interrupted translation resumes where it stopped, and one the quota cannot finish is not started.
- **Search kept on disk:** a complete search answer is reused for 6 hours, so opening the same video again, or restarting, does not call the subtitle providers again.
- **No more Stremio crash when there is no subtitle:** Stremio 2.6.0's streaming server aborts (and the app closes) when the address of an external subtitle answers 404, which RightSubs did whenever it found nothing. It now answers a short on-screen message ("No subtitle was found for this video", in the primary language, 16 languages) instead.
- **Clear cache button:** deletes the subtitles, searches and translations the addon kept and restarts it; credentials, settings and the log stay. It asks first, because the next time each video is opened it is searched and translated again (quotas).
- **Secondary language optional:** pick **None** to get only the primary.
- **Downloader codes** for installing on a TV (armeabi-v7a `8965173`, arm64-v8a `8443424`, universal `1324699`): in the README and in every release's notes. They always download the newest version.
- **VirusTotal:** every release sends its APKs to VirusTotal and its notes link to each report, with the number of detections.

## [0.2.0] — 2026-11-08

First public release. Everything in [0.1.0](#010--2026-11-04) below is included.

- **Releases on GitHub:** pushing a `vX.Y.Z` tag builds, signs (organization key) and publishes the APKs, with `SHA256SUMS.txt`, `BUILD-INFO.txt` and a build provenance attestation. Fixed file names (`rightsubs-armeabi-v7a.apk`, `rightsubs-arm64-v8a.apk`, `rightsubs-universal.apk`), so `releases/latest/download/…` always points at the newest version.
- **CI:** the unit tests run on every pull request and push to `main`.
- **App in English and Portuguese:** follows the device language (on Android 13+ it can be set per app), the phone form and the credential errors included.
- **Messages in Stremio in the primary language:** the subtitle menu entries, the on-screen notices, the translation notice and the addon description follow the primary subtitle language, in all 16 languages offered (English for any other). Before, only Portuguese or English, and following the language of the subtitle served.
- Code, logs, configuration errors, scripts and documentation in English.
- **License:** GNU GPL v3.0 or later. Each release also carries the source of the bundled ffmpeg (LGPL) and our patch to it.

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
