/** Phone side of the relay: keeps one outbound WebSocket open and answers each forwarded MCP request through `handler`. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export type RelayStatus = "off" | "connecting" | "online";

export interface RelayClientOptions {
  url: string;
  handler: (body: unknown) => Promise<object | undefined>;
  connect: (url: string) => SocketLike;
  onStatus?: (s: RelayStatus) => void;
  sleep?: (ms: number) => Promise<void>;
  maxBackoffMs?: number;
}

export class RelayClient {
  private sock?: SocketLike;
  private wanted = false;
  private attempt = 0;
  private status: RelayStatus = "off";
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: RelayClientOptions) {
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get current() {
    return this.status;
  }

  start() {
    if (this.wanted) return;
    this.wanted = true;
    this.attempt = 0;
    this.open();
  }

  stop() {
    this.wanted = false;
    const s = this.sock;
    this.sock = undefined;
    if (s) { s.onclose = s.onmessage = s.onerror = s.onopen = null; s.close(); }
    this.set("off");
  }

  private set(s: RelayStatus) {
    if (this.status === s) return;
    this.status = s;
    this.o.onStatus?.(s);
  }

  private open() {
    this.set("connecting");
    let s: SocketLike;
    try { s = this.o.connect(this.o.url); } catch { return void this.retry(); }
    this.sock = s;
    s.onopen = () => { this.attempt = 0; this.set("online"); };
    s.onmessage = (e) => void this.onFrame(s, e.data);
    s.onerror = () => {};
    s.onclose = () => { if (this.sock === s) { this.sock = undefined; void this.retry(); } };
  }

  private async onFrame(s: SocketLike, data: unknown) {
    if (typeof data !== "string") return;
    let f: { id?: unknown; body?: unknown };
    try { f = JSON.parse(data); } catch { return; }
    if (typeof f.id !== "string" || typeof f.body !== "string") return;
    const reply = await this.o.handler(f.body).catch(() => ({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } }));
    if (this.sock === s) s.send(JSON.stringify({ id: f.id, body: reply === undefined ? null : JSON.stringify(reply) }));
  }

  private async retry() {
    if (!this.wanted) return;
    this.set("connecting");
    const wait = Math.min(this.o.maxBackoffMs ?? 30_000, 1000 * 2 ** this.attempt++);
    await this.sleep(wait);
    if (this.wanted && !this.sock) this.open();
  }
}

/** Unguessable pairing secret: 32 random bytes as hex. Part of the relay URL, so treat it like a password. */
export function newPairingToken(bytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(bytes(32), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const isPairingToken = (t: string) => /^[0-9a-f]{64}$/.test(t);
