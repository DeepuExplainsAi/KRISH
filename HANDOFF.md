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
| 3 | UI: live window, chat, prompts, all screens | DONE; **restyled 2026-10-26 (see session log)**; builds; store tested; layout + touch drag/resize checked in headless Chrome at 467x922; real phone untested |
| 4 | History, Lite mode, memory, Projects, Tasks, morning brief | DONE |
| 5 | Desktop (Electron) | DONE; RUN under Xvfb: 12-check smoke test passes. Not run: safeStorage keychain, file dialogs, file upload via debugger, Docker tier |
| 6a | Tier 0 sandbox | DONE; tested in Node AND the built worker ran in real Chrome (6*7=42, infinite loop interrupted at 5 s, no fetch/XHR/WebSocket/importScripts) |
| 6b | Tier 1 Alpine+proot | WRITTEN; checksums verified; proot never executed (needs an arm64 Android device) |
| 7 | WebGPU local mode | DONE behind build flag KRISH_LOCAL_MODEL=1; never loaded |
| docs | README, BUILD, SECURITY, CREDITS, CHECKLIST, SOURCE-OFFER, LICENSES | DONE |

## Verified (actually run)
CHECKLIST.md is authoritative. Counts as of 2026-10-26: core 121, ui 21, desktop 8 unit tests; desktop smoke 12 checks; typecheck, lint, UI build, `cap sync`, `compileLiteDebugKotlin` + `compileFullDebugKotlin` all clean.

## Session log: Hark-style restyle, language, adjustable browser card (2026-10-26)
Owner request: new look like hark.com (video + screenshots in the todo), same features, browser card adjustable, answer in the user's language, many UI languages. **No feature was removed.** All old screens still exist.
What changed (UI + one prompt line; core logic, policy gate and security rules untouched):
1. **Look** (`ui/src/styles.css`, rewritten): sky gradient background, frosted-glass cards, black pills, round buttons. Lite mode keeps working: no blur/animation, glass becomes a solid fill. Safe-area padding line kept.
2. **Navigation** (`App.tsx`, new `screens/Menu.tsx`): top bar = **New chat (+)**, tabs Home / Chat / Projects, avatar (K) -> Menu. Menu lists Providers, Panels, Scheduled tasks, Settings, History, Security. Sub-screens have a Back-to-Menu button. STOP and the status pill show only while not idle.
3. **New chat** (`store.newChat`): clears the thread and goes to Chat; ignored while a run is active (STOP first). History keeps old runs. Test added.
4. **Steps** (`components/ChipPill.tsx`): spinner / check / warning icons. The latest running step is a black pill.
5. **Cards** (`components/Prompts.tsx`): confirm / question / secure input / take-over as glass cards with an X close button and "Secured by Krish". Same behaviour: the secure value goes only to the page.
6. **Browser card** (`components/LiveWindow.tsx`): header has close, title, size buttons S / M / L / XL, minimize. Footer = status pill with the current step (or "Action required" when the user must act), expand/shrink button (cycles medium -> large -> full -> medium), Take over / Resume, STOP. Still draggable (header) and resizable (corner handle, two-finger pinch). Size is clamped so the card never hangs off screen; leaving full restores the old position. It opens automatically when a run starts (Settings: "Show the browser card when the agent starts working", default on). It still collapses to a pill while confirm/question/secure cards are open (security rule, verified).
7. **Languages** (`ui/src/i18n/`): English, Hindi, Bengali, Spanish, French, German, Portuguese; Settings -> Language, default Auto (device language). Missing keys fall back to English. **Every screen is wired to `t()`**, but only English and Hindi have the full set of strings (~140 keys, a test enforces Hindi is complete). Bengali/Spanish/French/German/Portuguese cover navigation, chat, cards and the browser card (~50 keys); their inner-screen text (Settings, Providers, Tasks, Security...) shows English until someone adds the keys. **Next step: translate the missing keys for those five** (copy the `// screens` block from `hi.ts`). To add a language: new `xx.ts` (`Partial<Dict>`) + one line in `index.ts` (`DICTS` and `LANG_NAMES`). A test checks keys and `{placeholders}`.
8. **Agent replies in the user's language** (`core/src/agent/prompt.ts`, `loop.ts`): the system prompt tells the model to answer in the language and script of the latest USER_TASK/USER_REPLY (Hinglish typed in Latin letters gets Hinglish). The model now fills `thought` (<= 60 chars) on every action; it is shown as the step label (redacted, display only; the policy gate never reads it). **Secure-input steps always keep the fixed label "Action required"** so a page-influenced model cannot dress up a password prompt. Tests added.
9. **Bug found while testing in Chrome:** `scrollIntoView` returns a Promise in current Chrome/WebViews; `useEffect(() => el.scrollIntoView())` returned it as the cleanup function and crashed the whole UI on the first chat message ("destroy_ is not a function"). Fixed with braces in `Chat.tsx`. Never write an effect as an arrow that returns a call's result; use a block body.
10. Resize handle moved 6 px inside the card: at the very corner, touches hit the chat underneath and the browser cancelled the gesture.
11. **Independent review, fixed:** (a) The "normal question may not collect a secret" guard was English-only; with answers now in the user's language it covers password/OTP/PIN/card terms in all 7 languages (Unicode-aware regex in `loop.ts`; test with Hindi, Bengali, Spanish, French, German, Portuguese, Hinglish). Still a heuristic: the real protection is the secure card on the actual field. (b) Model-written step labels are only shown for steps that run without approval (`verdict: allow`); a step that confirms, asks or is blocked keeps the app's own wording. Control/bidi/zero-width characters are stripped from labels. (c) Browser card minimum size raised to 260x170 (header + footer + usable page); native bounds are exactly the `.view` box, and if it is smaller than 40 px the native view is hidden instead of enlarged. (d) New chat remounts the composer so an unsent draft does not follow. (e) Inner screens (Home, Settings, Providers, Projects, Tasks, Panels, History, Security) and accessibility labels now use `t()`.
Not verified: real phone touch (only CDP touch events in headless Chrome); Android/desktop native view positioning under the new card layout (same `.view` box logic as before); Hindi/Bengali font rendering on the device. Providers, Projects, Tasks, Panels and History only got the new colors, no layout rework.

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
- UI screenshots in the sandbox: `/opt/agent-browser/chrome/chrome` needs `--headless=new --no-sandbox --disable-gpu --js-flags=--jitless` (V8 CodeRange OOM otherwise) and a 1 GB swapfile. The `agent-browser` CLI is bound to the user's embedded browser and cannot reach sandbox `localhost`; drive Chrome over CDP directly (touch via `Input.dispatchTouchEvent`). Never run `eslint` over a built `dist*` folder (OOM).
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
