# Security

Scope: v1 of a single-user, local-first app. There is no server. The threat model is: **hostile web pages, hostile model output,
hostile files, a curious provider, and bugs of ours**. Not in scope: a rooted/compromised device, or a malicious user of their own phone.

## Rules the code enforces (and where)

| Rule | Enforced in | Tested by |
|---|---|---|
| Model output is untrusted. Strict JSON, allowlisted action types, https-only URLs without credentials, extra properties rejected. Nothing is eval'd. | `core/src/schema/actions.ts` | `core/test/schema` |
| Page, email, chat-site and sandbox text is data. Delimited blocks; data cannot close its own block. Only the user's typed message is `USER_TASK`. | `core/src/agent/loop.ts`, `prompt.ts` | `core/test/agent` (injection test) |
| Passwords, OTPs, card numbers never reach a model. Secret fields are shown as `(secret field)` without value; typing into them is blocked; the secure card passes the value to native `fill`, never stored or logged. | `core/src/privacy/redact.ts`, `agent/policy.ts`, `ui/src/components/Prompts.tsx` | `core/test/privacy`, `core/test/agent`, `ui/test/store` |
| Redaction of cookies, bearer tokens, JWTs, common key shapes, Luhn-valid card numbers, OTP phrases. Applied to observations, results, history, memory, errors. | `redact.ts` | `core/test/privacy` |
| Sign-in and payment pages are read like any other page. Passwords, codes and card numbers are redacted from everything a model sees, so no page is held back from a provider. | `core/src/privacy/redact.ts`, `agent/loop.ts` | `core/test/privacy`, `core/test/agent` |
| No confirmation cards. The user's own message is the permission, so the agent sends, uploads, clicks consent buttons, runs sandbox tasks and changes memory without asking. What is still refused: an element that is not on the page, and the model typing into a secret field or typing a redaction placeholder. | `core/src/agent/policy.ts` | `core/test/agent/policy.test.ts` |
| Site identity (`sameSite`/`siteOf`) uses the Public Suffix List including private suffixes (`a.github.io` and `b.github.io` differ). A saved login is only filled on the registrable site it was saved for. | `policy.ts` (tldts) | `core/test/agent/policy.test.ts`, `core/test/vault` |
| Element identity: each observed element carries a fingerprint; the host re-derives it from the live node and refuses a mismatch, so a page that swaps entries in its registry cannot redirect an approved action (including a secure fill). | `krish-page.js` (`get(id, fp)`) | `core/test/page` (swap test) |
| Secure input: an explicit target must exist and be a secret field (no fallback to another field); the card names the real site and field; a plain question that asks for a password/OTP/card is refused; fill errors are replaced by a fixed message because page-originated error text could echo the value. | `agent/loop.ts`, `Prompts.tsx`, plugins | `core/test/agent` |
| Everything that goes to a model is redacted first: task, user replies, action history, and element label/placeholder/name/title. | `loop.ts`, `redact.ts` | `core/test/agent` |
| STOP always works (aborts pending prompts). | `core/src/agent/controller.ts` | `core/test/agent` |
| Keys only in Android Keystore (AES-256-GCM, non-exportable key) or OS keychain via Electron safeStorage; refused if the OS cannot encrypt. Keys are sent only in headers, never URLs. | `KrishSecurePlugin.kt`, `desktop/lib.cjs` | `desktop/test`, `core/test/providers` |
| No `addJavascriptInterface` on any WebView that visits external sites. Native calls `evaluateJavascript` and reads the result. The page script is evaluated fresh into a local variable on each call so a page cannot spoof it. | `AgentWebView.kt`, `core/page-script/krish-page.js` | `core/test/page` (spoof test) |
| WebView: file/content access off, universal access from file URLs off, Safe Browsing on, mixed content blocked, all permission prompts denied, non-https navigation refused, SSL errors cancelled. | `AgentWebView.kt` | **untested on device** |
| Cleartext disabled, backups disabled. | `network_security_config.xml`, `AndroidManifest.xml` | static |
| Android permissions: INTERNET, ACCESS_NETWORK_STATE (metered download warning), POST_NOTIFICATIONS (morning-brief opt-in and the "Krish is working" line), FOREGROUND_SERVICE + FOREGROUND_SERVICE_DATA_SYNC + WAKE_LOCK (only while tasks run: `KeepAliveService`, v0.1.12; it holds no data and stops when the queue is empty). No contacts/SMS/camera/mic/location. No Accessibility Service, no overlay: the agent only drives its own WebView (removed in v0.1.9). | `AndroidManifest.xml` | static (see CHECKLIST) |
| Files only through the system picker / save dialog. File tokens are opaque; page JS never sees paths or URIs. | `KrishFilesPlugin.kt`, `desktop/main.cjs` | `desktop/test` |
| Composer attachments: picked in the same system picker, kept as opaque tokens in app state. The model sees only cleaned names and sizes in a fenced `USER_FILES` block (data, not instructions), never tokens, paths or bytes. The model can only pick among the attached names. | `core/src/agent/loop.ts`, `ui/src/state/store.ts` | `core/test/agent/loop.test.ts`, `ui/test/store.test.ts` |
| No analytics, telemetry, ads, crash reporters, remote config, remote code. | whole repo | `grep` in CHECKLIST |
| Desktop: agent view is a separate `WebContentsView` with its own session, `sandbox: true`, no preload, permission requests denied, popups denied, non-https navigation blocked. Page automation runs in an **isolated world** (page JS cannot hook our code or read its registry). Uploads re-verify the element and use an unguessable per-call marker. UI IPC is allowlisted and only accepted from the app's own origin. | `desktop/main.cjs`, `preload.cjs` | partial (`lib.cjs` only) |
| Trusted UI is never covered by page pixels: the native view is positioned from the live `.view` box (not header/footer), and the card collapses to a pill while a question or secure card is open (not for a CAPTCHA, which needs the page). | `LiveWindow.tsx` | **untested on device** |
| Android upload: one-shot authorization bound to the page origin, 5 s expiry, cleared on navigation, STOP and site-data clearing. A chooser from another origin gets nothing. | `PickedFiles.kt`, `AgentWebView.kt` | **untested on device** |

### KrishVault (round 6, 2026-10-28)
- Saved logins are kept for good and used without asking. There is no master passphrase, no lock and no auto-lock. They are stored through the platform key store (Android Keystore AES-256-GCM / OS keychain), which encrypts them at rest. **Trade-off:** anyone who can unlock the phone or the desktop session and open the app can see them in the Vault screen.
- A login typed once into the sign-in card is saved automatically. When a sign-in page opens, the app fills the saved login for that site, then clicks the form's Log in / Continue button itself. Email-first pages are handled step by step (email, then password).
- The model never receives a saved password or username: the app fills the form (`fillSecret`) and the model is only told that it happened. A login is filled only on the registrable site it was saved for (or a login saved for "every site"). One attempt per page and step, six per run, so a wrong password is never retried in a loop.
- The only things the app asks the user for are a password (sign-in card or secure card), a one-time code or bank detail (secure card), a CAPTCHA, and details the agent is missing.
- Values the app typed for the user are scrubbed from model input; a page that transforms a value before showing it (encoding, splitting) is not caught (gap: native fill is not bound to a document token).

### Tabs, email codes and sign-up (round 10, 2026-10-29)
- Up to 4 agent tabs, each the same hardened view (Android `AgentWebView`, Electron `WebContentsView` in the same session). Only the agent opens tabs (`open_tab`); page popups still load in the same tab. Only the active tab reports page events and receives a file-chooser answer.
- **One-time codes never reach a model.** `read_code` runs the page script in the inbox tab; the code stays in the agent loop, is scrubbed from every prompt and event, and only `fill_code` puts it into a field (native fill). The model is told "found / not found". A verification link is opened by the app and its URL is scrubbed. On mail/inbox hosts and on tabs used with `read_code`, every free-standing 4-8 digit number is masked in page text and `read` results; screenshots are not sent while masking is on.
- **Generated passwords never reach a model.** `sign_up` makes the password in the app (crypto RNG; the form's visible rules, default 14 chars with upper/lower/digit and one "!"), fills it natively, and saves site + email + password in KrishVault only after the user confirms the sign-up card.
- **Limits enforced in code:** one account per site per user command; a site that refuses the email stops the run for the user (no automatic retry with another address: typing another address on that site is blocked until the user answers); CAPTCHA / bot checks are only ever done by the user (Done card); no payment step is part of this flow. Temporary inboxes are used only when the user names one.
- Known limit: code extraction is a heuristic on page text; a cross-origin message frame cannot be read (then "not found"). Masking is pattern based like the rest of redaction.

### Native model downloads (round 12, untested on a phone)
- Model weights are data, not executable code, but future native parsers must still treat them as untrusted. Only IDs in the bundled catalog are accepted. No model file is bundled with the APK. A first-download consent dialog names the model, size, huggingface.co and its storage servers. The connection necessarily reveals the device's IP to those servers; no chat or page data or telemetry is sent in a download request.
- The native downloader uses a dedicated OkHttp client with no cookie jar or authorization, HTTPS only, host allowlist (`huggingface.co` or any subdomain ending in `.hf.co`), default port, no credentials in the URL and bounded, manually validated redirects. The `.hf.co` suffix includes Hugging Face storage/CDN hosts. Unknown redirect hosts fail closed. The selected revision, file, byte size and SHA-256 are pinned in the bundled catalog; a partial file is installed only after size and SHA-256 validation. This code has not yet been tested against the actual server or on Android.
- Files stay in app-private storage. Downloads check remaining space plus 15% of full size, with a separate check if a server ignores a resumed Range. Metered-network warning uses `ACCESS_NETWORK_STATE`. A failed checksum attempts to delete the partial; deletion failures are reported. OS/process death can leave a partial file for resume. Downloads hold a separate lease on KeepAliveService from agent tasks and continue through activity destruction, but Android may still terminate the process or stop the service (including Android 15 data-sync time limits); this is not a guarantee of completion. No real-device test has run.
- Native inference is not built: downloaded files cannot answer, and the online backup switch is intentionally disabled until inference exists. Existing API routing and redaction/fencing are unchanged. Future inference must receive only the existing redacted fenced prompt.

## Sandbox tiers

- **Tier 0 (always on):** a fresh Web Worker per task. Bundled JS/WASM only: fflate (zip/unzip) and QuickJS compiled to WebAssembly for scripts.
  The QuickJS VM has no host bindings except `print`, a 5 s deadline and a memory cap. The worker removes `fetch`, XHR, WebSocket, etc.
  Zip entries with `..`, absolute or drive paths are rejected; expanded size is checked from the central directory before inflating.
  Output is data. The worker has no route to the native bridge. **Known limit:** QuickJS's own `setMemoryLimit` did not bound growth reliably in testing; the real cap is a WebAssembly `Memory.grow` limit (`capWasmMemory`).
- **Tier 1 (Android "full" only, off by default):** Alpine minirootfs under proot, extracted to app-private storage after a SHA-256 check.
  Disabled on low-RAM devices. **proot cannot block the network**, so "Network OFF by default" is *not* technically enforced here: nothing sensitive (cookies, keys, browser data) is placed in the rootfs. If Android blocks execution, the plugin returns a clear error and Tier 0 continues.
- **Desktop container tier:** only if Docker and the `alpine:3` image already exist locally. `--network none --read-only --cap-drop ALL --pids-limit --memory --user 65534`, never pulls.

## Honest gaps

0. **Android page script runs in the page's JavaScript world.** WebView has no isolated-world API. A hostile page can hook prototypes or setters. What still holds: element fingerprints, fixed error text on fill, and the fact that nothing secret is ever passed except the value of a field the user was asked about on the named site. What does not: a page that hooks `HTMLInputElement.prototype.value` can read a value the user types into a *password field on that same page*, which is the same value the page's own form would receive. Desktop does not have this limit (isolated world).
0b. **Redirects are checked at action time, not blocked at the network layer.** `shouldOverrideUrlLoading` only sees top-level navigations and cannot enforce a site allowlist for scripts or subresources. The policy asks before the next consequential action on a page that left the approved site. It does not stop a page from loading a destination.
0c. **Linux keyring.** Desktop refuses to store keys when Electron's backend is `basic_text`/unknown; install gnome-keyring or KWallet, or keys stay unsaved.

1. **On-device WebGPU model vs. "no remote code":** web-llm downloads model weights and a model-runtime WASM from its host on first use. For that reason it is **not compiled in by default** (`KRISH_LOCAL_MODEL=1`), gated by a consent dialog, and described here. It sends no user data.
2. **Tier 1 network**, as above.
3. **Desktop provider calls** pass through the Electron main process (https only, redirects refused). Android uses Capacitor's native HTTP.
4. **Heuristics:** redaction is pattern-based and will miss things. The secure card is the real protection for passwords and codes.
4a. **No confirmation cards (by choice, round 6).** A wrong model step (a mistaken send, a click on the wrong button) runs without a second look. STOP is the only brake.
5. **Scheduled tasks never run unattended.** They notify; you tap Run.
6. **Android code was compile-checked, not run on a device.** See CHECKLIST.md.

Report issues privately to the repository owner.
