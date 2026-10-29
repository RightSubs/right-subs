#!/data/data/com.termux/files/usr/bin/sh
# Removes RightSubs from the box: stops the service and deletes its boot entry,
# cache and logs. With --all, also deletes the project folder (config.yaml and .env included).
# Usage: sh scripts/uninstall-termux.sh [--all]
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA_DIR="${RIGHTSUBS_HOME:-$HOME/.rightsubs}"

sh "$ROOT/scripts/rightsubs.sh" stop || true
rm -f "$HOME/.termux/boot/start-rightsubs"
rm -rf "$DATA_DIR"
echo "Serviço parado; inicialização automática, cache e logs removidos."

if [ "${1:-}" = "--all" ]; then
  rm -rf "$ROOT"
  echo "Pasta do projeto removida ($ROOT)."
fi

echo "No Stremio, remova o addon RightSubs em Addons."
echo "Pacotes do Termux (node, ffmpeg…) continuam instalados: pkg uninstall nodejs-lts ffmpeg"
