# phone-control

The phone-control code is not in this folder. It lives in:

- `core/src/security/`: allowlist, hard blocklist, screen gate, task plan and confirmation gate, pacing, activity log, consent
- `core/src/phone/`: engine, MCP server, relay client, Mode A chat driver, macros and replay, service
- `android/app/src/main/java/app/krish/agent/`: `AgentAccessibilityService`, `SafetyOverlay`, `PhoneSession`, `PackagePolicy`, `ScreenChecks`, `KrishPhonePlugin`, `DueReceiver`
- `relay/`: Cloudflare Worker for Mode B

The threat model and every rule is in `SECURITY.md`. Anything new that touches another app needs a row there first.
