#!/usr/bin/env bash
# Cross-compiles a minimal ffmpeg + ffprobe for one Android ABI with the NDK: only what
# RightSubs uses (read container headers and text subtitle tracks over HTTP(S), write
# SRT). TLS comes from the Termux OpenSSL already shipped for Node, and certificate +
# host verification is on by default (patches/ffmpeg-tls-verify.patch).
# Usage: build-ffmpeg.sh <abi> <termux usr dir> <jniLibs/abi out dir> <cache dir>
set -euo pipefail

ABI=$1
TERMUX_USR=$2
OUT=$3
CACHE=$4

FFMPEG_VERSION=7.1.1
FFMPEG_SHA256=733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1
API=24
HERE=$(cd "$(dirname "$0")" && pwd)
PATCH="$HERE/../patches/ffmpeg-tls-verify.patch"

case "$ABI" in
  armeabi-v7a) ARCH=arm; CPU=armv7-a; TRIPLE=armv7a-linux-androideabi; ASM=(--enable-neon) ;;
  arm64-v8a) ARCH=aarch64; CPU=armv8-a; TRIPLE=aarch64-linux-android; ASM=(--enable-neon) ;;
  x86_64) ARCH=x86_64; CPU=x86-64; TRIPLE=x86_64-linux-android; ASM=(--disable-asm) ;;
  *) echo "ABI desconhecida: $ABI" >&2; exit 2 ;;
esac

# Rebuilt only when this script, the patch, the version or the OpenSSL headers change.
KEY=$( (cat "$0" "$PATCH"; echo "$ABI $FFMPEG_VERSION"; cat "$TERMUX_USR/include/openssl/opensslv.h") | sha256sum | cut -c1-16)
BUILT="$CACHE/ffmpeg/$ABI-$KEY"
if [ -x "$BUILT/ffmpeg" ] && [ -x "$BUILT/ffprobe" ]; then
  echo "ffmpeg $FFMPEG_VERSION ($ABI): do cache"
else
  TARBALL="$CACHE/ffmpeg-$FFMPEG_VERSION.tar.xz"
  mkdir -p "$CACHE"
  if ! echo "$FFMPEG_SHA256  $TARBALL" | sha256sum -c - > /dev/null 2>&1; then
    curl -fsSLo "$TARBALL" "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
    echo "$FFMPEG_SHA256  $TARBALL" | sha256sum -c -
  fi
  WORK=$(mktemp -d)
  tar -xJf "$TARBALL" -C "$WORK"
  SRC="$WORK/ffmpeg-$FFMPEG_VERSION"
  patch -d "$SRC" -p1 < "$PATCH"

  TC="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64"
  (
    cd "$SRC"
    ./configure \
      --target-os=android --arch="$ARCH" --cpu="$CPU" --enable-cross-compile \
      --cc="$TC/bin/$TRIPLE$API-clang" --cxx="$TC/bin/$TRIPLE$API-clang++" \
      --ar="$TC/bin/llvm-ar" --nm="$TC/bin/llvm-nm" --ranlib="$TC/bin/llvm-ranlib" --strip="$TC/bin/llvm-strip" \
      --sysroot="$TC/sysroot" --pkg-config=false \
      --extra-cflags="-I$TERMUX_USR/include -O2" \
      --extra-ldflags="-L$TERMUX_USR/lib -Wl,-rpath-link=$TERMUX_USR/lib -Wl,-z,max-page-size=16384" \
      --enable-pic --disable-shared --enable-static \
      --disable-autodetect --disable-everything --disable-doc --disable-debug \
      --disable-ffplay --disable-avdevice --disable-postproc \
      --enable-ffmpeg --enable-ffprobe \
      --enable-network --enable-openssl --enable-zlib \
      --enable-protocol=file,pipe,tcp,tls,http,https \
      --enable-demuxer=matroska,mov,avi,mpegts,flv,ogg,srt,ass,webvtt \
      --enable-parser=h264,hevc,av1,vp9,mpeg4video,mpegvideo,aac,ac3 \
      --enable-decoder=subrip,srt,ass,ssa,mov_text,webvtt,text \
      --enable-encoder=srt,subrip \
      --enable-muxer=srt,null \
      "${ASM[@]}" > "$WORK/configure.log" 2>&1 || { tail -n 40 "$WORK/configure.log" ffbuild/config.log 2>/dev/null; exit 1; }
    make -j"$(nproc)" ffmpeg ffprobe > "$WORK/make.log" 2>&1 || { tail -n 40 "$WORK/make.log"; exit 1; }
  )
  mkdir -p "$BUILT"
  for tool in ffmpeg ffprobe; do "$TC/bin/llvm-strip" -o "$BUILT/$tool" "$SRC/$tool"; done
  rm -rf "$WORK"
  echo "ffmpeg $FFMPEG_VERSION ($ABI): compilado"
fi

mkdir -p "$OUT"
cp "$BUILT/ffmpeg" "$OUT/libffmpeg.so"
cp "$BUILT/ffprobe" "$OUT/libffprobe.so"
