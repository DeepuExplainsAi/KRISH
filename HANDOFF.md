# HANDOFF — read this first

Project: KRISH, source-only personal agent (Android + desktop). Spec: `docs/SPEC.md`.
Rule: update this file at the end of every work session (status table + "Next").

## Environment notes
- Cloud sandbox has Node 24, no Java/Android SDK -> Android code is NOT compiled here. Build in Codespaces (see BUILD.md).
- typescript pinned 6.0.3 because typescript-eslint 8.72 does not support TS 7.

## Status
| Step | Scope | State |
|---|---|---|
| 1 | Core: providers, fallback, model refresh, action schema, redaction, tests | DONE (56 tests) |
| 1b | Core: agent loop, policy/confirm gate, history, memory, projects, panels, scheduler, brief | DONE (80 tests total) |
| 2 | Android WebView plugin (Kotlin, flavors, manifest, Keystore, WorkManager) | WRITTEN, NEVER COMPILED (no JDK here). CI job `android-compile` in .github/workflows/check.yml is the first check |
| 3 | Live window, upload, confirm gate, STOP, redaction | DONE in code: ui/ builds, 4 store tests pass; native side + layout UNTESTED on device |
| 4 | History, Lite mode, memory, Projects, Tasks, morning brief | DONE in code (core tested; screens built; DueWorker untested) |
| 5 | Desktop (Electron): main/preload/lib + ui platform | WRITTEN; lib.cjs helpers tested (7); Electron main/preload NEVER RUN (binary not installed here) |
| 6a | Tier 0 sandbox (Worker + fflate + QuickJS WASM) | DONE: 7 node tests pass (zip-slip, bomb, loop, memory cap, no host globals). Worker itself never run in a real browser |
| 6b | Tier 1 Alpine+proot (android full flavor) | TODO |
| 7 | WebGPU local mode | TODO |
| docs | README, SECURITY, DEPENDENCIES, CREDITS, CHECKLIST, BUILD, workflow | TODO |

## Verified (actually run)
- core page script (core/page-script/krish-page.js) tested under jsdom (90 tests total)
- core: `npm test` (80 pass), `npm run typecheck`, `npm run lint` clean (2026-10-25)

## Untested / unverified
- everything Android (Kotlin never compiled), Electron, UI
- android/gradle/wrapper/gradle-wrapper.jar is a generated binary (Gradle standard); kept, document in CHECKLIST

## Gotchas
- Shell is `sh`: `mkdir -p a/{b,c}` does NOT brace-expand. Use separate args.
- git push token lacks `workflow` scope: workflows live in `ci/workflows/`; move to `.github/workflows/` (BUILD.md explains).
- QuickJS `setMemoryLimit` does not bound growth reliably -> wasm Memory.grow cap in sandbox/tasks.ts (capWasmMemory).
- Sandbox RAM is ~480MB: do not run big test allocations.

## Next
- ui/ (React+Vite): `npm run build:ui` is referenced by CI and not yet defined; screens: Home, Chat+LiveWindow, Panels, Projects, Tasks, History, Providers, Settings, Security
- ui/src/platform/*.ts: adapters mapping Capacitor plugins (KrishBrowser, KrishFiles, KrishSecure, KrishSystem) to core ports (PageDriver, KeyStore, KVStore)
- Then UI (ui/), desktop, sandbox, docs. Android/Electron cannot be compiled in this sandbox: mark everything unverified in CHECKLIST.md
