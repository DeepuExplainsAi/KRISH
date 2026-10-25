import { describe, expect, it } from "vitest";
import { ProviderRouter, AllProvidersFailedError } from "../../src/providers/router";
import { AbortedError } from "../../src/providers/types";
import { parseAction } from "../../src/schema/actions";
import { json, mockFetch, openaiReply, provider, stores } from "../helpers";

const DONE = '{"type":"done","summary":"ok"}';
const msgs = [{ role: "user" as const, content: "hi" }];

async function setup(handlers: Parameters<typeof mockFetch>[0], providers = [provider("a"), provider("b")], cfg = {}) {
  const { fn, calls } = mockFetch(handlers);
  const s = await stores(providers.map((p) => p.id));
  let t = 1_000_000;
  const router = new ProviderRouter({ ...s, fetch: fn, providers: () => providers, now: () => t, config: cfg });
  return { router, calls, advance: (ms: number) => (t += ms), ...s };
}

describe("ProviderRouter fallback", () => {
  it("uses first provider when healthy", async () => {
    const { router } = await setup({ "a.test": () => openaiReply(DONE), "b.test": () => openaiReply("x") });
    const r = await router.run(msgs, parseAction);
    expect(r.providerId).toBe("a");
  });

  it("falls back on 429 and honors Retry-After cooldown", async () => {
    const { router, calls, advance } = await setup({
      "a.test": () => json({}, 429, { "retry-after": "120" }),
      "b.test": () => openaiReply(DONE),
    });
    expect((await router.run(msgs, parseAction)).providerId).toBe("b");
    const aCalls = () => calls.filter((c) => c.url.includes("a.test")).length;
    expect(aCalls()).toBe(1);
    await router.run(msgs, parseAction); // a in cooldown: not called
    expect(aCalls()).toBe(1);
    advance(121_000);
    await router.run(msgs, parseAction); // cooldown over: a tried again
    expect(aCalls()).toBe(2);
  });

  it("falls back on 5xx", async () => {
    const { router } = await setup({ "a.test": () => json({}, 503), "b.test": () => openaiReply(DONE) });
    const r = await router.run(msgs, parseAction);
    expect(r.attempts.map((a) => a.outcome)).toEqual(["server", "ok"]);
  });

  it("falls back on network error", async () => {
    const { router } = await setup({
      "a.test": () => {
        throw new TypeError("offline");
      },
      "b.test": () => openaiReply(DONE),
    });
    expect((await router.run(msgs, parseAction)).providerId).toBe("b");
  });

  it("falls back on timeout", async () => {
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    const { router } = await setup({ "a.test": hang, "b.test": () => openaiReply(DONE) }, undefined, { requestTimeoutMs: 20 });
    const r = await router.run(msgs, parseAction);
    expect(r.attempts[0]?.outcome).toBe("timeout");
    expect(r.providerId).toBe("b");
  });

  it("falls back on invalid JSON body and on schema-invalid output", async () => {
    const { router } = await setup({
      "a.test": () => new Response("<html>oops</html>", { status: 200 }),
      "b.test": () => openaiReply(DONE),
    });
    expect((await router.run(msgs, parseAction)).attempts[0]?.outcome).toBe("bad_json");

    const second = await setup({
      "a.test": () => openaiReply('{"type":"rm_rf"}'),
      "b.test": () => openaiReply(DONE),
    });
    const r = await second.router.run(msgs, parseAction);
    expect(r.attempts[0]?.outcome).toBe("bad_json");
    expect(r.providerId).toBe("b");
  });

  it("tries the fallback model on the same provider first", async () => {
    const seen: string[] = [];
    const { router } = await setup(
      {
        "a.test": (_u, init) => {
          const model = JSON.parse(String(init?.body)).model as string;
          seen.push(model);
          return model === "m1" ? json({}, 500) : openaiReply(DONE);
        },
      },
      [provider("a", { fallbackModel: "m2" })],
    );
    const r = await router.run(msgs, parseAction);
    expect(seen).toEqual(["m1", "m2"]);
    expect(r.model).toBe("m2");
  });

  it("opens the circuit after repeated failures", async () => {
    const { router, calls, advance } = await setup(
      { "a.test": () => json({}, 500), "b.test": () => openaiReply(DONE) },
      undefined,
      { circuitThreshold: 2, circuitOpenMs: 60_000 },
    );
    await router.run(msgs, parseAction);
    await router.run(msgs, parseAction);
    const n = calls.filter((c) => c.url.includes("a.test")).length;
    await router.run(msgs, parseAction);
    expect(calls.filter((c) => c.url.includes("a.test")).length).toBe(n);
    advance(61_000);
    await router.run(msgs, parseAction);
    expect(calls.filter((c) => c.url.includes("a.test")).length).toBe(n + 1);
  });

  it("enforces the local daily limit and counts usage", async () => {
    const { router } = await setup(
      { "a.test": () => openaiReply(DONE), "b.test": () => openaiReply(DONE) },
      [provider("a", { dailyLimit: 1 }), provider("b")],
    );
    expect((await router.run(msgs, parseAction)).providerId).toBe("a");
    expect((await router.run(msgs, parseAction)).providerId).toBe("b");
    expect(await router.usageToday("a")).toBe(1);
  });

  it("skips providers not allowed on sensitive pages", async () => {
    const { router, calls } = await setup(
      { "a.test": () => openaiReply(DONE), "b.test": () => openaiReply(DONE) },
      [provider("a"), provider("b", { allowSensitive: true })],
    );
    const r = await router.run(msgs, parseAction, { sensitive: true });
    expect(r.providerId).toBe("b");
    expect(calls.some((c) => c.url.includes("a.test"))).toBe(false);
  });

  it("throws when every provider fails or none can be used", async () => {
    const { router } = await setup({ "a.test": () => json({}, 500), "b.test": () => json({}, 429) });
    await expect(router.run(msgs, parseAction)).rejects.toBeInstanceOf(AllProvidersFailedError);
    const none = await setup({}, [provider("a", { enabled: false })]);
    await expect(none.router.run(msgs, parseAction)).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it("does not fall back when the user aborts", async () => {
    const ac = new AbortController();
    const { router, calls } = await setup({
      "a.test": () => {
        ac.abort();
        throw new TypeError("x");
      },
      "b.test": () => openaiReply(DONE),
    });
    await expect(router.run(msgs, parseAction, { signal: ac.signal })).rejects.toBeInstanceOf(AbortedError);
    expect(calls.some((c) => c.url.includes("b.test"))).toBe(false);
  });

  it("sends keys in headers, never in URLs", async () => {
    const g = provider("g", { kind: "gemini", baseUrl: "https://g.test", defaultModel: "gemini-x" });
    const { router, calls } = await setup(
      { "g.test": () => json({ candidates: [{ content: { parts: [{ text: DONE }] } }] }) },
      [g],
    );
    await router.run(msgs, parseAction);
    const c = calls[0]!;
    expect(c.url).not.toContain("key-g");
    expect((c.init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("key-g");
  });
});

describe("fetch that ignores AbortSignal (Capacitor native POST)", () => {
  const hang = () => new Promise<Response>(() => undefined);
  const settle = <T,>(p: Promise<T>) =>
    Promise.race([p.then((v) => ({ v }), (e: unknown) => ({ e })), new Promise<"HUNG">((r) => setTimeout(() => r("HUNG"), 1500))]);

  it("still times out and falls back to the next provider", async () => {
    const { keys, kv } = await stores(["a", "b"]);
    const router = new ProviderRouter({
      keys, kv, providers: () => [provider("a"), provider("b")], config: { requestTimeoutMs: 40 },
      fetch: (u) => (u.includes("a.test") ? hang() : Promise.resolve(openaiReply(DONE))),
    });
    const r = await settle(router.run(msgs, parseAction));
    expect(r).not.toBe("HUNG");
    expect((r as { v: { attempts: { outcome: string }[] } }).v.attempts[0]?.outcome).toBe("timeout");
  });

  it("STOP interrupts a hung request", async () => {
    const { keys, kv } = await stores(["a"]);
    const router = new ProviderRouter({ keys, kv, providers: () => [provider("a")], fetch: hang });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    const r = await settle(router.run(msgs, parseAction, { signal: ac.signal }));
    expect((r as { e: unknown }).e).toBeInstanceOf(AbortedError);
  });
});

describe("error classification while reading the body", () => {
  const hungBody = (status: number) => () =>
    Promise.resolve({ ok: false, status, headers: new Headers(), text: () => new Promise<string>(() => undefined), json: () => new Promise(() => undefined) } as unknown as Response);
  const settle = <T,>(p: Promise<T>) =>
    Promise.race([p.then((v) => ({ v }), (e: unknown) => ({ e })), new Promise<"HUNG">((r) => setTimeout(() => r("HUNG"), 1500))]);

  it("an error response whose body hangs is a timeout, not an auth failure", async () => {
    const { keys, kv } = await stores(["a"]);
    const router = new ProviderRouter({ keys, kv, providers: () => [provider("a")], config: { requestTimeoutMs: 40 }, fetch: hungBody(401) });
    const r = await settle(router.run(msgs, parseAction));
    expect(r).not.toBe("HUNG");
    expect(String((r as { e: Error }).e)).toMatch(/timeout|timed out/i);
    expect(String((r as { e: Error }).e)).not.toMatch(/auth/i);
  });

  it("STOP during an error response body is an abort", async () => {
    const { keys, kv } = await stores(["a"]);
    const router = new ProviderRouter({ keys, kv, providers: () => [provider("a")], fetch: hungBody(401) });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    const r = await settle(router.run(msgs, parseAction, { signal: ac.signal }));
    expect((r as { e: unknown }).e).toBeInstanceOf(AbortedError);
  });

  it("a connection reset while reading a 200 body is a network error, not bad_json", async () => {
    const { keys, kv } = await stores(["a", "b"]);
    const reset = () => Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: () => Promise.reject(new TypeError("terminated")) } as unknown as Response);
    const router = new ProviderRouter({
      keys, kv, providers: () => [provider("a"), provider("b")],
      fetch: (u) => (u.includes("a.test") ? reset() : Promise.resolve(openaiReply(DONE))),
    });
    const r = await router.run(msgs, parseAction);
    expect(r.attempts[0]?.outcome).toBe("network");
  });
});
