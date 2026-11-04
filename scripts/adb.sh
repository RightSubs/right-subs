#!/usr/bin/env sh
# adb na box pela rede, de dentro do container de build (nada a instalar no PC).
# A chave do adb fica no volume Docker rightsubs-adb: a TV pede autorização só na 1ª vez.
# Montados no container: out/ em /out, build/generated/assets em /assets, scripts/box em /box.
#
# Uso:  BOX=<ip> sh scripts/adb.sh devices -l
#       BOX=<ip> sh scripts/adb.sh install -r /out/rightsubs-0.1.0-armeabi-v7a.apk
#       BOX=<ip> sh scripts/adb.sh shell cat /sdcard/Android/data/com.rightsubs.android/files/rightsubs.log
#       BOX=<ip> sh scripts/adb.sh forward tcp:7000 tcp:7000   (só vale dentro do mesmo container)
# Requer a depuração (USB/rede) ligada nas Opções do desenvolvedor da box.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
: "${BOX:?defina BOX=<ip da box> (está em CLAUDE.local.md)}"
# Docker Desktop no Windows (Git Bash) quer D:/…, não /d/….
HOST_ROOT=$(cygpath -m "$ROOT" 2> /dev/null || echo "$ROOT")
mkdir -p "$ROOT/out" "$ROOT/build/generated/assets"

MSYS_NO_PATHCONV=1 docker run --rm -i -e BOX="$BOX" \
  -v rightsubs-adb:/root/.android \
  -v "$HOST_ROOT/out:/out:ro" -v "$HOST_ROOT/build/generated/assets:/assets:ro" -v "$HOST_ROOT/scripts/box:/box:ro" \
  rightsubs-apk-builder bash -c '
    adb start-server > /dev/null 2>&1
    adb connect "$BOX:5555" > /dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do adb devices | grep -q "$BOX:5555.*device$" && break; sleep 1; done
    adb devices | grep -q "$BOX:5555.*device$" || { echo "box $BOX não conectada (depuração ligada? autorizou na TV?)" >&2; adb devices >&2; exit 1; }
    adb -s "$BOX:5555" "$@"' adb "$@"
