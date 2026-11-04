# Phone Control Agent — security requirements and workflow (owner's brief, 2026-11-04)

Verbatim requirements the code must satisfy. Implementation status: see HANDOFF.md.

## Security & privacy (implement FIRST)
Goal: the AI agent must never see or touch private/sensitive things. Nothing sensitive happens without the user's explicit approval.

1. ALLOWLIST (primary): user picks the apps the agent may use. AccessibilityService restricted to those packages
   (`packageNames` in accessibility_service_config.xml plus a runtime check). A non-allowed app in the foreground pauses the engine
   immediately; nothing is read, captured or sent from that screen.
2. HARD BLOCKLIST (always blocked, even if allowed): banking/UPI/wallet apps; Gmail, SMS/Messages, WhatsApp and other private chat apps;
   authenticator apps, password managers; phone Settings, Play Store, Google account screens.
3. SCREEN-LEVEL: never read or send password fields (`isPassword`). FLAG_SECURE screen or blank screenshot: stop the task.
   Words OTP, PIN, CVV, Password, Login, Sign in, Pay: pause and ask the user. Login is always done by the user, never by the AI.
4. NOTHING WITHOUT ASKING: confirmation popup before send, post, pay, delete, submit, install, share; before opening any new app.
   Show the user, before each task, which apps and actions will be used. No action outside the approved task plan.
5. DATA PROTECTION: send the AI only text of allowed apps' screens. Redact phone numbers, card numbers, emails, OTP-like numbers (regex)
   before sending. No screen content on any server; logs on-device only, user can view and delete. Never store passwords.
6. EMERGENCY: floating Stop button always visible while a task runs; volume-key shortcut; task stops if the phone locks or the app
   leaves the allowlist.
7. TRANSPARENCY: consent screen (what the app can see) with Privacy Policy and Terms; live activity log of every step (screenshot if allowed);
   rate limits and random delays for social-media actions; warn that automating Instagram may risk the account.

## Workflow
Setup once: install APK; Accessibility permission; overlay, notification, battery-optimisation-off permissions; choose Mode A or B.
- Mode B (MCP): phone connects to a Cloudflare relay (WebSocket); relay gives an MCP URL; user adds it as a connector in ChatGPT/Claude;
  chat app sends tool calls (`open_app`, `read_screen`, `tap`, `type`); relay forwards to the phone; engine runs the action and returns the
  screen result; repeat until done.
- Mode A: user writes the task in this app; app opens the ChatGPT/Gemini app, types the task, reads the reply from screen, extracts the action,
  engine runs it, result goes back to the chat app; repeat.
- Engine (both modes): read screen -> run action -> check result -> next step.
- Schedule: "tomorrow 6 pm do this" -> steps saved as a macro -> AlarmManager wakes the app -> macro replays without AI -> retry on failure, then notify.
- Safety flow on every task: Confirm popup for payment/delete/send; Stop button always; every step logged with screenshot; only one mode active at a time.

## Also requested
- Remove the in-app WebView browser system entirely (Google sign-in rejects embedded WebViews: "this browser is not secure").
