#!/usr/bin/env sh
# adb to the box over the network, from inside the build container (nothing to install on the computer).
# The adb key lives in the Docker volume rightsubs-adb: the TV asks for authorization only the first time.
# Mounted in the container: out/ at /out, build/generated/assets at /assets, scripts/box at /box.
#
# Usage:  BOX=<ip> sh scripts/adb.sh devices -l
#         BOX=<ip> sh scripts/adb.sh install -r /out/rightsubs-armeabi-v7a.apk
#         BOX=<ip> sh scripts/adb.sh shell cat /sdcard/Android/data/com.rightsubs.android/files/rightsubs.log
#         BOX=<ip> sh scripts/adb.sh forward tcp:7000 tcp:7000   (only works inside the same container)
# Needs debugging (USB/network) turned on in the box's Developer options.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
: "${BOX:?set BOX=<box ip> (see CLAUDE.local.md)}"
# Docker Desktop on Windows (Git Bash) wants D:/…, not /d/….
HOST_ROOT=$(cygpath -m "$ROOT" 2> /dev/null || echo "$ROOT")
mkdir -p "$ROOT/out" "$ROOT/build/generated/assets"

MSYS_NO_PATHCONV=1 docker run --rm -i -e BOX="$BOX" \
  -v rightsubs-adb:/root/.android \
  -v "$HOST_ROOT/out:/out:ro" -v "$HOST_ROOT/build/generated/assets:/assets:ro" -v "$HOST_ROOT/scripts/box:/box:ro" \
  rightsubs-apk-builder bash -c '
    adb start-server > /dev/null 2>&1
    adb connect "$BOX:5555" > /dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do adb devices | grep -q "$BOX:5555.*device$" && break; sleep 1; done
    adb devices | grep -q "$BOX:5555.*device$" || { echo "box $BOX not connected (debugging on? authorized on the TV?)" >&2; adb devices >&2; exit 1; }
    adb -s "$BOX:5555" "$@"' adb "$@"
