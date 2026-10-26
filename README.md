# Krish

**Free, open-source AI agent for Android, Windows and Linux.** Krish is an AI browser agent that works inside your own logged-in accounts: you give a plain-language command, it reads pages, fills forms, uploads files you pick and types into AI chat sites, and asks before anything risky. Bring your own API key (Gemini, Groq, OpenRouter and more), no Krish account, no backend server, no telemetry.

## Download

**[Latest builds: github.com/DeepuExplainsAi/KRISH/releases](https://github.com/DeepuExplainsAi/KRISH/releases)** (v0.1.1 is a pre-release: unsigned debug builds, not yet tested on real devices; details in the release notes)

| Platform | File | Install |
|---|---|---|
| Android 8.0+ | [`krish-android.apk`](https://github.com/DeepuExplainsAi/KRISH/releases/download/v0.1.1/krish-android.apk) | Open the APK and allow "install unknown apps" when asked. One file for every phone. |
| Windows 10/11 x64 | [`krish-windows-x64.zip`](https://github.com/DeepuExplainsAi/KRISH/releases/download/v0.1.1/krish-windows-x64.zip) | Unzip, run `Krish.exe`. SmartScreen: "More info" then "Run anyway" (the app is unsigned). |
| Linux x64 | [`krish-linux-x64.tar.gz`](https://github.com/DeepuExplainsAi/KRISH/releases/download/v0.1.1/krish-linux-x64.tar.gz) | `tar xzf krish-linux-x64.tar.gz && ./Krish-linux-x64/Krish`. KrishVault needs a keyring such as GNOME Keyring. |

Check a download against `SHA256SUMS.txt` from the same release. First run: Menu, then Providers, add a free API key (each provider has a "Get key" button), then type a task in Chat.

**Prefer to build it yourself?** Source and steps: [BUILD.md](BUILD.md).
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
- KrishVault keeps your logins encrypted with one master passphrase and fills them into a login page after you confirm; the AI never sees them.
- Tell Krish in chat to remember, update or forget something and it changes its memory.
- Sends, uploads, deletes, settings changes and shell commands show the exact content first (Confirm / Cancel).
- Keys live in Android Keystore-backed storage (desktop: OS keychain), only ever in request headers.
- No analytics, telemetry, ads, crash reporters, remote config or remote code. See [SECURITY.md](SECURITY.md).

## Develop

```sh
npm ci
npm run typecheck && npm run lint && npm test
npm run dev:ui          # browser-only demo with a fake page
```
