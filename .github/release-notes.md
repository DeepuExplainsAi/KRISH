**Unsigned debug builds. NOT tested on a real phone or a real Windows/Linux desktop.** What was checked: typecheck, lint, 301 core / 35 UI / 7 desktop tests, and the Android Kotlin compile for both flavors in CI. See CHECKLIST.md for what was not run.

## What is new: Krish is now a phone-control agent
- **Phone control.** An AI can operate the apps you choose on your phone: read the screen, act, check, repeat. Turn on the Accessibility Service in Android Settings, then pick apps.
- **Allowlist + hard blocklist.** Only your chosen apps. Banking, UPI, wallets, Gmail, SMS, WhatsApp and other private chat, authenticators, password managers, Settings, Play Store and Google account screens can never be used, even if you tick them.
- **Screen protection.** Password fields are never read. A protected (FLAG_SECURE) or blank screen stops the task. OTP / PIN / CVV / password / login / sign in pauses the task: you log in yourself.
- **Asks first.** A plan screen shows the apps and actions before a task starts. A popup asks before every send, post, pay, delete, submit, install, share and newly opened app. No answer in 60 s means No.
- **Mode A:** Krish drives the ChatGPT / Gemini / Claude app on your phone as the brain.
- **Mode B (MCP):** your phone connects out to your own Cloudflare relay (`relay/`); you add the connector URL in ChatGPT or Claude.
- **Saved phone tasks.** Save a task as a macro and schedule it. At the time you get a notification and tap Run. It replays without an AI, through the same safety checks.
- **Stop any time:** red STOP button, either volume key, or lock the phone.
- **Privacy.** Phone numbers, cards, emails and codes are redacted before text goes to an AI. The activity log (with screenshots) stays on the phone; you can read and delete it. Rate limits and random delays in social apps, with a warning that automating Instagram can risk your account.
- **No in-app browser.** The agent WebView, browser view and saved-login vault are removed (Google says "this browser is not secure" inside a WebView). You sign in in the real apps.
- Docs rewritten: SECURITY.md, README.md, CHECKLIST.md.

Built with the help of TODOforAI (https://todofor.ai).

## Files
| File | For |
|---|---|
| `krish-android.apk` | Any Android phone (8.0+). The only Android file you need. |
| `krish-windows-x64.zip` | Windows 64-bit. Unzip, run `Krish.exe`. Plain AI chat only (no phone control on desktop). |
| `krish-linux-x64.tar.gz` | Linux 64-bit. Extract, run `./Krish`. Plain AI chat only. Needs a keyring (for example GNOME Keyring) for API keys. |
| `SHA256SUMS.txt` | Checksums for all files. |

Android: allow "install unknown apps" for your browser or file manager, then turn on Accessibility for Krish. Windows: SmartScreen shows "More info" -> "Run anyway" because the app is unsigned.

## Known gaps
- Never run on a real Android device: Accessibility Service, STOP overlay, volume-key stop, screenshot check, Mode A, Mode B with a real relay, alarms and notifications.
- Alarms are lost after a reboot until Krish is opened once. Without the exact-alarm permission a notification can come a few minutes late.
- Redaction and the sensitive-word list are pattern based and will miss things.
- Real provider calls with real keys are not tested.
- Desktop on real hardware not run: OS keychain, file dialogs.
- Full list: SECURITY.md (honest gaps) and CHECKLIST.md.
