import { afterEach, describe, expect, it } from "vitest";
import { ProviderRouter, setLocalEngine, parseAction, type LocalEngine } from "../../src";
import { mockFetch, openaiReply, provider, stores } from "../helpers";

const DONE = '{"type":"done","summary":"ok"}';
const msgs = [{ role: "user" as const, content: "hi" }];
const local = provider("local", { kind: "webgpu-local", baseUrl: "local:" });
afterEach(() => setLocalEngine(undefined));

async function router(providers = [local, provider("a")]) {
  const { fn, calls } = mockFetch({ "a.test": () => openaiReply(DONE) });
  const s = await stores(["a"]); // no key stored for "local"
  return { r: new ProviderRouter({ ...s, fetch: fn, providers: () => providers }), calls };
}

describe("on-device model", () => {
  it("is used first without a key, and never touches the network", async () => {
    const engine: LocalEngine = { listModels: async () => [], complete: async () => DONE };
    setLocalEngine(engine);
    const { r, calls } = await router();
    expect((await r.run(msgs, parseAction)).providerId).toBe("local");
    expect(calls).toHaveLength(0);
  });

  it("falls back to API providers when the engine is missing, throws, or returns bad JSON", async () => {
    const { r } = await router();
    expect((await r.run(msgs, parseAction)).providerId).toBe("a"); // no engine registered
    setLocalEngine({ listModels: async () => [], complete: async () => { throw new Error("device lost"); } });
    expect((await (await router()).r.run(msgs, parseAction)).providerId).toBe("a");
    setLocalEngine({ listModels: async () => [], complete: async () => "not json" });
    expect((await (await router()).r.run(msgs, parseAction)).providerId).toBe("a");
  });

  it("rejects a non-HTTPS local navigation and falls back without executing it", async () => {
    setLocalEngine({ listModels: async () => [], complete: async () => '{"type":"navigate","url":"http://example.com"}' });
    const { r, calls } = await router();
    const result = await r.run(msgs, parseAction);
    expect(result.providerId).toBe("a");
    expect(result.value).toEqual({ type: "done", summary: "ok" });
    expect(result.attempts[0]?.outcome).toBe("bad_output");
    expect(calls).toHaveLength(1);
  });

});
