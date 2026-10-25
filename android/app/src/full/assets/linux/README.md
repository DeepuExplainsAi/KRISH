# Bundled Tier 1 assets (full flavor only)

| File | Source | SHA-256 |
|---|---|---|
| alpine-minirootfs-3.24.3-aarch64.tgz.bin (byte-identical to Alpine's `.tar.gz`; renamed because the Android build tools silently gunzip assets ending in `.gz`) | https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/aarch64/ | 4d3f80afaebd447c5591a63a73bde380a149fe8b2d85488cafabb2ff97551f50 (matches Alpine's published value) |

Native binaries: see ../../jniLibs/arm64-v8a/README.md and /SOURCE-OFFER.md. Nothing here is downloaded at build or run time.
