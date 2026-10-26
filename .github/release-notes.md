**Unsigned DEBUG builds. They were NOT tested on a real phone or on a real Windows/Linux desktop.** What was checked: the files build in CI, the APK is valid and carries the expected application ID, the Windows and Linux packages contain the app, and the Linux build starts and keeps running for 25 seconds under a virtual display. Nothing beyond that.

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
