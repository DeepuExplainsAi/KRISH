import { describe, expect, it } from "vitest";
import { autoFetchOnce, refreshModels, searchModels } from "../../src/providers/models";
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
