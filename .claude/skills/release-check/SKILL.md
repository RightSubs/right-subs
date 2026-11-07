---
name: release-check
description: Security checklist before committing or pushing this repository, or before handing anyone an APK — checks that no credentials, debug features, signing key or local data are in git or in the APK. Use before a commit/push, before a release, or before sending an APK to someone.
---

# Before committing, releasing or handing out an APK

Run everything; report each item to the user (ok / problem). Never print secret values — only counts.

**Automatic barriers** (they check the same things, but do not replace this checklist): `scripts/check-no-secrets.sh apk <apk>…` runs on **every build that is not `-Prefill`** (releases included) and deletes the APKs if it finds `prefill.json`, `.env`/`config.yaml` or any `.env` value in them; `scripts/check-no-secrets.sh staged` runs in the commit hook (`scripts/git-hooks/pre-commit`, active with `git config core.hooksPath scripts/git-hooks`). Both show only the variable's **name** and the file, never the value. The release workflow also refuses test builds (`DO-NOT-DISTRIBUTE.txt`, `-prefill`, `-debuglog`) and requires the organization's key (`REQUIRE_SIGNING_KEY=1`).

## Committing this repository

- `git diff --cached --name-only` must not contain: `.env`, `*.env`, `signing/`, `out/`, `build/`, `CLAUDE.local.md`, `android/local.properties`.
- No `.env` value in tracked files (`git grep -F -- <value>` with the loop below, over `git ls-files`).
- No box IP nor Real-Debrid links in tracked files (`git grep -nE '192\.168\.|download\.real-debrid'`).
- Code, comments, logs, scripts and docs in English; only the app's Portuguese strings (`values-pt/`) and the translated viewer messages (`rightsubs/src/i18n/messages.ts`) are in other languages.
- Commit only when the user asks; author = local `git config`.

## A release (GitHub Actions)

- Before the tag: the skill `new-version` (tag = `VERSION`, notes in `CHANGELOG.md`, CI green).
- After it: the release has the three APKs, `SHA256SUMS.txt` and `BUILD-INFO.txt` (commit without `+dirty`), and no `-prefill`/`-debuglog` file.
- The signing key lives only in the repository secrets and in the organization's offline backup: never in git, never in `signing/` of a shared machine.

## An APK handed to someone outside a release

Prefer the release link. If a local APK must go out anyway:

1. **Not a test build:** no `-debuglog` or `-prefill` in the name (`-Prefill` carries the `.env` credentials in plain text), no `out/DO-NOT-DISTRIBUTE.txt` and no `assets/prefill.json`:
   `unzip -l out/<apk> | grep -c prefill` → `0`. `out/BUILD-INFO.txt` with the right version and a commit without `+dirty`.
2. **None of this repository's `.env` secrets** (root and `rightsubs/`) (extracts the APK and the `rightsubs.zip` into a scratchpad folder and searches for each value ≥ 6 characters):
   ```sh
   W=<scratchpad>/apkcheck; rm -rf $W; mkdir -p $W/x $W/p
   unzip -q out/<apk> -d $W/x && unzip -q $W/x/assets/rightsubs.zip -d $W/p
   find $W/p \( -name '.env' -o -name 'config.yaml' -o -name 'CLAUDE.local.md' \)   # → nothing
   for f in .env rightsubs/.env; do [ -f $f ] || continue; n=0; h=0
     while IFS= read -r l; do v=$(printf '%s' "$l" | sed -n "s/^[A-Z_]*=//p" | sed "s/^['\"]//; s/['\"]$//")
       [ ${#v} -ge 6 ] || continue; n=$((n+1)); grep -rqF -- "$v" $W/x $W/p && h=$((h+1)); done < $f
     echo "$f: $n tested, $h found"; done      # → 0 found
   rm -rf $W
   ```
3. **Debug log off:** the normal build passes `-PdebugLog=false` (the first line of `BUILD-INFO.txt` does not mention `-debuglog`).
4. **Signature:** `apksigner verify --print-certs out/<apk>` inside the container. A local build is signed with the local key, so it **does not install over a release**: say so to whoever receives it.
5. **ffmpeg TLS with verification:** `grep -c "Unable to set the host to verify" $W/x/lib/*/libffmpeg.so` ≥ 1 (patch applied).
6. Hand `out/SHA256SUMS.txt` over with it.

## Reminders

- **Key backup:** the organization's keystore and password, kept offline. Without them no update installs over the published versions.
- **Testing features** in the code: log copy (`-DebugLog`) and `.env` credentials (`-Prefill`); `-WorkingTree` only changes where the addon comes from, and `translation.deepl.forceFrom` only applies to a computer's `config.yaml`. See "Testing-only features" in `CLAUDE.md`. The secrets loop above covers the `.env` `DEEPL_API_KEY` too.
