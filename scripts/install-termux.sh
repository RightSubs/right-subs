#!/data/data/com.termux/files/usr/bin/sh
# Installs RightSubs on an Android/Google TV box running Termux.
# Run from the project folder:  sh scripts/install-termux.sh
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIN_NODE_MAJOR=22
MIN_NODE_MINOR=18

step() { printf '\n==> %s\n' "$1"; }

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "Este script é para o Termux (Android). No Mac use: npm install && npm start"; exit 1 ;;
esac

step "Arquitetura do aparelho: $(uname -m)"

step "Instalando pacotes (node, ffmpeg, git, curl, rsync, openssh)"
# Upgrade what is already installed first: a new package (e.g. ffmpeg) linked
# against newer libraries fails to start next to outdated ones (libc++).
pkg upgrade -y -o Dpkg::Options::=--force-confold
pkg install -y nodejs-lts ffmpeg git curl rsync openssh

node_ok() {
  node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>$MIN_NODE_MAJOR||(a===$MIN_NODE_MAJOR&&b>=$MIN_NODE_MINOR)?0:1)"
}
if ! node_ok; then
  step "Node $(node --version) é antigo demais (mínimo $MIN_NODE_MAJOR.$MIN_NODE_MINOR) — trocando nodejs-lts por nodejs"
  pkg uninstall -y nodejs-lts
  pkg install -y nodejs
  node_ok || { echo "Node $(node --version) ainda é antigo. Abortando."; exit 1; }
fi
echo "Node $(node --version) ok"

step "Instalando e compilando o RightSubs"
cd "$ROOT"
# Compile once, then drop the compiler and npm's download cache to save space.
npm ci --no-fund --no-audit
npm run build
npm prune --omit=dev --no-fund --no-audit
npm cache clean --force > /dev/null 2>&1 || true

step "Arquivos de configuração"
[ -f config.yaml ] || { cp config.example.yaml config.yaml; echo "config.yaml criado a partir do exemplo"; }
[ -f .env ] || { cp .env.example .env; echo ".env criado — preencha as credenciais: nano $ROOT/.env"; }

step "Inicialização automática (Termux:Boot)"
mkdir -p "$HOME/.termux/boot"
BOOT_SCRIPT="$HOME/.termux/boot/start-rightsubs"
sed "s|__ROOT__|$ROOT|" scripts/boot/start-rightsubs > "$BOOT_SCRIPT"
chmod +x "$BOOT_SCRIPT" scripts/*.sh
echo "Script de boot instalado em $BOOT_SCRIPT"
echo "Lembrete: o app Termux:Boot precisa estar instalado e ter sido aberto uma vez."

step "Validando configuração"
if node dist/server.js --check; then
  sh scripts/rightsubs.sh restart
  printf '\nPronto. Instale no Stremio: http://127.0.0.1:%s/manifest.json\n' \
    "$(sed -n 's/^ *port: *\([0-9]*\).*/\1/p' config.yaml | head -n 1)"
else
  echo
  echo "Ajuste config.yaml/.env (nano config.yaml), valide com 'npm run check-config' e inicie com 'scripts/rightsubs.sh start'."
fi
