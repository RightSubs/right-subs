#!/usr/bin/env sh
# Roda só os testes unitários (addon + app), sem gerar o APK. Mac/Linux. Requer Docker.
# Uso:  sh test.sh              addon e app
#       ONLY=addon sh test.sh   só o addon (typecheck + node:test)
#       ONLY=app sh test.sh     só o app (JUnit)
# Testa rightsubs/ e android/ como estão no disco (não precisa commitar). Não usa credenciais.
set -eu

ROOT=$(cd "$(dirname "$0")" && pwd)

docker info > /dev/null 2>&1 || { echo "Docker não está rodando." >&2; exit 1; }

# Same image as the build: first time downloads ~3 GB of SDK/NDK; afterwards it is cached.
docker build -t rightsubs-apk-builder "$ROOT/docker"
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(cygpath -m "$ROOT" 2> /dev/null || echo "$ROOT"):/work" -v rightsubs-gradle:/gradle -v rightsubs-npm:/root/.npm \
  -e "ONLY=${ONLY:-all}" \
  rightsubs-apk-builder bash /work/scripts/container-test.sh
