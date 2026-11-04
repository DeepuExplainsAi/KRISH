/**
 * The relay's whole job, kept free of Cloudflare types so it is unit-tested: hold the phone's socket, forward one MCP request at a time
 * to it and hand back the answer. Everything is in memory; nothing is stored or logged. One hub per pairing token.
 */
export interface Peer { send(data: string): void }
export type Forwarded = { ok: true; body: string | null } | { ok: false; reason: "phone_offline" | "timeout" | "too_large" | "busy" | "phone_replaced" };

export const MAX_REQUEST_BYTES = 64 * 1024;
export const MAX_REPLY_BYTES = 256 * 1024;
export const MAX_PENDING = 8;

export class RelayHub {
  private phone?: Peer;
  private pending = new Map<string, { resolve: (f: Forwarded) => void; timer: ReturnType<typeof setTimeout> }>();
  private n = 0;

  constructor(private readonly timeoutMs = 90_000) {}

  get online() {
    return this.phone !== undefined;
  }

  /** A newer phone connection replaces the old one (reconnect). Requests waiting on the old one fail. */
  attach(p: Peer) {
    this.failAll("phone_replaced");
    this.phone = p;
  }

  detach(p: Peer) {
    if (this.phone !== p) return;
    this.phone = undefined;
    this.failAll("phone_offline");
  }

  /** `body` is the raw JSON-RPC text from the AI client. */
  forward(body: string): Promise<Forwarded> {
    if (body.length > MAX_REQUEST_BYTES) return Promise.resolve({ ok: false, reason: "too_large" });
    if (!this.phone) return Promise.resolve({ ok: false, reason: "phone_offline" });
    if (this.pending.size >= MAX_PENDING) return Promise.resolve({ ok: false, reason: "busy" });
    const id = String(++this.n);
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(id, { ok: false, reason: "timeout" }), this.timeoutMs);
      this.pending.set(id, { resolve, timer });
      try {
        this.phone!.send(JSON.stringify({ id, body }));
      } catch {
        this.settle(id, { ok: false, reason: "phone_offline" });
      }
    });
  }

  /** A frame from the phone: `{id, body}` where body is the JSON-RPC response text, or null for a notification. Anything else is ignored. */
  onPhoneMessage(raw: string) {
    if (raw.length > MAX_REPLY_BYTES) return;
    let f: { id?: unknown; body?: unknown };
    try { f = JSON.parse(raw); } catch { return; }
    if (typeof f.id !== "string" || !(typeof f.body === "string" || f.body === null)) return;
    this.settle(f.id, { ok: true, body: f.body });
  }

  private settle(id: string, f: Forwarded) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(f);
  }

  private failAll(reason: "phone_offline" | "phone_replaced") {
    for (const id of [...this.pending.keys()]) this.settle(id, { ok: false, reason });
  }
}
