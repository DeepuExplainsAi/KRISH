# HANDOFF — read this first

Project: KRISH, source-only personal agent (Android + desktop). Spec: `docs/SPEC.md`.
Rule: update this file at the end of every work session (status table + "Next"). Layout backup and restore: `LAYOUT-RESTORE.md`.

## ROUND 13 (2026-10-30): redirect policy, foreground lease and compact-prompt preparation

- Redirects: `LocalDownloadPolicy.kt` allows HTTPS with default/443 port only for `huggingface.co` or a host ending `.hf.co`. Rejects credentials, fragments, unrelated domains, cleartext and other ports. Redirect cap, isolated no-cookie OkHttp client, exact size and SHA-256 checks stay unchanged. `LocalDownloadPolicyTest.kt` contains JUnit allow/deny cases but was not run locally (no JDK/SDK); existing CI compiles Kotlin, not unit tests.
- Downloads now acquire a unique lease on `KeepAliveService` before starting; the agent has its own lease. Finishing one will not stop the other. Downloads use a process-wide worker and continue when an activity is destroyed; pause/cancel still cancel the request. If starting the service is refused the download fails cleanly instead of running unprotected. The service is not a restartable transfer manager: Android can kill the process or end the DATA_SYNC service, e.g. its Android 15 time limit; partial files require manual resume. The plugin instance may be retained until the worker finishes. Changes: `KrishLocalPlugin.kt`, `LocalDownloadPolicy.kt`, `KeepAliveService.kt`, `KrishSystemPlugin.kt`, and new test.
- Phase 2 preparation only: `AgentOptions.compactPrompt` starts the existing page/history/chat size scaling at 1/4; the normal redaction and fence pipeline is unchanged. `core/test/agent/loop.test.ts` checks compactness and redaction. Nothing calls this option yet; native engine integration must set it when local is preferred.
- Run locally: `npm run typecheck`, `npm run lint`, `npm test` (290 core, 54 UI, 10 desktop) and `npm run build:ui`, all pass. CI JS and both-flavor Kotlin compile passed on 3a40d94 (before the compact-prompt-only changes). **NOT RUN** on phone: install, real downloads and CDN redirects, pause/resume/cancel, service coexistence with agent, screen-off/background, low storage, integrity failure, battery/heat, RAM kills with WebView open. Kotlin policy unit tests not run.
- **Phase 2 is incomplete**: no llama.cpp/JNI/NDK build, grammar, chat template, memory safety, native LocalEngine, local-first router or backup toggle. Compact prompt support exists but is not connected. Do not tell the owner it works offline. Next: get Kotlin CI green; run JUnit + Android download/foreground lifecycle tests, then implement Phase 2 and all its safety checks before enabling the online-backup toggle. Phone download test after installing this draft APK: connect Wi-Fi, Settings → On-device model → download 2B; pause/resume, lock screen, reopen and check progress; avoid data charges. This does not test inference.

## ROUND 12 (2026-10-30): Android downloader — still draft / not offline-ready (redirect and service details superseded by Round 13)

- Shared pinned metadata moved to `core/model-catalog/local-models.json`, bundled as an Android asset; `core/src/local/catalog.ts` imports it. `KrishLocalPlugin` registered in common `MainActivity` for both flavors. Implements RAM/free space/metered info, one background-thread download, Range resume, pause/cancel, app-private partial files, SHA-256 and length checks, install/list/delete and progress events. Reserves remaining bytes plus 15% of full size. File names include the expected hash. Only exact allowed HTTPS hosts accepted on manual redirects: huggingface.co plus Hugging Face CDN `cas-bridge.xethub.hf.co`, `us.aws.cdn.hf.co`; no cookies/auth. Unknown hosts fail closed. This slightly extends the original huggingface.co-only constraint because the weight downloads redirect to storage infrastructure; actual redirects remain unverified.
- `ui/src/platform/{types,capacitor,desktop,web}.ts`: Android bridge and typed unsupported web/desktop; UI store listens to progress, keeps selection and consent. Settings offers download/pause/resume/cancel/delete, recommendation, oversized warning, Wi-Fi/metered warnings and consent (en/hi). Selection is only a saved preference: no local inference exists. Backup checkbox is visibly disabled and online routing/API Keys remain unchanged to avoid breaking the app before Phase 2.
- Verified locally: typecheck, lint, tests (core 289, UI 54, desktop 10) and build:ui. UI fake tests simulate progress, checksum mismatch, storage-low and selection/delete, not native networking. CI `android-compile` and `js` passed on 982762e (both Kotlin flavors; no JDK/SDK locally), including the activity-recreation locking fix. This is not a completed Phase 1.
- NOT RUN: APK installation, real downloads, redirect hosts, Android Range resume, checksum mismatch deletion, storage exhaustion, native plugin lifecycle, phone RAM, speed, RAM kills with WebView open, battery/heat. **Phase 2 not built.** No offline inference, no functional API-backup toggle, no provider screen hiding, no JNI, grammar or NDK CI.
- **Next:** run native downloader tests with a mock HTTPS server and security tests, then test on real phone (Wi-Fi download, pause/restart/resume, checksum mismatch and delete). Only after Phase 1 is green, implement pinned llama.cpp/JNI, strict action grammar, reasoning off via model template, memory/background safety, prompt sizing and local routing before enabling API-backup toggle. Test actual offline inference: download 2B, turn off Wi-Fi and online backup, ask “open example.com and tell me the title” (the website itself needs network). Do not bypass redaction/fencing.

## ROUND 11 (2026-10-30): local-model catalog preview — INCOMPLETE (superseded by Round 12)

- Built only a read-only catalog and RAM-tier picker. `core/src/local/catalog.ts` pins Unsloth Qwen3.5 Q4_K_M file names, revisions, exact bytes and SHA-256s from the Hugging Face tree API (0.8B `6ab461498e2023f6e3c1baea90a8f0fe38ab64d0`, 2B `1c466474d208da1a7c4b8cb87ebcdac78f160e34`, 4B `e87f176479d0855a907a41277aca2f8ee7a09523`, 9B `3885219b6810b007914f3a7950a8d1b469d598a5`). RAM thresholds are 3584 / 7168 / 11264 MiB; unknown RAM has no recommendation. The RAM fields are advisory, not hard limits.
- Settings shows an explicitly unavailable preview, the existing Android `KrishSystem.deviceInfo` total RAM, and the first three models; 9B is under More models. No downloads or inference exist. No provider or WebGPU code was changed. Files: catalog + core index + catalog tests; `ui/src/{state/store.ts,screens/Settings.tsx,i18n/en.ts,i18n/hi.ts}`, `ui/test/store.test.ts`; docs.
- Verified locally: npm ci, typecheck, lint, tests (core 289, UI 52, desktop 10), build:ui; headless Chromium web-demo screenshot at 390x844. This did not test real Android RAM or a phone. npm ci reports 3 moderate audit findings, not investigated here.
- NOT BUILT: remaining Phase 1 (native downloader, progress, pause/resume, verification, storage/network checks, consent, install/delete/select, API-backup toggle and UI state/tests), all Phase 2 (JNI llama.cpp, grammar, template, lifecycle/memory safety, router integration and CI). Do not present this branch as offline-ready. No download, real APK install/inference, speed, WebView RAM kill, battery/heat, or Android build run.
- **Next:** finish Phase 1 following the platform method checklist, and test all failure paths before enabling downloads. Hugging Face may redirect weight downloads to another host; reconcile the requested strict host pin with real redirects safely, without accepting arbitrary hosts or forwarding cookies/auth. Make checksum validation mandatory. Then implement Phase 2 separately with the existing redaction/fence pipeline, and actually test on phone. Only once ready: install APK, download Qwen3.5 2B, disable online backup, ask “open example.com and tell me the title”; measure memory with a WebView open, speed, heat and battery.

## ROUND 10 (2026-10-29): several tabs, email-code sign-up, app-made passwords (branch `round10-multitab-signup`)

Owner (Hinglish): "temporary Gmail se is site pe signup/login kar do, phir yahan jao, ye kaam karo" - the agent should do a multi-site job step by step, like the reference agent. READ THIS BEFORE TOUCHING TABS, `read_code`, `sign_up` OR THE SIGN-IN CARD.

**Supersedes Round 8 section 5 ("Temp-mail ... no") and Round 9 section 3 (first bullet).** Temporary inboxes are now allowed, but only as an inbox the USER names (their own Gmail, or a temp-inbox site they name: smailpro.com, emailnator.com, 22.do ...), with these limits kept in code and prompt: ONE account per site per user command; if a site refuses the email ("temporary emails not supported", "already in use", "use a different email") the agent STOPS and asks, it never cycles to a new address or inbox; CAPTCHA / Cloudflare / "verify you are human" are never solved or bypassed (the Done card stays: the user taps once); never pay. "Second real browser tab: not built" (Round 8) is also superseded: it is built below.

### 1. Tabs (max 4)
- `PageDriver` (core/src/agent/ports.ts) has `tabs()`, `openTab(url)`, `switchTab(id)`, `closeTab(id)`, `readCode(tabId, hint)`. Every other page method works on the ACTIVE tab. `TabInfo {id, title, url, active}`; ids are small integers (1, 2, ...), never reused in a session.
- New strict actions (core/src/schema/actions.ts): `open_tab {url}` (https only), `switch_tab {tabId}`, `close_tab {tabId}`. The loop refuses an unknown tab id ("no tab N; use an id from TABS") and a 5th tab (`MAX_TABS` = 4 in loop.ts, also enforced natively). With more than one tab the prompt gets a fenced `TABS` block (titles/urls are untrusted data, `TABS` added to the fence regex). `open_tab` on a run with no page makes the page live like `navigate`.
- UI: `BrowserHost` (ui/src/platform/types.ts) has `tabs/openTab/switchTab/closeTab/findCode`, `MAX_TABS`; `PageEvent.tabId`. Store keeps `state.tabs`, `openTabAndWait` (same load wait as `openAndWait`), `switchTab` for the chips. `LiveWindow` shows tab chips (only when >1 tab); tapping one switches the active tab (the agent reads it next step).
- Android `KrishBrowserPlugin.kt`: `LinkedHashMap<Int, AgentWebView>` + `activeId`; each tab has its own `TabListener` (only the active tab sends `page` events, tagged `tabId`; file-chooser answers go only to the active tab). Inactive tabs are `INVISIBLE`, alpha 0.01, not touchable. `setBounds`/`setDesktopLayout`/`stopLoading`/`clearSiteData` apply to all tabs. New `@PluginMethod`s: `tabs`, `openTab`, `switchTab`, `closeTab`, `findCode`. Closing the last tab is refused.
- Electron `desktop/main.cjs`: `views` Map of `WebContentsView` (same hardened session/partition, isolated world, https-only, popup rules); `activate(id)`; `call(expr, wc)` takes the tab's webContents. New IPC: `browser:tabs`, `browser:openTab`, `browser:switchTab`, `browser:closeTab`, `browser:findCode` (also in `preload.cjs` CHANNELS). `lib.tabId()` validates ids, `lib.expr.findCode()` quotes hints. Page links that open a new window still load in the SAME tab (only the agent opens tabs).
- Platform method checklist followed (Round 8 section 6): types.ts + capacitor.ts + desktop.ts + web.ts (fake tabs) + Kotlin + preload CHANNELS + main.cjs handle + `ui/test/store.test.ts` setup mock.

### 2. Email code (OTP) flow - `read_code` / `fill_code`
- `read_code {tabId, from?, subject?}`: the app runs the page script's `K.findCode(from, subject)` in that tab (core/page-script/krish-page.js): message blocks (`tr, li, article, role=row/listitem/article, class*=message/mail/inbox/letter ...`, innermost, document order = newest first) plus same-origin iframes (opened message), filtered by the hint; a 4-8 digit number next to a code word (code/otp/verif/confirm/pin/कोड...), years, times (10:45), dates and decimals skipped; "code:7391" counts. No code -> first https link whose text/href says verify/confirm/activate/magic/token.
- **The code never reaches a model.** It is kept in the loop (`foundCode`), added to the scrub set (`remember`), and only `fill_code {elementId}` puts it into a field via native fill; the model hears "a verification code was found (not visible to you)". A found LINK is opened by the app itself in the inbox tab (switch + navigate) and the URL is scrubbed from all prompts (the model never sees the token).
- Masking: on a mail/inbox host (`isInboxUrl`: host contains mail/inbox, or smailpro/emailnator/22.do/yopmail/outlook/proton...) or a tab `read_code` was used on, every free-standing 4-8 digit number in page text, element text and `read` results is `[REDACTED:otp]` (`maskCodes(text, true)`), so an OTP in a mail is hidden even before `read_code`. With 2+ tabs, numbers within 120 chars of a code word are masked on every page. Numbers joined to letters/`@` (an address like `abc123456@tmpbox`) are left alone so the address can be copied. Screenshots are dropped while masking is on.
- `read_code` max 8 per run (then the model is told to ask the user).

### 3. Sign-up with an app-made password - `sign_up`
- `sign_up {passwordElementId, confirmElementId?, email?}`. The loop checks the field(s) are password fields, shows the sign-in card in **sign-up mode** (`LoginRequest.signUp`, `email`; `SignUpCard` in Prompts.tsx: "Create an account on <site>?", email editable, "Create and save"; answer `{signUp: true, username}`). Only after that: `generatePassword(passwordRules(pageText))` (core/src/agent/signup.ts: default 14 chars, upper+lower+digit + exactly one "!"; reads "at least N", "N-M characters", "maximum N", "no special characters"; crypto RNG, no modulo bias), native fill into password + confirm, `vault.put({site, username, password})`. The model gets only "a password was made ... (not visible to you)". Closing the card = nothing filled, nothing saved.
- Note: the brief said "existing confirm card"; there is none since Round 6 (confirm cards removed). The sign-in card got a sign-up mode instead; no new prompt type.

### 4. Policy (code, not only prompt) - core/src/agent/loop.ts
- One account per site per command: `signedUp` set; a second `sign_up` on the same registrable site is refused.
- Refused email (`REJECTED_EMAIL` / `rejectionText` in signup.ts): on a site where an email was entered in this run (model typed into an email field, or `sign_up`), a page that says the address is refused makes the loop ask the user directly ("I will not try other addresses by myself. What should I do?"); empty answer = run ends `failed`. If the model calls `sign_up` on such a page, it is refused and typing another address into an email field on that site is BLOCKED until the user answers an `ask_user`. A rejection text on a site with no email entered (an FAQ page) is ignored.
- CAPTCHA unchanged (secure kind `captcha` -> Done card). Prompt: never solve/bypass, never pay, never pick a temp-mail site the user did not name, plan + one step at a time, `note` for non-secret values between tabs, never note a password or code.

### 5. Files
core: `schema/actions.ts`, `agent/{ports,loop,prompt}.ts`, `agent/signup.ts` (new), `privacy/redact.ts` (`maskCodes`), `index.ts`, `page-script/krish-page.js` (`findCode`); tests `test/agent/round10.test.ts` (new), `test/page/inbox.test.ts` (new), `test/agent/loop.test.ts` (fake driver). ui: `platform/{types,capacitor,desktop,web}.ts`, `state/store.ts`, `components/{LiveWindow,Prompts}.tsx`, `styles.css` (`.tab-chips`), `i18n/{en,hi}.ts` (signUpTo, signUpBody, signUpCreate, tabs), `test/store.test.ts`. android: `KrishBrowserPlugin.kt`. desktop: `main.cjs`, `preload.cjs`, `lib.cjs`, `test/lib.test.ts`. docs: this file, CHECKLIST.md, SECURITY.md.

### 6. Verified / not verified
- Verified: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` (core 277, ui 51, desktop 10), `npm run build:ui`. New tests: schema accept/reject (no code/password fields allowed in actions), tab routing in the loop, TABS block, 5th tab refused, unknown tab, read_code -> fill_code with the code in no prompt/event, link opened by the app with its token hidden, read of an inbox masked, sign_up fills password+confirm and saves to the vault with the password in no prompt, declined card, one account per site, non-password field refused, refused email stops (empty answer) / continues (answer) / blocks a second address, FAQ text ignored, password rules, inbox hosts, `findCode` on sample inbox HTML in jsdom (newest row, hint, link, unsubscribe ignored, same-origin iframe, years/times/address digits ignored), store: tab chips + sign-up card + vault, desktop: findCode quoting and tab id validation.
- CI on commit a80e616: `js` and `android-compile` (Kotlin, both flavors) green.
- NOT verified: anything on a phone or real Electron (several WebViews/WebContentsViews at once, memory with 4 tabs on a low-RAM phone, which view gets touches, `bringToFront` order over the app UI), `findCode` on the real smailpro / emailnator / 22.do / Gmail markup (only sample HTML; Gmail's reader is not a same-origin iframe in all views, and cross-origin message frames cannot be read at all), whether real sites accept the generated password, real models following the new prompt.
- Next AI: test on the phone: "smailpro.com kholo, us address se example site pe signup karo, code daalo". If `read_code` says "not found" on a real inbox, open the message first (click it) and add that inbox's markup as a jsdom sample in `core/test/page/inbox.test.ts` before changing `findCode`. Do not let the code or the password into `PAGE_DATA`/`RESULT_DATA`/events. Do not add address cycling, CAPTCHA solving or more than one account per site per command.

## ROUND 9 (2026-10-29): providers shown red for no reason, Groq 413, one message = many requests, clicks that did nothing (v0.1.13)

Owner (Hinglish): "providers all red, 'daily limit used up' / 'model not usable (HTTP 413)'; it keeps writing 'waiting for AI' and sends too many requests; buttons cannot be clicked; make it work on any device like Hark (screen recording); never run into limits or errors; find every problem that can come up later; handoff and upload." READ THIS BEFORE TOUCHING `providers/http.ts`, `router.ts`, `loop.ts` prompt building or `krish-page.js`.

### 1. Root causes found in the owner's screenshots, and the fix
- **"daily limit used up" on Gemini, OpenCode Zen and OpenRouter was a false alarm.** `classifyStatus` called any 429 whose text had "daily / per day / RPD / TPD" a spent quota. Gemini's 429 text lists EVERY quota of the project ("...PerDay...") even when only the per-minute one was hit. The mark was saved to disk for 3 h, so all three stayed red after restarts. Now `limitInfo(body)` (http.ts) reads the structure first: Gemini `details[].violations[].quotaId` (`...PerDay...` = day, `...PerMinute...` = minute) and `retryDelay`; Groq/others "try again in 7m12.5s"; OpenRouter `metadata.headers["X-RateLimit-Reset"]`. A real daily quota is skipped only until the provider's own reset time (min 60 s, max 3 h). The old marks are ignored: kv key renamed `spent:` -> `spent2:`.
- **Groq "HTTP 413" = the request was bigger than the free tokens-per-minute limit** (page text 8000 chars + 120 elements + 16 history turns, where an old `read` result could be 20 000 chars). New `ProviderErrorKind` `too_large` (413, or 400/422 "context length / request too large"). It is NOT a provider failure: no cooldown, no red mark, `tooBigAt[provider|model]` remembers the size, the next provider answers, and the loop halves page, history and chat (`size` 1 -> 1/2 -> 1/4 -> 1/8, kept for the rest of the run) and sends again at once ("Sending a shorter request"). Older step results are cut to `olderResultChars` (500); only the newest keeps `readMaxChars`.
- **One message cost 2-3 requests.** (a) JSON mode was tried first at EVERY step and a 400 cost a second request: `firstWorking()` remembers per provider+model which variant works (openaiCompat 2 variants, Gemini 3). (b) A schema-invalid reply was retried on the same model with the same prompt at temperature 0 (same answer): new kind `bad_output`, not retried on the same model. (c) `probeModels` sent 3 parallel requests per batch, up to 9: now one at a time, stops at the first that works; a rejected key / dead connection stops at once, a quota or outage after two models in a row (a per-model quota must not hide the model that works).
- **Old "Gone: ..." lines** (OpenCode Zen "test", OpenRouter "o4-mini ...") are the model-list diff (`modelsChanged`), not an error. They stay until the list changes again.

### 2. Clicks (core/page-script/krish-page.js, desktop/main.cjs, desktop/lib.cjs)
- `observe()` now also lists: elements with `onclick` / `tabindex`, `div|span|li|img|svg|i|p` with `cursor:pointer` (outermost only, not when it holds a real control, max 60), and controls inside OPEN shadow roots (depth 4). `labelFor` looks in the control's own root (a shadow-root password field keeps its "Password" label, so it stays redacted).
- `rect()` throws "covered by another element" when `elementFromPoint` at the centre is not the element or inside it; the Android plugin then falls back to the script click (it already did on any `rect` failure). Cookie banners and overlays no longer swallow a tap silently.
- Desktop `browser:click` now sends a REAL mouse event (`sendInputEvent`) when the view is live and the page is shown 1:1; hidden view or scaled PC layout -> script click as before (the mapping through Electron device emulation is NOT verified, so it is not guessed). `window.open` / `target=_blank` GET links open in the same view (one tab); popup POSTs stay refused.
- Pointer arrives in 340 ms (`pointerMs`, glide .32 s): smoother, still visible.

### 3. Asked for, NOT built (same reasons as Round 8)
- Hark's temp-mail + OTP sign-up loop on third-party sites (many accounts for free quotas, bypassing bot checks): not built. Use the sign-in card with the owner's own account. **(Superseded by Round 10: a user-named inbox with one account per site, stop on refused email, no CAPTCHA bypass.)**
- "Install Playwright or Node": not needed. The agent drives the real WebView (Android) / WebContentsView (Electron) through the page script; Playwright would be a second browser the app does not ship. Windows runs the same Electron build.
- Groq "two kinds" (transcribe vs chat): the picker already hides whisper/tts etc. from chat (`NOT_CHAT`); there is no speech-to-text feature in the app yet. If one is added, give it its own model slot, never the agent's.

### 4. Verified / not verified
- Verified: `npm run typecheck`, `npm run lint`, `npm test` (core 244, ui 50, desktop 10). New tests: Gemini PerMinute vs PerDay, Groq TPM vs TPD, OpenRouter reset header, 413, too-large size memory per model, shorter prompt sent at once and kept, old read result cut, JSON-mode variant memory, probe stop rules, shadow DOM / div buttons / covered check / label in jsdom.
- NOT verified: anything in a real browser. The sandbox this round had 482 MB RAM and Electron and Chromium both crashed at start, so real mouse clicks, shadow DOM on real sites, Gemini/Groq/OpenRouter real 429 bodies (formats taken from their docs) and Android are untested. Test on the phone first.
- Next AI: do not widen the daily-limit regex again; add a body sample to `router.test.ts` first. Do not retry a `bad_output` on the same model. Do not send a prompt bigger than `tooBigAt` allows.

## ROUND 8 (2026-10-28/29): one provider at a time, task queue, background run, PC layout fix, retry-then-another-way (v0.1.12)

Owner (Hinglish, frustrated): "multiple models in one provider make no sense: use my provider/model until its WHOLE daily quota is spent, then the next provider, built-in free last; OpenCode first, then OpenRouter, Groq, Gemini...";
"the AI cannot even respond"; "window is cut off at the bottom, make a PC look that works on phone and PC"; "retry login/click 3-4 times, then another method, then ask"; "let me give 6-7 tasks and leave, run them in the background";
"tell the AI about my interface/device"; "keep a backup so the old web-view layout can be restored"; "write everything in HANDOFF so the next AI knows". READ THIS SECTION BEFORE CHANGING PROVIDERS, THE QUEUE OR THE CARD.

### 1. Providers (core/src/providers/*, ui/src/state/store.ts `routerProviders`)
- **One model per provider.** `fallbackModel` and `MAX_MODELS_PER_PROVIDER` are gone. `pickModels` returns only `{ defaultModel }`. `probeModels` probes the ranked list and keeps the FIRST model that answers `{"ok":true}`. A model the user picked by hand (`modelsChosen`) is kept while the provider still lists it.
- **Order = the order of the user's list** (`insertByPreset` puts OpenCode Zen, OpenRouter, Gemini, Groq, Cerebras, Mistral... in preset order; the arrows on API Keys change it). Then the built-in free services (OpenCode Zen public key, Pollinations, llm7), then nothing. The on-device model, if on, is first. `settings.freeFallback` switches the built-in ones off.
- **Moving on to the next provider happens only when the current one cannot serve:** daily quota spent (new `ProviderErrorKind` `"quota"`, a 429 whose body matches `DAILY_LIMIT_BODY` = per-day / daily / FreeUsageLimit / RPD / TPD, or a payment error) -> the provider is marked SPENT in kv (`spentKey`) for `QUOTA_RECHECK_MS` and skipped without waiting; bad key (auth cooldown); circuit open. A plain rate limit / 5xx / network / bad JSON is retried on the SAME provider and model (`DEFAULTS.router.sameProviderTries` = 2, wait `sameProviderWaitMs` 3 s, a Retry-After up to `maxSameProviderWaitMs` 65 s is waited out, so a per-minute limit never moves the task to another provider; a longer one moves on). A timeout is NOT retried (it made the tests and the app hang 60 s). Keyless providers and the on-device model get one try.
- `router.clearSpent(id)` forgets a SPENT mark; the store calls it after a Test that passes and when a key is saved. `AllProvidersFailedError.transient` excludes quota. `RouterDeps.sleep` is injectable (tests). `friendlyReason`: rate_limit = "rate limit hit, try again in a moment", quota = "daily limit used up".
- API Keys screen: one "Use / In use" button per model (keys `useModel`, `modelInUse`), no Default/Fallback buttons.
- **Why "AI can't respond" (checked live 2026-10-28):** OpenCode Zen's shared `public` key answers 429 FreeUsageLimitError for every model; Pollinations allows ~1 reply per 30 s per IP (first call took 89 s); llm7 allows ~2 requests per few seconds. With no working user key the built-in free services alone are slow or empty. The fix that matters for the owner: put a real key (OpenCode / OpenRouter / Groq / Gemini) at the top of API Keys and use "Test". I could not run the owner's keys, so this was NOT verified end to end.

### 2. Reliability (core/src/agent/loop.ts, vault.ts, defaults.ts, prompt.ts)
- `maxConsecutiveErrors` 3 -> 4, `maxStalls` 3 -> 4, `pointerMs` 450 -> 200, `observationMaxElements` 80 -> 120, `observationMaxChars` 6000 -> 8000 (the sign-in button was probably cut off the list).
- **Retry, then another way, then ask.** After 4 failed or no-progress steps the loop does NOT ask: it puts an `App note:` in the next prompt ("use a different method: another element, exact visible text, scroll, submit the form, direct URL, another site"), shows a "Trying another way" step, and resets the counters (`otherMethod`). Only a second jam asks the user. Real progress resets it. (Test: `core/test/agent/loop.test.ts`, 8 steps then one question.)
- `findSignInButton` also accepts `role=button` that reads Log in / Sign in / Continue / Next / Submit / Verify / Confirm, with "... with email", "... to account". Links (`<a>`) are deliberately NOT matched: a header "Sign in" link would leave the page instead of sending the form (review finding). Sign-up, Google/Apple/Facebook/Microsoft and Forgot-password stay excluded.
- "Another way" resets only when the PAGE changed (url or text length), not on a successful `read`; the model's `thought`/`plan` text is ignored when comparing steps.
- Prompt: never ask what can be seen on the page; Google's "Couldn't sign you in / browser may not be secure" is Google's rule (use the site's own email login with `sign_in`; if only Google exists, say so once and go on to the next task). `DEVICE` is a fenced, untrusted block like the others.
- NOT verified: that logins now work on real sites. The code path was only tested with fakes.

### 3. Queue and background (ui/src/state/store.ts `send`/`runTask`/`stop`/`dequeue`, Chat.tsx, KeepAliveService.kt, desktop/main.cjs)
- The composer is never disabled. `state.running` is true for the WHOLE queue (so New chat and a second run cannot slip in between two tasks). The composer's attachment tray is emptied in `send()` only, never by a queued task starting. While a task runs, `send()` pushes `{id, command, files}` onto `state.queue`; the chat shows queued messages as dashed bubbles ("Waiting · #n") with a remove button; `send()` runs them one by one through `runTask`, each as its own task (own history entry, fresh agent run). A task that throws (the first one too) does not drop the rest. **STOP ends the running task AND clears the queue.**
- The AI is told "nobody answers questions while the queue runs, so decide small things yourself" (DEVICE line).
- **Background.** Android: `KeepAliveService` (foreground service type dataSync + PARTIAL_WAKE_LOCK, 4 h safety timeout, ongoing "Krish is working" notification) started by `Platform.system.keepAlive(true)` when the queue starts, stopped at the end. Manifest now has FOREGROUND_SERVICE, FOREGROUND_SERVICE_DATA_SYNC and WAKE_LOCK (they were removed before: SECURITY.md and CHECKLIST.md updated). `onTimeout` (Android 15+ dataSync budget) stops the service. A refused start is swallowed (`runCatching`): the task then runs as before. Desktop: `powerSaveBlocker("prevent-app-suspension")` on `system:keepAlive`, and `backgroundThrottling: false` on both web contents.
- The owner turned off battery limits for the app himself; without that Android may still freeze the WebView. NOT verified on a device (Kotlin compiles only in CI).
- Notification channel "working" needs POST_NOTIFICATIONS on Android 13+; without it the service still runs, the line is just not shown.

### 4. Layout (details and restore steps: `LAYOUT-RESTORE.md`)
- Kept the PC layout (web view) as the default; fixed the cut-off: taller card (`clamp(300px, 62dvh, 680px)`), layout width 1024 on a card narrower than 700 px, else 1280, and the emulated size is `card / scale` so it fills the card (Electron and Android). Old behaviour is documented and restorable.
- The DEVICE line (`AppStore.deviceLine()`) tells the AI: phone/desktop app, app screen size, narrow/wide layout, PC or mobile page layout.

### 5. Asked for, NOT built, and why (decided, not forgotten)
- **Clicking "verify you are human" / Cloudflare automatically** and **solving CAPTCHAs: no.** That is defeating a site's bot protection, and I will not build it even with the owner's "I take the risk": it can get the owner's IP or accounts blocked and it is what abuse tooling does. The Done card stays: the user taps once, the task continues.
- **(Superseded by Round 10, see there.)** **Temp-mail (smilepro etc.) sign-ups with OTP loops, many accounts for free quotas: no.** Same reason (account farming / free-tier abuse). Legit alternative that works today: log in once with the user's own Gmail/email via the sign-in card (saved in KrishVault), or let the agent use `note` to carry a value the user can see between two pages.
- **(Superseded by Round 10: built, max 4 tabs.)** **Second real browser tab: not built.** It needs a multi-view `BrowserHost` on Android and Electron plus UI. One tab + `note` covers "copy here, paste there". If someone builds it: `PageDriver` gets a tab id, `KrishBrowserPlugin` and `desktop/main.cjs` keep a map of views.

### 6. Files touched
core: `agent/loop.ts`, `agent/prompt.ts`, `config/defaults.ts`, `providers/{types,http,router,models,builtin}.ts`, `vault/vault.ts` + tests. ui: `state/store.ts`, `screens/{Chat,Providers}.tsx`, `platform/{types,capacitor,desktop}.ts`, `styles.css`, `i18n/{en,hi}.ts` + tests. android: `KeepAliveService.kt` (new), `KrishSystemPlugin.kt`, `AgentWebView.kt`, `AndroidManifest.xml`. desktop: `main.cjs`, `preload.cjs`, `lib.cjs` + test. docs: this file, `LAYOUT-RESTORE.md` (new), `SECURITY.md`, `CHECKLIST.md`, `.github/release-notes.md`.
- Add a platform method = `ui/src/platform/types.ts` + capacitor.ts + desktop.ts (+ web.ts if needed) + Kotlin plugin + `desktop/preload.cjs` `CHANNELS` + `main.cjs handle` + the `Platform` mock in `ui/test/store.test.ts` `setup()`.

### 7. Verified / not verified
- Verified: `npm run typecheck`, `npm run lint`, `npm test` (core 224, ui 49, desktop 9).
- NOT verified: any of this on a phone or a real desktop; the foreground service; the layout; logins on real sites; real provider calls with the owner's keys.
- Next AI: do not "fix" the owner by adding fallback models inside a provider, do not make the composer wait for a run, do not bring back questions before 4 tries + 1 other way. Test on the phone first, then change.

## ROUND 7 (2026-10-28): the app does what the user says; it remembers the chat; visible pointer; no start-up flash (v0.1.11)

Owner: "it cannot remember a single chat, it does the same thing whatever I say, something preset overrides me; make it work like Hark; no flash of 'Krish' at start; plan first".
- **Chat memory.** `runAgent({ chat })`: the last 12 messages of the thread go to the model as a fenced `CHAT` block (passed through `redactChat`, which also removes spoken
  "password is ..."). The thread is saved under kv key `thread` (60 messages, redacted, no errors/step pills) and restored at start. `ChatItem.plan` messages are not sent back.
- **No presets.** `SYSTEM_PROMPT` rewritten: the USER_TASK is the whole instruction, no extra steps/sites/accounts/sign-ins, queued tasks done in order, chat is background,
  greetings answered without the browser. The "earlier chats are never tasks" rule is gone. `maxSteps` 30 -> 80, `historyWindow` 8 -> 16.
- **Sign-in is the model's call.** `autofillLogin` (ran on every login form) is gone. New action `sign_in`: saved login filled and sent by the app, else the sign-in card once (same code as before: `signIn()` / `askLoginCard()` in loop.ts).
  A saved Google login is clicked only if the task names Google/Gmail. Saved logins of the current site are registered for scrubbing from the first look (before any `sign_in`), so an echoing page cannot leak them.
- **New actions/fields:** `note` (value kept for later steps, shown as `NOTES`, max 20), `plan` on the first action (emitted as `{type:"plan"}`, shown in the chat as an italic message).
- **Providers.** (1) Pollinations answers its per-IP free limit ("1 reply every 30 seconds") with **HTTP 402**; that was shown as "needs paid credit" and never retried. `http.ts` now maps a 402 with FREE_LIMIT / "retry after Ns" to `rate_limit` with that wait.
  (2) OpenCode Zen's shared `public` key returns 429 `FreeUsageLimitError` for every model (checked live 2026-10-28; not the user's usage). Keyless providers stop after 2 rate-limited models; cooldown doubles per repeated failure (30 s .. 15 min); the message says "shared free limit is full right now (not your usage)".
  (3) If every AI is busy the loop waits (4 s, 12 s, 30 s, and at least until `router.retryInMs()`) and retries instead of ending the task (`providerWaits`). (4) Gemini "flash" ranks above "pro" (the free key has no quota for most pro models).
- **Pointer.** `krish-page.js`: orange arrow glides to the control, tap ripple on click (both the script click and the native-tap path `rect`), also on type/fill. Elements carry `data-krish-cursor`, `pointer-events:none`, not in `observe()`. The loop waits `pointerMs` (450) before a click so it is seen.
- **Start-up.** No more "Krish" text: `index.html` root is empty, `ui/public/boot.js` (blocking, CSP-safe) sets `data-theme` before first paint, `App` renders nothing until ready then fades in; Android `splash.xml` is the theme's sky colour (+ `drawable-night`). Screens and cards rise in (`.chat` excluded: it holds the browser card).
- **Deliberately NOT built:** clicking Cloudflare / "verify you are human" checks (bot-check bypass; the user still gets the Done card), and the temp-mail sign-up + OTP loop on third-party sites (account-farming; the model may still ask the user). Second browser tab: not built (`BrowserHost` has one view) - the model can `note` a value, navigate, and come back.
- **Verified:** typecheck, lint, core 218 / ui 47 / desktop 8; real call to Pollinations with the new prompt returned `navigate` + `plan` for "open site, type gmail, do not log in". NOT verified: pointer on a phone, boot.js inside the packaged APK/Electron, Kotlin (unchanged; CI compiles it).

## ROUND 6 (2026-10-28): no Take over, no confirmation cards, logins saved for good and submitted by the app

Owner (angry): "what is Take over, remove it"; Krish must type, open and click by itself like Hark; after email + password once it must log in by itself
without waiting for a send button; ask only for login passwords and bank details; no locks; save a login once and reuse it without asking.
- **Take over / Resume / `paused` removed** (button, store methods, `AgentController.pause/resume/whenRunning`, status "paused", `statusPaused`/`takeOver`/`resume` keys).
  CAPTCHA keeps a plain card (`ui.solveCaptcha`, prompt type `captcha`, button "Done"); it is the only step a model cannot do. A closed sign-in card no longer
  hands the page over: the model is told and carries on or asks.
- **No confirmations anywhere.** `policy.gate()` returns allow or block only (`Gate`); block = element not on the page, or the model typing into a secret field /
  a `[REDACTED` text. Removed: `ConfirmRequest`/`ui.confirm`, off-site and consent/risky click rules, "Send?" on type+submit, sandbox/upload/memory/vault cards,
  `sensitive-page` stop (`isSensitivePage`, `allowSensitive` on providers, `RouteOptions.sensitive`, `aiSeesLogin`, `confirmFill`, `MAX_SENSITIVE_STOPS`),
  the page-site boundary (`homeUrl`). Screenshots are off only while the app has typed a secret (`typed`), not on login pages. `prompt.ts` now says the task is the permission.
- **Vault without a passphrase.** `Vault(KeyStore)` stores the list as JSON under key `krishLogins` in the platform key store (Keystore / keychain; encrypted at rest).
  No create/unlock/lock/auto-lock/erase, no PBKDF2. `MIN_PASSPHRASE`, `vaultLock`, `needMaster` are gone. The old `krishVault` blob (passphrase-encrypted) is NOT migrated
  (it was never used by the owner; entries must be added again). Vault screen = list + add form.
- **Login card always saves.** Email + password (or Google) typed once go into the page and into the vault (`site`, username, password). Next visit: no card.
  `autofillLogin` runs on any task that lands on a login form (the old "task says log in" gate is gone); one try per page+step, max 6 per run.
- **The app submits the form itself** (`findSignInButton` in vault.ts: submit button labelled Log in / Sign in / Continue / Next, else any submit button, never Google/Apple;
  clicked right after the fill). Email-first pages: email filled and Continue clicked, then the password step is filled and sent on the next loop turn.
  If a Google login is saved (site `google.com`) the page's Continue-with-Google button is clicked without a card.
- **Review fixes (same round):** the sign-in button is chosen **inside the form that was filled** (page script now reports `form`, the 1-based form number; `findSignInButton(elements, form)`),
  matches each label separately (an `<input type=submit>` repeats its value as text), never picks Sign up / Create / Forgot / Google / Apple, and with no confident match
  does not click at all (the model is told to). A form with a single unnamed submit is accepted. After the app sent a password, the same account is not sent again in
  that run when the form comes back (rejected password). STOP is checked between fill, fill and click (`alive()`), so a stop never lets a password or click go out afterwards.
  Everything shown or stored (chips, `action` events, results, summaries, errors) passes `safe()`/`scrubAction()`, which also removes the values the app typed. Two-step pages with
  only a "Sign in" heading + email + Next are recognised; Apple/Facebook buttons are no longer mistaken for Google. `Vault.put` upserts inside the queued write (no duplicate on a race).
- **Known gaps:** a passwordless email-first site (magic link / email code) still gets the card with a password box (the owner can close it); an email-only "type then Enter" form with no button is not submitted by the app.
- `SETTINGS_VERSION` 5 drops `aiSeesLogin` and `confirmFill` from saved settings. i18n: 7 languages updated (sec3, sec5, sec7, vaultIntro, tour2Body, tour3Body, loginNote; `done` added).
- **Verified:** typecheck, lint, core 190 / ui 47 / desktop 8 tests; UI harness in headless Chrome (phone and PC): login card has email + password only and no checkbox,
  answering it fills both fields and saves the login, the second run fills with no card, footer buttons are Expand + Close, no "Take over"/"Resume" text, password not in any prompt.
- **NOT verified:** anything on a real phone (scaled WebView touch, the card showing the full PC page), real sites (Instagram, Google 2-step, OTP), the Windows build,
  whether `findSignInButton` picks the right button on sites with odd markup (it is label based). Kotlin only compiled in CI.
- **Trade-off the owner chose:** saved passwords are readable by anyone who opens the app on an unlocked device. A wrong model step runs without a second look; STOP is the only brake.

## ROUND 5 (2026-10-28): no Accessibility; the PC layout lives inside Krish's own window

Owner: no Accessibility; the agent must work inside a window in the app, laid out like a PC, nothing cut off (like the reference video).
- **Removed:** `KrishAccessibilityService`, `KrishDevicePlugin`, `krish_accessibility.xml`, the manifest service, "my browser" mode (`settings.myBrowser`,
  `MyBrowserSetting`, `platform.myBrowser`, `browser.use`) and its strings. The app asks for INTERNET + POST_NOTIFICATIONS only again.
- **PC layout (`AgentWebView.place`)**: the WebView is made 1280 CSS px wide (card height scaled the same) and scaled down from its top-left corner to
  exactly fill the card (`scaleX/scaleY`, pivot 0,0). The page really lays out at a desktop width (no viewport meta trick), so nothing is cut off, and
  the card can be resized/expanded. User agent = this phone's own Chrome UA rewritten to a Linux PC (`X11; Linux x86_64`, no "Mobile").
  Below 1280 px card width the scale is < 1; the user can Expand the card for a bigger picture.
- **Clicks are real taps now** (`KrishBrowserPlugin.click`: `K.rect` then `tapCss`, script click as fallback); `scroll` was missing in the plugin and is added.
- **Verified:** typecheck, lint, tests (core 214, ui 47, desktop 8). **NOT verified:** Kotlin compile (CI `check`), anything on a phone. Whether
  touches map correctly through the scaled view on real devices is the first thing to test; fallback is `K.click`.

## ROUND 4 (2026-10-28): OpenCode Zen first, live model lists, desktop fetch fix

- **Order of use:** OpenCode Zen (free, public key, no account) is tried first (`BUILTIN_PROVIDERS[0]`, `DEFAULT_BUILTIN_ID`), then the user's own
  keys (preset order now OpenCode Zen, OpenRouter, Gemini, ...), then the other free services (pollinations, llm7). `ProviderConfig.anonymousKey`
  is the key a keyless service expects (`public`).
- **Live lists:** `store.syncLists()` runs at start and every 6 h: it fetches the free services' lists and every enabled provider's list when it is
  older than 6 h. `modelsChanged {added, removed}` is stored on the provider and shown in API Keys ("New: ...", "Gone: ..."). A retired default is
  replaced. A free service that is down keeps its last working models. Saved free lists live under kv key `freeProviders`.
- **Desktop:** `fetch` IPC now uses `net.fetch` (Chromium stack; Node `fetch` failed under `--jitless`).
- **Verified (run):** tests core 214, ui 48, desktop 8; typecheck, lint, UI build clean; real Electron under Xvfb: UI loads, a chat task
  "open example.com and tell me the page title" ran end to end with the free AI and answered "Example Domain".
- **Seen in the sandbox:** opencode.ai `/zen/v1/chat/completions` answered `FreeUsageLimitError` (HTTP 429) from this IP, so Zen was skipped and the
  next service answered. The fallback chain is what made the run work. Whether Zen answers from a phone/PC is untested.
- **NOT verified:** APK on a phone, Windows build, Kotlin (no JDK here; CI compiles). The browser card renders black under Xvfb (no GPU); the page itself loaded.

## ROUND 3b (2026-10-27, later): why the owner still saw the old app

Owner's phone screenshot (12:32) still showed "Google Gemini · gemma-4…" under the answer. v0.1.4 had removed that line. Cause: **every CI build
was signed with a new random debug key**, so Android refused to install v0.1.4 over v0.1.3 (signature mismatch) and the old app kept running.
Fixed: a fixed key is stored in repo secrets `KRISH_KEYSTORE_B64` / `KRISH_KEYSTORE_PASS` (PKCS12, alias `krish`) and used by `release.yml`;
`versionName`/`versionCode` come from the tag/run number. **The first install of v0.1.5 needs the old app uninstalled once** (different key;
this clears saved keys and vault). After that, updates install over it. Do not delete the secrets: a new key means another uninstall.
- Day sky is now light (was mid blue, read as "dark"); headings use `--head`. Settings shows the app version.
- Release page: `release.yml` now writes notes = version + the three download links (tag-pinned) + commits since the previous tag, and
  publishes as the latest release. README links use `releases/latest/download/`.
- Reference video watched (frames): the other app's login card says "Secured by <brand>", a floating live card, and "Action Required" on a
  login wall. We copy none of that; only the idea that a login/CAPTCHA wall is the one allowed stop.

## ROUND 3 (2026-10-27): owner's phone test said "nothing works, Action required everywhere" — read this first

Owner's screenshots showed: every provider failing with raw error bodies and model names in chat; "Action required" on every login page and
every Send; typing/clicking on Arena and Instagram not working. What changed (all in code, tests green, **not yet tried on a phone**):

- **Never stuck on one AI.** `core/src/providers/builtin.ts` is a keyless built-in provider (text.pollinations.ai, OpenAI-compatible, model
  `openai-fast`), always tried last; with no key added the app still answers. Switch: Settings → "Use the built-in free AI" (`freeFallback`).
  `router.run` now also tries the next 4 best listed models of the same provider before moving on. Payment/auth errors skip the provider.
- **No model or provider names in chat.** The `via` line is gone. `AllProvidersFailedError` lists distinct reasons only; Chat shows one calm
  line ("I could not answer just now") + the reasons.
- **"Action required" only when critical.** Only secure input (password/code/CAPTCHA) and take-over cards set it; questions and approvals do not.
  Secure chip label is now "Waiting for you". Search boxes submit without a "Send?" confirmation (`policy.isSearchBox`).
- **Sign-in pages no longer stop the run.** `aiSeesLogin` (default on) lets the user's providers see login pages (passwords/codes are always
  redacted anyway). That was the Instagram "no provider allowed, act yourself" wall.
- **Click/type fixes in `core/page-script/krish-page.js`:** contenteditable and role=textbox/searchbox/combobox targets, typing via
  `execCommand("insertText")` for rich editors, full pointer/mouse event sequence before `click()`, Enter keydown/keypress/keyup,
  on-screen elements listed first (a heavy page used up the 200-element budget before the message box), fingerprint of editable elements
  ignores their text (typing changed the fingerprint, so the second type into the same box was refused as "changed since observed").
- **Theme:** default is now **Auto = by local time** (dark 19:00–06:59, rechecked every minute); "Same as device" kept. `SETTINGS_VERSION` 3.
- **API Keys screen rebuilt** (`Providers.tsx`): summary, numbered order of use, health dot + reason, "N models found", automatic vs chosen
  models ("choose automatically again"), enable switch, free-AI card last, 2-step add flow per catalog entry, custom provider folded away.
- **Logins:** vault entries can be "every site" (`ALL_SITES = "*"`, default account); a site's own login wins. `confirmFill` (default off):
  saved logins are filled without asking. Settings has both switches.
- **Tour:** `components/Tour.tsx`, 4 cards, once; "Show the tour again" in Settings.
- Tests added: page script (contenteditable, fingerprint, on-screen order, click events), router (keyless, next-model fallback, no names),
  vault (default account), loop (askBeforeFill), store (no key → free AI answers, no names, prompts vs status, defaults), theme (clock).

### NOT verified in this round
- Nothing was run on a real phone or against Arena/Instagram. The page-script fixes are proven in jsdom only. `AgentWebView.kt` still clicks
  through JS (`K.click`); if a site ignores that, the next step is a real tap: `K.rect(id)` then `tapCss(...)` (already used for uploads).
- Kotlin not compiled (no JDK in the sandbox). No Kotlin was changed.
- The free service (pollinations) is a third party: it can be slow (~5 s), rate-limited or change. Its answers go to that host: it never gets
  sign-in/payment pages (`allowSensitive: false`). Mention it in the privacy text if you keep it.
- Only English and Hindi have the new strings; other languages fall back to English (`themeAuto` exists in all).
- Reference screenshots/video were only a layout idea. The word of the other product appears only here, never in app code or UI.

## PHONE-TEST ROUND 2 (v0.1.3, 2026-10-24) — read this first
Owner's findings from v0.1.2 and what was done (core 195, ui 36, desktop 8 pass; lint and typecheck clean). An independent code review found 8 issues; fixed: navigation now waits for the page to load before it counts as the page (`store.openAndWait`), a failed navigation never exposes the old tab, a plan made while the user took over is dropped, sensitive-page asks are capped per run, a rejected or tab-less first `read` does nothing, history-write failure cannot lock the chat, hand-picked models survive automatic tests (`ProviderConfig.modelsChosen`), braces in a prose answer no longer break parsing. Known, not fixed: no timeout around native browser calls (STOP cannot cancel a hung native call).. **Nothing here ran on a real phone yet.**
| # | Finding | Fix | State |
|---|---|---|---|
| 1 | Old, vanished models kept being used | Model list marks `expiring` (OpenRouter `expiration_date` < 14 days) and never auto-picks it; `probeModels` now tries up to 9 ranked models, 3 at a time, and keeps the first two that answer a JSON probe (a 404 or a prose reply is skipped); a "model no longer available" error triggers a fresh list + probe by itself; at app start, providers that are not OK or not checked for a day are re-tested (`store.checkUntested`) | DONE in code; real providers not tried |
| 2 | Instagram login "fails" and shows "Action required" | The warning only shows while a run is active (`LiveWindow`); steps left open when a run ends are closed (`store.ts`); Android WebView user agent drops `; wv` and `Version/x` (`AgentWebView.kt`) so sign-in pages treat it as Chrome | UA change **unverified** (cannot be tested here); if Instagram still refuses, the cause is Instagram blocking embedded browsers and nothing in the app can fix it |
| 3 | Any message opened the Instagram tab | A run now starts with **no page**: no page is read, no card, no sensitive-page check. The agent gets "No page is open" (plus the title/URL of a tab the user left open, as a hint only). It must `navigate` (opens the card) or `read` (looks at the open tab) to use a browser. Only saved tasks/panels with a start URL begin on a page (`loop.ts` `pageLive`, `store.send`) | DONE, tested |
| 4 | Free models on top, labelled | `sortModels` (free, then paid, then non-chat); picker shows a green "free" badge; free is also detected from `:free` / `-free` ids (OpenCode Zen) | DONE |
| 5 | Professional look, slow screens | Screens other than Home/Chat are lazy chunks; App/Chat subscribe per field; page events only re-render on a real change; static HTML paints "Krish" before JS; welcome screen with 3 starter prompts; provider card moved rarely used fields into "Settings"; one-title + one-line-per-provider failure card | DONE in code, not measured on a phone |
| 6 | Thinking indicator | `Thinking` bubble (dots + shimmer) while a run waits for the AI; off under reduced motion and lite mode | DONE |
| 7 | Endless "Action required / take over / resume" | Cause: the stale login tab was read as a sensitive page on every step. Now: no page unless used; a sensitive page asks **once** ("let the AI see it?"), declining hands over to the user once; the same page never asks twice (`takenOver`); the model's JSON is parsed leniently (prose around JSON, think tags, plain prose on the first step = answer) so free models that ignore the format still work; JSON mode is requested and retried without it on 400/422 | DONE, tested |

Next: install the APK, add a free key (Gemini or OpenRouter), check "hi" (no card, thinking dots, plain answer), then "open example.com" (card opens), then a login site (one question, no loop). If a provider still gives "unusable reply", look at `Attempt.detail`.

## PHONE-TEST FIXES (v0.1.2, 2026-10-24)
Owner tested v0.1.1 on a phone and sent screenshots. Findings and fixes (all in code and tests; core 179, ui 35, desktop 8):
- **Wrong models were auto-picked** (Gemini `antigravity-preview` = 400 "Developer instruction is not enabled", OpenRouter obscure free model = 429, OpenCode Zen paid model = 402). Fix: name-based ranking is only a first guess; `probeModels` (`core/src/providers/models.ts`) now sends one tiny real request to the best-ranked models and keeps the first two that answer as default and fallback. Rate-limited, unpaid and rejected models are skipped. It runs when a key is added, on the new "Test" button, and once at start for providers saved earlier.
- **Green tick**: `ProviderConfig.health {ok, at, note}`; set by the probe and updated after every real agent call (`RouterDeps.onResult`). Providers screen shows a green tick, "Checking…", or a red "Not working: <reason>".
- **Long red error text**: `AllProvidersFailedError` now says one short line per provider ("Gemini: free limit used up, try again later"). Raw provider bodies stay in `Attempt.detail` only. Error bubbles have a Dismiss button. HTTP 402 is its own kind (`payment`).
- **Gemini models that reject `systemInstruction`**: one retry with the rules put into the first user turn (`gemini.ts`).
- Answers show the provider and model small under them (`ChatItem.via`).
- **Not done / unverified**: the fallback chain was only checked with mocks and the harness; the real providers (free tiers) rate-limit often, so "free limit used up" is expected sometimes. A real phone test is still needed.

## REDESIGN RUN — DONE IN CODE, v0.1.1 RELEASED (2026-10-24); WAITING FOR PHONE TEST
Owner feedback after testing the v0.1.0 APK on a phone (screenshots of Krish vs the reference app in HANDOFF/CREDITS terms only; never write that name in app code or release notes).
Method: public CSS/JS bundle of the reference app's login page was fetched and read (REA `analyze-javascript-application` timed out at 300 s on the 650 KB bundle; the CSS tokens, keyframes and easings were read directly). The chat screen itself is behind a login, so its layout was taken from the owner's screenshots only. Do not bypass the login.

| # | Item | State |
|---|---|---|
| 1 | Crash text "Cannot read properties of undefined (reading 'token')" = cancelled file picker resolved with no data (`platform/capacitor.ts`) | DONE (commit 3a71227) |
| 2 | "all providers failed: <random id>:skipped" — message now names each provider and why (`router.ts`); the usual reason was "no model selected" | DONE |
| 3 | Adding a provider = enabled + appended to fallback order + best chat model picked automatically (`core/src/providers/models.ts` `pickModels`/`withAutoModels`, used by router and `store.addProvider/refreshProviderModels`) | DONE, tests added |
| 4 | Browser card opened on every send. Now it opens only when a page actually loads (`store.ts` onPage hook) or a start URL is given | DONE |
| 5 | Plain questions ("hi") answered as chat text: prompt rule "answer directly", no step pill for a first-step `done`, blank page is not "sensitive" (`prompt.ts`, `loop.ts`, `redact.ts`), summary limit 2000 -> 6000 | DONE |
| 6 | Softer dark theme (slate-blue sky, graphite glass) and light sky taken from the reference screens | DONE |
| 7 | Performance: nested backdrop-filter removed (only top tabs and composer blur), static background, `useAppSelector`, memo chips, bounds sent only on change | DONE, not measured on a real phone |
| 8 | Browser card redesign: black card docked in the layout, same on phone, desktop and Linux, no drag or S/M/L/XL (see item 6 below) | DONE, checked in headless Chrome at 467x922 and 1280x800; NOT checked on a real phone or Electron window |
| 9 | Providers screen: Main / Backup N badge from the order of enabled providers | DONE |
| 10 | Clearer first run: chat empty text, no-provider error has an "Open API Keys" button; ONE Android APK (`krish-android.apk`, the lite flavor) in releases from the next tag on | DONE in code; README links change with the next release |
| 11 | "Every field shows an error": not reproduced from code; the two visible errors were items 1 and 2. Ask the owner which field if it still happens | OPEN |

**Overall: about 85 % of the owner's list is done in code and tests (core 173, ui 34, desktop 8 pass; lint and typecheck clean). Nothing of this redesign has run on a real phone yet.**

Still to do, in this order:
1. DONE: `v0.1.2` is the latest (pre-release; v0.1.1 and v0.1.0 also exist) with `krish-android.apk`, Windows zip, Linux tar.gz and SHA256SUMS.txt; README links point to it. For the next release tag `v0.1.3` and change the version in the README links.
2. Owner installs the APK and checks: "hi" gets a text answer with no browser card; adding a provider picks a model; a second provider shows "Backup 1"; the card opens only when a site loads, and the page lines up with the black card (Android `setBounds` + `clipToOutline`).
3. If the card and native page are offset on a phone: the code is `components/LiveWindow.tsx` (`getBoundingClientRect` of `.view`) and `KrishBrowserPlugin.kt` `setBounds`.
4. Unverified guess: the model list ranking in `core/src/providers/models.ts` (`score`) is a heuristic; check it against real provider lists and tune the regexes.
5. The chat screen of the reference app is behind a login: only the owner's screenshots were available. If the owner wants a closer match (card header, animation details), ask for screenshots or a screen recording of that screen. Do not log in or bypass the wall.
6. Item 11 above (field errors) needs the owner to say which field.

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
6. **Browser card** (`components/LiveWindow.tsx`, redesigned 2026-10-24): a black card in the layout (Chat: between thread and composer; other screens: bottom). The native view sits over `.view` with a 20 px radius (`setBounds` takes `radius`: Android `clipToOutline`, Electron `setBorderRadius`). Strip below: status pill (current step, or "Action required"), Take over / Resume, STOP, expand (full screen), close. No drag, pinch, S/M/L/XL or minimize any more. While a confirm / question / secure card is up the page area folds away (`.live.folded`); take-over keeps it.
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
7. **Live window jank on low-end devices.** (Old floating card; superseded by the docked card, which has no drag/resize at all. The native bounds are now sent only when the `.view` box changes.)
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

## ROUND 4 (v0.1.6)
User screenshots 13:29-13:34 (all read): Gemini "model not usable (HTTP 400)", built-in AI "too slow", the browser card floating over API Keys, no sign-in form in chat.
1. **More keyless fallbacks.** `core/src/providers/builtin.ts` now has `BUILTIN_PROVIDERS`: Pollinations (`openai-fast`), then LLM7 (`api.llm7.io/v1`, models `default`, `gpt-oss:20b`, `nemotron-3-nano:30b`, `mistral-Nemo-Instruct-2407`). Both anonymous, last in the order, never see sign-in pages. Checked live 2026-10-26: Pollinations 200 in ~3 s; LLM7 200 but its anonymous daily quota is small and ran out from the sandbox IP. Checked and NOT used: OpenCode Zen free models (429 "Free usage limit reached" without a key), api.airforce (needs a key / 1 req limit), OpenRouter (needs a key, 401).
2. **Gemini 400.** `gemini.ts`: on 400 retries with the rules inline, then without JSON mode (Gemma and previews reject both). `rankModels`: `openrouter/free` first, Gemma `-60` so it never beats a Gemini model.
3. **Order of use / default.** `DEFAULTS.presets` is now OpenRouter, OpenCode Zen, Gemini, then the rest; `insertByPreset` (store.ts) puts a new key by that order. NOTE: "OpenRouter as default" means the first slot in the order; a key is still required for it.
4. **Sign-in card in chat.** `AgentUI.askLogin` -> `Prompt` type `login` -> `LoginCard` (Prompts.tsx): Google button (clicks the page's Google button), email, password, "save to KrishVault" (creates the vault with a passphrase if none). Shown by `autofillLogin` when no saved login matches. Values are filled natively and put in `typed` (scrubbed from model text). Closing the card = take over. A code field uses the existing secure `otp` card.
5. **Saved login by name.** `pickLogin(logins, task)`: "log in with my work account" / part of the email picks that vault entry.
6. **Layout.** The native view is now synced every animation frame (before: once per layout change, so it stranded over other screens). `.live` animates opacity only. On non-chat screens the window is a status strip (`LiveWindow compact`), Expand = full screen. `desktopLayout` defaults to true (PC-size pages on the phone); `SETTINGS_VERSION` 4 turns it on once for existing installs. Card height `clamp(240px, 50dvh, 520px)`.
**NOT verified on a device:** the per-frame sync cost on Android, the real Google button click, OTP on a real site, the LLM7 quota for real users.

## ROUND 5 (v0.1.7)
User screenshots + screen recording (2:18-2:19): the embedded browser card at the bottom of the chat was small, half cut off and "again in the mobile layout"; the user asked for another approach: let the AI work in THEIR OWN browser/system (already logged in, no login page), one tap + instruction, local only, live window not needed.
Root cause (kept honest): a native WebView laid over the app UI is always clipped/cramped; and any in-app WebView has its own cookie jar, so logins never match the user's real browser. Android gives no way to read another browser's cookies or remote-control it, so the only real route is an Accessibility Service.
1. **Work in my own browser (Android, default ON).** `KrishAccessibilityService.kt` (browsers only, see `res/xml/krish_accessibility.xml`) + `KrishDevicePlugin.kt` (plugin `KrishDevice`). `open` = ACTION_VIEW to the default browser (a supported one: Chrome, Firefox, Brave, Edge, Samsung, Opera, Vivaldi, Kiwi, DuckDuckGo), `observe` = accessibility tree -> the same `PageObservation` (ids + fingerprints, password fields flagged, browser toolbar nodes skipped), `click` (ACTION_CLICK, else a gesture tap), `type` (ACTION_SET_TEXT), `scroll`. Status pill (TYPE_ACCESSIBILITY_OVERLAY, no extra permission) with Stop / Resume / Open Krish. When a card is needed (sign-in, code, question, confirm) Krish is brought forward; on finish too.
2. **Platform split.** `capacitor.ts`: `embedded` (old WebView) and `mine` BrowserHost behind one `browser` with `use("app"|"mine")`; `Platform.myBrowser` (status, openSettings, say, hide, focusApp, onAction). Store: `Settings.myBrowser` (default true, ignored without `platform.myBrowser`), `mine()`; no Krish card when on; if the Accessibility switch is off the chat says so and opens the system settings. Settings + Home show `MyBrowserSetting` (switch, one-time setup note, local-only note in en/hi).
3. **New agent action `scroll`** (passive, all platforms: page script `K.scroll`, desktop `browser:scroll`, Android both paths) because an accessibility tree only has what is on screen.
4. **Email-first sign-in walls** (`findLoginWall`): a page with an email box and "log in or create account" / "Continue with Google" but no password field now shows the card in `wall` mode (Google or email only; the next page asks for the password).
5. **Layout fixes in the old window:** the saved "Desktop layout" setting is applied at start (it was only applied when toggled), Stop button uses the Stop icon.
6. **Safety rule changed on request:** SPEC rule 3 said no Accessibility Service in v1. SECURITY.md and docs/SPEC.md now say what exists and how it is limited. Revert = delete the service, plugin, xml and manifest entries.
**Desktop:** unchanged (embedded window). Driving the user's real Chrome profile on PC (CDP `--remote-debugging-port`, or an extension) is NOT built; next step if wanted. Chrome 136+ refuses remote debugging on the default profile, so it needs a dedicated profile or an extension.
**NOT verified on a device (Kotlin is only compiled in CI):** the accessibility tree of each browser (Chrome exposes web content as nodes only with its accessibility on; URL bar id list in `URL_BAR`), typing in Chrome fields via ACTION_SET_TEXT, whether the Krish page keeps running while the browser is in front, whether Android lets the service bring Krish forward (the pill's Open Krish is the fallback), Samsung Internet/Firefox node quality.

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
