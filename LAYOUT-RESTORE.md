<!-- Built with TODOforAI — https://todofor.ai -->
# Browser-card layout: what it is, why, and how to put the old one back

Written in Round 8 (v0.1.12). Read this before touching the browser card (`ui/src/components/LiveWindow.tsx`, `.live` in `ui/src/styles.css`, `AgentWebView.place`, `desktop/main.cjs applyEmulation`).

## Two layouts exist
| | **PC layout** (web view, default, `settings.desktopLayout = true`) | **Mobile layout** (`desktopLayout = false`) |
|---|---|---|
| What the page is | Laid out as on a PC (1024 CSS px wide on a phone card, 1280 on a card 700 px or wider), then scaled down so the whole width fits the card | Each site's own phone version at the card's real size |
| Android | WebView made `w/scale` wide, `scaleX/scaleY = scale`, desktop user agent | Normal WebView, mobile user agent |
| Desktop (Electron) | `enableDeviceEmulation` with `size = card / scale` and `scale = min(1, card / layoutWidth)`, desktop user agent | `disableDeviceEmulation()` |
| Good for | The AI: nav bars, "Log in" buttons and menus are on the page and not behind a hamburger. The user: sees the whole page. | Big, readable text. Sites that break at 1024+ px. |
| Bad for | Small text on a phone (the user can open Expand for full screen) | Hidden menus; login often behind a menu; more scrolling for the AI |

**Decision (Round 8): PC layout stays the default.** It is what the agent works best in (everything it needs is on the page), and the owner asked for a "PC look that works on mobile". The old cut-off at the bottom is fixed, see below. The user can switch in Settings -> "Desktop layout in the browser window"; nothing else changes.

## What was wrong ("window cut off at the bottom")
1. The card was `clamp(240px, 50dvh, 520px)` tall; on a phone that is a small box and the status strip below it could be pushed off-screen.
2. Electron emulated a fixed 1280x800 page and scaled it by `min(w/1280, h/800)`, so the page was letterboxed or cut when the card was not 16:10.
3. Android laid the page out at exactly 1280 px, so a 360 px card scaled it to 28%.

## What changed (v0.1.12)
- `ui/src/styles.css` `.live`: height `clamp(300px, 62dvh, 680px)` (was `clamp(240px, 50dvh, 520px)`).
- `android/.../AgentWebView.kt`: `layoutWidth(cardWidth)` = 1024 below 700 px, else 1280 (was the constant `DESKTOP_WIDTH = 1280.0`). `place()` uses `scale = min(1, w / layoutWidth(w))`.
- `desktop/lib.cjs` `layoutWidth` (same rule, unit-tested) and `desktop/main.cjs applyEmulation`: the emulated size is `card / scale`, so it fills the card in both directions (was fixed 1280x800).

## Put the OLD layout back (exact steps)
Old code is in git commit `f7ad55e` (tag `v0.1.11`).
```
git show f7ad55e:ui/src/styles.css            # the .live rule: height: clamp(240px, 50dvh, 520px)
git show f7ad55e:android/app/src/main/java/app/krish/agent/AgentWebView.kt   # DESKTOP_WIDTH = 1280.0
git show f7ad55e:desktop/main.cjs             # applyEmulation (1280x800, scale = min(w/1280, h/800))
```
1. `ui/src/styles.css`: set `.live { height: clamp(240px, 50dvh, 520px); }`.
2. `AgentWebView.kt`: replace `layoutWidth(w)` in `place()` by `DESKTOP_WIDTH` and restore `const val DESKTOP_WIDTH = 1280.0` in the companion object.
3. `desktop/main.cjs`: restore the old `applyEmulation` body (`scale = Math.min(bounds.width / 1280, bounds.height / 800)`, `size 1280x800`).
4. `desktop/lib.cjs` / `desktop/test/lib.test.ts`: delete `layoutWidth` and its test (or keep it unused).
5. `npm run typecheck && npm run lint && npm test`.

To go back to **mobile sites only** without any code change: Settings -> turn off "Desktop layout in the browser window", or set `desktopLayout: false` in `DEFAULT_SETTINGS` (`ui/src/state/store.ts`). The AI is told which one is active (DEVICE line in the prompt, `AppStore.deviceLine()`).

## Not verified
Layout was not seen on a real phone or desktop window in this round (no device in the build sandbox). `AgentWebView.kt` compiles only in CI.
