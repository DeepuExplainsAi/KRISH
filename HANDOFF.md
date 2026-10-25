# HANDOFF — read this first

Project: KRISH, source-only personal agent (Android + desktop). Spec: `docs/SPEC.md`.
Rule: update this file at the end of every work session (status table + "Next").

## Environment notes
- Cloud sandbox: Node 24, ~480 MB RAM, 1 CPU, ~2 GB free disk. JDK 21 and the Android SDK are NOT preinstalled; install them to /opt/jdk and /opt/android-sdk (see "Restart here"). Electron runs under `xvfb-run`.
- typescript pinned 6.0.3 because typescript-eslint 8.72 does not support TS 7.

## Status
| Step | Scope | State |
|---|---|---|
| 1 | Core: providers, fallback, model refresh, action schema, redaction | DONE, tested |
| 1b | Core: agent loop, policy gate, memory, history, projects, panels, scheduler, brief | DONE, tested |
| 2 | Android plugins (WebView, files, Keystore, WorkManager), flavors, manifest | DONE; Kotlin compiles (both flavors, re-run 2026-10-25); never run on a device |
| 3 | UI: live window, chat, prompts, all screens | DONE; builds; store tested; layout checked in real Chrome at 467x922; touch on a phone untested |
| 4 | History, Lite mode, memory, Projects, Tasks, morning brief | DONE |
| 5 | Desktop (Electron) | DONE; RUN under Xvfb: 12-check smoke test passes. Not run: safeStorage keychain, file dialogs, file upload via debugger, Docker tier |
| 6a | Tier 0 sandbox | DONE; tested in Node AND the built worker ran in real Chrome (6*7=42, infinite loop interrupted at 5 s, no fetch/XHR/WebSocket/importScripts) |
| 6b | Tier 1 Alpine+proot | WRITTEN; checksums verified; proot never executed (needs an arm64 Android device) |
| 7 | WebGPU local mode | DONE behind build flag KRISH_LOCAL_MODEL=1; never loaded |
| docs | README, BUILD, SECURITY, CREDITS, CHECKLIST, SOURCE-OFFER, LICENSES | DONE |

## Verified (actually run)
CHECKLIST.md is authoritative. Counts as of 2026-10-25: core 116, ui 14, desktop 8 unit tests; desktop smoke 12 checks; typecheck, lint, UI build, `cap sync`, `compileLiteDebugKotlin` + `compileFullDebugKotlin` all clean.

## Session log: audit and fixes (2026-10-25)
Re-checked the previous work against the spec by running it, not by reading the old notes. Found and fixed:
1. **Desktop app crashed at launch (segfault).** `applyBounds()` enabled/disabled device emulation on a `WebContentsView` that had no page yet. Now applied only once a page is loaded and after each load (`applyEmulation`). The old code never ran in Electron, so this was never seen.
2. **Desktop page automation threw `executeJavaScriptInIsolatedWorld is not a function`.** It lives on `webContents`, not `mainFrame`. Every observe/read/click/type call was broken. Fixed.
3. **Desktop snapshot failed with `UnknownVizError`** right after a reload or layout change. `capture()` retries 4 times, 400 ms apart.
4. **Lost History/Memory/Task entries.** `Collection` did async read-modify-write with no ordering, so concurrent `history.log` calls overwrote each other (the agent logs chips and actions without awaiting). Writes are now queued. Test fails on old code.
5. **Provider hang ignored timeout and STOP.** Capacitor's native POST bridge ignores `AbortSignal`, so a hung provider blocked fallback and STOP forever. `core/src/providers/http.ts` now races the request against the timeout and the abort. Two tests fail on old code.
6. **App layout: bottom nav sat mid-screen** in a real browser (grid rows vs `main`). Now a flex column with safe-area padding (`--safe-area-inset-*` from Capacitor, `env()` fallback).
7. **Live window jank on low-end devices.** Drag/resize/pinch wrote the whole settings JSON to storage and called the native `setBounds` on every move event. Now: storage written once on release, native bounds once per animation frame. Measured: 0 writes during a 30-move drag, 1 on release.
8. **Resize handle overlapped the STOP button.** Footer now keeps a right gap.
9. **Lite mode is on by default on low-RAM devices** (a saved user choice still wins). Test added.
10. **History cap 5000 -> 2000** (every write rewrites the list; 5000 entries is ~2 MB).
11. **Independent review round (found 4, all fixed, each with a test that fails on the earlier code):** (a) an error response whose body hung was reported as `auth`, not timeout/abort; (b) `Collection.all()` could overtake queued writes, so the History screen could miss entries; reads now go through the same queue (internal `read()` is used inside jobs to avoid self-deadlock); (c) `pointercancel` left drag/resize listeners installed and the last rect unsaved: one `gesture()` finalizer handles up, cancel and unmount and tracks the initiating pointer id (verified in real Chrome); (d) a connection reset while reading a 200 body was classified `bad_json`; only `SyntaxError` is now.
12. **Docs:** test counts were stale; `docs/SPEC.md` now holds the full spec; CREDITS wording; Playwright deviation and the `npm audit` result are documented in DEPENDENCIES.md; new `desktop/smoke.cjs` (`npm run smoke -w desktop`).

Checked and fine: no secrets/eval/telemetry/addJavascriptInterface in the repo; Alpine and proot checksums match; manifest permissions; CSP; `.gitignore`.

## Still open (cannot be done in the cloud sandbox)
- Run the APK on a real Android device and work through CHECKLIST.md "NOT RUN" (1-6, 8, 9, 12). Highest risk first: file upload tap, Keystore round trip, proot execution, live-window position under the UI.
- Desktop on real hardware: safeStorage keychain, file dialogs, `debugger.setFileInputFiles` upload, Docker tier.
- Real provider calls with real keys (request shapes follow public docs and mocks only).
- Move `ci/workflows/*.yml` to `.github/workflows/`: the available git token has no `workflow` scope. Copy command is in BUILD.md section 5.
- Android has no isolated JS world and no network-level site allowlist (SECURITY.md gaps 0, 0b): platform limits, mitigated by policy.
- `npm audit`: 3 moderate, dev-only (`@capacitor/cli` -> `xcode` -> `uuid`); see DEPENDENCIES.md.
- Phase 2 `phone-control/` is a stub by design.

## Gotchas
- Shell is `sh`: no brace expansion, no `<(...)`, no `time`.
- git push: run `gh auth setup-git` once, then `GIT_TERMINAL_PROMPT=0 git push origin main`. Without it git waits for a password.
- Set git identity per repo (`user.name` / `user.email`) before committing.
- QuickJS `setMemoryLimit` does not bound growth reliably -> wasm Memory.grow cap in sandbox/tasks.ts (capWasmMemory).
- Sandbox RAM is ~480 MB: do not run Chrome, Gradle and Electron at once, and no big allocations. Add a 1 GB swapfile before Gradle. Background `mcporter` processes can eat ~250 MB for a minute.
- `agent-browser` eval: pass the script with `"$(cat file.js)"`; very long output is truncated, so write results to `document.title` or a file and read that.
- Electron under Xvfb needs `--no-sandbox --disable-gpu --disable-dev-shm-usage`.

## Restart here
```sh
npm ci && npm run typecheck && npm run lint && npm test      # ~1 min
npm run build:ui && npx cap sync android
npm run smoke -w desktop                                      # needs xvfb + network; downloads Electron once: (cd node_modules/electron && node install.js)
```
Android compile in the sandbox (about 10 min cold, 1 GB swap first, ~1.5 GB disk):
```sh
# JDK 21:  https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse -> /opt/jdk
# SDK:     cmdline-tools 11076708 -> /opt/android-sdk; sdkmanager "platforms;android-36" "build-tools;36.0.0"
cd android && echo "sdk.dir=/opt/android-sdk" > local.properties
JAVA_HOME=/opt/jdk ./gradlew --no-daemon -Dorg.gradle.jvmargs=-Xmx380m compileLiteDebugKotlin compileFullDebugKotlin
```
`local.properties`, `build/` and `.gradle/` are git-ignored. Then read CHECKLIST.md and pick from "Still open" above.
