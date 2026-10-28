**Unsigned DEBUG builds. They were NOT tested on a real phone or on a real Windows/Linux desktop.** What was checked: the files build in CI, the APK is valid and carries the expected application ID, the Windows and Linux packages contain the app, and the Linux build starts and keeps running for 25 seconds under a virtual display. Nothing beyond that.

## What changed in 0.1.12
- **One provider at a time.** Krish uses your first provider and its one model until that provider's daily limit is really used up, then the next one. The built-in free services come last. OpenCode, OpenRouter, Groq, Gemini... follow the order on the API Keys screen. No more many models inside one provider.
- **Task queue.** Type the next task while one is running: it waits in the chat and runs afterwards. STOP stops the running task and clears the queue. A "Krish is working" notification (Android) and a no-sleep lock (PC) keep it running with the screen off.
- **Retry, then another way, then ask.** After 4 failed tries Krish tries a different method before it asks you.
- **PC layout fixed:** the browser card is taller and the page fits it without being cut off. The AI is told what screen you have.
- Sign-in button detection is wider (links, "Continue with email", "Submit").
- Not included, on purpose: automatic "I am human" / CAPTCHA clicking and temp-mail account sign-ups (they defeat sites' protection; you still tap Done), and a second tab (one tab, with copy and paste between pages, works).
- If the AI still does not answer: add a real key at the top of API Keys and press Test. The built-in free services are shared and often full.

Built with the help of TODOforAI (https://todofor.ai).

## Files
| File | For |
|---|---|
| `krish-android.apk` | Any Android phone (8.0+). The only Android file you need. |
| `krish-windows-x64.zip` | Windows 64-bit. Unzip, run `Krish.exe`. |
| `krish-linux-x64.tar.gz` | Linux 64-bit. Extract, run `./Krish`. |
| `SHA256SUMS.txt` | Checksums for all files. |

Android: allow "install unknown apps" for your browser or file manager. Windows: SmartScreen shows "More info" -> "Run anyway" because the app is unsigned. Linux: needs a keyring (for example GNOME Keyring) for KrishVault.

## Known gaps
- Never run on a real Android device: file upload tap, Keystore round trip, Tier 1 (Alpine + proot) execution, live-window position under the UI.
- Desktop on real hardware not run: OS keychain (`safeStorage`), file dialogs, file upload via debugger, Docker tier, `openExternal`.
- KrishVault is not tested on a real Keystore/keychain. On Linux without a keyring the vault refuses to be created.
- Real provider calls with real keys are not tested (request shapes follow public docs and mocks).
- Real logins on real sites are not tested.
- Known limit: a hostile page can still transform a value (encode, split, reverse) before showing it; the echo scrub only catches exact copies. Android has no isolated JS world and no network-level site allowlist (see SECURITY.md).
- Optional on-device model (WebGPU) is not included in these builds.
