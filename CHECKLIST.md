# Checklist: what was verified, and what was not

Legend: **RUN** = executed in the build environment with the result observed. **STATIC** = checked by reading output/config. **NOT RUN** = never executed; may be wrong.

## Verified (RUN)

| Area | How | Result (2026-10-25) |
|---|---|---|
| Core logic: provider adapters, fallback (429 + Retry-After, 5xx, timeout, network, invalid JSON, schema-invalid), circuit breaker, daily counter, sensitive-page gating, abort, keys-in-headers, **fetch that ignores AbortSignal, hung error body, body-read reset** | `npm test -w core` (mocked providers) | pass |
| Live model refresh: Gemini filter + pagination, OpenAI-compatible `/models`, `free` only when provider says so, failed refresh keeps cache, auto-fetch exactly once | same | pass |
| Strict action schema (allowlist, https only, no creds, extra props) | same | pass |
| Redaction (cookies, tokens, JWTs, key shapes, cards with Luhn, OTP phrases, secret fields) | same | pass |
| Agent loop: no confirmation cards, secure-input flow (value never reaches model/history), CAPTCHA card, saved-login autofill and auto-submit, injection fencing, STOP, step limit, stuck handling | same | pass |
| Memory, history, projects, panels, scheduler math, opt-in brief, **concurrent writes keep every entry, reads see queued writes** | same | pass |
| Page script (observe, type/fill with native setter, click, highlight, stale ids, spoof resistance) | jsdom | pass |
| App store flows with a fake platform, Lite mode default on low-RAM | `npm test -w ui` | pass |
| Tier 0 sandbox: zip, unzip, zip-slip, zip bomb, stored-entry size lie, QuickJS script, no host globals, infinite loop, memory cap, print/output limits | `npm test -w ui` (Node, real QuickJS WASM) | pass |
| Desktop helper logic (https check, fetch validation, expression quoting, secret store, docker flags) | `npm test -w desktop` | pass |
| **Real Electron 45 main process + preload + WebContentsView**: layout toggle with and without a page (used to segfault), http/file/unknown-channel refusals, fetch refusals, isolated-world observe/read, stale-fingerprint refusal, snapshot, clear site data. Page's own JS sees no `K` | `npm run smoke -w desktop` under Xvfb (12 checks); also confirmed it crashes on the old code | 12/12 pass |
| **Login persistence on desktop** (Electron, `persist:krish-agent` partition): app closed and reopened with the same profile. Cookies with an expiry ("remember me") and localStorage survived; session cookies (no expiry) did not, as in any browser | manual script under Xvfb | as described |
| **Tier 0 worker in real Chrome** (built bundle): script result, infinite loop interrupted at 5 s, `fetch`/`XMLHttpRequest`/`WebSocket`/`importScripts` undefined | agent-browser | pass |
| **UI layout in real Chrome at 467x922**: nav at the bottom, live window drag writes storage once per drag (0 during, 1 on release or on `pointercancel`; a second pointer and stray moves after cancel are ignored) | agent-browser | pass |
| **Restyled UI in headless Chrome at 467x922 (2026-10-26)**: chat, secure card, confirm-to-pill collapse, browser card sizes S/M/L/XL/expand (stays on screen, restores position after full), real touch drag + corner resize, Menu, Hindi switch, Lite mode, New chat | CDP script (harness not committed) | pass; found and fixed a UI crash and a dead resize handle |
| **KrishVault, memory by chat, Auto theme, PC layout, API Keys catalog (2026-10-27)** | `npm test` (core 167, ui 32) + headless-Chrome flow harness `ui/harness` on phone 467x922 and PC 1280x800, light + dark | pass; vault autofill never put the password in a prompt; memory add/update/forget works; every memory change needs a confirm card |
| TypeScript strict type-check, ESLint | `npm run typecheck`, `npm run lint` | clean |
| UI production build (default and with `KRISH_LOCAL_MODEL=1`) | `npm run build:ui` | builds; local model code absent from default bundle |
| Kotlin sources compile for both flavors (Gradle 8.14.3, AGP 8.13.0, Kotlin 2.4.21, JDK 21, SDK 36); re-run 2026-10-25 | `./gradlew compileLiteDebugKotlin compileFullDebugKotlin` | BUILD SUCCESSFUL |
| `cap sync android`; Alpine rootfs and proot `.so` SHA-256 match `SHA256SUMS`; repo scan: no secrets, `eval`, telemetry, `addJavascriptInterface` | shell | clean |
| `TarGz.kt` extracts the real Alpine rootfs identically to GNU tar (83 files, 335 symlinks, contents equal) | kotlinc + diff | identical |
| Independent review of the safety rules (static) and fixes | 12 findings; 11 fixed in code with tests that fail on the old code (policy, loop, page script, sandbox limits, keyring check, upload binding, layout). #1 is partly open on Android (see SECURITY.md gaps 0, 0b) | fixed as described |
| Merged manifest permissions | inspected merged manifests | only INTERNET and POST_NOTIFICATIONS (WorkManager extras removed) |

## NOT RUN: needs a real device or display (please test)
- **(new 2026-10-27)** Kotlin `KrishSystemPlugin.openExternal` not compiled; vault on real Android Keystore / Electron safeStorage; "Get key" opening the real browser; vault autofill on a real login page.

1. **Everything on an Android device.** The APK was not installed or launched.
2. Agent WebView on Android (including: login survives closing and reopening the app; `CookieManager.flush()` was added in `onPageFinished` and NOT recompiled after the change, the JDK was gone): loading sites, `evaluateJavascript` round trip, element highlight, live-window positioning under the UI (native `setBounds` margins), drag/pinch/resize feel, Mini snapshot mode, safe-area insets with Capacitor's SystemBars.
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
13. New UI on a real phone: touch drag/resize of the browser card, native browser view lining up with the card's `.view` box, Hindi/Bengali glyphs, long labels.
14. Dark theme on a real phone and in the Electron window: Settings -> Theme (System / Light / Dark). Checked only in headless Chrome with an emulated `prefers-color-scheme`. Not checked: the native browser view's own page colors (a web page stays light), Android status/navigation bar colors (`AppTheme` is still the light parent), Electron window background flash before the UI loads.
15. File attach on a real phone and in Electron: paperclip -> pick a video, an image, a zip -> chip shows -> send -> agent asks upload on a site with a file input (also one whose input is hidden behind a button, e.g. a drag-and-drop area) -> confirm card shows the name -> the site really receives the file. Check Android: `PickedFiles.arm` + tap on the label of a hidden input; Electron: `DOM.setFileInputFiles`. Also try a large file (hundreds of MB) and picking several files.

## Review findings that are only partly addressed

- Android has no isolated JavaScript world: the page script shares the page's JS realm (SECURITY.md gap 0). Desktop uses an isolated world.
- Network-level enforcement of "stay on the opened site" is not possible with `shouldOverrideUrlLoading`; the policy asks before acting on a page that left the approved site (gap 0b).
- Layout fix (native view bounds from the real `.view` box, collapse while prompts are open) and the Android upload binding are code-reviewed only.

## Known limitations

- Tier 1 cannot disable network (proot). See SECURITY.md.
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
