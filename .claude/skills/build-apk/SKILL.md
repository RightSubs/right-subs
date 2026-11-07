---
name: build-apk
description: Builds the RightSubs APK locally (normal, for testing with the log readable by adb, or from uncommitted changes) and checks the result. Use when the user asks to build, rebuild or update the APK. Releases are not built here: they are built by GitHub Actions (skill new-version).
---

# Building the APK

Everything runs in the `rightsubs-apk-builder` container (Docker must be running: `docker info`). Architecture context in `CLAUDE.md`.

**APKs for users come from GitHub releases** (`.github/workflows/release.yml`, signed with the organization's key): a local build is for testing. It is signed with the key in `signing/` (created on the first build), so it does not install over a release (and vice versa) without uninstalling.

## Pick the kind

| Request | Command (macOS/Linux · Windows) | Output in `out/` |
|---|---|---|
| Local APK | `sh build.sh` · `.\build.ps1` | `rightsubs-{armeabi-v7a,arm64-v8a,universal}.apk` + `BUILD-INFO.txt` |
| Box tests (log readable by adb) | `DEBUG_LOG=1` · `-DebugLog` | `…-debuglog.apk` — **never distribute** |
| Test the addon **without committing** | `WORKING_TREE=1` · `-WorkingTree` | `rightsubs/` as it is on disk, new files included |
| `.env` credentials in the APK (tests) | `PREFILL=1` · `-Prefill` | `…-prefill.apk` — plain text, **never distribute**; only applies to an install without credentials (`pm clear` first) |
| 32-bit box only (faster) | `ABIS=armeabi-v7a` · `-Abis armeabi-v7a` | |
| Run the addon tests first | `RUN_TESTS=1` · `-Test` (the app tests run on every build) | |
| Tests only, no APK | `sh test.sh` · `.\test.ps1` (skill `tests`) | — |

The build uses **only the last commit** of `rightsubs/` (`git archive HEAD:rightsubs`), unless `WORKING_TREE`. Every build deletes the previous `out/`.

## Testing uncommitted changes (without committing)

`WORKING_TREE=1` (`-WorkingTree`) takes a snapshot of `rightsubs/` as it is now, **new files included**, in a temporary git index (`build/worktree.index`: `read-tree HEAD` + `add -A -- rightsubs` + `write-tree`), without touching the stage or the branch; `.gitignore` still applies (`.env` and `config.yaml` stay out). The app (`android/`) is always copied from the folder as it is. Box test flow (the one used for the DeepL translation):

```sh
WORKING_TREE=1 PREFILL=1 DEBUG_LOG=1 RUN_TESTS=1 sh build.sh     # Windows: .\build.ps1 -WorkingTree -Prefill -DebugLog -Test
export BOX=<ip>   # CLAUDE.local.md
sh scripts/adb.sh install -r /out/rightsubs-armeabi-v7a-debuglog-prefill.apk
sh scripts/adb.sh shell pm clear com.rightsubs.android   # fresh .env credentials and cache (the cached translation goes away)
sh scripts/adb.sh shell am start -n com.rightsubs.android/.MainActivity
```

The build warns "addon built from the uncommitted changes". Do not use `git stash create`: it ignores new files and the build silently uses `HEAD` (the `ConfigWriter` test `understandsTheBundledTemplate` catches a changed template).

## After the build

1. End of the log: `BUILD-INFO.txt` (versions, commit, Node, ffmpeg) and the APK sizes.
2. Common errors: `SHA-256 mismatch` (the Termux index changed → run again); `needs X, which is not in the APK` (new Node dependency in Termux → adjust `SYSTEM_LIBS`/`termux-node.mjs`); Gradle/lint failure (read the full log).
3. To install on the box, the skill `box`. A local APK is not distributed: releases go through the skill `new-version`.
4. No commit unless the user asks.

## Dockerfile changes

Add layers at the **end** so the SDK/NDK cache (~3 GB) stays valid. `docker build -t rightsubs-apk-builder docker`. CI caches the image too (`docker/build-push-action` with the `gha` cache).
