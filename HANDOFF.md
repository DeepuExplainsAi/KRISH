# HANDOFF — read this first

Project: KRISH, source-only personal agent (Android + desktop). Spec: `docs/SPEC.md`.
Rule: update this file at the end of every work session (status table + "Next").

## RELEASE RUN — DONE 2026-10-24 (v0.1.0 published)
Followed `docs/AI-RELEASE-PROMPT.md`. Release: https://github.com/DeepuExplainsAi/KRISH/releases/tag/v0.1.0 (pre-release).
Next AI: the release task is finished. Remaining work is the device testing below and the older "Still open" list. To cut another release: `git tag v0.1.1 && git push origin v0.1.1`.

| # | Step | State |
|---|---|---|
| 1 | `gh` token has `workflow` scope | DONE (owner ran `gh auth refresh -h github.com -s workflow`) |
| 2 | Workflows in `.github/workflows/`; `check` green incl. both Kotlin flavors (`openExternal` compiles) | DONE: https://github.com/DeepuExplainsAi/KRISH/actions/runs/40338496897 |
| 3 | `.github/workflows/release.yml` + `.github/release-notes.md` | DONE |
| 4 | Fix loop | Nothing needed fixing in app code; only change: `android-actions/setup-android` (third party) replaced by the runner's preinstalled SDK + `sdkmanager "platforms;android-36" "build-tools;36.0.0"` |
| 5 | Verify artifacts | DONE, see below |
| 6 | README Download section, BUILD.md section 5 | DONE |
| 7 | Tag v0.1.0 -> release run | DONE: https://github.com/DeepuExplainsAi/KRISH/actions/runs/40339247503 (android, desktop linux, desktop win32, publish all green) |

Runs: check 40338496897, build-apk 40338795116, build-desktop 40338801195, release 40339247503.

### Session log (release run)
- Decisions: `.github/workflows/` is what runs; `ci/workflows/` stays as a copy of check/build-apk/build-desktop (keep in sync or delete). `release.yml` exists only in `.github/workflows/`. Release is a pre-release; `/releases/latest` ignores pre-releases, so README links to `/releases` and to the `v0.1.0` asset URLs (update those when you tag a new version).
- Release files (sizes): lite APK 5,170,602 B; full APK 9,346,270 B; Windows zip 158,839,156 B; Linux tar.gz 124,450,536 B. SHA256 in `SHA256SUMS.txt` on the release page; `sha256sum -c` passed on the downloaded files.
- **Verified (run):** both APKs are valid zips with `AndroidManifest.xml` and `classes.dex`; applicationId `app.krish.agent.lite` (no native libs) and `app.krish.agent` (arm64-v8a libs only); minSdk 26, target 36; both `debuggable=true` (debug builds). Windows zip has `Krish.exe` and `resources/app.asar`; Linux tar has an executable `Krish` and `resources/app.asar`. Inside both asars: `package.json`, `desktop/{main,lib,preload}.cjs`, `ui/dist/index.html`, `core/page-script/krish-page.js` (packager makes `app.asar`, not a `resources/app/` folder). The Linux build was started under `xvfb-run` with `--no-sandbox --disable-gpu --disable-dev-shm-usage --js-flags=--jitless` and was still running after 25 s (killed by timeout), no missing-file error, only dbus warnings (no desktop bus in the sandbox). Without `--js-flags=--jitless` it dies with the sandbox's V8 CodeRange OOM (environment limit, see Gotchas).
- **NOT verified:** installing or running the APKs on any device or emulator; running `Krish.exe` on Windows; the Linux build on a real desktop or with the app window rendered; everything in the "NOT verified" lists in the session logs below.
- Release notes (`.github/release-notes.md`) say plainly: unsigned debug builds, not tested on real devices, known gaps.

## Environment notes
- Cloud sandbox: Node 24, ~480 MB RAM, 1 CPU, ~2 GB free disk. JDK 21 and the Android SDK are NOT preinstalled; install them to /opt/jdk and /opt/android-sdk (see "Restart here"). Electron runs under `xvfb-run`.
- typescript pinned 6.0.3 because typescript-eslint 8.72 does not support TS 7.

## Status
| Step | Scope | State |
|---|---|---|
| 1 | Core: providers, fallback, model refresh, action schema, redaction | DONE, tested |
| 1b | Core: agent loop, policy gate, memory, history, projects, panels, scheduler, brief | DONE, tested |
| 2 | Android plugins (WebView, files, Keystore, WorkManager), flavors, manifest | DONE; Kotlin compiles (both flavors, re-run 2026-10-25); never run on a device |
| 3 | UI: live window, chat (file attach), prompts, all screens | DONE; **restyled 2026-10-26, desktop layout + KrishVault + API Keys catalog 2026-10-27 (see session logs)**; builds; store tested; layout + touch drag/resize checked in headless Chrome at 467x922; real phone untested |
| 4 | History, Lite mode, memory, Projects, Tasks, morning brief | DONE |
| 4b | KrishVault (encrypted logins + autofill), memory by chat, one-task-at-a-time rules, Auto theme, PC layout, API Keys catalog | DONE 2026-10-27; tested; Kotlin `openExternal` compiles (CI `check` green 2026-10-24) |
| 5 | Desktop (Electron) | DONE; RUN under Xvfb: 12-check smoke test passes. Not run: safeStorage keychain, file dialogs, file upload via debugger, Docker tier |
| 6a | Tier 0 sandbox | DONE; tested in Node AND the built worker ran in real Chrome (6*7=42, infinite loop interrupted at 5 s, no fetch/XHR/WebSocket/importScripts) |
| 6b | Tier 1 Alpine+proot | WRITTEN; checksums verified; proot never executed (needs an arm64 Android device) |
| 7 | WebGPU local mode | DONE behind build flag KRISH_LOCAL_MODEL=1; never loaded |
| docs | README, BUILD, SECURITY, CREDITS, CHECKLIST, SOURCE-OFFER, LICENSES | DONE |

## Verified (actually run)
CHECKLIST.md is authoritative. Counts as of 2026-10-27: core 167, ui 32, desktop 8 unit tests; desktop smoke 12 checks; typecheck, lint, UI build, `cap sync`, `compileLiteDebugKotlin` + `compileFullDebugKotlin` all clean.

## Session log: KrishVault, memory by chat, Auto theme, PC layout, API Keys catalog (2026-10-27)
Owner (Hinglish): the whole project is the owner's. Build the HANDOFF plan and the new asks; **keep every old feature**; the screenshots were only a *layout reference for PC*, do not copy anything else from them; the app is called **Krish** and its UI/code must never say "Hark" (the inspiration is explained only in the MD files: this file, `docs/SPEC.md`, `CREDITS.md`).
No old feature was removed. Phone layout is unchanged except one new Menu entry (KrishVault).

### What was built
1. **KrishVault** (`core/src/vault/vault.ts`, `ui/src/screens/Vault.tsx`, Menu -> KrishVault). Saved logins (site, name, username, password, notes).
   - Crypto: master passphrase -> PBKDF2-SHA256 (600k iterations) -> AES-256-GCM, fresh IV on every save, stored through the platform `KeyStore` (Android Keystore / OS keychain), so it is encrypted twice. Passphrase is never stored; no recovery (only "erase"). Locks after 15 min idle (only unlock/add/remove/autofill extend it, listing does not), on Lock now, and on dispose.
   - Lifecycle (hardened after review): all writes go through one queue (no lost updates, erase always wins); the in-memory list changes only after storage succeeded; `lock()`/`erase()` bump a session counter so an unlock or save that was still running cannot bring the vault back; a vault that fails to load is `unreadable` and can never be "created over". The unlocked UI is a separate component, so half-typed passwords are dropped on lock.
   - Autofill (`autofillLogin` in `core/src/agent/loop.ts`): on a login form, only if the page is on the site the run started on, the saved login is for the same registrable site (look-alike hosts get nothing), and the user's task asks to log in (`LOGIN_INTENT`) or the agent itself navigated there. Max 3 offers per run, one per origin+path (a page that rewrites its query cannot loop it). Vault locked -> master-passphrase secure card. Then a confirm card "Fill your saved login on <host>?" (name + username, never the password). After the OK the page is observed again and the credentials are read from the vault only then: if the vault was locked, the form is gone or the site differs, nothing is filled. The app fills natively (`driver.fillSecret`); the model only reads "the saved username and password were filled".
   - Echo protection: every value the app typed for the user (vault login or secure card) goes into a per-run set and is replaced by `[REDACTED]` in everything sent to the model (prompt, read results), and screenshots are not sent after that. Tested with a page that echoes the username and password.
   - **Known limit (be honest with the owner):** a hostile page can still transform a value (encode, split, reverse) before showing it, and the scrub only catches exact copies. The fill is also not bound to a native document token (the native fill gets an element id + fingerprint, not the approved origin); a native `fill(origin, token)` check on Android/Electron is the right next hardening. Not done: auto-submit, a picker for several accounts per site (the first is used; the card says "N more saved"), import/export, biometric unlock (Android BiometricPrompt), TOTP.
2. **Memory by chat.** New actions `memory_add {text}` and `memory_remove {ids:["m1",...]}`. MEMORY is shown to the model numbered m1, m2... (fixed per step, so "m2" is always the line it read). **Every** change shows a confirm card with the exact text ("Remember this?" / "Forget this?") before it is applied; an earlier version skipped the card when the task contained words like "remember", and an independent review showed that is not real authorization (briefs and project text match it, and one match would allow every change in the run), so it was removed. Unknown ids remove nothing. Text is redacted before saving. "Update" = remove + add (two cards). Policy keeps both actions "allow"; the loop does the confirming because only it knows the text. Memory is global plus the active project's (unchanged); the Home list still works and shows chat changes.
3. **Less hallucination / no old-task bleed.** Prompt (`core/src/agent/prompt.ts`): work only on the latest USER_TASK; earlier chats, tasks and MEMORY are background, never tasks; never guess or invent; say "done" only when a page/result shows it; report declined steps honestly. Model temperature 0.2 -> 0 (both adapters). Honest limit: this is prompt + determinism + strict action checks, it cannot guarantee zero hallucination; a model can still misread a page.
4. **Theme default = Auto** (`DEFAULT_SETTINGS.theme = "system"`, label "Auto (follows device)"). `settings.version` + `migrateSettings`: an old saved "light" (the previous default, indistinguishable from a choice) moves to Auto once; anything chosen later is kept. The look of Auto is the existing light/dark look.
5. **PC layout** (`styles.css` `@media (min-width: 900px)`, `App.tsx`, `store.ts` `WIDE`/`APP_MAX`/`firstWindow`). Content is centered in a column of at most 1240 px; a left sidebar (same entries as the phone Menu, `MENU_GROUPS`); screens max 860 px, chat 780 px (500 px while the browser card is open); the browser card starts docked at the right edge of the column (440x400); back button and avatar are hidden on wide screens (sidebar replaces them); `large` preset is 62% of the width. Below 900 px nothing changed. While the browser card is open on a wide screen, screens narrow to `100% - 464px` so the card never covers content (`.app.has-window`).
6. **API Keys catalog** (the plan below, now built): `DEFAULTS.presets` has `keyUrl` + `free` for 10 providers (Gemini, Groq, OpenRouter, OpenCode Zen, Cerebras, Mistral, GitHub Models, NVIDIA NIM, Hugging Face, SambaNova). `Providers.tsx`: rows with letter icon, Free badge, "Get key" (opens the provider's page in the user's own browser via new `platform.system.openExternal(url)`: Android `ACTION_VIEW`, desktop `shell.openExternal`, both https-only), key field, "Add and load models"; Custom form; bottom pills All / Free / Added / Custom; 2 columns on PC, 1 on phone. Existing provider cards (order = fallback, enable, allow-sensitive, cap, replace key, refresh/pick models, usage) are unchanged.
7. **Naming.** Removed the only "Hark" in the app code (a CSS comment). It now appears only in MD docs.
8. **Dev screenshot harness** (`ui/harness/`, `ui/harness.html`, `ui/vite.harness.ts`; not in the product build; output dir ignored by git and eslint). `cd ui && npx vite build -c vite.harness.ts && (cd dist-harness && python3 -m http.server 8089 &)` then `node ui/harness/shoot.mjs <outDir> ui/harness/shots.mjs` (needs the Chrome flags below; `THEMES=light` for one theme; ~4 min for 2 devices x 2 themes). It runs the real UI with a scripted fake model and a fake `site.test` login page, so the flows (vault autofill, memory add/update/forget, declined unasked memory write) run end to end. Phone = 467x922 @2x, PC = 1280x800.

### Proof images
`docs/proof/` has contact sheets (phone 467x922 and PC 1280x800, light and dark, screens + flows): `phone-*-1-screens.jpg`, `phone-*-2-flows.jpg`, `pc-*-1-screens.jpg`, `pc-*-2-flows.jpg`. These come from the dev harness (web platform, scripted fake model, fake login page), **not from a real device**: they prove layout and flow logic, not Android WebView / Electron behaviour.

### Verified (run)
- `npm run typecheck`, `npm run lint`, `npm test`: core 167 (+37: vault crypto/lock/IV/site match/erase/concurrent saves/erase-vs-save/unlock-vs-lock/failed save/unreadable/idle timer, autofill confirm/decline/locked/wrong passphrase/other site/unrelated task/echoing page/page changed/locked during confirm/URL-rewriting page, memory add/remove/unknown id/always-confirm/redaction, prompt rules), ui 32 (+4: Auto default, migration, window dock, vault in store + autofill through the store), desktop 8.
- Headless Chrome screenshots, phone + PC, light + dark, every screen and every flow above; flow checks printed by the harness: autofill filled `["deepu","S3cret-pw"]` and the password was in no model prompt; memory saved -> updated -> forgotten, each behind a confirm card; a declined memory write left memory empty.
### NOT verified
- `KrishSystemPlugin.openExternal` (Kotlin) was **not compiled** (no JDK/SDK in the sandbox this session). It is 8 lines (`Intent.ACTION_VIEW`, https-only). Run the Gradle line in "Restart here" first.
- Desktop `system:openExternal` and the vault on real Electron `safeStorage` / real Android Keystore (the web platform's key store is in memory, dev only). On Linux desktop without a keyring the vault refuses to be created (same rule as API keys).
- Real login on a real site; real models obeying the new prompt rules.
### Ideas for the next AI (owner asked for "everything", these are not built)
- **Google / WhatsApp / Facebook / Instagram "connections":** today the user logs in inside the built-in browser (persisted cookies) and the vault autofills when a session ends. Real API connections (Gmail/Drive OAuth etc.) need a registered OAuth client and token storage; SPEC says no hosted backend, so decide with the owner first (device-flow or user-supplied client id), then store tokens in the same `KeyStore`.
- Vault: several accounts per site picker, biometric unlock, auto-submit option, breach/weak-password hints, TOTP, import/export (encrypted file).
- Tasks/Subscriptions/Policies as panels: reuse `Panels` + `Scheduler`; a "subscriptions" panel template (name, renewal date, amount, reminder via `scheduleDue`) is the smallest start.
- Desktop window default is still 1100x760; consider remembering the window size.

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

## Session log: dark theme + full-app screenshot check (2026-10-26, later)
Owner asked: show every screen of the whole app on phone and PC, say what works, add a dark mode that can follow the system, check for errors. No feature changed.
1. **Theme setting** (`Settings.theme`: `system` | `light` | `dark`, default `system` at that time, now `light`; Settings -> Theme). `ui/src/theme.ts` `resolveTheme()` (tested). `App.tsx` sets `<html data-theme>` and listens to `prefers-color-scheme`, so System follows the device live.
2. **CSS** (`styles.css`): all hard-coded colors became variables (`--strong`/`--on-strong` replace `--black`, plus `--surface`, `--field`, `--field-pre`, `--user-bubble`, `--bar`, `--live-bg`, `--handle`, `--shadow`). `:root[data-theme="dark"]` overrides them (deep navy sky like the owner's Hark chat screenshot, glass cards, white active pill). Light values are unchanged. New colors go into the variables, never hard-coded.
3. **i18n:** keys `theme`, `themeSystem`, `themeLight`, `themeDark` in all 7 languages.
4. **Checked in headless Chrome** (phone 467x922 @2x and PC 1280x800; light and dark; 15 screens each: Home, Menu, Providers, Projects, Panels, Tasks, History (closed/open), Settings (top/bottom), Security, Chat empty / working with browser card / done / secure input card): no JS exceptions, no console errors, no horizontal overflow, explicit theme overrides the device and "System" restores it. Only noise: the harness server's `/favicon.ico` 404.
5. **Tests:** core 121, ui 22 (+1), desktop 8; typecheck, lint, UI build clean.
Not done: Android system bars and the Electron window background still use the light native theme (CHECKLIST 14). Inner screens still have the old layout, only restyled.
Screenshot harness (not committed; see `.git/info/exclude`): `ui/harness.html`, `ui/src/harness.tsx`, `ui/vite.harness.ts` build a fake-platform UI with a scripted model. The runner drove Chrome over CDP with `Emulation.setEmulatedMedia` for dark. Needs a 1 GB swapfile in the 480 MB sandbox.

## Session log: file attach, glass STOP, default Light (2026-10-26, latest)
Owner asked: (a) a file-attach button in the chat composer for any file type (video, audio, image, screenshot, zip...) so the agent can take the file into a site, (b) STOP not red but the same light glass as the top menu buttons, (c) default theme Light, (d) everything written here.
1. **Attach button** (paperclip, left of the globe in the composer, `Chat.tsx`). Opens the system picker via the existing `platform.files.pick()` (Android `ACTION_OPEN_DOCUMENT */*`, Electron `showOpenDialog`), so any type works and no storage permission is added. Up to `MAX_ATTACHMENTS` = 10. Chips above the composer show name + size with an x; the sent message shows the same chips. `store.attach()`, `store.detach(token)`, `State.attachments`; `newChat()` clears them; `send()` takes them, clears the tray and passes `files` to `runAgent`. Names are cleaned with `cleanLabel` (exported from `core/src/agent/loop.ts`). The button is disabled while a run is active.
2. **How the agent uses them** (core, no new capability, same gate): `runAgent({files})` adds a `<USER_FILES>` block with one line per file: `f1: name (size bytes)`. No token, no bytes, no path. Names are cleaned (control chars, `<`/`>` removed, `redactText`, 120 chars), so a file name cannot open or close a fence or leak a secret. Action `upload_selected_file {elementId, file?}`: `file` must match `/^f\d{1,2}$/` (the id, never the name). One attached file needs no id; several and no/unknown id -> nothing is uploaded, the result lists the valid ids so the model retries. With no attached files the old behaviour is kept: the picker opens mid-run. **The confirm card "Upload to <host>?" with file name + size still appears for every upload, and declining uploads nothing.**
3. **Hidden file inputs.** Most sites hide `<input type=file>` behind a button or dropzone, and the page script skipped invisible elements, so the agent could not target them. `krish-page.js` now lists up to 5 hidden file inputs (cap so a page cannot crowd real fields out of the 200-element budget) with `hidden:true` and the parent's text as label; `format.ts` prints `hidden-input`. `rect()` (Android tap) taps only a real `<label>` of the input; with none it throws "ask the user to take over" instead of tapping an unrelated parent. Desktop attaches the file through CDP `DOM.setFileInputFiles` and needs no tap.
4. **STOP** is now glass like `.round`/`.seg` (`--glass`, `--glass-line`, `--blur`, text `--ink`; no red anywhere), in the status bar and the live-window footer, light and dark. Lite mode uses `--glass-solid`.
5. **Default theme = `light`** (`DEFAULT_SETTINGS.theme`). A saved choice is never overridden. Settings still offers System / Light / Dark. (The line "default `system`" in the previous session log is outdated.)
6. **i18n:** `attachFile`, `attachments`, `removeFile` in all 7 languages.
7. **Checked:** tests core 130 (+9: attached files in the prompt, upload by id, one file needs no name, several files without a name, declined confirm, hostile file name, hidden file input, format), ui 28 (+6: attach/detach/new chat, picker cancel + limit, late picker result dropped, composer-only attachments, send passes files and clears tray, default theme). An independent review found and these fixes were applied: select by id not name, redaction of names, hidden-input cap and label-only tap, picker race after New chat, tasks/panels/brief never consume the composer tray (`send(cmd, {files})`, only Chat passes them). Typecheck, lint, UI build clean. Headless Chrome (phone 467x922 and PC 1280x800, light and dark): empty composer, 3 chips, typed, running with confirm card "Upload to www.instagram.com? receipt.png (218000 bytes)", done thread; no JS exceptions; STOP computed style is the glass colour; default `data-theme` is `light` even when the device prefers dark. The harness `files.pick` returns 3 fake files (`ui/src/harness.tsx`, not committed).
**NOT verified (needs a device):** the real picker on Android and Electron; the real upload into a real site (CHECKLIST 15); large files; hidden-input tap on Android.
**Known, left as is:** `send()` clears the tray before history/memory loading (a failure there loses the draft; `history.log` sits outside the try/finally, as before). Sensitive-page detection still works on the capped 200-element list (as before).
**Not built, ideas for the next AI:**
- The model cannot read an attached file's content (by design: names and sizes only). To "work with" a file beyond uploading (resize an image, extract a zip, transcribe audio) it must go through `run_sandbox_task`, which only sees files added with Sandbox -> Add file (`store.addSandboxFile`). Next step: offer an "also make available to the sandbox" option on an attachment, or auto-add attachments to Tier 0 when small (`Tier0Sandbox.addFile`, size limit in `sandbox/tasks.ts`), plus a confirm.
- Drag-and-drop and paste of screenshots into the composer on desktop (needs a `files.fromBlob` on the platform; today only the system picker is used so that paths and tokens stay native).
- Image thumbnails in the chips; progress and size limit warnings (the page decides the real limit).
- `web.ts` platform has no picker (`pick` returns undefined), so attach does nothing in the plain browser build.

## API Keys screen + "Get key" links (planned 2026-10-26, BUILT 2026-10-27, see the log above)
**Status: built as planned. The table below is the source of the catalog data. Owner will say what else to change per screen.**
Owner wants (Hinglish, paraphrased):
1. A screen for adding provider API keys. Each provider has a direct "Get key" link that opens that provider's key-creation page. Many free providers (OpenCode Zen, OpenRouter, Gemini, ...), then a **Custom** entry (name + base URL + key).
2. Same design on PC and mobile. PC = wider (2-column grid), mobile = vertical single column, like other AI apps.
3. Bottom pill tabs like the Hark Logins screenshot: All / Free / Added / Custom (black active pill, frosted list above).
4. Keep all existing features. Existing `screens/Providers.tsx` logic (order = fallback, enable, allow-sensitive, daily cap, key replace, refresh/pick models, usage) stays; the new screen is a restyle plus a catalog.
5. Owner will list per-screen changes later. Keep writing them here.

Mockup: one row per provider = letter icon, name, "Free" badge, limits line, `Get key` button. Tapping a row expands: black pill "Open <key page>", password field, "Add & load models". Custom row = name + base URL (https only) + key.

Catalog to add (extend `DEFAULTS.presets` in `core/src/config/defaults.ts` with `keyUrl` and `free` text; show in `Providers.tsx`). URLs checked with curl on 2026-10-26 (HTTP status after redirects; login redirects are normal). Free limits are from awesome-free-llm-apis (verified Mar 2026), may have changed: show them as "approx" and never promise them.
| Provider | keyUrl | baseUrl | kind | Notes |
|---|---|---|---|---|
| OpenCode Zen | https://opencode.ai/auth | https://opencode.ai/zen/v1 | openai-compat | `/models` works without a key (200). Free models marked "free for a limited time"; some free models log prompts / train: say so in the UI. Some models use the Anthropic/Responses/Gemini endpoints, not chat completions: only chat-completions models work with kind openai-compat, so filter the list. |
| OpenRouter | https://openrouter.ai/keys | https://openrouter.ai/api/v1 | openai-compat | `:free` model ids; about 20/min, 200/day |
| Google Gemini | https://aistudio.google.com/apikey | existing preset | gemini | free tier not in EU/UK/CH |
| Groq | https://console.groq.com/keys | existing | openai-compat | about 30/min, 14,400/day |
| Cerebras | https://cloud.cerebras.ai/ | existing | openai-compat | about 30/min; models list answers 403 without key |
| Mistral | https://console.mistral.ai/api-keys | existing | openai-compat | about 1 req/s |
| GitHub Models | https://github.com/settings/tokens | existing (models.github.ai/inference) | openai-compat | needs a PAT with models scope |
| NVIDIA NIM | https://build.nvidia.com/ | https://integrate.api.nvidia.com/v1 | openai-compat | `/models` 200 |
| Hugging Face | https://huggingface.co/settings/tokens | https://router.huggingface.co/v1 | openai-compat | `/models` 200; about $0.10 free credit per month. The older api-inference.huggingface.co URL from the list was NOT used. |
| SambaNova | https://cloud.sambanova.ai/apis | https://api.sambanova.ai/v1 | openai-compat | `/models` 200 |
Left out on purpose: Requesty (key page 404), Cloudflare Workers AI and Cohere (not OpenAI-compatible), keyless/pay-per-IP services. Could not check from the sandbox (blocked/403): platform.openai.com, console.x.ai, Cloudflare dashboard.

Opening "Get key": use an external browser (Android: `Intent.ACTION_VIEW` via a Capacitor plugin; desktop: `shell.openExternal` with an https allow-list). Do NOT load it in the agent's WebView (the agent window must not see the user's login). Check what the app already exposes before adding a new bridge; it must stay https-only.
Never put a key in a URL, log, or the model prompt (unchanged rule).

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
