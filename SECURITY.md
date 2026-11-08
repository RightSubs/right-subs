# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub: **Security › Report a vulnerability** on this repository ([direct link](https://github.com/RightSubs/right-subs/security/advisories/new)). Only the maintainers see it, and we answer there.

Helpful to include: what is affected, how to reproduce it, the APK version (Settings › Apps › RightSubs, or the app's status line) and the device.

## Supported versions

Only the [latest release](https://github.com/RightSubs/right-subs/releases/latest) gets fixes.

## What matters most here

- **Credentials** (OpenSubtitles, Real-Debrid, DeepL): encrypted with the Android Keystore, passed to the addon only as environment variables, and never logged ([README › Credentials security](README.md#credentials-security)).
- **"Fill in on your phone"**: a temporary HTTP form on the local network, protected by a one-time code.
- **The addon** answers only on `127.0.0.1`.
- **Releases** are built and signed by GitHub Actions. Each APK has a build provenance attestation (`gh attestation verify rightsubs-universal.apk --repo RightSubs/right-subs`) and a VirusTotal report in the release notes. An APK from anywhere else may not be ours.
