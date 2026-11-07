---
name: tests
description: Sets up the environment (Docker, Git) on Windows, macOS or Linux and runs all RightSubs APK tests - addon and app unit tests without building the APK, and the box test script. Use when the developer asks to run/check the tests, set up a machine for testing, or validate a change before committing. CI runs the same unit tests on every pull request.
---

# Running the tests

Everything runs in the build container (`rightsubs-apk-builder`): the developer only installs **Docker** and **Git**. Documentation for people: README › Tests. **CI** (`.github/workflows/ci.yml`) runs `sh test.sh` on every pull request and push to `main`; when Docker is not available locally, the CI run is the check.

## 1. Check the environment

First find out the system (`$IsWindows`/`$env:OS` in PowerShell, `uname -sm` in a shell) and use its commands. Run the check and **show the result** of each item; install only what is missing, and ask the developer to install what needs an installer (Docker, Git).

```powershell
# Windows (PowerShell)
docker --version; docker info *> $null; "docker running: $($LASTEXITCODE -eq 0)"; git --version
```

```sh
# macOS / Linux
uname -sm; docker --version; docker info > /dev/null 2>&1 && echo "docker running" || echo "docker stopped or no permission"; git --version
```

| System | Install (once) |
|---|---|
| **Windows 10/11** | [Docker Desktop](https://www.docker.com/products/docker-desktop/) with the WSL 2 backend, **running**; [Git for Windows](https://git-scm.com/download/win) (brings Git Bash, used by `scripts/adb.sh`). PowerShell 5.1 is enough. `.ps1` commands. |
| **macOS** | Docker Desktop (or Colima/OrbStack), running; `xcode-select --install` or `brew install git`. Commands `sh test.sh`/`sh build.sh`. **Apple chip (arm64)**: `export DOCKER_DEFAULT_PLATFORM=linux/amd64` first (Docker Desktop: "Use Rosetta for x86_64/amd64 emulation"); emulation, slower, **not tested**. |
| **Linux** | Docker Engine ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)); `sudo usermod -aG docker $USER` and a new session (otherwise "permission denied" on the socket); `sudo apt install git` / `sudo dnf install git`. Fedora/RHEL with SELinux: `:z` on the scripts' `-v …:/work` volume. ARM: same note as the Apple chip. |

| Item | Requirement |
|---|---|
| Disk | at least 10 GB free; the image is ≈6 GB. |
| Network | the first run downloads ~3 GB (SDK, NDK, Gradle); Gradle downloads Build-Tools 34 on **every** run (throwaway container). |

No Node, Java, Android Studio, `.env` or device is needed for the automated tests. Do not install anything outside Docker.

## 2. Automated tests (no APK)

```sh
sh test.sh                 # macOS/Linux (and Git Bash): addon (typecheck + node:test) and app (JUnit)
ONLY=addon sh test.sh      # addon only; ONLY=app for the app only
```

```powershell
.\test.ps1                 # Windows
.\test.ps1 -Only addon     # addon only
.\test.ps1 -Only app       # app only
```

The addon alone also runs without Docker, with Node ≥ 22.18: `cd rightsubs && npm ci && npx tsc && npm test`.

- `scripts/container-test.sh` copies `rightsubs/` (without `node_modules`, `dist`, `.env`, `config.yaml`) and `android/` into the container's `/tmp`: it tests what is **on disk**, without committing, and writes nothing to the repository. The app uses the addon's real `config.example.yaml` and `languages.ts` (`ConfigWriterTest`, `LanguagesTest`); `StringsTest` checks that English and Portuguese have the same strings.
- The first time without the image builds `docker/Dockerfile` (several minutes). If the image build fails on the network, repeat.
- Success = exit code 0 and `==> ALL TESTS PASSED`. On failure: `✖`/`not ok` from node:test, or the Gradle report; show the failure to the developer and **ask before fixing**.
- To read the app report after a failure, run `ONLY=app sh test.sh` again (the container is throwaway; the summary "App: N tests, N failures" comes at the end).
- After changing `rightsubs/` (sync rules, ranking, config), read the rules in `rightsubs/CLAUDE.md`: every new behavior comes with a test, and the real case goes to `rightsubs/docs/FINDINGS.md`.

## 3. Full APK test (builds the APK; only when asked)

```sh
RUN_TESTS=1 sh build.sh          # macOS/Linux; Windows: .\build.ps1 -Test
```

Builds, runs the addon tests (the app tests always run) and checks versions and that no credentials got in. The skill `build-apk` has the variants.

## 4. Tests on the box or a phone (optional, needs a device)

Ask the developer first: it needs an Android device on the same network with **USB/network debugging** on, and the `.env` with the credentials (`OPENSUBTITLES_API_KEY`, `OPENSUBTITLES_USER`, `OPENSUBTITLES_PASSWORD`; optional `RD_TOKEN`, `DEEPL_API_KEY`; template in `rightsubs/.env.example`). The IP goes in `CLAUDE.local.md` (outside git). Never print `.env` values.

1. `WORKING_TREE=1 PREFILL=1 DEBUG_LOG=1 RUN_TESTS=1 sh build.sh` (Windows: `.\build.ps1 -WorkingTree -Prefill -DebugLog -Test`) → test APK in `out/` (**never distribute**; comes with `DO-NOT-DISTRIBUTE.txt`).
2. Install, clear and open (skill `box` for the rest: `/health`, log, extraction timing):
   ```sh
   export BOX=<ip>          # Git Bash, macOS or Linux
   sh scripts/adb.sh install -r /out/rightsubs-<abi>-debuglog-prefill.apk   # armeabi-v7a (32-bit boxes) or arm64-v8a
   sh scripts/adb.sh shell pm clear com.rightsubs.android
   sh scripts/adb.sh shell am start -n com.rightsubs.android/.MainActivity
   ```
3. Real regression cases with known answers: `rightsubs/docs/FINDINGS.md` (Drive, Halloween, Valkyrie, Enter the Void); translation: `rightsubs/docs/DEEPL-TRANSLATION.md`.
4. When done: **remind the developer to turn off debugging** on the box.

## What the automated tests do not cover

`AddonService` and the Node supervision (exit codes 75 and 78), `BootReceiver`, `SecretStore` with a real Keystore, the real Node/ffmpeg on the device, the app's screens, and Stremio's/the players' behavior (10 s limit). The translation timing check was only validated with Real-Debrid. Say so when reporting "everything passed".

## Common problems

| Symptom | Cause / fix |
|---|---|
| `Docker is not running` | open Docker Desktop (Windows/Mac) and wait; on Linux `sudo systemctl start docker`; `docker info` |
| Linux: `permission denied` on `/var/run/docker.sock` | `sudo usermod -aG docker $USER` and a new session (or run with `sudo`) |
| Linux/Fedora: the container cannot read `/work` | SELinux: `:z` on the `-v …:/work` volume |
| Mac/Linux ARM: `aapt2`/`exec format error` in Gradle | `export DOCKER_DEFAULT_PLATFORM=linux/amd64` and repeat (emulation) |
| Linux: `build/` or `out/` owned by root | the container runs as root; `sudo rm -rf build out` |
| Path/`\r` errors running `.sh` on Windows | run the `.ps1`; in Git Bash use `MSYS_NO_PATHCONV=1` and `D:/…` paths |
| `npm ci` fails | no network or the registry is down; repeat |
| Gradle: `Could not GET`/license | no network on the first run; repeat |
| `.ps1` with broken characters | the file needs a UTF-8 BOM (do not save it without one) |
| Clean everything | `docker rmi rightsubs-apk-builder` and `docker volume rm rightsubs-gradle rightsubs-npm` (the `rightsubs-adb` volume holds the box's adb key: the TV would ask for authorization again) |
