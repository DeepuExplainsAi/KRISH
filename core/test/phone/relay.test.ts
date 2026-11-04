import { describe, expect, it, vi } from "vitest";
import { isPairingToken, newPairingToken, RelayClient, RelayHub, type SocketLike } from "../../src/phone";

describe("RelayHub", () => {
  it("forwards a request to the phone and returns its answer", async () => {
    const hub = new RelayHub();
    const sent: string[] = [];
    hub.attach({ send: (d) => void sent.push(d) });
    const p = hub.forward('{"a":1}');
    const { id, body } = JSON.parse(sent[0]!);
    expect(body).toBe('{"a":1}');
    hub.onPhoneMessage(JSON.stringify({ id, body: '{"ok":true}' }));
    expect(await p).toEqual({ ok: true, body: '{"ok":true}' });
  });
  it("offline, oversized, busy, timeout", async () => {
    const hub = new RelayHub(20);
    expect(await hub.forward("x")).toEqual({ ok: false, reason: "phone_offline" });
    hub.attach({ send: () => {} });
    expect(await hub.forward("x".repeat(70_000))).toEqual({ ok: false, reason: "too_large" });
    expect(await hub.forward("x")).toEqual({ ok: false, reason: "timeout" });
    const waiting = Array.from({ length: 8 }, () => hub.forward("x"));
    expect(await hub.forward("x")).toEqual({ ok: false, reason: "busy" });
    await Promise.all(waiting);
  });
  it("phone disconnect or replacement fails waiting requests; a stale detach is ignored", async () => {
    const hub = new RelayHub(5000);
    const a = { send: () => {} }, b = { send: () => {} };
    hub.attach(a);
    const p1 = hub.forward("x");
    hub.attach(b);
    expect(await p1).toEqual({ ok: false, reason: "phone_replaced" });
    hub.detach(a);
    expect(hub.online).toBe(true);
    const p2 = hub.forward("x");
    hub.detach(b);
    expect(await p2).toEqual({ ok: false, reason: "phone_offline" });
    expect(hub.online).toBe(false);
  });
  it("ignores junk, unknown ids, oversized and replayed frames", async () => {
    const hub = new RelayHub(30);
    const sent: string[] = [];
    hub.attach({ send: (d) => void sent.push(d) });
    const p = hub.forward("x");
    const { id } = JSON.parse(sent[0]!);
    for (const junk of ["nope", "{}", JSON.stringify({ id: 5, body: "x" }), JSON.stringify({ id: "999", body: "x" }), JSON.stringify({ id, body: 7 }), "z".repeat(300_000)]) hub.onPhoneMessage(junk);
    expect(await p).toEqual({ ok: false, reason: "timeout" });
    hub.onPhoneMessage(JSON.stringify({ id, body: "late" })); // already settled: no effect, no throw
  });
  it("a notification answer is body null", async () => {
    const hub = new RelayHub();
    const sent: string[] = [];
    hub.attach({ send: (d) => void sent.push(d) });
    const p = hub.forward("{}");
    hub.onPhoneMessage(JSON.stringify({ id: JSON.parse(sent[0]!).id, body: null }));
    expect(await p).toEqual({ ok: true, body: null });
  });
});

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; }
}

describe("RelayClient", () => {
  const make = () => {
    const socks: FakeSocket[] = [];
    const status: string[] = [];
    const sleeps: number[] = [];
    const c = new RelayClient({
      url: "wss://x/phone/t", connect: () => { const s = new FakeSocket(); socks.push(s); return s; },
      handler: async (b) => (b === "boom" ? Promise.reject(new Error("x")) : b === "note" ? undefined : { echo: b }),
      onStatus: (s) => status.push(s), sleep: async (ms) => void sleeps.push(ms),
    });
    return { c, socks, status, sleeps };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  it("connects, answers forwarded requests, and sends null for notifications", async () => {
    const { c, socks, status } = make();
    c.start();
    socks[0]!.onopen!();
    expect(status).toEqual(["connecting", "online"]);
    socks[0]!.onmessage!({ data: JSON.stringify({ id: "1", body: "hi" }) });
    socks[0]!.onmessage!({ data: JSON.stringify({ id: "2", body: "note" }) });
    socks[0]!.onmessage!({ data: JSON.stringify({ id: "3", body: "boom" }) });
    socks[0]!.onmessage!({ data: "junk" });
    socks[0]!.onmessage!({ data: 5 });
    await flush();
    expect(socks[0]!.sent.map((s) => JSON.parse(s))).toEqual([
      { id: "1", body: '{"echo":"hi"}' }, { id: "2", body: null },
      { id: "3", body: expect.stringContaining("Internal error") },
    ]);
  });
  it("reconnects with growing back-off, resets after success, and stop() really stops", async () => {
    const { c, socks, sleeps, status } = make();
    c.start();
    socks[0]!.onclose!();
    await flush();
    socks[1]!.onclose!();
    await flush();
    expect(sleeps).toEqual([1000, 2000]);
    socks[2]!.onopen!();
    socks[2]!.onclose!();
    await flush();
    expect(sleeps[2]).toBe(1000);
    c.stop();
    expect(status.at(-1)).toBe("off");
    expect(socks[3]!.closed).toBe(true);
    const n = socks.length;
    await flush();
    expect(socks.length).toBe(n);
  });
  it("a late answer after stop is not sent", async () => {
    const { c, socks } = make();
    c.start();
    socks[0]!.onopen!();
    socks[0]!.onmessage!({ data: JSON.stringify({ id: "1", body: "hi" }) });
    c.stop();
    await flush();
    expect(socks[0]!.sent).toEqual([]);
  });
});

describe("pairing token", () => {
  it("is 64 hex chars, random, and validated strictly", () => {
    const t = newPairingToken();
    expect(isPairingToken(t)).toBe(true);
    expect(newPairingToken()).not.toBe(t);
    for (const bad of ["", "abc", "g".repeat(64), t + "0", t.toUpperCase()]) expect(isPairingToken(bad)).toBe(false);
    expect(vi.isMockFunction(newPairingToken)).toBe(false);
  });
});
