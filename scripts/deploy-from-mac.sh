#!/usr/bin/env sh
# Builds on the Mac, copies the project to the box over SSH and restarts the service.
# config.yaml, .env and node_modules on the box are left untouched; the box only
# installs runtime dependencies (no compiler).
# Usage: BOX=192.168.0.50 scripts/deploy-from-mac.sh
set -eu

: "${BOX:?defina o IP da box, ex.: BOX=192.168.0.50 scripts/deploy-from-mac.sh}"
PORT="${BOX_SSH_PORT:-8022}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)

(cd "$ROOT" && npm run build)

rsync -az --delete \
  --exclude node_modules --exclude .git --exclude config.yaml --exclude .env --exclude .DS_Store \
  -e "ssh -p $PORT" "$ROOT/" "$BOX:right-subs/"

ssh -p "$PORT" "$BOX" 'cd ~/right-subs && npm ci --omit=dev --no-fund --no-audit && npm cache clean --force >/dev/null 2>&1; sh scripts/rightsubs.sh restart'
