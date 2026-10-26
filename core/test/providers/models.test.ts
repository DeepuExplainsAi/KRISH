import { describe, expect, it } from "vitest";
import { adapters, autoFetchOnce, pickModels, probeModels, refreshModels, searchModels, sortModels, withAutoModels } from "../../src/providers/models";
import { json, mockFetch, provider } from "../helpers";

const deps = (handlers: Parameters<typeof mockFetch>[0]) => {
  const m = mockFetch(handlers);
  return { ...m, deps: { fetch: m.fn, now: () => 42 } };
};

describe("refreshModels", () => {
  it("Gemini: keeps only generateContent models, strips prefix, paginates, key in header", async () => {
    const { calls, deps: d } = deps({
      "g.test": (url) =>
        url.includes("pageToken=p2")
          ? json({ models: [{ name: "models/gem-b", supportedGenerationMethods: ["generateContent"] }] })
          : json({
              models: [
                { name: "models/gem-a", displayName: "A", supportedGenerationMethods: ["generateContent"] },
                { name: "models/embed", supportedGenerationMethods: ["embedContent"] },
              ],
              nextPageToken: "p2",
            }),
    });
    const cfg = provider("g", { kind: "gemini", baseUrl: "https://g.test" });
    const out = await refreshModels(cfg, "SECRET", d);
    expect(out.models?.items.map((m) => m.id)).toEqual(["gem-a", "gem-b"]);
    expect(out.models?.fetchedAt).toBe(42);
    expect(calls[0]!.url).toContain("/v1beta/models");
    expect(calls.every((c) => !c.url.includes("SECRET"))).toBe(true);
    expect((calls[0]!.init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("SECRET");
  });

  it("OpenAI-compatible: GET {baseUrl}/models with bearer header; free only when pricing says so", async () => {
    const { calls, deps: d } = deps({
      "o.test": () =>
        json({
          data: [
            { id: "paid", pricing: { prompt: "0.001", completion: "0.002" } },
            { id: "free-one", pricing: { prompt: "0", completion: "0" } },
            { id: "unknown" },
          ],
        }),
    });
    const out = await refreshModels(provider("o", { baseUrl: "https://o.test/v1" }), "SECRET", d);
    expect(calls[0]!.url).toBe("https://o.test/v1/models");
    expect((calls[0]!.init?.headers as Record<string, string>).authorization).toBe("Bearer SECRET");
    const byId = Object.fromEntries(out.models!.items.map((m) => [m.id, m.free]));
    expect(byId).toEqual({ paid: undefined, "free-one": true, unknown: undefined });
  });

  it("failed refresh keeps the cached list and records the error", async () => {
    const { deps: d } = deps({ "o.test": () => json({}, 500) });
    const cached = { fetchedAt: 1, items: [{ id: "old" }] };
    const out = await refreshModels(provider("o", { baseUrl: "https://o.test/v1", models: cached }), "k", d);
    expect(out.models).toEqual(cached);
    expect(out.modelsError).toMatch(/500/);
  });

  it("bad JSON shape is a failed refresh", async () => {
    const { deps: d } = deps({ "o.test": () => json({ nope: true }) });
    const out = await refreshModels(provider("o", { baseUrl: "https://o.test/v1" }), "k", d);
    expect(out.models).toBeUndefined();
    expect(out.modelsError).toBeTruthy();
  });

  it("auto fetch happens only once", async () => {
    const { calls, deps: d } = deps({ "o.test": () => json({ data: [{ id: "x" }] }) });
    const first = await autoFetchOnce(provider("o", { baseUrl: "https://o.test/v1" }), "k", d);
    expect(first.modelsAutoFetched).toBe(true);
    await autoFetchOnce(first, "k", d);
    expect(calls.length).toBe(1);
  });

  it("auto fetch is consumed even when it fails; the button still works", async () => {
    let fail = true;
    const { calls, deps: d } = deps({ "o.test": () => (fail ? json({}, 500) : json({ data: [{ id: "x" }] })) });
    const first = await autoFetchOnce(provider("o", { baseUrl: "https://o.test/v1" }), "k", d);
    expect(first.modelsAutoFetched).toBe(true);
    await autoFetchOnce(first, "k", d);
    expect(calls.length).toBe(1);
    fail = false;
    expect((await refreshModels(first, "k", d)).models?.items).toHaveLength(1);
  });

  it("search filters by id and display name", () => {
    const items = [{ id: "llama-3" }, { id: "x", displayName: "Gemma Big" }];
    expect(searchModels(items, "GEMMA")).toHaveLength(1);
    expect(searchModels(items, "")).toHaveLength(2);
  });
});

describe("pickModels / withAutoModels", () => {
  const ids = (...x: string[]) => x.map((id) => ({ id }));
  it("prefers a newer, bigger, stable chat model and skips embeddings, audio and image models", () => {
    const r = pickModels(ids("text-embedding-004", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-pro-preview", "gemini-2.5-flash-preview-tts"));
    expect(r.defaultModel).toBe("gemini-2.5-pro"); // stable beats preview
    expect(r.fallbackModel).toBe("gemini-2.5-flash");
  });
  it("uses only free models when the provider marks some as free", () => {
    const r = pickModels([{ id: "big-paid-pro-5" }, { id: "llama-3.3-70b:free", free: true }, { id: "tiny-8b:free", free: true }]);
    expect(r.defaultModel).toBe("llama-3.3-70b:free");
    expect(r.fallbackModel).toBe("tiny-8b:free");
  });
  it("lists free models first (marked by pricing or by the provider's own -free / :free naming), then paid, then non-chat", () => {
    const sorted = sortModels([{ id: "text-embedding-3" }, { id: "paid-pro-9" }, { id: "tiny-8b-free", free: true }, { id: "big-70b:free", free: true }, { id: "paid-mini-1" }]);
    expect(sorted.map((m) => m.id)).toEqual(["big-70b:free", "tiny-8b-free", "paid-pro-9", "paid-mini-1", "text-embedding-3"]);
  });
  it("never picks a model the provider says is leaving", () => {
    expect(pickModels([{ id: "old-pro-9", free: true, expiring: true }, { id: "new-pro-3", free: true }]).defaultModel).toBe("new-pro-3");
  });
  it("an empty list picks nothing; a single model has no fallback", () => {
    expect(pickModels([])).toEqual({ defaultModel: undefined, fallbackModel: undefined });
    expect(pickModels(ids("only-one"))).toEqual({ defaultModel: "only-one", fallbackModel: undefined });
  });
  it("keeps models the user chose and fills only the missing one", () => {
    const base = provider("p", { defaultModel: undefined, models: { fetchedAt: 1, items: ids("m-2", "m-1") } });
    expect(withAutoModels(base)).toMatchObject({ defaultModel: "m-2", fallbackModel: "m-1" });
    const chosen = { ...base, defaultModel: "m-1" };
    expect(withAutoModels(chosen)).toMatchObject({ defaultModel: "m-1", fallbackModel: "m-2" });
    expect(withAutoModels({ ...chosen, fallbackModel: "x" })).toEqual({ ...chosen, fallbackModel: "x" });
  });
});

describe("probeModels", () => {
  const withList = (ids: string[]) => provider("o", { defaultModel: undefined, models: { fetchedAt: 1, items: ids.map((id) => ({ id })) } });
  const chat = (ok: Record<string, number>) => (_url: string, init?: RequestInit) => {
    const model = JSON.parse(String(init?.body)).model as string;
    return ok[model] === undefined ? openaiOk() : json({}, ok[model]!);
  };
  const openaiOk = () => json({ choices: [{ message: { content: '{"ok":true}' } }] });

  it("keeps the first two models that really answer and skips rate-limited and unpaid ones", async () => {
    const { deps: d } = deps({ "o.test": chat({ "chat-9": 429, "chat-8": 402 }) });
    const out = await probeModels(withList(["chat-9", "chat-8", "chat-7", "chat-6", "chat-5"]), "k", d);
    expect(out).toMatchObject({ defaultModel: "chat-7", fallbackModel: "chat-6", health: { ok: true } });
  });
  it("skips models that are gone (404) and models that cannot follow the JSON format", async () => {
    const answer = (_u: string, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model as string;
      if (model === "chat-9") return json({}, 404);
      return json({ choices: [{ message: { content: model === "chat-8" ? "Sure, I can help" : '{"ok":true}' } }] });
    };
    const { deps: d } = deps({ "o.test": answer });
    const out = await probeModels(withList(["chat-9", "chat-8", "chat-7", "chat-6"]), "k", d);
    expect(out).toMatchObject({ defaultModel: "chat-7", fallbackModel: "chat-6", health: { ok: true } });
  });
  it("nothing works: no model chosen, health says why", async () => {
    const { deps: d } = deps({ "o.test": chat({ "chat-2": 429, "chat-1": 429 }) });
    const out = await probeModels(withList(["chat-2", "chat-1"]), "k", d);
    expect(out.defaultModel).toBeUndefined();
    expect(out.health).toMatchObject({ ok: false, note: "free limit used up, try again later" });
  });
  it("a rejected key stops after the first batch", async () => {
    const { calls, deps: d } = deps({ "o.test": () => json({}, 401) });
    const out = await probeModels(withList(["a-1", "a-2", "a-3", "a-4", "a-5"]), "bad", d);
    expect(calls).toHaveLength(3);
    expect(out.health).toMatchObject({ ok: false, note: "key rejected" });
  });
});

describe("Gemini system instruction", () => {
  it("retries once with the rules inside the first user turn when the model rejects systemInstruction", async () => {
    const bodies: Record<string, unknown>[] = [];
    const { deps: d } = deps({
      "g.test": (_u, init) => {
        const b = JSON.parse(String(init?.body));
        bodies.push(b);
        return b.systemInstruction ? json({ error: { message: "Developer instruction is not enabled for models/x" } }, 400) : json({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });
      },
    });
    const cfg = provider("g", { kind: "gemini", baseUrl: "https://g.test" });
    const text = await adapters.gemini.complete({ config: cfg, apiKey: "k", fetch: d.fetch, timeoutMs: 1000 }, "x", { messages: [{ role: "system", content: "RULES" }, { role: "user", content: "hi" }] });
    expect(text).toBe("{}");
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1])).toContain("RULES\\n\\nhi");
    expect(bodies[1]!.systemInstruction).toBeUndefined();
  });
});
