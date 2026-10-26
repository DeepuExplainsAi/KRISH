# Prompt for an AI agent: build APK + desktop apps and publish a GitHub Release

Give this to any AI agent that has a shell and GitHub access with `repo` + `workflow` scopes (`gh auth refresh -s workflow`, or a token with both).

```
You have shell access and a GitHub login (gh) with repo + workflow scopes. Repo: https://github.com/DeepuExplainsAi/KRISH (owner: DeepuExplainsAi, branch main). KRISH is a free personal agent: core/ (TypeScript), ui/ (React+Vite), android/ (Capacitor + Kotlin, flavors lite and full), desktop/ (Electron 45).

GOAL: the owner does nothing by hand. You enable CI, build the Android APKs and the desktop apps on GitHub Actions, fix whatever breaks, publish everything on a GitHub Release page, and update the docs. Work in this order and do not stop until the Release page exists with working download files.

READ FIRST: HANDOFF.md, BUILD.md, ci/workflows/*.yml (check.yml, build-apk.yml, build-desktop.yml were written but never run; they sit in ci/workflows/ because an earlier token lacked the workflow scope).

1. Setup. Clone the repo, run `gh auth status` and confirm the workflow scope. If it is missing, stop and tell the owner exactly how to grant it. Do not work around it.
2. Enable CI. Copy ci/workflows/*.yml to .github/workflows/ (keep ci/workflows/ as the source or delete it, your choice, but say which in HANDOFF.md). Push. Run `check` first. It compile-checks both Kotlin flavors. The new KrishSystemPlugin.openExternal Kotlin function has never been compiled, so errors there are likely: fix them.
3. Add .github/workflows/release.yml: triggers on tag push `v*` and on workflow_dispatch with a `tag` input. Jobs: (a) Android: build lite and full DEBUG APKs; (b) desktop: package Windows x64 and Linux x64 with @electron/packager (main.cjs reads ../ui/dist and ../core/page-script, so keep that folder layout; see build-desktop.yml); (c) a release job with `permissions: contents: write` that downloads the artifacts, zips the Windows folder, tars the Linux folder, writes SHA256SUMS.txt, and creates a GitHub Release for the tag as a PRE-RELEASE with these files:
   krish-android-lite-debug.apk, krish-android-full-debug.apk, krish-windows-x64.zip, krish-linux-x64.tar.gz, SHA256SUMS.txt.
   Use only first-party actions or `gh`. No third-party actions you cannot justify. No `pull_request_target`. No secrets other than GITHUB_TOKEN.
4. Fix loop. Run the workflows, read the logs (`gh run view --log-failed`), fix the cause, push, rerun. Common causes: missing Android SDK pieces, Gradle memory, Electron packager flags, wrong paths. Fix root causes. Never delete or weaken tests, lint rules or the app's safety rules (policy gate, redaction, vault) to get green. Tests must stay green: `npm run typecheck && npm run lint && npm test` (core 167, ui 32, desktop 8).
5. Verify the artifacts, do not assume. Download the release files and check: both APKs are valid zips containing AndroidManifest.xml and classes.dex (use `unzip -l`, and aapt/apkanalyzer if available) and have applicationId app.krish.agent.lite and app.krish.agent; the Windows zip contains Krish.exe and resources/app with ui/dist/index.html; the Linux tar contains an executable `Krish`. If a Linux machine with a display or xvfb is available, start the Linux build for ~20 s and confirm it does not crash on missing files.
6. Docs. Add a "Download" section at the top of README.md linking to the latest Release with the 4 files and one line each on how to install (Android: allow unknown apps; lite works on every phone, full is arm64 only; Windows: SmartScreen "More info -> Run anyway" because the app is unsigned; Linux: needs a keyring for KrishVault). Update BUILD.md section 5 (CI is now live, how to cut a release: `git tag v0.1.1 && git push --tags`). Add a session log to HANDOFF.md: what you did, run URLs, what was verified, what is not.
7. Release. Tag v0.1.0 (or the next free tag) and let release.yml publish it. Release notes must say, plainly: these are unsigned DEBUG builds; they were NOT tested on a real phone or a real Windows/Linux desktop; list the known gaps from HANDOFF.md ("NOT verified" and "Known limit"). Do not claim more than was tested.

RULES
- Do not change app features or UI behaviour. Only fix what the build needs, and say what and why.
- No signing keys, no keystores, no secrets in the repo or logs. Debug builds only.
- No force-push, no rewriting history, no deleting existing tags or releases.
- Keep the app name Krish. Do not add the word "Hark" anywhere in the app or the release notes.
- Keep commits small, with clear messages.

FINAL REPORT (short): links to the Release page, to each green workflow run, the list of release files with sizes and SHA256, what you fixed, what you verified and how, and what is still untested.
```

## Owner steps
1. Connect GitHub for that AI with `repo` + `workflow` scopes (classic token, or `gh auth refresh -s workflow`).
2. Paste the prompt above into it.
3. When it reports back, open `https://github.com/DeepuExplainsAi/KRISH/releases`, download the file, install, and tell it (or the previous AI) what breaks on the real device.
