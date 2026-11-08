#!/usr/bin/env bash
# Runs inside the build container (see test.ps1 / test.sh): the unit tests only, no APK.
# /work is this repository. Tests run on rightsubs/ and android/ AS THEY ARE ON DISK (no git archive),
# in copies under /tmp so nothing is written to the repository.
#   1. addon: npm ci, typecheck (tsc), npm test (node:test)
#   2. app:   Gradle testReleaseUnitTest (JUnit) with the real config template and languages.ts of the addon
# Env: ONLY=addon|app (default: both).
set -euo pipefail

W=/work
ONLY=${ONLY:-all}
GEN=/tmp/gen
rm -rf "$GEN" /tmp/rightsubs /tmp/android
mkdir -p "$GEN/assets" "$GEN/jniLibs" /tmp/rightsubs

# Copy without node_modules/dist/.env/config.yaml: a clean install, like the build does.
tar -C "$W/rightsubs" --exclude=node_modules --exclude=dist --exclude=.env --exclude=config.yaml -cf - . | tar -C /tmp/rightsubs -xf -

status=0

if [ "$ONLY" = all ] || [ "$ONLY" = addon ]; then
  echo "==> Addon: npm ci"
  (cd /tmp/rightsubs && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error)
  echo "==> Addon: typecheck"
  (cd /tmp/rightsubs && npm run typecheck --silent) || status=1
  echo "==> Addon: npm test"
  (cd /tmp/rightsubs && npm test) || status=1
fi

if [ "$ONLY" = all ] || [ "$ONLY" = app ]; then
  # What the app's tests read (same files build-payload.sh hands to Gradle).
  cp "$W/rightsubs/config.example.yaml" "$GEN/config.template.yaml"
  cp "$W/rightsubs/src/languages/languages.ts" "$GEN/languages.ts"
  echo "==> App: Gradle testReleaseUnitTest"
  cp -r "$W/android" /tmp/android
  rm -rf /tmp/android/.gradle /tmp/android/build /tmp/android/app/build
  gradle -p /tmp/android --no-daemon --quiet -PgeneratedDir="$GEN" testReleaseUnitTest || status=1
  # Summary from the JUnit reports (Gradle is quiet when everything passes).
  if ls /tmp/android/app/build/test-results/testReleaseUnitTest/*.xml > /dev/null 2>&1; then
    node -e '
      const fs = require("fs"), d = "/tmp/android/app/build/test-results/testReleaseUnitTest/";
      let t = 0, f = 0, s = 0;
      for (const n of fs.readdirSync(d).filter((x) => x.endsWith(".xml"))) {
        const x = fs.readFileSync(d + n, "utf8");
        const m = x.match(/tests="(\d+)" skipped="(\d+)" failures="(\d+)" errors="(\d+)"/);
        if (m) { t += +m[1]; s += +m[2]; f += +m[3] + +m[4]; }
      }
      console.log(`App: ${t} tests, ${f} failures, ${s} skipped`);
    '
  fi
fi

if [ "$status" = 0 ]; then echo "==> ALL TESTS PASSED"; else echo "==> THERE WERE FAILURES (details above)" >&2; fi
exit "$status"
