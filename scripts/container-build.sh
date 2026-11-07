#!/usr/bin/env bash
# Runs inside the build container (see build.ps1 / build.sh). /work is this repository.
set -euo pipefail

ABIS=${ABIS:-armeabi-v7a arm64-v8a}
W=/work
B=$W/build
GEN=$B/generated
OUT=$W/out
SIGNING=$W/signing

rm -rf "$GEN" /tmp/termux
mkdir -p "$GEN/assets" "$GEN/jniLibs" "$OUT" "$B/cache"

echo "==> Node.js (Termux packages)"
# shellcheck disable=SC2086 # ABIS is a list
node "$W/scripts/termux-node.mjs" --cache "$B/cache" --stage /tmp/termux --out "$GEN" $ABIS

echo "==> ffmpeg"
for abi in $ABIS; do
  bash "$W/scripts/build-ffmpeg.sh" "$abi" /tmp/termux/"$abi"/data/data/com.termux/files/usr "$GEN/jniLibs/$abi" "$B/cache"
done
# shellcheck disable=SC2086
node "$W/scripts/termux-node.mjs" --check "$GEN" $ABIS

# One version for the APK and the addon it ships (VERSION file, semver): checked before anything is built.
APP_VERSION=$(tr -d ' \r\n' < "$W/VERSION")
[[ $APP_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "invalid VERSION: '$APP_VERSION' (use X.Y.Z)" >&2; exit 1; }
export APP_VERSION

echo "==> RightSubs"
bash "$W/scripts/build-payload.sh" "$B/rightsubs-src.tar" "$GEN/assets"

# Testing only: log copy readable with adb (see NodeRuntime.kt). Never distribute.
SUFFIX=""
DEBUG_LOG=${DEBUG_LOG:-0}
[ "$DEBUG_LOG" = 1 ] && SUFFIX="-debuglog"

# Testing only: credentials from .env inside the APK, stored on the first start (Prefill.kt).
# The APK holds them in plain text: never distribute it.
PREFILL=${PREFILL:-0}
if [ "$PREFILL" = 1 ]; then
  echo "==> Test credentials (prefill) from .env"
  node "$W/scripts/write-prefill.mjs" "$W/.env" "$GEN/assets/prefill.json"
  SUFFIX="$SUFFIX-prefill"
fi

echo "==> Signing key"
# Releases (GitHub Actions) bring the organization's key from the repository secrets and set
# REQUIRE_SIGNING_KEY=1: a new key there would make every release impossible to install over the last.
if [ ! -f "$SIGNING/keystore.properties" ] && [ "${REQUIRE_SIGNING_KEY:-0}" = 1 ]; then
  echo "ERROR: no signing key in signing/ and REQUIRE_SIGNING_KEY=1 — refusing to create a new one" >&2
  exit 1
fi
if [ ! -f "$SIGNING/keystore.properties" ]; then
  mkdir -p "$SIGNING"
  password=$(head -c 24 /dev/urandom | base64 | tr -d '/+=')
  keytool -genkeypair -noprompt -keystore "$SIGNING/release.p12" -storetype PKCS12 -alias rightsubs \
    -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=RightSubs" \
    -storepass "$password" -keypass "$password" > /dev/null
  printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=rightsubs\nkeyPassword=%s\n' "$SIGNING/release.p12" "$password" "$password" \
    > "$SIGNING/keystore.properties"
  chmod 600 "$SIGNING/keystore.properties" "$SIGNING/release.p12"
  echo "New key in signing/ — BACK IT UP: without it no APK update can be published."
fi

echo "==> APK"
rm -rf /tmp/android
cp -r "$W/android" /tmp/android
rm -rf /tmp/android/.gradle /tmp/android/build /tmp/android/app/build
# Minutes since 1970: always grows, so any newer build installs over an older one
# (Android refuses a lower versionCode; the first builds already used this scheme).
VERSION_CODE=${VERSION_CODE:-$(( $(date +%s) / 60 ))}
gradle -p /tmp/android --no-daemon --quiet \
  -PgeneratedDir="$GEN" -PsigningProps="$SIGNING/keystore.properties" \
  -PversionCode="$VERSION_CODE" -PversionName="$APP_VERSION" -PdebugLog="$([ "$DEBUG_LOG" = 1 ] && echo true || echo false)" \
  testReleaseUnitTest assembleRelease

rm -f "$OUT"/*.apk "$OUT/SHA256SUMS.txt" "$OUT/BUILD-INFO.txt" "$OUT/DO-NOT-DISTRIBUTE.txt"
for apk in /tmp/android/app/build/outputs/apk/release/*.apk; do
  # Fixed names (no version: it is in BUILD-INFO.txt and inside the APK), so that
  # github.com/…/releases/latest/download/rightsubs-<abi>.apk always points at the newest release.
  name=$(basename "$apk" | sed "s/^app-/rightsubs-/; s/-release/$SUFFIX/")
  apksigner verify "$apk"
  cp "$apk" "$OUT/$name"
done
# The APK and the addon inside it must report the same version (that is what the app shows).
check_versions() {
  local apk tmp apk_version addon_version
  for apk in "$@"; do
    tmp=$(mktemp -d)
    apk_version=$(aapt2 dump badging "$apk" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -n 1)
    unzip -p "$apk" assets/rightsubs.zip > "$tmp/rightsubs.zip"
    addon_version=$(unzip -p "$tmp/rightsubs.zip" package.json | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')
    rm -rf "$tmp"
    if [ "$apk_version" != "$APP_VERSION" ] || [ "$addon_version" != "$APP_VERSION" ]; then
      echo "ERROR: different versions in $(basename "$apk"): APK $apk_version, addon $addon_version, VERSION $APP_VERSION" >&2
      rm -f "$OUT"/*.apk
      exit 1
    fi
  done
}
check_versions "$OUT"/*.apk

# Credentials never go forward: a build that is not -Prefill is a release candidate and must carry none
# of the values in the .env files (nor prefill.json); if it does, no APK is left in out/.
if [ "$PREFILL" != 1 ]; then
  if ! bash "$W/scripts/check-no-secrets.sh" apk "$OUT"/*.apk; then
    rm -f "$OUT"/*.apk
    echo "ERROR: the APK carries .env credentials — no APK was left in out/" >&2
    exit 1
  fi
fi
# Test builds say so next to the APKs.
if [ "$PREFILL" = 1 ]; then
  echo "THESE APKs CARRY THE .env CREDENTIALS IN PLAIN TEXT (assets/prefill.json). For your own tests only: NEVER distribute them or send them to anyone." > "$OUT/DO-NOT-DISTRIBUTE.txt"
elif [ "$DEBUG_LOG" = 1 ]; then
  echo "THESE APKs WRITE A LOG WITH THE MOVIES WATCHED (-DebugLog). For your own tests only: NEVER distribute them or send them to anyone." > "$OUT/DO-NOT-DISTRIBUTE.txt"
fi

(cd "$OUT" && sha256sum ./*.apk > SHA256SUMS.txt)
{
  echo "RightSubs APK $APP_VERSION (versionCode $VERSION_CODE${SUFFIX:+, $SUFFIX})"
  echo "apk: commit ${APK_COMMIT:-?}"
  echo "addon: $(cat "$GEN/rightsubs-version.txt") (rightsubs/ from the same commit)"
  cat "$GEN/node-version.txt"
  echo "ffmpeg: $(sed -n 's/^FFMPEG_VERSION=//p' "$W/scripts/build-ffmpeg.sh")"
  echo "built: $(date -u +%Y-%m-%dT%H:%MZ)"
} > "$OUT/BUILD-INFO.txt"
cat "$OUT/BUILD-INFO.txt"
ls -lh "$OUT"
