import { RelayHub } from "../../core/src/phone/relay-hub";

// Minimal Cloudflare types, so this file needs no extra dependency to type-check or lint.
declare const WebSocketPair: new () => { 0: CfSocket; 1: CfSocket };
interface CfSocket {
  accept(): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message" | "close" | "error", cb: (e: { data?: unknown }) => void): void;
}
interface DurableObjectNamespace { idFromName(name: string): unknown; get(id: unknown): { fetch(req: Request): Promise<Response> } }
interface Env { HUB: DurableObjectNamespace }

const TOKEN = /^[0-9a-f]{64}$/;
const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const REASON_STATUS = { phone_offline: 503, phone_replaced: 503, timeout: 504, too_large: 413, busy: 429 } as const;

/**
 *   wss://<relay>/phone/<token>   the phone connects here (outbound WebSocket)
 *   POST https://<relay>/mcp/<token>   the AI client (MCP "Streamable HTTP", JSON replies) posts JSON-RPC here
 * The token is the only secret. Nothing is stored: the Durable Object keeps the open socket and in-flight requests in memory.
 */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const [, kind, token, ...rest] = new URL(req.url).pathname.split("/");
    if (rest.length || !token || !TOKEN.test(token) || (kind !== "phone" && kind !== "mcp")) return json(404, { error: "not found" });
    return env.HUB.get(env.HUB.idFromName(token)).fetch(req);
  },
};

export class Hub {
  private hub = new RelayHub();

  async fetch(req: Request): Promise<Response> {
    const kind = new URL(req.url).pathname.split("/")[1];
    return kind === "phone" ? this.phone(req) : this.mcp(req);
  }

  private phone(req: Request): Response {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json(426, { error: "websocket required" });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const peer = { send: (d: string) => server.send(d) };
    this.hub.attach(peer);
    server.addEventListener("message", (e) => typeof e.data === "string" && this.hub.onPhoneMessage(e.data));
    const gone = () => this.hub.detach(peer);
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  private async mcp(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    const body = await req.text();
    const r = await this.hub.forward(body);
    if (!r.ok) return json(REASON_STATUS[r.reason], { jsonrpc: "2.0", id: null, error: { code: -32000, message: `Phone relay: ${r.reason}` } });
    if (r.body === null) return new Response(null, { status: 202 });
    return new Response(r.body, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
}
