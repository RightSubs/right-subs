---
name: box
description: Reaches the Android TV box over the network (adb inside the container) to install the APK, read RightSubs' /health and log, and time subtitle extraction on the box itself. Use when the user asks to install on the box, read the log, check whether the addon is running, or investigate a movie that came out of sync.
---

# Working on the box

The box's IP and details are in `CLAUDE.local.md`. Everything goes through `scripts/adb.sh` (adb inside the container; key in the `rightsubs-adb` volume). Example: `BOX=<ip> sh scripts/adb.sh shell getprop ro.product.model`.

If it does not connect: the box restarted/updated, or debugging was turned off. Ask the user to turn on **Developer options → USB debugging** (and network debugging, if there is one) and accept "Always allow" on the TV. When a round of tests is over, remind them to turn debugging off.

## Install / update

```sh
BOX=<ip> sh scripts/adb.sh shell getprop ro.product.cpu.abilist     # armeabi-v7a → armeabi-v7a APK
BOX=<ip> sh scripts/adb.sh install -r /out/<apk>                     # -r keeps the credentials
BOX=<ip> sh scripts/adb.sh shell am start -n com.rightsubs.android/.MainActivity
```

- Same signing key = installs over. A different key → `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (it would need an uninstall and the credentials would be lost: ask first). Releases are signed with the organization's key (GitHub secrets); a local build uses the key in `signing/`, which is a different one, so a local build does not install over a release (and vice versa).
- Before the first install on a box that runs the **Termux** RightSubs, that one must be removed (port 7000).
- The user presses "Save and start" on the TV; do not automate the screen (it is `FLAG_SECURE` and shows credentials).

## Is it running (/health)

`forward` only works inside the container, so do it all in one call:

```sh
MSYS_NO_PATHCONV=1 docker run --rm -e BOX=<ip> -v rightsubs-adb:/root/.android rightsubs-apk-builder bash -c '
  adb start-server >/dev/null 2>&1; adb connect $BOX:5555 >/dev/null; sleep 2
  adb forward tcp:7000 tcp:7000 >/dev/null; curl -s http://127.0.0.1:7000/health'
```

Of interest: `tools.ffmpeg.available`, `providers[0].login` (`ok`, `no_account`, `rejected`, `pending`), `locator` (Real-Debrid), `subtitles.served` and `subtitles.recentUnsynced` (reset on restart).

## Reading the log

Only in `-debuglog` APKs (`.\build.ps1 -DebugLog` / `DEBUG_LOG=1 sh build.sh`: a copy of the log in accessible storage; the main log is private to the app):

```sh
BOX=<ip> sh scripts/adb.sh shell "grep -v http.request /sdcard/Android/data/com.rightsubs.android/files/rightsubs.log | tail -n 60" \
  | sed -E 's#https?(:|%3A|%253A)(/|%2F|%252F){2}[^ "]*real-debrid\.com(/|%2F|%252F)d(/|%2F|%252F)[^ "]*#***#gI' | cut -c1-600
```

Always with that `sed`: APKs older than the 2026-11-01 fix may have RD links in the log, encoded ones too (`https%3A%2F%2F…`), which a filter on `https://` alone lets through.

In the normal APK, only through the app's **Log** button (the user reads it on the TV).

Lines that matter for each movie:
1. `subtitles.choice`: `candidates` per language (those in `referenceLanguages`, default `en`, are here too) and the chosen language.
2. `file.located`: `source` = `realdebrid` or `stremio` (torrent without RD: no embedded track).
3. `video.probed`: embedded tracks, fps.
4. `embedded.extracted`/`embedded.failed`: windows, `timeoutMs` (grows with the bitrate), `ms`.
5. `subtitles.served`: `sync.status` (`exact`, `synced`, `already_synced`, `likely_synced`, `fps_corrected`, `no_reference`, `low_confidence`, `budget_exceeded`), `offsetMs`, fps ratio and `referenceMatch` (`same_edit` = reference from another release of the same edition).

DeepL translation (no subtitle in the wanted languages): `subtitles.choice` with `translate: true`; `embedded.extracted` with 6 `windows`; one `translation.candidate` per candidate (`status`: `synced`/`already_synced` accepted; `inconsistent`/`weak_agreement`/`unconfirmed`/`low_confidence` refused; `deviationMs`, `starts`); `translation.done` and `subtitles.served` with `status: translated`, `from`, `offsetMs`. The first time, `subtitles.placeholder` (provisional after 3 s) and `subtitles.track_closed` (`delivered: true` = Stremio was still there). The box only opens the video if the `.srt` arrives within a few seconds of the first request: see `rightsubs/docs/DEEPL-TRANSLATION.md`.

`subtitles.track_requested` repeated every ~10 s = the player waiting for the `.srt`. The order of references and what each status means: `rightsubs/CLAUDE.md`; cases with known answers to compare against: `rightsubs/docs/FINDINGS.md`.

## Timing the extraction on the box

Ask the user for the file's **direct link** (`https://<n>.download.real-debrid.com/d/<code>/<name>.mkv`; the `real-debrid.com/d/…` page does not work) and use `scripts/box/extract-timing.sh` (instructions in its header). It times the direct download, each window with RightSubs' arguments and the same window with audio only, and deletes everything in `/data/local/tmp/rs` at the end. Never print the link: mask it with the same `sed` as in "Reading the log".

Rules for scripts on the box: write them to a file, strip `\r` (`tr -d '\r'`) and send with `adb push` (nested quotes in `adb shell "…"` break); do not use `pkill -f` (it kills its own shell). Track and fps: first run `libffprobe.so -v error -show_entries stream=index,codec_type,codec_name:stream_tags=language,title -of compact <url>` with the script's `LD_LIBRARY_PATH`/`SSL_CERT_FILE`.

Changes to sync behavior go in **`rightsubs/`** (rules in `rightsubs/CLAUDE.md`). Present the results and ask before applying a fix.
