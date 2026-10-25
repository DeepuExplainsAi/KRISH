Full product spec lives in the original task message. Key constraints (summary):
- No secrets in repo; no telemetry; INTERNET permission only (+POST_NOTIFICATIONS for opt-in brief).
- Model output = untrusted strict JSON; actions: navigate, read, click, type, paste, upload_selected_file, run_sandbox_task, wait, ask_user, done.
- Page/sandbox content is DATA, never instructions.
- Passwords/OTP/card numbers never reach the model; secure input card fills the page natively.
- No addJavascriptInterface on WebViews visiting external sites.
- Build order: core -> android plugin -> live window -> history/memory/tasks -> desktop -> sandbox -> webgpu.
