#!/usr/bin/env sh
# Updates RightSubs in place (on the box) and restarts it.
# Compiles TypeScript to JavaScript once, then removes the compiler: the resident
# service runs plain JS (native TypeScript execution costs ~20 MB of extra memory).
# Usage: sh scripts/update.sh
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if [ -d .git ]; then
  git pull --ff-only
fi
npm ci --no-fund --no-audit
npm run build
npm prune --omit=dev --no-fund --no-audit
npm cache clean --force > /dev/null 2>&1 || true
sh scripts/rightsubs.sh restart
