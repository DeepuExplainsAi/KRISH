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
| Confirmation (exact preview) before send/submit, upload, shell/sandbox writes, leaving the opened site, consent clicks. Cosmetic popups ("Not now") are dismissed automatically. | `core/src/agent/policy.ts` | `core/test/agent` |
| Work only in the opened tab; navigation off-site asks first. | `policy.ts` (`sameSite`) | `core/test/agent` |
| STOP always works (aborts pending prompts); Take over pauses; Resume continues. | `core/src/agent/controller.ts` | `core/test/agent` |
| Keys only in Android Keystore (AES-256-GCM, non-exportable key) or OS keychain via Electron safeStorage; refused if the OS cannot encrypt. Keys are sent only in headers, never URLs. | `KrishSecurePlugin.kt`, `desktop/lib.cjs` | `desktop/test`, `core/test/providers` |
| No `addJavascriptInterface` on any WebView that visits external sites. Native calls `evaluateJavascript` and reads the result. The page script is evaluated fresh into a local variable on each call so a page cannot spoof it. | `AgentWebView.kt`, `core/page-script/krish-page.js` | `core/test/page` (spoof test) |
| WebView: file/content access off, universal access from file URLs off, Safe Browsing on, mixed content blocked, all permission prompts denied, non-https navigation refused, SSL errors cancelled. | `AgentWebView.kt` | **untested on device** |
| Cleartext disabled, backups disabled. | `network_security_config.xml`, `AndroidManifest.xml` | static |
| Android permissions: INTERNET, POST_NOTIFICATIONS (requested only by the morning-brief opt-in). No contacts/SMS/camera/mic/location/overlay/Accessibility. | `AndroidManifest.xml` | static (see CHECKLIST) |
| Files only through the system picker / save dialog. File tokens are opaque; page JS never sees paths or URIs. | `KrishFilesPlugin.kt`, `desktop/main.cjs` | `desktop/test` |
| No analytics, telemetry, ads, crash reporters, remote config, remote code. | whole repo | `grep` in CHECKLIST |
| Desktop: agent view is a separate `WebContentsView` with its own session, `sandbox: true`, no preload, permission requests denied, popups denied, non-https navigation blocked. UI IPC is allowlisted and only accepted from the app's own origin. | `desktop/main.cjs`, `preload.cjs` | partial (`lib.cjs` only) |

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

1. **On-device WebGPU model vs. "no remote code":** web-llm downloads model weights and a model-runtime WASM from its host on first use. For that reason it is **not compiled in by default** (`KRISH_LOCAL_MODEL=1`), gated by a consent dialog, and described here. It sends no user data.
2. **Tier 1 network**, as above.
3. **Desktop provider calls** pass through the Electron main process (https only, redirects refused). Android uses Capacitor's native HTTP.
4. **Heuristics:** redaction and sensitive-page detection are pattern-based and will miss things. The per-provider flag and the secure card are the real protections.
5. **Scheduled tasks never run unattended.** They notify; you tap Run. This is deliberate (confirmations need you).
6. **Android code was compile-checked, not run on a device.** See CHECKLIST.md.

Report issues privately to the repository owner.
