# RightSubs

A Stremio subtitle addon that runs on your own Android TV / Google TV (or phone) and serves **one subtitle, already chosen and synced**, in your language: pick any file, press play and watch, without choosing a subtitle or adjusting the delay.

It ships as an APK: it installs like any app, with no Termux, command line or boot script. On first launch it asks for the credentials, stores them encrypted and starts the addon at `http://127.0.0.1:7000/manifest.json`.

What is inside the APK:

| Part | Origin |
|---|---|
| RightSubs addon (`dist/` + `yaml` and `zod`) | the [rightsubs/](rightsubs/) folder of this repository, at the last commit (`git archive`) |
| Node.js 24 LTS | Termux's `nodejs-lts` package, with the libraries it needs |
| ffmpeg + ffprobe | built here with the NDK, minimal: they only read headers and text subtitles over HTTP(S) and write SRT |
| Android app | Kotlin, no libraries besides the stdlib: credentials screen, foreground service, start on boot |

The app speaks English and Portuguese (it follows the device language; on Android 13+ it can also be set per app). The messages RightSubs shows inside Stremio follow the primary subtitle language you pick, in [16 languages](rightsubs/src/i18n/messages.ts).

## Install

### 1. Download the APK

From the [latest release](https://github.com/RightSubs/right-subs/releases/latest):

| File | For |
|---|---|
| `rightsubs-armeabi-v7a.apk` | Chromecast with Google TV and most TV boxes (32-bit) |
| `rightsubs-arm64-v8a.apk` | NVIDIA Shield TV, recent phones |
| `rightsubs-universal.apk` | either of the two (bigger) |

These links always point at the newest version:

- `https://github.com/RightSubs/right-subs/releases/latest/download/rightsubs-armeabi-v7a.apk`
- `https://github.com/RightSubs/right-subs/releases/latest/download/rightsubs-arm64-v8a.apk`
- `https://github.com/RightSubs/right-subs/releases/latest/download/rightsubs-universal.apk`

**On a TV** (Google TV has no browser): install the **Downloader** app from the Play Store, type one of the links above (or its short code, when published) and install. Allow "install unknown apps" for Downloader when asked.

Each release comes with `SHA256SUMS.txt` and a build provenance attestation: `gh attestation verify rightsubs-universal.apk --repo RightSubs/right-subs` confirms the APK was built from this repository by its release workflow.

### 2. Set it up

**First, prepare** a free OpenSubtitles account (opensubtitles.com): profile → **API consumers** → **New consumer** (name `RightSubs`, tick **Allow anonymous downloads**) and note the **API key**, the **username** (not the e-mail: the login is refused with an e-mail) and the password. Real-Debrid is optional: token at real-debrid.com/apitoken. So is DeepL: a free key at deepl.com (Account › API Keys, it ends in `:fx`; 500,000 characters a month) lets RightSubs translate a subtitle when none exists in your languages.

1. If the old Termux RightSubs is installed on the box, remove it first (in Termux: `sh ~/right-subs/scripts/uninstall-termux.sh`): both would use port 7000.
2. Open **RightSubs** and fill in the credentials. Easiest: tap **Fill in on your phone**, point the phone's camera (on the same Wi-Fi) at the QR code and fill in or paste the values in the browser. The Google TV app keyboard (remote › keyboard) works too. **Without Real-Debrid, leave the token blank:** torrents played by Stremio itself are found too (real fps; without the embedded subtitle as reference).
3. Install the addon in Stremio. **On a TV:** in Stremio, open **Addons › Add addon** and type `http://127.0.0.1:7000/manifest.json` (with `http`, not `https`; the **Install in Stremio** button shows this reminder). The remote cannot paste: to avoid typing letter by letter, use the **Google TV** app keyboard on your phone (remote › keyboard), which can paste. **On a phone:** the button opens Stremio Web in the browser with the addon ready to install. A `stremio://` link does not work, because Stremio turns `stremio://` into `https://` and the addon only answers on `http` (checked on an NVIDIA Shield, Stremio 1.12.0). Nothing needs uninstalling: Torrentio/Sootio and the subtitle addons (OpenSubtitles v3 etc.) stay installed, and RightSubs' track shows up next to theirs. On other devices of the same Stremio account, RightSubs (which only exists on this device) does not answer and the other addons keep working.
4. Under **Subtitle languages**, pick the primary and the secondary, which are the subtitles you watch (default: Brazilian and European Portuguese), and the **reference for syncing** (default: English). The reference never shows on screen: subtitles in that language made for the exact file help get the timing right, and the embedded track in that language is preferred. The change applies at once (the addon restarts). In Stremio, set the subtitle language to the primary, so it picks RightSubs' track by itself.

The service starts by itself when the box turns on and after every app update. The "Addon running" notification is what keeps Android from stopping it.

### Updating

Install the new APK over the old one (from the same place: releases install over releases). The credentials stay.

## Credentials security

- **Storage:** OpenSubtitles API key, username and password, Real-Debrid token and DeepL key (the last two optional) are encrypted with AES-256-GCM. The key is generated inside the **Android Keystore** (in hardware when the device has it; StrongBox when it exists) and cannot be exported: the encrypted file is useless off this device. Each field is bound to its name (AAD), so one cannot be swapped for another.
- **Nothing in plain text on disk:** there is no `.env`. The generated `config.yaml` keeps the `${VAR}` placeholders and the values reach Node only as environment variables of the process (on Android, only the app itself sees them). They never go on the command line.
- **No backup:** `allowBackup=false` and empty extraction rules: nothing goes to the cloud backup or to device-to-device transfer.
- **Screen:** `FLAG_SECURE` (no screenshot, recording, casting or thumbnail in recents); fields with hidden text, no keyboard suggestions or learning (`flagNoPersonalizedLearning`), no autofill (other apps do not get the values) and no saving of the content in the screen's saved state. Once saved, the values **never show again**: editing only replaces (a blank field keeps the current one). "Delete credentials" deletes the encrypted data and the Keystore key itself.
- **Log:** every Node line goes through a filter that replaces any credential (URL-encoded too) with `***` before it reaches the file or the screen.
- **Fill in on your phone:** the button opens, only while the screen is open, a form on the home network (`http://<TV IP>:7001`), with a QR code and a 6-digit code shown only on the TV. It closes after one accepted submission, after 10 minutes, after 5 wrong codes or when leaving the screen. The submission has **no encryption of its own**, protected only by the Wi-Fi password: prefer a trusted network.
- **Network:** the addon only listens on `127.0.0.1` (only apps on the device itself, like Stremio, reach it). The app itself only speaks HTTP to `127.0.0.1`; everything else needs HTTPS with system CAs. ffmpeg was patched to **verify the certificate and the server name** (ffmpeg's default is not to verify; see [patches/ffmpeg-tls-verify.patch](patches/ffmpeg-tls-verify.patch)).
- **Components:** only the main screen is exported; the service is not; the boot receiver only reacts to system broadcasts.
- **Build:** the RightSubs bundle comes from `git archive` of `rightsubs/` at the last commit, so the `.env` and `config.yaml` on your computer never get in; the script checks that too. `npm ci --ignore-scripts` (nothing from the registry runs during the build). The Termux `.deb` files are checked against the SHA-256 in the repository index; ffmpeg, the Android SDK and Gradle against a fixed or published hash.

## How the subtitle is chosen and synced

**First of all, RightSubs looks at the file itself.** If the video already has a subtitle track in your primary language (or, then, the secondary), it searches and downloads nothing, does not read the video and does not use DeepL: it offers only an entry in the subtitle menu saying the video already has an embedded subtitle in your language. Pick the file's own track in the menu. ("Forced" tracks do not count, and neither do tracks only in other languages.) This saves Real-Debrid bandwidth and the OpenSubtitles and DeepL quotas.

Without such a track in the file, RightSubs offers Stremio **one** track in the primary language (with no subtitle at all in it, in the secondary). To choose, it compares each subtitle with the file that is playing: hash, release name, **edition** (DC, Extended, Uncut, Unrated, Theatrical, IMAX), group, source (BluRay/WEB/HDTV/DVD), resolution and fps.

If the subtitle was made for another release, it fixes the timing (offset and fps) against a reference. It stops at the first option that exists:

| # | Reference | In the log (`subtitles.served`) |
|---|---|---|
| 1 | an OpenSubtitles subtitle made for **this file**, in any language searched; one from another edition does not count | `synced` / `already_synced` |
| 2 | none: the subtitle is from the same edition, source and resolution, so it probably already matches; the video is not read | `likely_synced` |
| 3 | the subtitle **embedded** in the file (text, preferring the reference language), read in 3 windows of 45 s; the time limit grows with the file size | `synced` / `already_synced` |
| 4 | a subtitle from **another release of the same edition**, source and resolution | `synced` (`referenceMatch: same_edit`) |
| 5 | none: fixes only the fps, from the file's real value | `fps_corrected` / `no_reference` |

**Text cleanup:** every subtitle served, from any source, goes through a cleanup that removes musical notes (♪ ♫ ♬… and the corrupted form `â™ª`), invalid or invisible characters, `#` used as a music mark and leftover ASS codes (`{\an8}`, `\N`). Without it, the TV draws little boxes in songs.

The file that is playing is found through Real-Debrid. In a torrent without Real-Debrid, it is found through Stremio's local server: then only the fps is read, without the embedded track, because reading windows of the torrent takes bandwidth from the video.

**Known limitations:**
- With no text reference at all, the subtitle goes out as downloaded (`no_reference`). That holds even if the fps reported by OpenSubtitles is wrong or the edition has another name (e.g. "Extended" = "DC"). Only syncing by audio, not done yet, would fix it.
- The secondary only comes in when there is **no subtitle at all** in the primary; an out-of-sync primary subtitle does not switch to the secondary.

### No subtitle in your languages: DeepL translation (optional)

With a DeepL key, if there is no subtitle in the primary or the secondary language, RightSubs translates an OpenSubtitles subtitle in **any language** into the primary. It only translates a subtitle whose timing the file's embedded track confirms (it reads 6 short windows, never the whole movie): subtitles made for another cut of the movie, even in English, are refused. The translation says "[Subtitles machine-translated by AI (DeepL)]" (in your language) and uses your Stremio's subtitle style.

**What depends on Real-Debrid:** not the translation itself, but **checking the subtitle's timing** does, because RightSubs needs to read a few windows of the video and only gets the file's link through Real-Debrid.

| How you watch | Timing check | What the translation does |
|---|---|---|
| **Real-Debrid** | yes | full: picks the right subtitle among the languages and fixes the timing |
| **Torrent through Stremio itself** (no debrid) | no | exact subtitle by hash: translated as it is; **movie**: translated with "timing not confirmed"; **series**: nothing |
| **Another debrid** (AllDebrid, Premiumize, TorBox…) or a direct link | no | only the exact subtitle by hash |

Only the Real-Debrid case was really tested; the others are what the code does.

**Movies without an embedded subtitle to check the timing** are translated too, as long as the subtitle's fps is the file's, but the subtitle says "timing not confirmed" and may come early or late. Series (episodes have cuts and ads) are not.

**The first time for a movie or episode** the translation takes 20 to 60 s, longer than the 10 s Stremio waits. The video opens with a provisional subtitle asking you to **leave and open it again in about 30 s**; the translation finishes in the background and, from the second time on, comes out at once.

Real measured cases and the reason behind each rule: [rightsubs/docs/FINDINGS.md](rightsubs/docs/FINDINGS.md); every option: [rightsubs/docs/CONFIGURATION.md](rightsubs/docs/CONFIGURATION.md); the DeepL translation in detail: [rightsubs/docs/DEEPL-TRANSLATION.md](rightsubs/docs/DEEPL-TRANSLATION.md).

## Limitations

- The translation's **timing check** only exists with Real-Debrid; with Stremio torrents or other debrids the translation is more limited (table above).
- The DeepL translation uses the free quota (~21,000 characters per episode, out of 500,000 a month), only translates a series with an embedded text track to check the timing (a movie without one is translated with "timing not confirmed") and, the first time for each episode, asks you to open the video again.
- The screen sets only the credentials and the languages; the other options (time limits, cache, syncing) use the defaults in `rightsubs/config.example.yaml`. RightSubs only serves subtitles: the videos keep coming from the stream addons installed in Stremio (Torrentio, Sootio…).
- ffmpeg has only what the current RightSubs needs. Syncing by audio (not done yet) will need audio decoders in [scripts/build-ffmpeg.sh](scripts/build-ffmpeg.sh).
- Node comes from the Termux repository, which only keeps the latest version: each build takes the current one (`BUILD-INFO.txt` records which).

## Development

### Building the APK

Requirements: **Docker** (running) and Git. Everything else (JDK, Android SDK, NDK, Gradle, Node) lives inside the container.

```sh
sh build.sh                                   # macOS/Linux (and Git Bash)
RUN_TESTS=1 sh build.sh                       # also runs the addon tests (the app tests always run)
```

```powershell
.\build.ps1                                   # Windows
.\build.ps1 -Test
```

The first time takes a while (it downloads ~3 GB and builds ffmpeg); afterwards it is fast. Output in `out/`: the three APKs above, `SHA256SUMS.txt` and `BUILD-INFO.txt` (APK and addon version, commit used, Node and ffmpeg versions). For an x86_64 emulator: `ABIS=x86_64 sh build.sh`.

**Commit before building:** only the last commit of `rightsubs/` goes in (the script warns about pending changes).

**Signing:** a local build signs with a key created in `signing/` (outside git) on the first build. It is not the organization's key, so a local APK does not install over a release (and vice versa) without uninstalling. APKs for users come only from [releases](#releases).

**Barriers:** every build that is not a test build checks that the APK carries no credential from your `.env` (and deletes the APKs if it does), and a commit hook (`git config core.hooksPath scripts/git-hooks`) keeps credentials, keys and APKs out of git. Test APKs come with an `out/DO-NOT-DISTRIBUTE.txt` warning.

**Testing only (never distribute):** `DEBUG_LOG=1` (`-DebugLog`) builds `*-debuglog.apk`, which writes a copy of the log (already without secrets) to `/sdcard/Android/data/com.rightsubs.android/files/`, readable by adb (the log shows the movies the person watches). `PREFILL=1` (`-Prefill`) builds `*-prefill.apk` with the `.env` credentials **in plain text** inside the APK, stored on first launch (on a box that already has credentials, `pm clear` first). `WORKING_TREE=1` (`-WorkingTree`) packs the addon with the still uncommitted changes in `rightsubs/`. They combine: `WORKING_TREE=1 PREFILL=1 DEBUG_LOG=1 sh build.sh`.

### Tests

**CI** runs the unit tests on every pull request and push to `main` ([.github/workflows/ci.yml](.github/workflows/ci.yml)). Locally:

```sh
sh test.sh                  # addon (typecheck + node:test) and app (JUnit); ONLY=addon or ONLY=app for one
```

```powershell
.\test.ps1                  # Windows; -Only addon / -Only app
```

They test `rightsubs/` and `android/` **as they are on disk** (no need to commit) and write nothing to the repository. Expected at the end: `ℹ fail 0`, `App: N tests, 0 failures` and `ALL TESTS PASSED`; exit code 0. The addon alone also runs without Docker, with Node ≥ 22.18: `cd rightsubs && npm ci && npx tsc && npm test`.

| Layer | Where | What it covers |
|---|---|---|
| Addon | `rightsubs/test/*.test.ts` | subtitle choice and syncing, sources, cache, DeepL translation, config, viewer messages in every language |
| App | `android/app/src/test/` | `ConfigWriter` with the addon's **real** template, language list × the addon's `languages.ts`, English × Portuguese strings, `Redactor`, phone form, QR code, credentials validation |

Setup (once), per system:

- **Windows 10/11:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) with the **WSL 2** backend, running; [Git for Windows](https://git-scm.com/download/win) (brings Git Bash, used by `scripts/adb.sh`). PowerShell 5.1 is enough.
- **macOS:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Colima/OrbStack), running; Git with `xcode-select --install` or `brew install git`. **Apple chip:** the build uses Android tools compiled for x86_64, so run with `export DOCKER_DEFAULT_PLATFORM=linux/amd64` (Docker Desktop: "Use Rosetta for x86_64/amd64 emulation"); it works through emulation, **slower and not tested** by us.
- **Linux:** Docker Engine ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)), `sudo usermod -aG docker $USER` and a new session; `sudo apt install git` / `sudo dnf install git`. Fedora/RHEL with SELinux: add `:z` to the scripts' `-v …:/work` volume. The container runs as root: `build.sh` leaves `build/` and `out/` owned by root (`sudo rm -rf build out`).

Disk and time: at least 10 GB free for the image (≈6 GB) and the Docker volumes; the **first** run downloads ~3 GB (Android SDK, NDK, Gradle). No credentials or device are needed for the automated tests. The `.env` (`cp rightsubs/.env.example .env` at the root) is only read by `PREFILL`, and only the box tests use it.

**Not covered by the automated tests** (only on a device): `AddonService` and the Node supervision (exit codes 75 and 78), `BootReceiver`, `SecretStore` with the Keystore, the installation and the real ffmpeg/Node, the screens, and Stremio's and the players' behavior. The **translation timing check was only validated with Real-Debrid**.

**Tests on a box or phone** (optional): an Android device on the same network with **USB/network debugging** on (Developer options) and the credentials in `.env`.

```sh
WORKING_TREE=1 PREFILL=1 DEBUG_LOG=1 RUN_TESTS=1 sh build.sh              # test APK: NEVER distribute
export BOX=<device IP>
sh scripts/adb.sh install -r /out/rightsubs-armeabi-v7a-debuglog-prefill.apk   # arm64-v8a on Shield/phones
sh scripts/adb.sh shell pm clear com.rightsubs.android      # applies the .env credentials
sh scripts/adb.sh shell am start -n com.rightsubs.android/.MainActivity
```

The first time the TV asks to authorize adb ("Always allow"). adb runs inside the container, nothing to install. To read the log and `/health`, time the extraction and check the reference movies (Drive, Halloween, Valkyrie, Enter the Void), see [.claude/skills/box/SKILL.md](.claude/skills/box/SKILL.md) and [rightsubs/docs/FINDINGS.md](rightsubs/docs/FINDINGS.md). **Turn debugging off when done.**

### Releases

The APK version lives in [VERSION](VERSION) (`X.Y.Z`) and what changed in each one in [CHANGELOG.md](CHANGELOG.md). The addon in `rightsubs/` gets the same version at build time (the one the app shows on its status line and Stremio in the manifest), and the build checks that the APK and the addon say the same number.

| Changed | Bump | Example |
|---|---|---|
| fixes only | the last number | X.Y.Z → X.Y.(Z+1) |
| new feature | the middle one (and the last to 0) | X.Y.Z → X.(Y+1).0 |
| whoever updates must uninstall or type the credentials again | the first | X.Y.Z → (X+1).0.0 |

While working, note each change under `[Unreleased]` in `CHANGELOG.md`. To release:

1. Write the new number in `VERSION` (and `cd rightsubs && npm version X.Y.Z --no-git-tag-version --allow-same-version`). In `CHANGELOG.md`, rename `[Unreleased]` to `[X.Y.Z] — YYYY-MM-DD` and add an empty `[Unreleased]` above it.
2. `git commit -m "Version X.Y.Z"` with those files.
3. `git tag -a vX.Y.Z -m "RightSubs X.Y.Z"` and `git push origin main vX.Y.Z`.

Pushing the tag runs [.github/workflows/release.yml](.github/workflows/release.yml): it checks that the tag matches `VERSION`, builds in the same container as local builds, signs with the organization's key, runs the addon tests and the secret checks, attests the build provenance and publishes the release with the APKs, `SHA256SUMS.txt`, `BUILD-INFO.txt` and the version's `CHANGELOG` section as notes. Before the push, a wrong tag is deleted with `git tag -d vX.Y.Z`; after it, do not move the tag: release the next version.

Android's internal `versionCode` is automatic: the minutes since 1970, so it always grows and any newer build installs over an older one.

#### Signing key (maintainers, once)

Releases are signed with the organization's key, kept in the repository secrets. Android only updates an app with an APK signed by the same key: **losing it means everyone has to uninstall** (and type the credentials again), so keep an offline backup of the keystore and its password.

Create it (the builder image has the JDK, so nothing to install):

```sh
docker run --rm -it -v "$PWD:/k" -w /k rightsubs-apk-builder \
  keytool -genkeypair -keystore rightsubs-release.p12 -storetype PKCS12 -alias rightsubs \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=RightSubs"
```

Then, in the repository, **Settings › Secrets and variables › Actions** (or with `gh secret set … --repo RightSubs/right-subs`):

| Secret | Value |
|---|---|
| `SIGNING_KEYSTORE_BASE64` | `base64 < rightsubs-release.p12 \| tr -d '\n'` |
| `SIGNING_KEYSTORE_PASSWORD` | the password typed in keytool (PKCS12 uses it for the key too) |
| `SIGNING_KEY_ALIAS` | `rightsubs` |

Then move `rightsubs-release.p12` out of the repository folder, to the backup (git ignores `*.p12`, and the commit hook refuses one). The release job runs in the `release` environment: under **Settings › Environments › release** you can require an approval before each release and keep the secrets there instead.

## Layout

| Path | Contents |
|---|---|
| [build.sh](build.sh), [build.ps1](build.ps1) | entry point on the computer (Docker) |
| [test.sh](test.sh), [test.ps1](test.ps1) | unit tests only (addon + app), without building the APK |
| [.github/workflows/](.github/workflows) | CI (tests) and releases |
| [docker/Dockerfile](docker/Dockerfile) | build and test environment |
| [scripts/container-build.sh](scripts/container-build.sh), [scripts/container-test.sh](scripts/container-test.sh) | steps inside the container (build / tests) |
| [scripts/termux-node.mjs](scripts/termux-node.mjs) | Node and libraries from Termux → `jniLibs` |
| [scripts/build-ffmpeg.sh](scripts/build-ffmpeg.sh) | minimal ffmpeg with the NDK |
| [scripts/build-payload.sh](scripts/build-payload.sh) | RightSubs build → `rightsubs.zip` |
| [scripts/release-notes.sh](scripts/release-notes.sh) | a version's `CHANGELOG` section (release notes) |
| [android/](android) | Android app |
| [scripts/adb.sh](scripts/adb.sh) | adb to the box over the network, from inside the container (`BOX=<ip> sh scripts/adb.sh …`) |
| [scripts/box/extract-timing.sh](scripts/box/extract-timing.sh) | times the embedded subtitle extraction on the box (diagnostics) |
| [rightsubs/](rightsubs/) | the addon ([rightsubs/README.md](rightsubs/README.md), [rightsubs/CLAUDE.md](rightsubs/CLAUDE.md)) |
| [VERSION](VERSION), [CHANGELOG.md](CHANGELOG.md) | APK version and what changed in each one |
| [.claude/skills/](.claude/skills) | procedures for Claude Code: `tests`, `build-apk`, `box`, `release-check`, `new-version` |

## Credits and licenses

RightSubs is free software under the [GNU General Public License v3.0 or later](LICENSE): you may use, study, change and redistribute it, including for a fee, as long as whatever you distribute (changed or not) stays under the same license with its source code available.

The APK also carries third-party software under its own licenses:

| Component | License | Source |
|---|---|---|
| Node.js (Termux's `nodejs-lts` package) and its libraries (OpenSSL, libuv, c-ares, ICU, zlib, …) | MIT, Apache-2.0 and other permissive licenses | [Termux packages](https://github.com/termux/termux-packages); fetched by [scripts/termux-node.mjs](scripts/termux-node.mjs) |
| ffmpeg / ffprobe 7.1.1 (minimal build, without GPL parts) | LGPL-2.1-or-later | `ffmpeg-7.1.1.tar.xz` and `ffmpeg-tls-verify.patch` attached to every release; built by [scripts/build-ffmpeg.sh](scripts/build-ffmpeg.sh) |
| `yaml`, `zod` (the addon's dependencies) | ISC, MIT | npm |

- **Font:** the app uses [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) (Tokotype), under the **SIL Open Font License 1.1**, which allows embedding and redistribution. The file is the same one Stremio uses in its web app (`android/app/src/main/res/font/plus_jakarta_sans.ttf`).
- **Colors:** the look follows the public palette of Stremio's web app. RightSubs is an independent project, **not affiliated with Stremio**.
