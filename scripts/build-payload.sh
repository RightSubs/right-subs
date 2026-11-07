#!/usr/bin/env bash
# Builds RightSubs from the source snapshot (git archive of rightsubs/ in the last commit: .env and
# config.yaml never get in) and packs what runs on the device into rightsubs.zip:
# compiled dist/, production node_modules (pure JS), package.json and the config template.
# Usage: [APP_VERSION=X.Y.Z] build-payload.sh <rightsubs-src.tar> <assets out dir>
# With APP_VERSION the addon in the package takes the APK's version (see below).
set -euo pipefail

SRC_TAR=$1
OUT=$2

WORK=$(mktemp -d)
mkdir -p "$WORK/src" "$WORK/payload"
tar -xf "$SRC_TAR" -C "$WORK/src"
(
  cd "$WORK/src"
  # No install scripts: nothing from the registry runs during the build.
  npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
  npm run build --silent
  if [ "${RUN_TESTS:-0}" = 1 ]; then npm test; fi
  npm prune --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
)

cp -r "$WORK/src/dist" "$WORK/src/node_modules" "$WORK/src/package.json" "$WORK/payload/"
# One version for everything the user sees: the addon reports the version of the APK it ships in (the
# status line of the app, the Stremio manifest, the User-Agent and the log read it from package.json).
# Without this, rightsubs/package.json drifted from VERSION.
if [ -n "${APP_VERSION:-}" ]; then
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    pkg.version = process.argv[2];
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  ' "$WORK/payload/package.json" "$APP_VERSION"
fi
cp "$WORK/src/config.example.yaml" "$WORK/payload/config.template.yaml"
# Also for the app's unit tests (ConfigWriter must understand the real template, and
# the language list on screen must match the one RightSubs accepts).
cp "$WORK/src/config.example.yaml" "$OUT/../config.template.yaml"
cp "$WORK/src/src/languages/languages.ts" "$OUT/../languages.ts"

# Defense in depth: no secrets or local configuration in the APK.
if find "$WORK/payload" \( -name '.env' -o -name 'config.yaml' -o -name 'CLAUDE.local.md' \) | grep -q .; then
  echo "ERROR: local configuration file in the bundle — aborting" >&2
  exit 1
fi

mkdir -p "$OUT"
rm -f "$OUT/rightsubs.zip"
(cd "$WORK/payload" && zip -qr -X "$OUT/rightsubs.zip" .)
node -p "'RightSubs ' + require('$WORK/payload/package.json').version" > "$OUT/../rightsubs-version.txt"
rm -rf "$WORK"
echo "RightSubs bundle: $(cat "$OUT/../rightsubs-version.txt")"
