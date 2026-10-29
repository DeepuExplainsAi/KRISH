import { describe, expect, it } from "vitest";
import { ProviderRouter, AllProvidersFailedError } from "../../src/providers/router";
import { classifyStatus, limitInfo } from "../../src/providers/http";
import { AbortedError } from "../../src/providers/types";
import { parseAction } from "../../src/schema/actions";
import { json, mockFetch, openaiReply, provider, stores } from "../helpers";

const DONE = '{"type":"done","summary":"ok"}';
const msgs = [{ role: "user" as const, content: "hi" }];

async function setup(handlers: Parameters<typeof mockFetch>[0], providers = [provider("a"), provider("b")], cfg = {}) {
  const { fn, calls } = mockFetch(handlers);
  const s = await stores(providers.map((p) => p.id));
  let t = 1_000_000;
  const router = new ProviderRouter({ ...s, fetch: fn, providers: () => providers, now: () => t, sleep: async () => undefined, config: cfg });
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

  it("says how long until a provider is usable again, and a skipped-for-cooldown failure is not reported as 'nothing set up'", async () => {
    const { router, advance } = await setup({ "a.test": () => json({}, 429, { "retry-after": "60" }) }, [provider("a")]);
    expect(await router.retryInMs()).toBe(0);
    const err = await router.run(msgs, parseAction).catch((e: Error) => e);
    expect(await router.retryInMs()).toBe(60_000);
    advance(20_000);
    expect(await router.retryInMs()).toBe(40_000);
    const again = (await router.run(msgs, parseAction).catch((e) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(again.message).toMatch(/busy, trying again shortly/);
    expect(again.message).not.toMatch(/Nothing is set up/);
  });

  it("a free service's 402 'free limit, retry after 30s' is a wait, not 'needs paid credit'; a real 402 still is", async () => {
    const limit = { success: false, error: { code: "FREE_LIMIT", message: "Free limit reached: 1 reply every 30 seconds per IP. Retry after 30s" } };
    const { router, advance } = await setup({ "a.test": () => json(limit, 402) }, [provider("a")]);
    const err = (await router.run(msgs, parseAction).catch((e) => e)) as Error;
    expect(err.message).toContain("rate limit hit, try again in a moment");
    expect(err.message).not.toContain("paid credit");
    expect(await router.retryInMs()).toBe(30_000);
    advance(31_000);
    expect(await router.retryInMs()).toBe(0);
    const paid = await setup({ "a.test": () => json({ error: { message: "insufficient credits" } }, 402) }, [provider("a")]);
    expect(String(await paid.router.run(msgs, parseAction).catch((e: Error) => e.message))).toContain("needs paid credit");
  });

  it("falls back on 5xx", async () => {
    const { router } = await setup({ "a.test": () => json({}, 503), "b.test": () => openaiReply(DONE) });
    const r = await router.run(msgs, parseAction);
    expect(r.attempts.map((a) => a.outcome)).toEqual(["server", "server", "ok"]); // one retry on the same provider, then the next
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
    expect(r.attempts[0]?.outcome).toBe("bad_output");
    expect(r.providerId).toBe("b");
    expect(second.calls.filter((c) => c.url.includes("a.test"))).toHaveLength(1); // same prompt, same answer: not asked again
  });

  it("a hiccup is retried once on the same provider with the same model, never with another model", async () => {
    const seen: string[] = [];
    let n = 0;
    const { router } = await setup(
      { "a.test": (_u, init) => (seen.push(JSON.parse(String(init?.body)).model), ++n === 1 ? json({}, 500) : openaiReply(DONE)) },
      [provider("a", { models: { fetchedAt: 1, items: ["m1", "m2", "m3"].map((id) => ({ id })) } })],
    );
    const r = await router.run(msgs, parseAction);
    expect(seen).toEqual(["m1", "m1"]);
    expect(r.providerId).toBe("a");
  });

  it("stays on the first provider and its model for every step while it works", async () => {
    const { router, calls } = await setup({ "a.test": () => openaiReply(DONE), "b.test": () => openaiReply(DONE) });
    for (let i = 0; i < 5; i++) expect((await router.run(msgs, parseAction)).providerId).toBe("a");
    expect(calls.every((c) => c.url.includes("a.test"))).toBe(true);
  });

  it("moves to the next provider only when the daily quota is spent, and keeps skipping the spent one", async () => {
    const day = { error: { message: "Quota exceeded: free-models-per-day limit reached" } };
    const { router, calls, advance } = await setup({ "a.test": () => json(day, 429), "b.test": () => openaiReply(DONE) });
    expect((await router.run(msgs, parseAction)).providerId).toBe("b");
    expect(calls.filter((c) => c.url.includes("a.test"))).toHaveLength(1); // a quota is not retried
    for (let i = 0; i < 3; i++) await router.run(msgs, parseAction);
    expect(calls.filter((c) => c.url.includes("a.test"))).toHaveLength(1); // later steps do not wait on a spent provider
    advance(4 * 3_600_000);
    await router.run(msgs, parseAction);
    expect(calls.filter((c) => c.url.includes("a.test"))).toHaveLength(2); // asked again once its quota may have reset
  });

  it("a spent provider is remembered across a restart and forgotten when the user fixes it", async () => {
    const day = { error: { message: "Rate limit: 200 requests per day" } };
    const first = await setup({ "a.test": () => json(day, 429), "b.test": () => openaiReply(DONE) });
    await first.router.run(msgs, parseAction);
    const { fn, calls } = mockFetch({ "a.test": () => openaiReply(DONE), "b.test": () => openaiReply(DONE) });
    const again = new ProviderRouter({ keys: first.keys, kv: first.kv, fetch: fn, providers: () => [provider("a"), provider("b")], now: () => 1_000_000 });
    expect((await again.run(msgs, parseAction)).providerId).toBe("b"); // new router, same storage
    await again.clearSpent("a");
    expect((await again.run(msgs, parseAction)).providerId).toBe("a");
    expect(calls.filter((c) => c.url.includes("a.test"))).toHaveLength(1);
  });

  it("a short per-minute 429 is waited on and retried, it does not spend the provider's day", async () => {
    let n = 0;
    const { router } = await setup({ "a.test": () => (++n === 1 ? json({}, 429, { "retry-after": "2" }) : openaiReply(DONE)), "b.test": () => openaiReply("x") });
    expect((await router.run(msgs, parseAction)).providerId).toBe("a");
  });

  it("a 429 that clears within a minute is waited out on the SAME provider (the second provider is never called); a longer one moves on", async () => {
    let n = 0;
    const a = await setup({ "a.test": () => (++n === 1 ? json({}, 429, { "retry-after": "60" }) : openaiReply(DONE)), "b.test": () => openaiReply("x") });
    const r = await a.router.run(msgs, parseAction);
    expect(r.providerId).toBe("a");
    expect(a.calls.some((c) => c.url.includes("b.test"))).toBe(false);
    const b = await setup({ "a.test": () => json({}, 429, { "retry-after": "600" }), "b.test": () => openaiReply(DONE) });
    expect((await b.router.run(msgs, parseAction)).providerId).toBe("b");
  });

  it("when every provider has spent its day the error says so and is not worth waiting for", async () => {
    const day = { error: { message: "daily limit" } };
    const { router } = await setup({ "a.test": () => json(day, 429), "b.test": () => json(day, 429) });
    const err = (await router.run(msgs, parseAction).catch((e) => e)) as AllProvidersFailedError;
    expect(err.message).toBe("No AI provider could answer. daily limit used up");
    expect(err.transient).toBe(false);
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
    expect(calls.filter((c) => c.url.includes("a.test")).length).toBe(n + 2); // the provider is asked again (one try and its retry)
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

  it("throws when every provider fails or none can be used", async () => {
    const { router } = await setup({ "a.test": () => json({}, 500), "b.test": () => json({}, 429) });
    await expect(router.run(msgs, parseAction)).rejects.toBeInstanceOf(AllProvidersFailedError);
    const none = await setup({}, [provider("a", { enabled: false })]);
    await expect(none.router.run(msgs, parseAction)).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it("when nothing could even be tried the error says so, without provider names", async () => {
    const { router } = await setup({}, [provider("a", { name: "Gemini", enabled: false }), provider("b", { name: "Groq", defaultModel: undefined })]);
    const msg = String(await router.run(msgs, parseAction).catch((e: Error) => e.message));
    expect(msg).toBe("No AI provider could answer. Nothing is set up to answer yet.");
  });

  it("the error lists each distinct reason once, never provider or model names or the raw body", async () => {
    const big = JSON.stringify({ error: { message: "x".repeat(300) } });
    const { router } = await setup({ "a.test": () => json(big, 429), "b.test": () => json({}, 402) }, [provider("a", { name: "Gemini" }), provider("b", { name: "Zen" })]);
    const msg = String(await router.run(msgs, parseAction).catch((e: Error) => e.message));
    expect(msg).toBe("No AI provider could answer. rate limit hit, try again in a moment · needs paid credit");
    expect(msg).not.toMatch(/Gemini|Zen|xxxx/);
  });

  it("a keyless provider is used without any stored key and does not send a key header", async () => {
    const seen: string[] = [];
    const { fn } = mockFetch({ "free.test": (_u, init) => (seen.push(String((init?.headers as Record<string, string>).authorization)), openaiReply(DONE)) });
    const ps = [provider("free", { baseUrl: "https://free.test/v1", keyless: true })];
    const s = await stores([]);
    const router = new ProviderRouter({ ...s, fetch: fn, providers: () => ps });
    expect((await router.run(msgs, parseAction)).providerId).toBe("free");
    expect(seen).toHaveLength(1);
  });

  it("reports every real result to onResult", async () => {
    const seen: [string, boolean, string | undefined][] = [];
    const { fn } = mockFetch({ "a.test": () => json({}, 401), "b.test": () => openaiReply(DONE) });
    const ps = [provider("a"), provider("b")];
    const s = await stores(["a", "b"]);
    const router = new ProviderRouter({ ...s, fetch: fn, providers: () => ps, onResult: (id, ok, note) => seen.push([id, ok, note]) });
    await router.run(msgs, parseAction);
    expect(seen).toEqual([["a", false, "key rejected"], ["b", true, undefined]]);
  });

  it("a provider without a chosen model gets one from its fetched list", async () => {
    const { router } = await setup({ "a.test": () => openaiReply(DONE) }, [
      provider("a", { defaultModel: undefined, models: { fetchedAt: 1, items: [{ id: "chat-2" }, { id: "chat-1" }] } }),
    ]);
    expect((await router.run(msgs, parseAction)).model).toBe("chat-2");
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
    expect(String((r as { e: Error }).e)).toMatch(/too slow/i);
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

describe("limits that look like a daily quota but are not", () => {
  const gemini = (quotaId: string, retry: string) => ({
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message: "You exceeded your current quota. Quota metric: GenerateRequestsPerDayPerProjectPerModel-FreeTier. Please retry in 27.3s.",
      details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: retry }],
    },
  });

  it("Gemini: a per-minute violation is a short wait even though the text lists the per-day quota; a per-day one is spent", () => {
    const minute = JSON.stringify(gemini("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "27s"));
    expect(classifyStatus(429, minute)).toBe("rate_limit");
    expect(limitInfo(minute).retryMs).toBe(27_000);
    expect(classifyStatus(429, JSON.stringify(gemini("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "43200s")))).toBe("quota");
  });

  it("Groq: a tokens-per-minute 429 that says when it lifts is a wait; a tokens-per-day one is spent", () => {
    const tpm = JSON.stringify({ error: { message: "Rate limit reached for model x in organization y on tokens per minute (TPM): Limit 6000. Please try again in 7.5s.", type: "tokens" } });
    expect(classifyStatus(429, tpm)).toBe("rate_limit");
    expect(limitInfo(tpm).retryMs).toBe(7500);
    const tpd = JSON.stringify({ error: { message: "Rate limit reached ... on tokens per day (TPD): Limit 100000, Used 99000. Please try again in 14m6.5s.", type: "tokens" } });
    expect(limitInfo(tpd).daily).toBe(true);
    expect(limitInfo(tpd).retryMs).toBe(846_500);
    expect(classifyStatus(429, tpd)).toBe("quota");
  });

  it("OpenRouter: the free-models-per-day limit is spent, and its reset time is read from the headers", () => {
    const now = 1_000_000;
    const body = JSON.stringify({ error: { message: "Rate limit exceeded: free-models-per-day.", metadata: { headers: { "X-RateLimit-Reset": String(now + 5 * 3_600_000) } } } });
    expect(limitInfo(body, now)).toEqual({ daily: true, retryMs: 5 * 3_600_000 });
  });

  it("413 and 'context too long' are 'too large', not a broken model", () => {
    expect(classifyStatus(413, "Request too large for model")).toBe("too_large");
    expect(classifyStatus(400, '{"error":{"message":"This model\'s maximum context length is 8192 tokens"}}')).toBe("too_large");
    expect(classifyStatus(400, "bad field")).toBe("bad_request");
  });
});

describe("a request that is too big", () => {
  const big = { error: { message: "Request too large for model: Limit 6000, Requested 9000" } };
  const bigMsgs = [{ role: "user" as const, content: "x".repeat(5000) }];

  it("is not a failure of the provider: no cooldown, no red mark, the next provider answers, and the same size is not sent again", async () => {
    const { router, calls } = await setup({
      "a.test": (_u, init) => (String(init?.body).length > 3000 ? json(big, 413) : openaiReply(DONE)),
      "b.test": () => openaiReply(DONE),
    });
    expect((await router.run(bigMsgs, parseAction)).providerId).toBe("b");
    expect((await router.run(bigMsgs, parseAction)).providerId).toBe("b");
    expect(calls.filter((c) => c.url.includes("a.test"))).toHaveLength(1);
    expect((await router.run(msgs, parseAction)).providerId).toBe("a"); // a short request still goes to the first provider
  });

  it("when every provider refuses the size the error says so and asks for a shorter request, not for waiting", async () => {
    const { router } = await setup({ "a.test": () => json(big, 413), "b.test": () => json(big, 413) });
    const err = (await router.run(bigMsgs, parseAction).catch((e) => e)) as AllProvidersFailedError;
    expect(err.tooLarge).toBe(true);
    expect(err.transient).toBe(false);
    const again = (await router.run(bigMsgs, parseAction).catch((e) => e)) as AllProvidersFailedError;
    expect(again.tooLarge).toBe(true); // also when the providers are skipped for it
  });
});

describe("request variants", () => {
  it("a model that rejects JSON mode is asked without it from then on: one request per step, not two", async () => {
    const { router, calls } = await setup({
      "a.test": (_u, init) => (JSON.parse(String(init?.body)).response_format ? json({ error: { message: "response_format unsupported" } }, 400) : openaiReply(DONE)),
    });
    await router.run(msgs, parseAction);
    expect(calls).toHaveLength(2);
    await router.run(msgs, parseAction);
    await router.run(msgs, parseAction);
    expect(calls).toHaveLength(4);
  });
});

describe("size and variant memory is per model", () => {
  it("a bigger-context model chosen later is not skipped for the size the old model refused", async () => {
    const big = { error: { message: "Request too large" } };
    const bigMsgs = [{ role: "user" as const, content: "x".repeat(5000) }];
    const p = provider("a");
    const cfg = { current: p };
    const { fn } = mockFetch({ "a.test": (_u, init) => (JSON.parse(String(init?.body)).model === "small" ? json(big, 413) : openaiReply(DONE)) });
    const s = await stores(["a"]);
    const router = new ProviderRouter({ ...s, fetch: fn, providers: () => [cfg.current], now: () => 1_000_000, sleep: async () => undefined });
    cfg.current = { ...p, defaultModel: "small" };
    await expect(router.run(bigMsgs, parseAction)).rejects.toBeInstanceOf(AllProvidersFailedError);
    cfg.current = { ...p, defaultModel: "large" };
    expect((await router.run(bigMsgs, parseAction)).providerId).toBe("a");
  });
});
