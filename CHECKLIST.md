# Checklist: what was verified, and what was not

Legend: **RUN** = executed in the build environment with the result observed. **STATIC** = checked by reading output/config. **NOT RUN** = never executed; may be wrong.
Last updated 2026-11-05 (phone-control pivot, parts 1-13). Older rounds below are kept as history; anything about the removed in-app browser, vault or web agent no longer applies.

## Verified (RUN), phone control

| Area | How | Result |
|---|---|---|
| Allowlist + hard blocklist, fail-closed (empty / unknown package refused) | `npm test -w core` (`packages.test.ts`) | pass |
| Screen gate: package, FLAG_SECURE, blank screenshot, blocked site, password / secret-hint fields, OTP / PIN / CVV / password / login / sign in, "pay" approvable, redaction | `screen.test.ts` | pass |
| Action schema (strict, unknown fields rejected), task plan, confirmation kinds (send, post, pay, delete, submit, install, share, new app, unlabeled), step limit | `actions.test.ts` | pass |
| Pacing (social caps and delays, reads not counted), activity log (redacted, capped, delete, clear), consent versioning | `pacing.test.ts`, `activity-log.test.ts`, `consent.test.ts` | pass |
| `PhoneEngine`: single path, denied popup, stop / pause states, re-check after popup, refused screens return no text | `engine.test.ts` | pass |
| Mode B: MCP handler, relay client and hub, token handling, one mode at a time | `mcp.test.ts`, `relay.test.ts`, `service.test.ts` | pass |
| Mode A: nonce marker, first valid action after the last marker, chat app must be in the plan | `chat-driver.test.ts` | pass |
| Macros: recording by label (never node ids), replay without an AI through the engine (popups still asked, denied popup stops), element missing = retryable failure and no tap, login screen / foreign app stops, removed app refuses, retry then report, `PhoneService.runMacro` | `macro.test.ts`, `service.test.ts` (301 core tests) | pass |
| UI with a fake platform (35 tests), desktop helpers (7), strict TypeScript, ESLint, UI production build | `npm run typecheck && npm run lint && npm test && npm run build:ui` | clean |
| Kotlin compiles for both flavors in CI | GitHub Actions `check` | see HANDOFF for the latest run |
| No in-app browser left | `grep -rIl -i webview` finds only Capacitor's host (`MainActivity.kt`, `activity_main.xml`), comments and proguard text | STATIC |

## Round 17: local-first integration (2026-10-30)

- Step 2 CI `41032308054`: JS and Android Kotlin/NDK compile passed; not an APK/device test. Local step 3 checks: typecheck, lint, 297 core / 56 UI / 10 desktop tests and UI build passed. Step 3 PR run `41033360016` passed JS and both-flavor Android Kotlin/NDK compile; strict-JSON follow-up run `41033973986` also passed JS and both-flavor Android Kotlin/NDK compile. Native log suppression was host-compiled; its Android build is subject to final CI.
- Added selected-native-first routing, online backup opt-in, API Keys gated by toggle, per-provider compact/redacted prompt, strict native action validation, and stop propagation. Tests use fake engine/network; host parsed schema-derived grammar and rendered a Qwen test template, not actual inference.
- **NOT RUN on phone:** install, model download, inference, JSON quality, native process crash/restart, stop, background unload, OOM with WebView, speed, battery or heat. `:llm` isolates native crashes but cannot prevent system-wide memory kills.

## Round 16: isolated native engine, not integrated (2026-10-30)

- Implemented `:llm` bound service and JNI operations, schema-derived first-filter grammar and strict post-validation; provider registration and backup toggle remain pending. Host build and Qwen template render only; Android compilation subject to CI, native inference **NOT RUN**.
- **NOT RUN on phone:** installation, download, inference, native process death/restart, OOM recovery, background unload, stop, performance, RAM with WebView, battery and heat. Isolation cannot guarantee the UI survives Android system-wide memory pressure.

## Round 15: native inference investigation (2026-10-30)

- **NOT BUILT:** step 2 JNI load/complete/stop/unload, schema-equivalent grammar, Qwen template application, isolation/OOM handling, background unload; step 3 engine registration, local-first routing and working backup toggle. The existing native library exposes only a link probe.
- Zod JSON-schema export loses the custom HTTPS URL refinement; llama.cpp converter may weaken unsupported regex patterns. Model output must still pass `ActionSchema` and policy checks. llama.cpp includes native abort paths, so a language-level exception catch is not sufficient crash isolation.
- **NOT RUN:** native inference, APK installation, real model download, real-device OOM, speed, RAM with WebView open, battery/heat, background unload, or phone fallback. Existing local-router fallback tests use fake engines only.

## Round 14: native build probe (2026-10-30)

- Pinned source, CMake, arm64-only Gradle config and JNI link probe added. CI-only dependencies invoke both native build tasks from the existing Android check; **CI passed on 0616dff** (run 41029080188), no local Android JDK/SDK/NDK. Local typecheck, lint, tests (290 core, 54 UI, 10 desktop), and UI build passed. `ci/workflows/check.yml` is a non-active workflow mirror.
- **NOT BUILT:** model load/completion, action grammar, template/thinking switch, local engine registration, fallback toggle and lifecycle/memory handling. The app cannot answer offline.
- **NOT RUN:** actual Android JNI probe, APK installation, download, inference, performance, WebView RAM kills, battery/heat or screen-off lifecycle.

## Round 13: downloader redirect and foreground changes (2026-10-30)

- Local typecheck, lint, tests (core 290, UI 54, desktop 10), and UI build pass. CI JS and both-flavor Kotlin compilation passed on 3a40d94; new `LocalDownloadPolicyTest` not run (no local JDK/SDK; existing CI compiles Kotlin only).
- **NOT RUN:** real phone APK install, actual CDN redirects, real model download, screen-off/background continuation, agent and download overlapping, pause/resume/cancel, storage-low, hash mismatch, process kill, service timeout, battery/heat, WebView RAM kills.
- Compact prompt option is tested but not connected to a native engine.
- **NOT BUILT:** Phase 2 native inference, llama.cpp/JNI/grammar, NDK CI, local-first router or working backup toggle. The app still cannot answer offline.

## Round 12: Android downloader (2026-10-30, work in progress; see Round 13)

- `npm run typecheck`, `npm run lint`, `npm test` (core 289, UI 54, desktop 10), `npm run build:ui` pass locally. Fake-platform tests simulate progress, pause, hash mismatch, storage error, selection and delete; they do not exercise native hashing, redirects or networking.
- CI Android Kotlin compile passed for both flavors on 982762e, including activity-recreation locking; CI JS also passed. Local environment has no JDK/Android SDK. Native plugin functionality has not been run. `ACCESS_NETWORK_STATE` added for metered warning; inspect merged manifests.
- NOT BUILT: native inference, local routing, functional API-backup toggle, hiding the API Keys screen, JNI/grammar and NDK CI. No offline answers yet. Do not advertise Phase 1 as complete or enable backup off before the engine exists.
- NOT RUN: real APK install, actual Hugging Face redirect hosts, actual model download/pause/resume/cancel/hash failure/storage-low or delete, process death/restart, real inference, speed, RAM kills with a WebView open, battery/heat.

## Round 11: partial local-model work (2026-10-30; superseded by Round 12)

- Run: `npm run typecheck`, `npm run lint`, `npm test` (core 289, UI 52, desktop 10), `npm run build:ui` all pass. Headless Chromium showed the Settings catalog preview at 390×844 using the web demo; this is not a phone test.
- NOT BUILT: native download manager, consent and storage/metered checks, checksum verification, model selection/deletion, API backup toggle, native inference, grammar, JNI/NDK or offline routing. Existing API routing is unchanged. This is not a working offline model or a complete Phase 1.
- NOT RUN: real APK install, real model download, real inference, speed, RAM kills with a WebView open, battery/heat, or Android build for these changes. CI on this branch has not been checked yet.

## NOT RUN: needs a real device (please test)

1. **Everything on an Android device.** No APK was installed or launched.
2. **Accessibility Service**: enabling it, runtime `packageNames` narrowing, foreground guard, reading the tree, tap / type / scroll / back, password nodes giving no text.
3. **Safety overlay**: red STOP while a task runs, Allow / Deny popup, 60 s timeout = No, tapjacking filter, both volume keys, phone lock stopping the task. The overlay is an accessibility window; Android versions differ.
4. **Screenshot / FLAG_SECURE / blank-screenshot check** (`takeScreenshot`, Android 11+).
5. **Mode B end to end**: deploy `relay/`, add the connector in ChatGPT or Claude, run `open_app` / `read_screen` / `tap` / `type`, rotate the token.
6. **Mode A end to end**: the ChatGPT / Gemini / Claude app's screen layout, finding the input and Send button, reading the reply.
7. **Macros and alarms**: `AlarmManager` notification at the chosen minute (exact vs inexact on Android 12+), tap-to-open, Run, retry, failure notification, alarms after reboot (lost until the app opens).
8. Android Keystore plugin (`KrishSecurePlugin`) encrypt / decrypt round trip; POST_NOTIFICATIONS opt-in on Android 13+.
9. Electron on real hardware: `safeStorage` keychain, file dialogs.
10. Real provider calls (no keys were used). Request shapes follow public API docs and mocks only.
11. On-device model: see Rounds 11-17 above; none of it was run on a phone.
12. `.github/workflows/*.yml` still reference `core/page-script/`; `ci/workflows/*` are the cleaned copies (HANDOFF, Part 11).
13. Accessibility of the app UI itself, RTL, small screens, landscape, Hindi / Bengali glyphs, dark theme on a real phone.

## Known limitations

- Redaction and sensitive-word detection are heuristics (SECURITY.md, gaps 2-3).
- The optional Linux tier (`full` flavor: proot + Alpine) is still in the repository but has no screen that uses it; it was never executed.
- Payments / wallet apps, Gmail, SMS, WhatsApp and other private chat, authenticators, password managers, Settings, Play Store and Google account screens are blocked on purpose, not missing.
- Scheduled tasks and macros notify; you tap Run. They do not start by themselves, so every confirmation has a person to answer it.
- Binaries committed on purpose: `android/gradle/wrapper/gradle-wrapper.jar` (standard Gradle wrapper), `android/app/src/full/jniLibs/arm64-v8a/*.so` and the Alpine rootfs tarball (pinned, checksummed, licensed; see SOURCE-OFFER.md).

## Reproduce the "no extras" claims

```sh
grep -rniE "analytics|telemetry|crashlytics|sentry|firebase|admob|google-services" --include=*.{ts,tsx,kt,gradle,json,xml,cjs} . --exclude-dir=node_modules --exclude-dir=build | grep -v package-lock
grep -rn "addJavascriptInterface\|AgentWebView" android/app/src   # expect: nothing
grep -n "uses-permission" android/app/src/main/AndroidManifest.xml   # expect: no contacts, SMS, camera, mic, location, QUERY_ALL_PACKAGES
```
