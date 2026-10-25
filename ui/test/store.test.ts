import { MemoryKeyStore, MemoryKV, type PageObservation } from "@krish/core";
import { describe, expect, it } from "vitest";
import type { Platform } from "../src/platform/types";
import { AppStore } from "../src/state/store";

const reply = (o: object) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }), { status: 200 });

function setup(script: object[]) {
  const filled: [number, string][] = [];
  const prompts: string[] = [];
  let i = 0;
  const page: PageObservation = {
    url: "https://site.test/login", title: "Login", text: "Sign in",
    elements: [{ id: 0, tag: "input", type: "password", label: "Password" }],
  };
  const platform: Platform = {
    kind: "web",
    kv: new MemoryKV(),
    keys: new MemoryKeyStore(),
    fetch: async (url, init) => {
      if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 });
      prompts.push(JSON.parse(String(init?.body)).messages[1].content);
      return reply(script[Math.min(i++, script.length - 1)]!);
    },
    browser: {
      open: async () => {}, observe: async () => page, read: async () => "", click: async () => {}, type: async () => {},
      fill: async (id, v) => void filled.push([id, v]), upload: async () => {}, highlight: async () => {}, setBounds: async () => {},
      setMode: async () => {}, setDesktopLayout: async () => {}, snapshot: async () => "", stopLoading: async () => {}, clearSiteData: async () => {},
      onPage: () => () => {},
    },
    files: { pick: async () => undefined, read: async () => new Uint8Array(), save: async () => false },
    system: { deviceInfo: async () => ({ lowRam: false, totalMemMb: 4096, linuxSandbox: false }), requestNotifications: async () => true, scheduleDue: async () => {}, cancelDue: async () => {} },
  };
  return { store: new AppStore(platform), filled, prompts, platform };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("AppStore", () => {
  it("adds a provider with one automatic model fetch, key kept out of kv", async () => {
    const { store, platform } = setup([]);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "SECRET-KEY");
    const p = store.getState().providers[0]!;
    expect(p.models?.items.map((m) => m.id)).toEqual(["m1"]);
    expect(await platform.keys.get(p.id)).toBe("SECRET-KEY");
    expect(JSON.stringify(await platform.kv.get("providers"))).not.toContain("SECRET-KEY");
  });

  it("secure prompt: user value reaches the page, never the model or history", async () => {
    const { store, filled, prompts } = setup([
      { type: "ask_user", question: "Enter your password", secure: { kind: "password", elementId: 0 } },
      { type: "done", summary: "logged in" },
    ]);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    const p = store.getState().providers[0]!;
    await store.updateProvider({ ...p, defaultModel: "m1", allowSensitive: true });

    const run = store.send("log me in");
    await tick(); await tick();
    const prompt = store.getState().prompts[0]!;
    expect(prompt.type).toBe("secure");
    expect(store.getState().status).toBe("action_required");
    store.answer(prompt.id, "TopSecret#1");
    await run;

    expect(filled).toEqual([[0, "TopSecret#1"]]);
    expect(prompts.join("\n")).not.toContain("TopSecret#1");
    expect(JSON.stringify(await store.history.list())).not.toContain("TopSecret#1");
    expect(store.getState().items.some((i) => i.chip?.label === "Action required")).toBe(true);
    expect(store.getState().status).toBe("idle");
  });

  it("STOP resolves pending prompts and ends the run", async () => {
    const { store } = setup([{ type: "ask_user", question: "Code?", secure: { kind: "otp", elementId: 0 } }]);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1", allowSensitive: true });
    const run = store.send("go");
    await tick(); await tick();
    expect(store.getState().prompts).toHaveLength(1);
    store.stop();
    await run;
    expect(store.getState().running).toBe(false);
    expect(store.getState().prompts).toHaveLength(0);
  });

  it("disables the Linux sandbox on low-RAM devices", async () => {
    const { store, platform } = setup([]);
    platform.system.deviceInfo = async () => ({ lowRam: true, totalMemMb: 1024, linuxSandbox: true });
    await platform.kv.set("settings", JSON.stringify({ linuxSandbox: true }));
    await store.init();
    expect(store.getState().settings.linuxSandbox).toBe(false);
    expect(store.getState().linuxAvailable).toBe(false);
  });

  it("starts in Lite mode on a low-RAM device, but never overrides a saved choice", async () => {
    const low = setup([]);
    low.platform.system.deviceInfo = async () => ({ lowRam: true, totalMemMb: 1024, linuxSandbox: false });
    await low.store.init();
    expect(low.store.getState().settings.liteMode).toBe(true);

    const chosen = setup([]);
    chosen.platform.system.deviceInfo = async () => ({ lowRam: true, totalMemMb: 1024, linuxSandbox: false });
    await chosen.platform.kv.set("settings", JSON.stringify({ liteMode: false }));
    await chosen.store.init();
    expect(chosen.store.getState().settings.liteMode).toBe(false);

    const normal = setup([]);
    await normal.store.init();
    expect(normal.store.getState().settings.liteMode).toBe(false);
  });
});
