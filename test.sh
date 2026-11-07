#!/usr/bin/env sh
# Runs only the unit tests (addon + app), without building the APK. macOS/Linux. Needs Docker.
# Usage:  sh test.sh              addon and app
#         ONLY=addon sh test.sh   addon only (typecheck + node:test)
#         ONLY=app sh test.sh     app only (JUnit)
#         SKIP_IMAGE_BUILD=1 sh test.sh   use the rightsubs-apk-builder image already built (CI)
# Tests rightsubs/ and android/ as they are on disk (no need to commit). Uses no credentials.
set -eu

ROOT=$(cd "$(dirname "$0")" && pwd)

docker info > /dev/null 2>&1 || { echo "Docker is not running." >&2; exit 1; }

# Same image as the build: first time downloads ~3 GB of SDK/NDK; afterwards it is cached.
[ "${SKIP_IMAGE_BUILD:-0}" = 1 ] || docker build -t rightsubs-apk-builder "$ROOT/docker"
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(cygpath -m "$ROOT" 2> /dev/null || echo "$ROOT"):/work" -v rightsubs-gradle:/gradle -v rightsubs-npm:/root/.npm \
  -e "ONLY=${ONLY:-all}" \
  rightsubs-apk-builder bash /work/scripts/container-test.sh
