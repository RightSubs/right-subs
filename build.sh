#!/usr/bin/env sh
# Gera o APK do RightSubs no Mac/Linux. Requer Docker e Git.
# Uso:  sh build.sh
#       ABIS="armeabi-v7a arm64-v8a x86_64" RUN_TESTS=1 sh build.sh
#       DEBUG_LOG=1 sh build.sh                   SÓ TESTES: cópia do log legível por adb
#       PREFILL=1 sh build.sh                     SÓ TESTES: credenciais do .env dentro do APK
#       WORKING_TREE=1 sh build.sh                SÓ TESTES: addon com as alterações não commitadas de rightsubs/
# A versão do APK vem do arquivo VERSION. O addon vem de rightsubs/ no último commit deste
# repositório (git archive): .env e config.yaml nunca.
set -eu

ROOT=$(cd "$(dirname "$0")" && pwd)

docker info > /dev/null 2>&1 || { echo "Docker não está rodando." >&2; exit 1; }

mkdir -p "$ROOT/build"
SOURCE=HEAD
if [ "${WORKING_TREE:-0}" = 1 ]; then
  # A tree of the working copy built in a throwaway index: HEAD and the real index stay as they are.
  export GIT_INDEX_FILE="$ROOT/build/worktree.index"
  rm -f "$GIT_INDEX_FILE"
  git -C "$ROOT" read-tree HEAD
  git -C "$ROOT" add -A -- rightsubs
  SOURCE=$(git -C "$ROOT" write-tree)
  unset GIT_INDEX_FILE
  echo "Aviso: addon montado das alterações não commitadas de rightsubs/ (WORKING_TREE=1)." >&2
elif [ -n "$(git -C "$ROOT" status --porcelain -- rightsubs)" ]; then
  echo "Aviso: há alterações não commitadas em rightsubs/: o APK usa só o último commit (WORKING_TREE=1 para testar com elas)." >&2
fi
git -C "$ROOT" archive --format=tar -o "$ROOT/build/rightsubs-src.tar" "$SOURCE:rightsubs"
APK_COMMIT=$(git -C "$ROOT" rev-parse --short HEAD)
[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ] || APK_COMMIT="$APK_COMMIT+alterações"

docker build -t rightsubs-apk-builder "$ROOT/docker"
docker run --rm \
  -v "$ROOT:/work" -v rightsubs-gradle:/gradle -v rightsubs-npm:/root/.npm \
  -e "ABIS=${ABIS:-armeabi-v7a arm64-v8a}" -e "RUN_TESTS=${RUN_TESTS:-0}" -e "DEBUG_LOG=${DEBUG_LOG:-0}" \
  -e "PREFILL=${PREFILL:-0}" -e "APK_COMMIT=$APK_COMMIT" \
  rightsubs-apk-builder bash /work/scripts/container-build.sh
echo "APKs em $ROOT/out"
if [ "${PREFILL:-0}" = 1 ]; then
  echo "AVISO: ESTES APKs TÊM AS CREDENCIAIS DO .env EM TEXTO PURO. Só para os seus testes: NUNCA distribua." >&2
elif [ "${DEBUG_LOG:-0}" = 1 ]; then
  echo "AVISO: ESTES APKs GRAVAM O LOG COM OS FILMES ASSISTIDOS. Só para os seus testes: NUNCA distribua." >&2
fi
