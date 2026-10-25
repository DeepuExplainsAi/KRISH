# Checklist: what was verified, and what was not

Legend: **RUN** = executed in the build environment with the result observed. **STATIC** = checked by reading output/config. **NOT RUN** = never executed; may be wrong.

## Verified (RUN)

| Area | How | Result (2026-10-25) |
|---|---|---|
| Core logic: provider adapters, fallback (429 + Retry-After, 5xx, timeout, network, invalid JSON, schema-invalid), circuit breaker, daily counter, sensitive-page gating, abort, keys-in-headers, **fetch that ignores AbortSignal, hung error body, body-read reset** | `npm test -w core` (mocked providers) | pass |
| Live model refresh: Gemini filter + pagination, OpenAI-compatible `/models`, `free` only when provider says so, failed refresh keeps cache, auto-fetch exactly once | same | pass |
| Strict action schema (allowlist, https only, no creds, extra props) | same | pass |
| Redaction (cookies, tokens, JWTs, key shapes, cards with Luhn, OTP phrases, secret fields) | same | pass |
| Agent loop: confirm-before-send, secure-input flow (value never reaches model/history), CAPTCHA take-over, off-site and consent confirmations, upload confirm, injection fencing, STOP, Take over/Resume, step limit, stuck handling | same | pass |
| Memory, history, projects, panels, scheduler math, opt-in brief, **concurrent writes keep every entry, reads see queued writes** | same | pass |
| Page script (observe, type/fill with native setter, click, highlight, stale ids, spoof resistance) | jsdom | pass |
| App store flows with a fake platform, Lite mode default on low-RAM | `npm test -w ui` | pass |
| Tier 0 sandbox: zip, unzip, zip-slip, zip bomb, stored-entry size lie, QuickJS script, no host globals, infinite loop, memory cap, print/output limits | `npm test -w ui` (Node, real QuickJS WASM) | pass |
| Desktop helper logic (https check, fetch validation, expression quoting, secret store, docker flags) | `npm test -w desktop` | pass |
| **Real Electron 45 main process + preload + WebContentsView**: layout toggle with and without a page (used to segfault), http/file/unknown-channel refusals, fetch refusals, isolated-world observe/read, stale-fingerprint refusal, snapshot, clear site data. Page's own JS sees no `K` | `npm run smoke -w desktop` under Xvfb (12 checks); also confirmed it crashes on the old code | 12/12 pass |
| **Tier 0 worker in real Chrome** (built bundle): script result, infinite loop interrupted at 5 s, `fetch`/`XMLHttpRequest`/`WebSocket`/`importScripts` undefined | agent-browser | pass |
| **UI layout in real Chrome at 467x922**: nav at the bottom, live window drag writes storage once per drag (0 during, 1 on release or on `pointercancel`; a second pointer and stray moves after cancel are ignored) | agent-browser | pass |
| TypeScript strict type-check, ESLint | `npm run typecheck`, `npm run lint` | clean |
| UI production build (default and with `KRISH_LOCAL_MODEL=1`) | `npm run build:ui` | builds; local model code absent from default bundle |
| Kotlin sources compile for both flavors (Gradle 8.14.3, AGP 8.13.0, Kotlin 2.4.21, JDK 21, SDK 36); re-run 2026-10-25 | `./gradlew compileLiteDebugKotlin compileFullDebugKotlin` | BUILD SUCCESSFUL |
| `cap sync android`; Alpine rootfs and proot `.so` SHA-256 match `SHA256SUMS`; repo scan: no secrets, `eval`, telemetry, `addJavascriptInterface` | shell | clean |
| `TarGz.kt` extracts the real Alpine rootfs identically to GNU tar (83 files, 335 symlinks, contents equal) | kotlinc + diff | identical |
| Independent review of the safety rules (static) and fixes | 12 findings; 11 fixed in code with tests that fail on the old code (policy, loop, page script, sandbox limits, keyring check, upload binding, layout). #1 is partly open on Android (see SECURITY.md gaps 0, 0b) | fixed as described |
| Merged manifest permissions | inspected merged manifests | only INTERNET and POST_NOTIFICATIONS (WorkManager extras removed) |

## NOT RUN: needs a real device or display (please test)

1. **Everything on an Android device.** The APK was not installed or launched.
2. Agent WebView on Android: loading sites, `evaluateJavascript` round trip, element highlight, live-window positioning under the UI (native `setBounds` margins), drag/pinch/resize feel, Mini snapshot mode, safe-area insets with Capacitor's SystemBars.
3. File upload into a web page (real tap + `onShowFileChooser` answer): the riskiest mechanism; some sites may reject it.
4. Android Keystore plugin (`KrishSecurePlugin`): encrypt/decrypt round trip.
5. WorkManager notifications (`DueWorker`) and the POST_NOTIFICATIONS opt-in on Android 13+.
6. **Tier 1 (proot + Alpine) has never been executed.** Android may block executing the bundled binaries on some OS builds (the code reports this and Tier 0 keeps working).
7. Electron on real hardware: `safeStorage` keychain (refuses to store without a keyring, as designed; verified only that it refuses), file dialogs, `debugger.setFileInputFiles` upload, Docker tier. (Main process, preload, `WebContentsView`, layout emulation and isolated world are RUN, see above.)
8. Real provider calls (no keys were used). Request shapes follow public API docs and mocks only; confirm Gemini and each OpenAI-compatible host.
9. Optional WebGPU model (`KRISH_LOCAL_MODEL=1`): never loaded; needs a WebGPU-capable device.
10. Tier 0 Worker inside the Android WebView and Electron (it ran in desktop Chrome; the memory-cap path was not exercised in a browser).
11. `ci/workflows/*.yml` were never executed by GitHub (the push token lacked `workflow` scope).
12. Accessibility, RTL, small screens, landscape.

## Review findings that are only partly addressed

- Android has no isolated JavaScript world: the page script shares the page's JS realm (SECURITY.md gap 0). Desktop uses an isolated world.
- Network-level enforcement of "stay on the opened site" is not possible with `shouldOverrideUrlLoading`; the policy asks before acting on a page that left the approved site (gap 0b).
- Layout fix (native view bounds from the real `.view` box, collapse while prompts are open) and the Android upload binding are code-reviewed only.

## Known limitations

- Tier 1 cannot disable network (proot). Mitigated by mandatory confirmation. See SECURITY.md.
- Redaction and sensitive-page detection are heuristics.
- `phone-control/` is an empty stub (phase 2).
- Payments/wallet, Google OAuth email/Drive, cloud background execution and password saving are out of scope and not present.
- Scheduled tasks notify; they do not run unattended.
- Binaries committed on purpose: `android/gradle/wrapper/gradle-wrapper.jar` (standard Gradle wrapper), `android/app/src/full/jniLibs/arm64-v8a/*.so` and the Alpine rootfs tarball (pinned, checksummed, licensed; see `SOURCE-OFFER.md`).

## Reproduce the "no extras" claims

```sh
grep -rniE "analytics|telemetry|crashlytics|sentry|firebase|admob|google-services" --include=*.{ts,tsx,kt,gradle,json,xml,cjs} . --exclude-dir=node_modules --exclude-dir=build | grep -v package-lock
grep -rn "addJavascriptInterface" android/app/src   # expect: only the comment in AgentWebView.kt
```
