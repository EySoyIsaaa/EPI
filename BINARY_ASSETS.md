# Binary assets removed

This repository intentionally excludes binary files because the review/storage pipeline only supports text-based sources.

Removed binary artifacts include:
- `Epicenter_Player-main.zip`
- Android launcher images (`.png`/`.webp` under `android/app/src/main/res/mipmap-*`)
- `android/gradle/wrapper/gradle-wrapper.jar`

If you need to build Android locally, regenerate or re-download these assets in your own environment.
