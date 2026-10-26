# Krish

A free-to-run personal agent for Android and desktop. You log in to your own accounts once inside the app's built-in
browser, then give plain-language commands. The agent reads pages, fills forms, pastes text, uploads files you pick, and
types prompts into AI chat sites, asking before anything risky.

No backend server. You bring your own API keys. Everything the agent does is visible in the app and logged on your device.

**Source only.** This repository contains no APK or installer. Build instructions: [BUILD.md](BUILD.md).
**Current status and what is unverified:** [CHECKLIST.md](CHECKLIST.md). Working on it? Read [HANDOFF.md](HANDOFF.md) first.

## Layout

| Path | What |
|---|---|
| `core/` | Shared TypeScript: provider adapters + fallback, strict action schema, redaction, agent loop, policy gate, memory, history, projects, panels, scheduler. Page-side script in `core/page-script/`. |
| `ui/` | React + Vite app: Home, Chat (with file attach) with live browser window, Projects (top tabs); Panels, Tasks, History, Providers, Settings, Security (Menu). 7 UI languages (`ui/src/i18n`), light/dark/system theme. Tier 0 sandbox. |
| `android/` | Capacitor + Kotlin plugins. Hardened agent WebView, Keystore secrets, WorkManager, file picker. Flavors `lite` and `full`. |
| `desktop/` | Electron shell: agent browser in a separate sandboxed `WebContentsView`, OS-keychain secrets, optional Docker tier. |
| `LICENSES/`, `CREDITS.md`, `SOURCE-OFFER.md`, `DEPENDENCIES.md` | Licenses, attribution, and why each dependency exists. |

## How safety works (short)

- Model output is untrusted strict JSON, validated against a schema and an allowlist. Nothing is evaluated.
- Page, email, chat-site and sandbox text is wrapped as data. Only the message you type in the app is a command.
- Passwords, OTPs and card numbers never reach a model: the app shows its own masked card and fills the page itself.
- Sends, uploads, deletes, settings changes and shell commands show the exact content first (Confirm / Cancel).
- Keys live in Android Keystore-backed storage (desktop: OS keychain), only ever in request headers.
- No analytics, telemetry, ads, crash reporters, remote config or remote code. See [SECURITY.md](SECURITY.md).

## Develop

```sh
npm ci
npm run typecheck && npm run lint && npm test
npm run dev:ui          # browser-only demo with a fake page
```
