# Dependencies

Every dependency is pinned to an exact version (no `^`/`~`) and has a reason. Lockfile: `package-lock.json`. Add nothing without a line here.
All were checked for license. `npm audit` (re-run 2026-10-25) reports 3 moderate findings, all one chain in dev tooling: `@capacitor/cli` -> `xcode` -> `uuid` (missing bounds check in uuid v3/v5/v6 when a buffer is passed). It runs only on the developer machine during `cap sync`, never ships in the app, and `npm audit fix --force` would downgrade `@capacitor/cli`, so it is left as is. Nothing is downloaded at run time.

## Runtime (ships in the app)

| Package | Pin | Why | Size/Notes |
|---|---|---|---|
| zod | 4.6.7 | Strict validation of untrusted model output and provider replies (the safety boundary). | core |
| react, react-dom | 19.3.1 | UI. Smallest mainstream option with hooks + good mobile perf. | ui |
| @capacitor/core | 8.5.3 | Native bridge to the Kotlin plugins and native HTTP. | ui |
| @mlc-ai/web-llm | 0.2.86 | **Optional, build-flag only** (`KRISH_LOCAL_MODEL=1`): on-device WebGPU model. Not in default bundles. Downloads weights at first use: see SECURITY.md. | ui |

## Build / test only

| Package | Pin | Why |
|---|---|---|
| typescript | 6.0.3 | Strict type-checking. |
| vite, @vitejs/plugin-react | 8.3.5, 6.1.2 | Bundles the UI. |
| vitest | 5.0.5 | Tests (Node + jsdom). |
| eslint, typescript-eslint | 10.13.0, 8.72.0 | Lint. |
| @types/node, @types/react, @types/react-dom | 26.6.5, 19.3.0, 19.3.0 | Types. |
| @capacitor/cli, @capacitor/android | 8.5.3 | Generates and syncs the Android project. |
| electron | 45.0.0 | Desktop shell (dev dependency: the packaged app bundles its own runtime). |

## Android (Gradle)

| Component | Pin | Why |
|---|---|---|
| Gradle | 8.14.3 | Wrapper from the Capacitor template; works with AGP 8.13. |
| Android Gradle Plugin | 8.13.0 | Matches compileSdk 36. |
| Kotlin Gradle plugin | 2.4.21 | Plugins are written in Kotlin. Supports Gradle 7.6.3-9.7.0 and AGP 8.5.2-9.3.1. |
| AlarmManager (platform) | n/a | Due-time notifications (scheduled tasks, macros). `androidx.work` was removed in part 12. Alarms do not survive reboot; the app re-arms them when opened. | android |
| androidx appcompat / core / activity / fragment / webkit / splashscreen | see `variables.gradle` | Capacitor template defaults. |
| compileSdk / targetSdk / minSdk | 36 / 36 / 26 | minSdk 26 for adaptive icons and Keystore behavior. |
| JDK | 21 | Required by AGP 8.13 + Capacitor 8. |

## Bundled binaries (full flavor only) — see SOURCE-OFFER.md

| File | Version | Why |
|---|---|---|
| proot + loader (aarch64) | 5.1.107.101 | Runs the Alpine rootfs without root. |
| libtalloc, libandroid-shmem | 2.5.0, 0.7 | proot's shared libraries. |
| Alpine minirootfs | 3.24.3 (aarch64) | Tier 1 Linux userland, SHA-256 verified before use. |

Deliberately NOT used: analytics/crash SDKs, Firebase, ads, any CDN-hosted script, any package that downloads binaries in `postinstall`
(Electron's binary download is a separate, explicit step in BUILD.md).


## Native model files and downloader (not bundled)

The catalog lists Unsloth's Qwen3.5 Q4_K_M GGUF text weights (0.8B, 2B, 4B, 9B). The model cards declare Apache 2.0; see https://huggingface.co/Qwen/Qwen3.5-2B and the model repositories linked in `core/src/local/catalog.ts`. Their exact file sizes and LFS SHA-256s were checked using the Hugging Face tree API. No model binaries are included. Android downloads use OkHttp 4.12.0 (Apache 2.0), with a dedicated no-cookie client and automatic redirects disabled. The Android native build fetches llama.cpp release b12001 (commit `eb4e244be77a906a183cd4a00fd51d9ad3200955`, MIT; `LICENSES/llama.cpp-MIT.txt`) as source at build time and verifies the source archive SHA-256 `bd2f111a77f617614fd58e1202bed7d0249d3ea8949ad8a1a183915d612f0aad`. Build requires access to codeload.github.com; no weights or prebuilt binary are fetched. The current JNI is only a build/link probe and does not run inference. Android NDK 27.2.12479018 and CMake 3.22.1 are pinned, arm64-v8a only.
