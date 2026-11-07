#!/usr/bin/env bash
# Generates the launcher icon and the Android TV banner from art/icon-source.png
# (1254×1254, artwork on a dark purple rounded square, no text). Runs in the builder container:
#   MSYS_NO_PATHCONV=1 docker run --rm -v "D:/vscode_projects/right-subs-apk:/work" \
#     rightsubs-apk-builder bash /work/scripts/make-icons.sh
set -euo pipefail

W=/work
SRC=$W/art/icon-source.png
RES=$W/android/app/src/main/res
# Background inside the source's rounded square; also android/.../themes.xml icon_background.
BG='#0F0620'
# Square around the artwork (910×914 px at 176,145), inside the rounded square.
CROP='960x960+151+122'
# The source background is a gradient (#0A0415–#14062B): every shade near it becomes $BG,
# so the crop does not show as a square on the background around it.
FLATTEN=(-fuzz 6% -fill "$BG" -opaque "$BG")
FONT=DejaVu-Sans-Bold

command -v convert >/dev/null || { apt-get update -qq && apt-get install -y -qq imagemagick >/dev/null; }
TMP=$(mktemp -d)
convert "$SRC" -crop "$CROP" +repage "${FLATTEN[@]}" "$TMP/art.png"

# Adaptive icon foreground: 108 dp canvas, artwork within the 66 dp safe zone so any
# launcher mask (circle, squircle) only cuts background.
for pair in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  density=${pair%%:*}
  canvas=$(awk "BEGIN { printf \"%d\", 108 * ${pair##*:} }")
  art=$(awk "BEGIN { printf \"%d\", 66 * ${pair##*:} }")
  mkdir -p "$RES/mipmap-$density"
  convert "$TMP/art.png" -resize "${art}x${art}" \
    -background "$BG" -gravity center -extent "${canvas}x${canvas}" \
    -strip "$RES/mipmap-$density/ic_launcher_foreground.png"
done

# Android TV home row banner: 320×180 px in drawable-xhdpi (Android TV guidelines),
# artwork and the app name ("Right" white, "Subs" in the artwork's lilac).
mkdir -p "$RES/drawable-xhdpi"
convert -background none -font "$FONT" -pointsize 64 \
  -fill '#FFFFFF' label:Right -fill '#B79CFF' label:Subs +append -trim +repage \
  -resize '168x60>' "$TMP/name.png"
convert -size 320x180 "xc:$BG" \
  \( "$TMP/art.png" -resize 124x124 \) -gravity west -geometry +12+0 -composite \
  "$TMP/name.png" -gravity west -geometry +142+0 -composite \
  -strip "$RES/drawable-xhdpi/banner.png"

rm -rf "$TMP"
echo "Icons generated in $RES"
