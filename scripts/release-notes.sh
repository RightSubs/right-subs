#!/usr/bin/env sh
# Prints the CHANGELOG.md section of one version (without its heading): the notes of its GitHub release.
# Usage:  sh scripts/release-notes.sh X.Y.Z [CHANGELOG.md]
# Fails when the version has no section or the section is empty: a release always says what changed.
set -eu

VERSION=${1:?usage: release-notes.sh X.Y.Z [CHANGELOG.md]}
FILE=${2:-$(cd "$(dirname "$0")/.." && pwd)/CHANGELOG.md}

notes=$(awk -v version="$VERSION" '
  /^## \[/ {
    if (found) exit
    if (index($0, "## [" version "]") == 1) { found = 1; next }
  }
  found { print }
' "$FILE" | sed -e '/./,$!d')

if [ -z "$(printf '%s' "$notes" | tr -d '[:space:]')" ]; then
  echo "no notes for version $VERSION in $FILE (add a \"## [$VERSION]\" section)" >&2
  exit 1
fi
printf '%s\n' "$notes"
