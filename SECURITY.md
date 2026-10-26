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
| Sensitive pages (login, bank, payment, secret fields) only go to providers with "Allow on sensitive pages" on (default off). Otherwise the agent hands over to the user. | `core/src/providers/router.ts`, `agent/loop.ts` | `core/test/providers`, `core/test/agent` |
| Confirmation (exact preview) before send/submit, upload, shell/sandbox writes, leaving the opened site, consent clicks. A click is only auto-allowed as "cosmetic" if it does not submit a form (effective type, not just the attribute) and **every** label/text/title is cosmetic; a risky word in any of them asks. | `core/src/agent/policy.ts`, `page-script` (`submits`) | `core/test/agent/policy.test.ts` |
| "Same site" uses the Public Suffix List including private suffixes (`a.github.io` and `b.github.io` differ). If the page is no longer on the approved site (redirect or script navigation), any action other than read/wait/ask/navigate asks first. | `policy.ts` (tldts) | `core/test/agent/policy.test.ts` |
| Sandbox write confirmation is derived from the tool, never from the model's `writesFiles` claim (zip/unzip/shell always ask; scripts that touch `output` ask). | `policy.ts` (`sandboxWrites`) | same |
| Element identity: each observed element carries a fingerprint; the host re-derives it from the live node and refuses a mismatch, so a page that swaps entries in its registry cannot redirect an approved action (including a secure fill). | `krish-page.js` (`get(id, fp)`) | `core/test/page` (swap test) |
| Secure input: an explicit target must exist and be a secret field (no fallback to another field); the card names the real site and field; a plain question that asks for a password/OTP/card is refused; fill errors are replaced by a fixed message because page-originated error text could echo the value. | `agent/loop.ts`, `Prompts.tsx`, plugins | `core/test/agent` |
| Everything that goes to a model is redacted first: task, user replies, action history, and element label/placeholder/name/title. | `loop.ts`, `redact.ts` | `core/test/agent` |
| STOP always works (aborts pending prompts); Take over pauses; Resume continues. | `core/src/agent/controller.ts` | `core/test/agent` |
| Keys only in Android Keystore (AES-256-GCM, non-exportable key) or OS keychain via Electron safeStorage; refused if the OS cannot encrypt. Keys are sent only in headers, never URLs. | `KrishSecurePlugin.kt`, `desktop/lib.cjs` | `desktop/test`, `core/test/providers` |
| No `addJavascriptInterface` on any WebView that visits external sites. Native calls `evaluateJavascript` and reads the result. The page script is evaluated fresh into a local variable on each call so a page cannot spoof it. | `AgentWebView.kt`, `core/page-script/krish-page.js` | `core/test/page` (spoof test) |
| WebView: file/content access off, universal access from file URLs off, Safe Browsing on, mixed content blocked, all permission prompts denied, non-https navigation refused, SSL errors cancelled. | `AgentWebView.kt` | **untested on device** |
| Cleartext disabled, backups disabled. | `network_security_config.xml`, `AndroidManifest.xml` | static |
| Android permissions: INTERNET, POST_NOTIFICATIONS (requested only by the morning-brief opt-in). No contacts/SMS/camera/mic/location/overlay/Accessibility. | `AndroidManifest.xml` | static (see CHECKLIST) |
| Files only through the system picker / save dialog. File tokens are opaque; page JS never sees paths or URIs. | `KrishFilesPlugin.kt`, `desktop/main.cjs` | `desktop/test` |
| Composer attachments: picked in the same system picker, kept as opaque tokens in app state. The model sees only cleaned names and sizes in a fenced `USER_FILES` block (data, not instructions), never tokens, paths or bytes. Each upload still needs the confirm card, and the model can only pick among the attached names. | `core/src/agent/loop.ts`, `ui/src/state/store.ts` | `core/test/agent/loop.test.ts`, `ui/test/store.test.ts` |
| No analytics, telemetry, ads, crash reporters, remote config, remote code. | whole repo | `grep` in CHECKLIST |
| Desktop: agent view is a separate `WebContentsView` with its own session, `sandbox: true`, no preload, permission requests denied, popups denied, non-https navigation blocked. Page automation runs in an **isolated world** (page JS cannot hook our code or read its registry). Uploads re-verify the element and use an unguessable per-call marker. UI IPC is allowlisted and only accepted from the app's own origin. | `desktop/main.cjs`, `preload.cjs` | partial (`lib.cjs` only) |
| Trusted UI is never covered by page pixels: the native view is positioned from the live `.view` box (not header/footer), and the card collapses to a pill while a confirm, question or secure card is open (not for CAPTCHA take-over). | `LiveWindow.tsx` | **untested on device** |
| Android upload: one-shot authorization bound to the page origin, 5 s expiry, cleared on navigation, STOP and site-data clearing. A chooser from another origin gets nothing. | `PickedFiles.kt`, `AgentWebView.kt` | **untested on device** |

## Sandbox tiers

- **Tier 0 (always on):** a fresh Web Worker per task. Bundled JS/WASM only: fflate (zip/unzip) and QuickJS compiled to WebAssembly for scripts.
  The QuickJS VM has no host bindings except `print`, a 5 s deadline and a memory cap. The worker removes `fetch`, XHR, WebSocket, etc.
  Zip entries with `..`, absolute or drive paths are rejected; expanded size is checked from the central directory before inflating.
  Output is data. The worker has no route to the native bridge. **Known limit:** QuickJS's own `setMemoryLimit` did not bound growth reliably in testing; the real cap is a WebAssembly `Memory.grow` limit (`capWasmMemory`).
- **Tier 1 (Android "full" only, off by default):** Alpine minirootfs under proot, extracted to app-private storage after a SHA-256 check.
  Disabled on low-RAM devices. **proot cannot block the network**, so "Network OFF by default" is *not* technically enforced here: every shell command
  requires confirmation, and nothing sensitive (cookies, keys, browser data) is placed in the rootfs. If Android blocks execution, the plugin returns a clear error and Tier 0 continues.
- **Desktop container tier:** only if Docker and the `alpine:3` image already exist locally. `--network none --read-only --cap-drop ALL --pids-limit --memory --user 65534`, never pulls.

## Honest gaps

0. **Android page script runs in the page's JavaScript world.** WebView has no isolated-world API. A hostile page can hook prototypes or setters. What still holds: element fingerprints, fixed error text on fill, and the fact that nothing secret is ever passed except the value of a field the user was asked about on the named site. What does not: a page that hooks `HTMLInputElement.prototype.value` can read a value the user types into a *password field on that same page*, which is the same value the page's own form would receive. Desktop does not have this limit (isolated world).
0b. **Redirects are checked at action time, not blocked at the network layer.** `shouldOverrideUrlLoading` only sees top-level navigations and cannot enforce a site allowlist for scripts or subresources. The policy asks before the next consequential action on a page that left the approved site. It does not stop a page from loading a destination.
0c. **Linux keyring.** Desktop refuses to store keys when Electron's backend is `basic_text`/unknown; install gnome-keyring or KWallet, or keys stay unsaved.

1. **On-device WebGPU model vs. "no remote code":** web-llm downloads model weights and a model-runtime WASM from its host on first use. For that reason it is **not compiled in by default** (`KRISH_LOCAL_MODEL=1`), gated by a consent dialog, and described here. It sends no user data.
2. **Tier 1 network**, as above.
3. **Desktop provider calls** pass through the Electron main process (https only, redirects refused). Android uses Capacitor's native HTTP.
4. **Heuristics:** redaction and sensitive-page detection are pattern-based and will miss things. The per-provider flag and the secure card are the real protections.
5. **Scheduled tasks never run unattended.** They notify; you tap Run. This is deliberate (confirmations need you).
6. **Android code was compile-checked, not run on a device.** See CHECKLIST.md.

Report issues privately to the repository owner.
