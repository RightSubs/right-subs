# Runs ON THE BOX (not on the computer): times the embedded subtitle extraction the way RightSubs
# does it, with the Node and ffmpeg of the installed APK, without touching the app's data.
# Prepare and run (from the computer):
#   BOX=<ip> sh scripts/adb.sh shell mkdir -p /data/local/tmp/rs
#   BOX=<ip> sh scripts/adb.sh push /assets/cacert.pem /data/local/tmp/rs/
#   BOX=<ip> sh scripts/adb.sh push /box/extract-timing.sh /data/local/tmp/rs/
#   BOX=<ip> sh scripts/adb.sh shell sh /data/local/tmp/rs/extract-timing.sh <direct link> <track> <start s>...
# The direct link is the *.download.real-debrid.com/d/… one (not the real-debrid.com/d/… page).
# Mask the output: | sed -E 's#https://[^ "]*download\.real-debrid[^ "]*#<url>#g'
# Deletes everything in /data/local/tmp/rs when done.
U=$1
TRACK=$2
shift 2
T=/data/local/tmp/rs
L=$(dirname "$(pm path com.rightsubs.android | sed s/package://)")/lib/arm
[ -d "$L" ] || L=$(dirname "$(pm path com.rightsubs.android | sed s/package://)")/lib/arm64
mkdir -p $T/lib
# The real names of the renamed libraries (assets/libmap.txt).
for p in libz.so.1:libz_so_1.so libcrypto.so.3:libcrypto_so_3.so libssl.so.3:libssl_so_3.so \
  libicui18n.so.78:libicui18n_so_78.so libicuuc.so.78:libicuuc_so_78.so libicudata.so.78:libicudata_so_78.so; do
  ln -sf "$L/${p#*:}" "$T/lib/${p%%:*}"
done
export LD_LIBRARY_PATH=$T/lib:$L SSL_CERT_FILE=$T/cacert.pem HOME=$T
now() { date +%s%3N; }

cat > $T/speed.mjs << 'EOF'
const t = Date.now();
const r = await fetch(process.argv[2], { headers: { range: 'bytes=10000000000-10199999999' } });
let b = 0;
for await (const c of r.body) b += c.length;
console.log(`download direto: ${(b * 8 / ((Date.now() - t) / 1000) / 1e6).toFixed(0)} Mbit/s (${(b / 1e6).toFixed(0)} MB)`);
EOF
"$L/libnode.so" $T/speed.mjs "$U"

for start in "$@"; do
  s=$(now)
  # Same arguments as rightsubs/src/media/embedded.ts.
  timeout 120 "$L/libffmpeg.so" -v error -threads 1 -copyts -ss "$start" -i "$U" -to $((start + 45)) \
    -map "0:$TRACK" -c:s srt -f srt - > $T/out.srt 2> $T/err.txt
  code=$?
  sub=$(( $(now) - s ))
  s=$(now)
  "$L/libffmpeg.so" -v verbose -threads 1 -copyts -ss "$start" -i "$U" -map 0:a:0 -c copy -to $((start + 45)) -f null - > /dev/null 2> $T/aud.txt
  aud=$(( $(now) - s ))
  bytes=$(grep -oE 'Statistics: [0-9]+ bytes read' $T/aud.txt | grep -oE '[0-9]+' | sort -n | tail -1)
  echo "window ${start}s: subtitle ${sub} ms (exit $code, $(grep -c -- '-->' $T/out.srt) cues) | audio only ${aud} ms, $(( ${bytes:-0} / 1000000 )) MB"
done
rm -rf $T
