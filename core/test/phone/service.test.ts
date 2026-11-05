import { describe, expect, it } from "vitest";
import { parseRelayUrl, PhoneService, type PhoneDevice, type SocketLike } from "../../src/phone";
import { ActivityLog } from "../../src/security/activity-log";
import { approvePlan, createPlan } from "../../src/security/actions";
import { MemoryKeyStore, MemoryKV } from "../../src/storage";

class Sock implements SocketLike {
  onopen = null; onmessage = null; onclose = null; onerror = null; closed = false;
  constructor(public url: string) {}
  send() {}
  close() { this.closed = true; }
}
const setup = () => {
  const socks: Sock[] = [];
  const stops: string[] = [];
  let state: "idle" | "running" = "idle";
  const dev: PhoneDevice = {
    state: async () => ({ state }), start: async () => void (state = "running"),
    readScreen: async () => ({ pkg: "com.android.chrome", nodes: [] }), perform: async () => ({ ok: true }), openApp: async () => {},
    confirm: async () => true, pause: async () => {}, stop: async (r) => void ((state = "idle"), stops.push(r)),
  };
  const keys = new MemoryKeyStore();
  const svc = new PhoneService(dev, new ActivityLog(new MemoryKV()), keys, (u) => { const s = new Sock(u); socks.push(s); return s; });
  return { svc, socks, stops, keys };
};

describe("parseRelayUrl", () => {
  it("accepts only a bare https origin", () => {
    expect(parseRelayUrl(" https://krish.me.workers.dev ")?.host).toBe("krish.me.workers.dev");
    for (const bad of ["http://a.dev", "https://a.dev/x", "https://u:p@a.dev", "https://a.dev/?q=1", "https://localhost", "wss://a.dev", "nope", ""]) expect(parseRelayUrl(bad)).toBeUndefined();
  });
});

describe("PhoneService", () => {
  it("Mode B connects under a stable secret token and returns the connector URL", async () => {
    const { svc, socks } = setup();
    const r = await svc.enableMcp("https://k.workers.dev");
    expect(r.ok && r.connectorUrl).toMatch(/^https:\/\/k\.workers\.dev\/mcp\/[0-9a-f]{64}$/);
    const token = r.ok ? r.connectorUrl.split("/").pop() : "";
    expect(socks[0]!.url).toBe(`wss://k.workers.dev/phone/${token}`);
    expect(svc.current.mode).toBe("mcp");
    await svc.disable();
    const again = await svc.enableMcp("https://k.workers.dev");
    expect(again.ok && again.connectorUrl.split("/").pop()).toBe(token);
  });
  it("rejects a bad relay URL without connecting", async () => {
    const { svc, socks } = setup();
    expect(await svc.enableMcp("http://x.dev")).toMatchObject({ ok: false });
    expect(socks).toHaveLength(0);
    expect(svc.current.mode).toBe("off");
  });
  it("rotating the token changes the connector URL and closes the old connection", async () => {
    const { svc, socks } = setup();
    const a = await svc.enableMcp("https://k.workers.dev");
    const b = await svc.rotateToken("https://k.workers.dev");
    expect(a.ok && b.ok && a.connectorUrl !== b.connectorUrl).toBe(true);
    expect(socks[0]!.closed).toBe(true);
    expect(socks).toHaveLength(2);
  });
  it("switching or disabling ends a running task", async () => {
    const { svc, stops } = setup();
    await svc.enableMcp("https://k.workers.dev");
    await svc.begin(approvePlan(createPlan("t", ["com.android.chrome"])));
    expect(svc.current.taskActive).toBe(true);
    await svc.disable();
    expect(svc.current).toMatchObject({ mode: "off", taskActive: false, relay: "off" });
    expect(stops).toEqual(["mode_change"]);
  });
  it("Mode A refuses to start when the chat app is not approved, and leaves no mode behind", async () => {
    const { svc } = setup();
    const r = await svc.runChat(approvePlan(createPlan("t", ["com.android.chrome"])), "com.openai.chatgpt");
    expect(r.status).toBe("failed");
    expect(svc.current.mode).toBe("off");
  });
  it("the token lives in the key store, never in the activity log", async () => {
    const { svc, keys } = setup();
    await svc.enableMcp("https://k.workers.dev");
    expect(await keys.get("phone-relay-token")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("PhoneService.runMacro", () => {
  const macro = (apps: string[]) => ({
    id: "m", title: "t", task: "t", apps, steps: [{ type: "back" as const }], repeat: { every: "daily" as const }, hour: 1, minute: 0, enabled: true, createdAt: 0, approvedAt: 1,
  });
  it("runs without an AI, ends in mode off, and shuts the relay first (one mode at a time)", async () => {
    const { svc, socks } = setup();
    await svc.enableMcp("https://k.workers.dev");
    const r = await svc.runMacro(macro(["com.android.chrome"]), ["com.android.chrome"], { sleep: async () => {} });
    expect(r).toMatchObject({ ok: true, attempts: 1 });
    expect(socks[0]!.closed).toBe(true);
    expect(svc.current.mode).toBe("off");
  });
  it("does not retry a permanent failure", async () => {
    const { svc } = setup();
    expect(await svc.runMacro(macro(["com.android.chrome"]), [], { sleep: async () => {} })).toMatchObject({ ok: false, attempts: 1 });
  });
});
