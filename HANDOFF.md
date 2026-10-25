# HANDOFF — read this first

Project: KRISH, source-only personal agent (Android + desktop). Spec: `docs/SPEC.md`.
Rule: update this file at the end of every work session (status table + "Next").

## Environment notes
- Cloud sandbox has Node 24, no Java/Android SDK -> Android code is NOT compiled here. Build in Codespaces (see BUILD.md).
- typescript pinned 6.0.3 because typescript-eslint 8.72 does not support TS 7.

## Status
| Step | Scope | State |
|---|---|---|
| 1 | Core: providers, fallback, model refresh, action schema, redaction | DONE, tested |
| 1b | Core: agent loop, policy gate, memory, history, projects, panels, scheduler, brief | DONE, tested |
| 2 | Android plugins (WebView, files, Keystore, WorkManager), flavors, manifest | DONE; Kotlin COMPILES, both debug APKs assemble; never run on a device |
| 3 | UI: live window, chat, prompts (confirm/secure/takeover), all screens | DONE; builds; store tested; layout/touch untested |
| 4 | History, Lite mode, memory, Projects, Tasks, morning brief | DONE |
| 5 | Desktop (Electron) | WRITTEN; helpers tested; Electron never run |
| 6a | Tier 0 sandbox | DONE, tested in Node |
| 6b | Tier 1 Alpine+proot | WRITTEN; TarGz verified; proot never executed |
| 7 | WebGPU local mode | DONE behind build flag KRISH_LOCAL_MODEL=1; never loaded |
| docs | README, BUILD, SECURITY, CREDITS, CHECKLIST, SOURCE-OFFER, LICENSES | DONE |

## Verified (actually run)
See CHECKLIST.md (authoritative). Summary: 94 core + 11 ui + 7 desktop tests, typecheck, lint, ui build, Gradle Kotlin compile + assembleLiteDebug/assembleFullDebug (lite 5.0 MB, full 9.4 MB).

## Remaining ideas (not required for v1)
- Run on a device and work through CHECKLIST.md "NOT RUN".
- Move ci/workflows/*.yml to .github/workflows/ (needs token with workflow scope).
- Phase 2: phone-control module (stub only).
- A real e2e test of file upload and the live-window layout on hardware.

## Gotchas
- Shell is `sh`: `mkdir -p a/{b,c}` does NOT brace-expand. Use separate args.
- git push token lacks `workflow` scope: workflows live in `ci/workflows/`; move to `.github/workflows/` (BUILD.md explains).
- QuickJS `setMemoryLimit` does not bound growth reliably -> wasm Memory.grow cap in sandbox/tasks.ts (capWasmMemory).
- Sandbox RAM is ~480MB: do not run big test allocations.

## Restart here
`npm ci && npm test && npm run typecheck && npm run lint`, then read CHECKLIST.md. To rebuild Android in this sandbox: JDK 21 at /opt/jdk and SDK at /opt/android/sdk may be gone; see BUILD.md. Sandbox has ~480MB RAM: add swap and set org.gradle.jvmargs=-Xmx420m before ./gradlew, then restore -Xmx1536m.
