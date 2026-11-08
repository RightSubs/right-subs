---
name: new-version
description: Releases a new version of the RightSubs APK — picks the number (semver), updates VERSION and CHANGELOG, commits, creates the vX.Y.Z tag and, when the user asks, pushes it so GitHub Actions builds, signs and publishes the release. Use when the user asks for a new version, a release, to "bump the version" or for an APK to distribute.
---

# New APK version

The version lives **only** in the `VERSION` file (`X.Y.Z`). The build uses it as `versionName` **and injects it into the addon's `package.json`** (`build-payload.sh`): that is the version the app shows on its status line ("Version X.Y.Z · Node…"), the one Stremio shows in the manifest, and the one in the User-Agent and the log. So **no app text has a hand-written version** (not `strings.xml`, not layouts, not Kotlin). `versionCode` is automatic (minutes since 1970: it always grows, so any newer build installs over an older one).

**Releases are built by GitHub Actions**, not on this machine: pushing the tag `vX.Y.Z` runs `.github/workflows/release.yml`, which checks tag = `VERSION`, takes the notes from `CHANGELOG.md`, builds in the same container as local builds, signs with the organization's key (repository secrets), runs the addon tests and the secret checks, attests the build provenance and publishes the release with `rightsubs-{armeabi-v7a,arm64-v8a,universal}.apk`, `SHA256SUMS.txt` and `BUILD-INFO.txt`. The fixed APK names keep `releases/latest/download/rightsubs-<abi>.apk` pointing at the newest version. Each version = commit "Version X.Y.Z" + annotated tag `vX.Y.Z`. Steps for people: README › Releases. Confirm every git step with the user (commit, tag and push only when asked).

## 1. Pick the number

From the last tag (`git describe --tags --abbrev=0`) and what changed (`git log <tag>..HEAD --oneline`; the addon is in `rightsubs/`):

| Changed | Bump | Example |
|---|---|---|
| Fixes only | PATCH | X.Y.Z → X.Y.(Z+1) |
| New feature (screen, option, stream source) | MINOR, PATCH to 0 | X.Y.Z → X.(Y+1).0 |
| Whoever updates must redo something (uninstall, type the credentials again, new signing key) | MAJOR | X.Y.Z → (X+1).0.0 |

Propose the number to the user before going on.

## 2. Prerequisites

- The commit hook is active (`git config core.hooksPath` = `scripts/git-hooks`): it blocks commits with `.env` credentials, `signing/`, `out/`, APKs or `CLAUDE.local.md`. If not: `git config core.hooksPath scripts/git-hooks`.
- `main` up to date, everything committed (including `rightsubs/`), CI green on the last commit (`.github/workflows/ci.yml`).
- `CHANGELOG.md`: the `[Unreleased]` section says what goes in (for the people who install it). The release fails without notes for the version.
- The signing secrets exist in the repository (README › Releases). Without them the release fails before building.

## 3. Prepare and commit

1. `VERSION` ← `X.Y.Z` (one line).
   Keep the addon's source in line (the build already injects the number into the package, but `npm run dev` and git read these files): `cd rightsubs && npm version X.Y.Z --no-git-tag-version --allow-same-version` (updates `package.json` and `package-lock.json`).
2. `CHANGELOG.md`: rename `[Unreleased]` to `[X.Y.Z] — YYYY-MM-DD` and add an empty `[Unreleased]` above it. Check the notes: `sh scripts/release-notes.sh X.Y.Z`.
3. The "Committing this repository" part of the skill `release-check`, then:
   ```sh
   git add VERSION CHANGELOG.md rightsubs/package.json rightsubs/package-lock.json   # and whatever else belongs to the version
   git commit -m "Version X.Y.Z"
   ```

## 4. Tag and publish

```sh
git tag -a vX.Y.Z -m "RightSubs X.Y.Z"
git push origin main vX.Y.Z   # only when the user asks: this publishes the release
```

A wrong tag before the push: `git tag -d vX.Y.Z` and create it again. After the push, never move the tag: release X.Y.(Z+1). If the workflow fails before publishing (missing secret, tag ≠ `VERSION`, no notes), fix it, delete the tag locally and remotely (`git push origin :refs/tags/vX.Y.Z`) only if no release was created, and push it again.

## 5. Check the release

1. `gh run watch` (or the Actions tab) until the `Release` workflow finishes; on failure, show the log of the failed step and ask before fixing.
2. On the release page: the three APKs, `SHA256SUMS.txt`, `BUILD-INFO.txt` (version X.Y.Z, the "addon:" line also X.Y.Z, commit without `+dirty`) and the notes.
3. **Where the version shows in the app** (check at least 1 and 2 on a device, or through `/health`):

   | Where | Source | How to check |
   |---|---|---|
   | Status line on the screen ("Version X.Y.Z · Node …") | the addon's `package.json`, injected | the app's screen, or `curl http://127.0.0.1:7000/health` (`version`) |
   | Settings › Apps › RightSubs | `VERSION` (Gradle `versionName`) | `aapt2 dump badging <apk>` |
   | Stremio's addon list | `/manifest.json` (`version`) | the same addon |
   | User-Agent (`RightSubs vX.Y.Z`) and `server.started` in the log | the same addon | the app's log |
   | `BUILD-INFO.txt` | `VERSION` and addon | the file |

   To find a forgotten hand-written version, search for the **previous** one: `grep -rn "<previous version>" android rightsubs/package.json rightsubs/src README.md` (only examples and tests may remain).
4. Anyone can check that an APK came from this repository: `gh attestation verify rightsubs-universal.apk --repo RightSubs/right-subs`.
