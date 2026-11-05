# Security

Krish is a single-user, local-first Android app that can operate **other apps on your phone** through the Android Accessibility Service, driven by an AI.
There is no Krish server. The only optional network piece is the Mode B relay (`relay/`), which stores nothing.

Threat model: **hostile text on a phone screen (prompt injection), hostile or mistaken model output, a curious AI provider, an AI that is
tricked into touching private apps, and bugs of ours.** Not in scope: a rooted or compromised phone, or someone who can already unlock your phone.

Spec: `docs/PHONE-CONTROL-SPEC.md`. Every row below names the code and the test.

## Layers (in the order a screen or action meets them)

| # | Rule | Enforced in | Tested by |
|---|---|---|---|
| 1 | **Allowlist.** You pick the apps. The Accessibility Service's `packageNames` is narrowed at runtime to those apps, and every read and every action checks the foreground package again. A foreign app in front pauses the task; nothing is read or sent from it. | `AgentAccessibilityService.kt` (`applyAllowlist`, `guard`, `permitted`), `PackagePolicy.kt`, `core/src/security/packages.ts` | `core/test/security/packages.test.ts` |
| 2 | **Hard blocklist**, even if you allow the app: banking / UPI / wallets, Gmail, SMS, WhatsApp and other private chat, authenticators, password managers, Settings, Play Store, Google account screens. One shared list for TypeScript and Android. Fail-closed: an unknown or empty package is refused. | `core/security-policy/blocklist.json` (also an Android asset), `packages.ts`, `PackagePolicy.kt` | `packages.test.ts` |
| 3 | **Screen gate.** The only door from a screen to a model is `sanitizeScreen`. Order: package, FLAG_SECURE, blank screenshot, blocked site (account and payment pages in a browser), password / secret-hint fields, sensitive words, then redaction. Password nodes (`isPassword`) contribute no text even natively. | `core/src/security/screen.ts`, `AgentAccessibilityService.kt`, `ScreenChecks.kt` | `screen.test.ts` |
| 4 | **Stop on protected screens.** A FLAG_SECURE window or a blank screenshot ends the task. | `screen.ts`, `PhoneEngine` | `screen.test.ts`, `engine.test.ts` |
| 5 | **Pause on login/credential words**: OTP, PIN, CVV, password, login, sign in (hard: never waved through). "Pay" is soft: you may approve it for one task. **Login is always done by you**; the next screen no longer shows the word and the task goes on. | `screen.ts`, `PhoneEngine.observe` | `screen.test.ts`, `engine.test.ts` |
| 6 | **Task plan.** Before a task you see its apps and action types and tap Start. Nothing outside the approved plan runs; there is a step limit. | `core/src/security/actions.ts` (`createPlan`, `approvePlan`, `gatePhoneAction`) | `actions.test.ts` |
| 7 | **Confirmation popup** before every send, post, pay, delete, submit, install, share, every newly opened app, every unlabeled control, and typing a line break. Drawn by the Accessibility Service itself (no "draw over apps" permission), refuses to be answered while another window covers it (tapjacking), 60 s without an answer is **No**. Labels come from the screen, never from the model. | `SafetyOverlay.kt`, `actions.ts` (`consentKindOf`) | `actions.test.ts`, `engine.test.ts` |
| 8 | **Strict actions.** An AI may only ask for `open_app`, `read_screen`, `tap`, `type`, `scroll`, `back`, `wait`, `ask_user`, `done`, as strict JSON. Extra fields are rejected. A tap or type targets a numbered item of the last gated screen; unknown numbers are refused. Nothing is evaluated. | `actions.ts` (`PhoneActionSchema`) | `actions.test.ts`, `mcp.test.ts`, `chat-driver.test.ts` |
| 9 | **One engine path.** Mode A, Mode B and macro replay all go through `PhoneEngine.step`: state, plan and confirmation gate, pacing, re-check after a popup or delay, act, screen gate, log. Steps run one at a time. | `core/src/phone/engine.ts` | `engine.test.ts`, `macro.test.ts` |
| 10 | **Redaction before any model sees text**: phone numbers, card numbers (Luhn), emails, 6-digit and cue-led codes, tokens, key shapes. Only text of allowlisted apps' screens is ever sent. Screen text is labelled to the AI as untrusted data. | `core/src/privacy/redact.ts`, `screen.ts` (`redactForModel`), `mcp.ts` | `redact.test.ts`, `screen.test.ts`, `mcp.test.ts` |
| 11 | **Pacing.** Rolling per-app caps and random delays. Social apps (Instagram etc.): 1.2-4.5 s between actions, 8 per minute, 120 per hour, 600 per day. Reads do not count. The UI shows `INSTAGRAM_WARNING` first: automating a social app can get the account limited or banned. | `core/src/security/pacing.ts` | `pacing.test.ts` |
| 12 | **Emergency stop.** A red STOP overlay while a task runs; either volume key stops it; locking the screen stops it; leaving the allowlist pauses it; switching mode ends the task. | `SafetyOverlay.kt`, `AgentAccessibilityService.kt` (`onKeyEvent`, screen-off receiver) | engine tests (stop paths); overlay and keys **not run on a device** |
| 13 | **Activity log on the phone only.** Every step is logged (redacted, capped at 2000 entries) with an optional screenshot kept in app-private files under opaque names. You can view it and clear it from the Phone screen (screenshots go with the entries; the log API can also delete one task). Nothing is uploaded. | `core/src/security/activity-log.ts`, `ui/src/screens/Phone.tsx` | `activity-log.test.ts` |
| 14 | **Consent first.** The phone-control screen is locked until you accept a versioned consent (what it sees, what is sent, what it asks, how to stop) with Privacy Policy and Terms. Changing the text bumps the version and asks again. | `core/src/security/consent.ts`, `Phone.tsx` | `consent.test.ts`, `ui/test/phone.test.ts` |

## Modes

- **Mode B (MCP).** The phone connects *out* to your own Cloudflare Worker (WebSocket). The Worker holds the socket and in-flight requests in memory; no KV, no logs, no storage. The connector URL carries a 64-hex secret token made on the phone and kept in the Keystore-backed store; rotating it cuts off every client. All safety checks run **on the phone**; the relay cannot widen them. Anyone with the connector URL can call the tools, but only inside the approved plan, and every consequential tap still needs your popup.
- **Mode A (chat app as the brain).** Krish types the sanitized screen into the ChatGPT / Gemini / Claude app and reads the reply from that app's screen. The chat app must be in the plan. A per-turn random marker is typed with the prompt; only the first valid strict-JSON action after the **last** marker is used, so text on the screen cannot replay or inject an older command. Everything then goes through the same engine.
- **Macros (schedule).** You save the steps of a task you ran. The steps are stored as visible labels (never element numbers, which change), with the apps you approved. An Android alarm (AlarmManager) only posts a notification; you tap Run. The replay uses **no AI** but the **same engine**: popups, pacing, screen gate and log all apply, a login or code screen stops it, and a missing element is a failure (never a guess). A failure that may be temporary is retried, then you get a notification. A macro whose app is no longer allowed or is now blocked refuses to run. Nothing starts on its own, so a confirmation always has a person to answer it.
- One mode at a time; switching ends the running task.

## Other rules

| Rule | Enforced in |
|---|---|
| Provider keys only in Android Keystore (AES-256-GCM, non-exportable key) or the OS keychain via Electron safeStorage; sent only in headers. | `KrishSecurePlugin.kt`, `desktop/lib.cjs` |
| **There is no in-app browser.** The agent's WebView, browser view and saved-login vault were removed (Google refuses sign-in inside a WebView: "this browser is not secure"). You sign in in the real app or browser. The only WebView left is Capacitor's own, which loads this app's bundled local files. | `MainActivity.kt` |
| Cleartext traffic and backups are disabled. | `network_security_config.xml`, `AndroidManifest.xml` |
| Permissions: INTERNET, ACCESS_NETWORK_STATE (metered-download warning), POST_NOTIFICATIONS (due notifications, "Krish is working"), FOREGROUND_SERVICE(+DATA_SYNC) and WAKE_LOCK (only while tasks run), SCHEDULE_EXACT_ALARM (on-time macro notification; without it Android may delay it). The Accessibility Service is turned on by you in Android Settings; it requests content retrieval, screenshots and key events, no gestures. No boot start, no `QUERY_ALL_PACKAGES` (the app list uses a launcher-intent query), no contacts, SMS, camera, microphone or location. | `AndroidManifest.xml`, `accessibility_service_config.xml` |
| Files only through the system picker or save dialog; file tokens are opaque. | `KrishFilesPlugin.kt` |
| On-device models: only catalog IDs; HTTPS only to `huggingface.co` / `*.hf.co`, no cookies, bounded validated redirects, SHA-256 checked, no model bundled. Inference runs in a separate `:llm` process (crash isolation, **not** a sandbox). The model's output is untrusted and goes through the same strict action parser. | `LocalDownloadPolicy.kt`, `LlmService.kt`, `core/src/local/catalog.ts` |
| No analytics, telemetry, ads, crash reporters, remote config or remote code. | whole repo (`grep` in CHECKLIST) |

## Honest gaps

1. **Not run on a device.** The Accessibility Service, overlay, volume-key stop, screenshot check, alarms, relay and Mode A have been compiled (CI) and unit-tested with fakes. They have not been exercised on a real phone. See CHECKLIST.md.
2. **Redaction and the sensitive-word list are pattern based** and will miss things (other languages, split text, images). The hard blocklist, the allowlist and the popups are the real protection, not redaction.
3. **A screen with no text** (a game, a canvas, an image-only button) cannot be checked for credentials by words. FLAG_SECURE and the blank-screenshot check help only where apps use them.
4. **Mode B token.** Whoever holds the connector URL can drive the approved plan until you rotate it. Treat the URL like a password.
5. **Mode A reads another app's screen.** The reply is parsed by marker and strict JSON, but a chat app that changes its layout can make Krish fail (it then stops; it does not guess).
6. **Alarms are lost on reboot** until Krish is opened once (the boot receiver was removed on purpose). Without the exact-alarm permission a notification can arrive a few minutes late.
7. **Accessibility is powerful.** While it is on, Android lets this service see windows of the allowed apps. Turn it off in Android Settings when you do not use Krish.
8. **Social apps.** Pacing lowers but does not remove the chance of an account limit.
9. **Desktop (Electron)** has no phone control; it is the plain AI chat with the same key storage. Provider calls pass through the main process (https only, redirects refused). Linux needs a keyring (GNOME Keyring or KWallet), or keys stay unsaved.
10. **`PackagePolicyTest.kt` is not run by CI** (the workflow does not run Android unit tests); the same policy is covered in TypeScript.

Report issues privately to the repository owner.
