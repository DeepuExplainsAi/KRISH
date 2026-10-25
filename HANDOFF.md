# HANDOFF — read this first

Project: KRISH, source-only personal agent (Android + desktop). Spec: `docs/SPEC.md`.
Rule: update this file at the end of every work session (status table + "Next").

## Environment notes
- Cloud sandbox has Node 24, no Java/Android SDK -> Android code is NOT compiled here. Build in Codespaces (see BUILD.md).
- typescript pinned 6.0.3 because typescript-eslint 8.72 does not support TS 7.

## Status
| Step | Scope | State |
|---|---|---|
| 1 | Core: providers, fallback, model refresh, action schema, tests | IN PROGRESS |
| 2 | Android WebView plugin | TODO |
| 3 | Live window, upload, confirm gate, STOP, redaction | TODO (redaction in core) |
| 4 | History, Lite mode, memory, Projects, Tasks, morning brief | TODO |
| 5 | Desktop (Electron) | TODO |
| 6 | Tier 0 / Tier 1 sandbox | TODO |
| 7 | WebGPU local mode | TODO |
| docs | README, SECURITY, DEPENDENCIES, CREDITS, CHECKLIST, BUILD, workflow | TODO |

## Verified (actually run)
- nothing yet

## Untested / unverified
- everything Android, Electron, UI

## Next
- finish step 1, run `npm test && npm run typecheck && npm run lint`
