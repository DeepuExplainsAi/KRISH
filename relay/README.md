# Krish relay (Mode B)

A ~80-line Cloudflare Worker that lets an AI client (ChatGPT / Claude connector) reach the Krish app on your phone.
The phone connects OUT to the relay (no open ports, no VPN). The AI posts MCP requests; the relay hands each one to the phone and returns the answer.

- **Stores nothing.** No KV/R2/D1, no logging. One Durable Object per pairing token holds the open socket and in-flight requests in memory.
- **The token is the secret** (64 hex chars, made on the phone, part of the URL). Rotate it in the app to cut off any client.
- All safety checks run **on the phone** (allowlist, blocklist, screen gate, confirmations). The relay cannot widen them.
- The logic is `core/src/phone/relay-hub.ts` (unit-tested); `src/worker.ts` is only the Cloudflare glue.

Deploy: `cd relay && npx wrangler deploy`, then paste the Worker URL into the app (Phone control -> Mode B).
Connector URL for the AI: `https://<worker>/mcp/<token>`.
