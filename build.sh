#!/usr/bin/env sh
# Builds the RightSubs APK on macOS/Linux. Needs Docker and Git.
# Usage:  sh build.sh
#         ABIS="armeabi-v7a arm64-v8a x86_64" RUN_TESTS=1 sh build.sh
#         DEBUG_LOG=1 sh build.sh                   TESTING ONLY: log copy readable with adb
#         PREFILL=1 sh build.sh                     TESTING ONLY: credentials from .env inside the APK
#         WORKING_TREE=1 sh build.sh                TESTING ONLY: addon with the uncommitted changes in rightsubs/
#         REQUIRE_SIGNING_KEY=1 sh build.sh         fail instead of creating a signing key (releases)
#         SKIP_IMAGE_BUILD=1 sh build.sh            use the rightsubs-apk-builder image already built (CI)
# The APK version comes from the VERSION file. The addon comes from rightsubs/ in this
# repository's last commit (git archive): never .env or config.yaml.
set -eu

ROOT=$(cd "$(dirname "$0")" && pwd)

docker info > /dev/null 2>&1 || { echo "Docker is not running." >&2; exit 1; }

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
  echo "Warning: addon built from the uncommitted changes in rightsubs/ (WORKING_TREE=1)." >&2
elif [ -n "$(git -C "$ROOT" status --porcelain -- rightsubs)" ]; then
  echo "Warning: rightsubs/ has uncommitted changes: the APK uses only the last commit (WORKING_TREE=1 to test with them)." >&2
fi
git -C "$ROOT" archive --format=tar -o "$ROOT/build/rightsubs-src.tar" "$SOURCE:rightsubs"
APK_COMMIT=$(git -C "$ROOT" rev-parse --short HEAD)
[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ] || APK_COMMIT="$APK_COMMIT+dirty"

[ "${SKIP_IMAGE_BUILD:-0}" = 1 ] || docker build -t rightsubs-apk-builder "$ROOT/docker"
docker run --rm \
  -v "$ROOT:/work" -v rightsubs-gradle:/gradle -v rightsubs-npm:/root/.npm \
  -e "ABIS=${ABIS:-armeabi-v7a arm64-v8a}" -e "RUN_TESTS=${RUN_TESTS:-0}" -e "DEBUG_LOG=${DEBUG_LOG:-0}" \
  -e "PREFILL=${PREFILL:-0}" -e "APK_COMMIT=$APK_COMMIT" -e "REQUIRE_SIGNING_KEY=${REQUIRE_SIGNING_KEY:-0}" \
  rightsubs-apk-builder bash /work/scripts/container-build.sh
echo "APKs in $ROOT/out"
if [ "${PREFILL:-0}" = 1 ]; then
  echo "WARNING: THESE APKs CARRY THE .env CREDENTIALS IN PLAIN TEXT. For your own tests only: NEVER distribute them." >&2
elif [ "${DEBUG_LOG:-0}" = 1 ]; then
  echo "WARNING: THESE APKs WRITE A LOG WITH THE MOVIES WATCHED. For your own tests only: NEVER distribute them." >&2
fi
