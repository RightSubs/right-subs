# Contributing to RightSubs

Thanks for helping! RightSubs is a small project run by volunteers, so clear, focused pull requests get reviewed fastest.

## Ways to help

- **Report a bug:** open an issue with the APK version (the app's status line), the device, what you did and what happened. For a subtitle out of sync, include the movie or episode and, if you can, the file name or release. **Security problems go through [SECURITY.md](SECURITY.md)**, not a public issue.
- **Review a translation:** the messages shown inside Stremio exist in 16 languages ([rightsubs/src/i18n/messages.ts](rightsubs/src/i18n/messages.ts)), and most were written by the maintainers, not by native speakers. Corrections from native speakers are very welcome. So are fixes to the app's Portuguese ([android/app/src/main/res/values-pt/strings.xml](android/app/src/main/res/values-pt/strings.xml)).
- **Fix or improve something:** for anything bigger than a small fix, open an issue first to agree on the approach. Some choices are deliberate (see [CLAUDE.md](CLAUDE.md) › Architecture and [rightsubs/CLAUDE.md](rightsubs/CLAUDE.md) › Decisions already made), and a quick chat saves you work.

## Setting up

```sh
git clone https://github.com/<you>/right-subs.git    # your fork
cd right-subs
git config core.hooksPath scripts/git-hooks          # once per clone: blocks credentials and build output in commits
```

You need Docker for the full test suite. The addon alone only needs Node ≥ 22.18. Per-system setup: [README › Tests](README.md#tests).

## Before opening a pull request

1. **Run the tests.** They must pass:
   ```sh
   sh test.sh                                           # addon + app, in Docker (Windows: .\test.ps1)
   cd rightsubs && npm ci && npx tsc && npm test        # the addon alone, without Docker
   ```
2. **Add a test** for every new behavior (`rightsubs/test/` for the addon, `android/app/src/test/` for the app).
3. **Write a line under `[Unreleased]`** in [CHANGELOG.md](CHANGELOG.md) if people who install the app would notice the change.
4. **Keep the rules below.**

## Rules

- **Everything in the repository is in English:** code, comments, logs, error messages, docs and commit messages. There are only two exceptions, the translations meant for users:
  - **The app's text** goes in **both** `android/app/src/main/res/values/strings.xml` (English) and `values-pt/strings.xml` (Portuguese). `StringsTest` checks both files have the same strings.
  - **A new message shown in Stremio** goes into **all 16 languages** in `rightsubs/src/i18n/messages.ts`. `messages.test.ts` checks this. If you cannot translate a language, use English there and say so in the pull request.
- **Never commit credentials** or local files: `.env`, `config.yaml`, `signing/`, keystores, `out/`, `build/`, APKs. The commit hook refuses them. Never put tokens, Real-Debrid links or Torrentio/Sootio URLs in code, tests, logs or issues, because they carry personal keys.
- **The addon's dependencies:** only `yaml` and `zod` at runtime, and no native modules (it runs on Termux's Node inside the APK). Avoid adding dependencies. **The app:** Kotlin with no libraries.
- **Resources:** the addon must use almost nothing while Stremio is not using it. Read the "Resource rules" in [rightsubs/CLAUDE.md](rightsubs/CLAUDE.md) before adding timers, caches or background work.
- **Subtitle choice and syncing:** a change there must keep the real cases in [rightsubs/docs/FINDINGS.md](rightsubs/docs/FINDINGS.md) working, and new measurements are recorded there.

## The pull request

- One topic per pull request. Describe what changed, why, and how you tested it. Mention a device if you tried it on one.
- The CI runs the same tests (`sh test.sh`). A maintainer's review is required, and changes to the build, workflows and app (`.github/`, `scripts/`, `docker/`, `android/`) need a code owner's review ([.github/CODEOWNERS](.github/CODEOWNERS)).
- Pull requests are squash-merged, so the title becomes the commit message. Write it as a short sentence in English ("Retry the builder image downloads").

## Releases

Maintainers release versions: a `vX.Y.Z` tag builds, signs and publishes the APKs after a maintainer approves. See [README › Releases](README.md#releases). Contributors never need the signing key, and a local build signs with its own key.

## License

By contributing, you agree that your contribution is licensed under the project's [GNU GPL v3.0 or later](LICENSE).
