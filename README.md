# Krish

**Free, open-source Android phone-control agent.** Krish lets an AI operate the apps *you* choose on your phone, one visible step at a time:
it reads the screen, acts, checks the result and repeats. It never touches banking, private chat, mail, password or settings apps, never logs in for you,
and asks before every send, post, payment, delete, submit, install, share or newly opened app. Everything stays on your phone.

Two ways to give it a brain (one at a time):

- **Mode A: your chat app.** Krish types the task into the ChatGPT / Gemini / Claude app on the same phone, reads the reply and does what it says.
- **Mode B: MCP.** Your phone connects out to your own small Cloudflare relay (`relay/`). You paste the connector URL into ChatGPT or Claude; the chat app calls `open_app`, `read_screen`, `tap`, `type`.

Plus **saved phone tasks**: save the steps of a task and replay them on a schedule without an AI (same safety checks; you get a notification and tap Run).
The same app also has a plain AI chat, Panels, Projects, History and API Keys.

Safety design and honest gaps: [SECURITY.md](SECURITY.md). Spec: [docs/PHONE-CONTROL-SPEC.md](docs/PHONE-CONTROL-SPEC.md).
**What is verified and what is not:** [CHECKLIST.md](CHECKLIST.md). Working on it? Read [HANDOFF.md](HANDOFF.md) first.

> **Status:** compiled and unit-tested; **not yet run on a real phone.** There is no in-app browser: you sign in yourself in the real apps.

## Set up

1. Install the APK ([releases](https://github.com/DeepuExplainsAi/KRISH/releases); unsigned debug builds, allow "install unknown apps").
2. Open Menu, then Phone control. Read and accept the consent screen.
3. Turn on the Accessibility Service in Android Settings (the app has a button), allow notifications, and exempt Krish from battery optimization.
4. Tick the apps the agent may use. Banking, chat, mail, password and system apps are greyed out and can never be allowed.
5. Pick Mode A or Mode B, write the task, review the plan (apps and actions), tap Start.

Stop any time: the red STOP button, either volume key, or lock the phone.

## Layout

| Path | What |
|---|---|
| `core/` | Shared TypeScript. `security/` (allowlist, blocklist, screen gate, plan and confirmation gate, pacing, activity log, consent), `phone/` (engine, MCP server, relay client, Mode A chat driver, macros and replay, service), `privacy/` (redaction), `providers/` (AI providers for the chat), `memory/`. |
| `ui/` | React + Vite app. Phone control, Chat, Projects, Panels, Tasks (alarms and saved phone tasks), History, API Keys, Settings, Security. 7 languages, light/dark theme. |
| `android/` | Capacitor + Kotlin: Accessibility Service, safety overlay, Keystore secrets, AlarmManager, optional on-device model. Flavors `lite` and `full`. |
| `relay/` | Cloudflare Worker for Mode B. Stores nothing. |
| `desktop/` | Electron shell for the plain chat (no phone control). |
| `LICENSES/`, `CREDITS.md`, `SOURCE-OFFER.md`, `DEPENDENCIES.md` | Licenses, attribution, why each dependency exists. |

## How safety works (short)

- Allowlist first: only your chosen apps; a foreign app in front pauses the task and nothing is read.
- A hard blocklist wins over the allowlist (banking, UPI, wallets, Gmail, SMS, WhatsApp, authenticators, password managers, Settings, Play Store, Google account).
- Password fields are never read. FLAG_SECURE or a blank screenshot stops the task. OTP / PIN / CVV / password / login / sign in pauses it for you.
- Phone numbers, card numbers, emails and codes are redacted before text goes to any AI.
- Confirmation popup for send / post / pay / delete / submit / install / share and every new app; no answer in 60 s means No.
- Rate limits and random delays in social apps, with a warning that automating Instagram can get your account limited.
- The activity log is on the phone only; you can read and delete it. No analytics, telemetry or ads.

## Develop

```sh
npm ci
npm run typecheck && npm run lint && npm test
npm run dev:ui          # browser-only UI demo (no phone control)
```
