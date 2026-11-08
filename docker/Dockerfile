# Build environment for the RightSubs APK: Node (builds the addon), JDK + Android SDK
# (builds the app) and the NDK (cross-compiles ffmpeg). Every download is checked.
FROM node:24-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jdk-headless unzip zip xz-utils make patch pkg-config curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV ANDROID_HOME=/opt/android-sdk
ARG CMDLINE_TOOLS=11076708
ARG CMDLINE_TOOLS_SHA256=2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258
RUN curl -fsSL --retry 5 --retry-all-errors -o /tmp/clt.zip "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS}_latest.zip" \
 && echo "${CMDLINE_TOOLS_SHA256}  /tmp/clt.zip" | sha256sum -c - \
 && mkdir -p "$ANDROID_HOME/cmdline-tools" \
 && unzip -q /tmp/clt.zip -d "$ANDROID_HOME/cmdline-tools" \
 && mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest" \
 && rm /tmp/clt.zip

ARG NDK_VERSION=27.2.12479018
RUN yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null \
 && "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "platforms;android-35" "build-tools;35.0.0" "ndk;${NDK_VERSION}" > /dev/null
ENV ANDROID_NDK_HOME=$ANDROID_HOME/ndk/$NDK_VERSION

ARG GRADLE_VERSION=8.10.2
RUN curl -fsSL --retry 5 --retry-all-errors -o /tmp/gradle.zip "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" \
 && echo "$(curl -fsSL --retry 5 --retry-all-errors "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip.sha256")  /tmp/gradle.zip" | sha256sum -c - \
 && unzip -q /tmp/gradle.zip -d /opt \
 && ln -s "/opt/gradle-${GRADLE_VERSION}/bin/gradle" /usr/local/bin/gradle \
 && rm /tmp/gradle.zip

ENV GRADLE_USER_HOME=/gradle

# adb, to install on a box over the network (install.ps1).
RUN "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "platform-tools" > /dev/null
ENV PATH=$PATH:$ANDROID_HOME/build-tools/35.0.0:$ANDROID_HOME/platform-tools
