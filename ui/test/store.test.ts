import { MemoryKeyStore, MemoryKV, type ProviderConfig } from "@krish/core";
import { describe, expect, it } from "vitest";
import { unsupportedLocalModel, type Platform, type LocalProgress } from "../src/platform/types";
import { AppStore, insertByPreset, migrateSettings, parseReply as parseAction, parseReply, SETTINGS_VERSION } from "../src/state/store";

const reply = (o: object) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }), { status: 200 });

function setup(script: object[]) {
  const prompts: string[] = [];
  const hooks: { fetch?: (url: string, init?: RequestInit) => Response | undefined } = {}; // tests can take over the network after the store exists
  let i = 0;
  const platform: Platform = {
    kind: "web",
    local: unsupportedLocalModel(),
    kv: new MemoryKV(),
    keys: new MemoryKeyStore(),
    fetch: async (url, init) => {
      const sent = typeof init?.body === "string" ? (JSON.parse(init.body).messages as { content: string }[] | undefined) : undefined;
      if (sent && sent.length > 1) prompts.push(sent.map((m) => m.content).join("\n")); // real chat turns only, not the one-message connection test
      const forced = hooks.fetch?.(url, init);
      if (forced) return forced;
      if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 });
      return reply(script[Math.min(i++, script.length - 1)]!);
    },
    files: { pick: async () => undefined, read: async () => new Uint8Array(), save: async () => false },
    system: { deviceInfo: async () => ({ lowRam: false, totalMemMb: 4096 }), requestNotifications: async () => true, scheduleDue: async () => {}, cancelDue: async () => {}, openExternal: async () => {} },
  };
  return { store: new AppStore(platform, { providerWaits: [], sleep: async () => undefined }), prompts, platform, hooks };
}


describe("native model store", () => {
  function localSetup() {
    const result = setup([]);
    let emit: (event: LocalProgress) => void = () => {};
    let installed: string[] = [];
    let error: string | undefined;
    const actions: string[] = [];
    result.platform.kind = "android";
    result.platform.local = {
      ...unsupportedLocalModel(),
      supported: true,
      deviceInfo: async () => ({ totalRamMB: 4096, freeStorageMB: 10000, metered: false }),
      listInstalled: async () => ({ installed, partial: [] }),
      download: async (id) => { actions.push(`download:${id}`); if (error) throw new Error(error); },
      pause: async (id) => { actions.push(`pause:${id}`); },
      resume: async (id) => { actions.push(`resume:${id}`); },
      cancel: async (id) => { actions.push(`cancel:${id}`); },
      delete: async (id) => { actions.push(`delete:${id}`); installed = installed.filter((m) => m !== id); },
      onProgress: (cb) => { emit = cb; return () => { emit = () => {}; }; },
    };
    return { ...result, actions, event: (event: LocalProgress) => emit(event), setInstalled: (ids: string[]) => { installed = ids; }, setError: (msg: string) => { error = msg; } };
  }

  it("prefers installed local, disables online by default, and enables fallback only by consent", async () => {
    const x = localSetup();
    x.setInstalled(["qwen3.5-2b"]);
    const calls: string[] = [];
    let fails = false;
    x.platform.local.complete = async (model, messages, schema) => {
      calls.push(model);
      expect(JSON.parse(schema).required).toEqual(["reply"]);
      expect(messages).not.toContain("imageDataUrl");
      if (fails) throw new Error("process died");
      return '{"reply":"local"}';
    };
    let onlineCalls = 0;
    x.hooks.fetch = () => { onlineCalls++; return reply({ reply: "backup" }); };
    await x.store.init();
    const messages = [{ role: "user" as const, content: "hello", imageDataUrl: "data:secret" }];
    expect((await x.store.router.run(messages, parseAction)).providerId).toBe("native-local");
    expect(calls).toEqual(["qwen3.5-2b"]);
    expect(onlineCalls).toBe(0);
    fails = true;
    await expect(x.store.router.run(messages, parseAction)).rejects.toThrow("No AI provider could answer");
    expect(onlineCalls).toBe(0);
    const online: ProviderConfig = { id: "api", name: "API", kind: "openai-compat", baseUrl: "https://api.test", enabled: true, defaultModel: "m" };
    x.store.state.providers = [online];
    await x.platform.keys.set("api", "key");
    await x.store.saveSettings({ nativeBackup: true });
    const result = await x.store.router.run(messages, parseAction);
    expect(result.providerId).toBe("api");
    expect(result.attempts[0]?.outcome).toBe("server");
    expect(onlineCalls).toBe(1);
    fails = false;
    expect((await x.store.router.run(messages, parseAction)).providerId).toBe("native-local");
    x.store.dispose();
  });

  it("uses online providers normally when no native model is installed", async () => {
    const x = localSetup();
    await x.store.init();
    const online: ProviderConfig = { id: "api", name: "API", kind: "openai-compat", baseUrl: "https://api.test", enabled: true, defaultModel: "m" };
    x.store.state.providers = [online];
    await x.platform.keys.set("api", "key");
    x.hooks.fetch = () => reply({ reply: "online" });
    expect((await x.store.router.run([{ role: "user", content: "hi" }], parseAction)).providerId).toBe("api");
    x.store.dispose();
  });

  it("shows progress, pause, checksum mismatch and resumes after consent", async () => {
    const x = localSetup(); await x.store.init();
    const id = "qwen3.5-2b";
    await x.store.startNativeDownload(id, false);
    expect(x.actions).toEqual([]);
    await x.store.startNativeDownload(id, true);
    expect(x.actions).toEqual([`download:${id}`]);
    x.event({ modelId: id, status: "downloading", bytes: 40, total: 100 });
    expect(x.store.getState().nativeProgress[id]?.bytes).toBe(40);
    await x.store.controlNativeDownload(id, "pause");
    x.event({ modelId: id, status: "paused", bytes: 40, total: 100 });
    await x.store.startNativeDownload(id, true);
    x.event({ modelId: id, status: "error", bytes: 0, total: 100, error: "Model checksum mismatch" });
    expect(x.store.getState().nativeError).toBe("Model checksum mismatch");
    expect(x.store.getState().nativeInstalled).toEqual([]);
    x.store.dispose();
  });

  it("reports storage errors and selects and deletes only installed models", async () => {
    const x = localSetup(); await x.store.init();
    x.setError("Not enough free storage");
    await x.store.startNativeDownload("qwen3.5-2b", true);
    expect(x.store.getState().nativeError).toBe("Not enough free storage");
    await x.store.selectNativeModel("qwen3.5-2b");
    expect(x.store.getState().settings.nativeSelectedModel).toBeUndefined();
    x.setInstalled(["qwen3.5-0.8b", "qwen3.5-2b"]);
    await x.store.refreshNativeModels();
    expect(x.store.getState().settings.nativeSelectedModel).toBe("qwen3.5-2b");
    await x.store.selectNativeModel("qwen3.5-0.8b");
    await x.store.controlNativeDownload("qwen3.5-0.8b", "delete");
    expect(x.store.getState().nativeInstalled).toEqual(["qwen3.5-2b"]);
    expect(x.store.getState().settings.nativeSelectedModel).toBe("qwen3.5-2b");
    x.store.dispose();
  });
});


describe("AppStore", () => {
  it("retains Android RAM for the model preview but not a browser demo value", async () => {
    const { store, platform } = setup([]);
    platform.kind = "android";
    await store.init();
    expect(store.getState().deviceTotalRamMB).toBe(4096);
    store.dispose();
    const demo = setup([]).store;
    await demo.init();
    expect(demo.getState().deviceTotalRamMB).toBe(0);
    demo.dispose();
  });

  it("adds a provider with one automatic model fetch, key kept out of kv", async () => {
    const { store, platform } = setup([]);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "SECRET-KEY");
    const p = store.getState().providers[0]!;
    expect(p.models?.items.map((m) => m.id)).toEqual(["m1"]);
    expect(await platform.keys.get(p.id)).toBe("SECRET-KEY");
    expect(JSON.stringify(await platform.kv.get("providers"))).not.toContain("SECRET-KEY");
  });

  it("a provider added with a key is ready at once: enabled, last in the order of use, one best model chosen", async () => {
    const { store, platform } = setup([]);
    platform.fetch = async (url) =>
      url.endsWith("/models")
        ? new Response(JSON.stringify({ data: [{ id: "chat-small-mini" }, { id: "chat-3-pro" }, { id: "embed-1" }] }), { status: 200 })
        : reply({ ok: true });
    await store.init();
    await store.addProvider({ name: "A", kind: "openai-compat", baseUrl: "https://a.test/v1" }, "k1");
    await store.addProvider({ name: "B", kind: "openai-compat", baseUrl: "https://b.test/v1" }, "k2");
    const [a, b] = store.getState().providers;
    expect([a!.name, b!.name]).toEqual(["A", "B"]);
    expect(b).toMatchObject({ enabled: true, defaultModel: "chat-3-pro", health: { ok: true } });
  });

  it("only models that really answer are chosen; a provider that answers nothing shows why, not a tick", async () => {
    const { store, platform } = setup([]);
    platform.fetch = async (url, init) => {
      if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "chat-9" }, { id: "chat-8" }, { id: "chat-7" }] }), { status: 200 });
      const model = JSON.parse(String(init?.body)).model as string;
      return model === "chat-7" ? reply({ ok: true }) : new Response("{}", { status: model === "chat-9" ? 429 : 402 });
    };
    await store.init();
    await store.addProvider({ name: "A", kind: "openai-compat", baseUrl: "https://a.test/v1" }, "k");
    expect(store.getState().providers[0]).toMatchObject({ defaultModel: "chat-7", health: { ok: true } });

    platform.fetch = async (url) => (url.endsWith("/models") ? new Response(JSON.stringify({ data: [{ id: "chat-1" }] }), { status: 200 }) : new Response("{}", { status: 402 }));
    await store.addProvider({ name: "Z", kind: "openai-compat", baseUrl: "https://z.test/v1" }, "k");
    expect(store.getState().providers[1]).toMatchObject({ health: { ok: false, note: "needs paid credit" } });
    expect(store.getState().providers[1]!.defaultModel).toBeUndefined();
    expect(store.getState().checking).toEqual([]);
  });

  it("starts in Lite mode on a low-RAM device, but never overrides a saved choice", async () => {
    const low = setup([]);
    low.platform.system.deviceInfo = async () => ({ lowRam: true, totalMemMb: 1024, });
    await low.store.init();
    expect(low.store.getState().settings.liteMode).toBe(true);

    const chosen = setup([]);
    chosen.platform.system.deviceInfo = async () => ({ lowRam: true, totalMemMb: 1024, });
    await chosen.platform.kv.set("settings", JSON.stringify({ liteMode: false }));
    await chosen.store.init();
    expect(chosen.store.getState().settings.liteMode).toBe(false);

    const normal = setup([]);
    await normal.store.init();
    expect(normal.store.getState().settings.liteMode).toBe(false);
  });

  it("language defaults to auto and is saved", async () => {
    const { store, platform } = setup([]);
    await store.init();
    expect(store.getState().settings.language).toBe("auto");
    await store.saveSettings({ language: "hi" });
    expect(JSON.parse((await platform.kv.get("settings"))!).language).toBe("hi");
  });

  it("a real reply updates the tick; a failed call clears it with the reason; the message can be dismissed", async () => {
    const { store, hooks } = setup([{ reply: "Hello" }]);
    hooks.fetch = (_url, init) => (JSON.parse(String(init?.body ?? "{}")).messages?.length === 1 ? reply({ ok: true }) : undefined); // the one-message connection test
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]! });
    expect(store.getState().providers[0]!.health?.ok).toBe(true);
    hooks.fetch = () => new Response("{}", { status: 429 });
    await store.send("hi");
    expect(store.getState().providers[0]!.health).toMatchObject({ ok: false, note: "rate limit hit, try again in a moment" });
    const failed = store.getState().items.find((i) => i.failed)!;
    expect(failed.text).toMatch(/^No AI provider could answer\. .*rate limit hit, try again in a moment/);
    expect(failed.text).toContain("shared free limit is full right now (not your usage)"); // the built-in free services say it is their shared pool, not the user's
    store.dismissItem(failed.id);
    expect(store.getState().items.some((i) => i.failed)).toBe(false);
  });

  it("with no key added, the built-in free AI answers; model and provider names never reach the chat", async () => {
    const { store, hooks } = setup([{ reply: "Hello" }]);
    const hosts: string[] = [];
    hooks.fetch = (url) => (hosts.push(new URL(url).host), undefined);
    await store.init();
    await store.send("hi");
    expect(hosts).toContain("text.pollinations.ai");
    const texts = store.getState().items.map((i) => i.text ?? "").join("\n");
    expect(texts).toContain("Hello");
    expect(texts).not.toMatch(/pollinations|openai-fast|Free AI/i);
    expect(store.getState().providers).toEqual([]); // the built-in service is never listed as the user's own key
  });

  it("with the free fallback switched off and no key, the run fails with one calm message", async () => {
    const { store } = setup([{ reply: "Hello" }]);
    await store.init();
    await store.saveSettings({ freeFallback: false });
    await store.send("hi");
    expect(store.getState().items.find((i) => i.failed)?.text).toMatch(/^No AI provider could answer\. Nothing is set up/);
  });

  it("a message sent while a reply is pending joins the queue and runs next; STOP drops the queue", async () => {
    const { store, hooks } = setup([]);
    hooks.fetch = (_url, init) => {
      const m = JSON.parse(String(init?.body ?? "{}")).messages as { content: string }[] | undefined;
      return m && m.length > 1 ? reply({ reply: `re ${m.at(-1)!.content}` }) : undefined;
    };
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1" });
    const run = store.send("one");
    await store.send("two");
    await store.send("three");
    expect(store.getState().queue.map((q) => q.command)).toEqual(["two", "three"]);
    await run;
    const texts = store.getState().items.map((i) => i.text ?? "");
    expect(texts).toEqual(["one", "re one", "two", "re two", "three", "re three"]);
    expect(store.getState().running).toBe(false);

    const again = store.send("four");
    await store.send("five");
    store.stop();
    await again;
    expect(store.getState().queue).toEqual([]);
    expect(store.getState().running).toBe(false);
    expect(store.getState().items.map((i) => i.text)).not.toContain("five");
  });

  it("the model sees notes, the project and recent turns, with secrets redacted", async () => {
    const { store, prompts, hooks } = setup([]);
    hooks.fetch = (_url, init) => ((JSON.parse(String(init?.body ?? "{}")).messages?.length ?? 0) > 1 ? reply({ reply: "ok" }) : undefined);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1" });
    await store.memory.add("my dog is Rex");
    await store.send("my password is hunter2");
    await store.send("again");
    expect(prompts.at(-1)).toContain("my dog is Rex");
    expect(prompts.at(-1)).toContain("again");
    expect(prompts.join("\n")).not.toContain("hunter2");
  });

  it("New chat clears the thread and returns to Chat, but is ignored while a reply is pending", async () => {
    const { store } = setup([{ reply: "ok" }]);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1" });
    const run = store.send("hello");
    store.newChat();
    expect(store.getState().items.length).toBeGreaterThan(0);
    await run;
    store.go("home");
    store.newChat();
    expect(store.getState().items).toEqual([]);
    expect(store.getState().screen).toBe("chat");
  });

  it("settings from an older build lose the browser switches", async () => {
    const { store, platform } = setup([]);
    await platform.kv.set("settings", JSON.stringify({ version: 5, confirmFill: true, autoOpenWindow: true, desktopLayout: true, linuxSandbox: true, liteMode: true }));
    await store.init();
    const st = store.getState().settings;
    expect(st).toMatchObject({ liteMode: true, version: SETTINGS_VERSION, freeFallback: true });
    for (const gone of ["confirmFill", "autoOpenWindow", "desktopLayout", "linuxSandbox", "screenshots"]) expect(st).not.toHaveProperty(gone);
  });
});

describe("parseReply", () => {
  it("takes the reply field, or the plain text when the model ignored the format", () => {
    expect(parseReply('{"reply":"Hi"}')).toBe("Hi");
    expect(parseReply("Just text")).toBe("Just text");
    expect(parseReply('{"other":1}')).toBe('{"other":1}');
    expect(() => parseReply("  ")).toThrow();
  });
});

describe("settings helpers", () => {
  it("a new key is placed by the preset order: OpenCode Zen, OpenRouter, Gemini, then the others, custom last", () => {
    const p = (name: string) => ({ id: name, name, kind: "openai-compat" as const, baseUrl: "https://x.test", enabled: true, allowSensitive: false });
    let list: ProviderConfig[] = [p("Groq"), p("My own")];
    for (const n of ["Google Gemini", "OpenRouter", "OpenCode Zen"]) list = insertByPreset(list, p(n));
    expect(list.map((x) => x.name)).toEqual(["OpenCode Zen", "OpenRouter", "Google Gemini", "Groq", "My own"]);
  });

  it("the default theme is Auto (day and night)", () => {
    expect(setup([]).store.getState().settings.theme).toBe("auto");
  });

  it("an old saved default ('light' from v1, 'system' from v2) moves to Auto once; a later choice is kept", () => {
    expect(migrateSettings({ theme: "light" })).toMatchObject({ theme: "auto", version: SETTINGS_VERSION });
    expect(migrateSettings({ version: 2, theme: "system" })).toMatchObject({ theme: "auto", version: SETTINGS_VERSION });
    expect(migrateSettings({ version: 2, theme: "light" })).toMatchObject({ theme: "light", version: SETTINGS_VERSION });
    expect(migrateSettings({ theme: "dark" })).toMatchObject({ theme: "dark", version: SETTINGS_VERSION });
    expect(migrateSettings({ version: SETTINGS_VERSION, theme: "light" })).toEqual({ version: SETTINGS_VERSION, theme: "light" });
  });
});

describe("free services and live model lists", () => {
  const zenList = (ids: string[]) => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });

  it("the user's own provider answers first; the built-in free services (OpenCode Zen first) are only the last resort", async () => {
    const { store, hooks } = setup([{ type: "done", summary: "Hello" }]);
    const calls: { host: string; auth: string }[] = [];
    hooks.fetch = (url, init) => (url.endsWith("/chat/completions") && calls.push({ host: new URL(url).host, auth: String((init?.headers as Record<string, string>).authorization) }), undefined);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "mine");
    calls.length = 0;
    await store.send("hi");
    expect(calls).toEqual([{ host: "p.test", auth: "Bearer mine" }]); // stays on P: nothing else is asked while P works
    hooks.fetch = (url, init) => (url.endsWith("/chat/completions") ? (calls.push({ host: new URL(url).host, auth: String((init?.headers as Record<string, string>).authorization) }), url.includes("p.test") ? new Response('{"error":{"message":"free-models-per-day limit"}}', { status: 429 }) : undefined) : undefined);
    calls.length = 0;
    await store.send("hi again");
    expect(calls).toEqual([{ host: "p.test", auth: "Bearer mine" }, { host: "opencode.ai", auth: "Bearer public" }]); // P's day is spent: OpenCode Zen free, with the public key
  });

  it("the live list replaces the seeded models, and what appeared or vanished is reported", async () => {
    const { store, hooks } = setup([]);
    let ids = ["big-pickle", "zen-a-free", "zen-b-free"];
    hooks.fetch = (url) => (url === "https://opencode.ai/zen/v1/models" ? zenList(ids) : undefined);
    await store.init();
    await store.syncLists();
    const zen = () => store.getState().freeProviders.find((p) => p.id === "builtin-zen")!;
    expect(zen().models?.items.map((m) => m.id)).toEqual(ids);
    expect(zen().defaultModel).toBe("big-pickle");
    ids = ["zen-b-free", "zen-c-free"];
    await store.syncLists();
    expect(zen().modelsChanged).toMatchObject({ added: ["zen-c-free"], removed: ["big-pickle", "zen-a-free"] });
    expect(zen().defaultModel).not.toMatch(/big-pickle|zen-a-free/); // a retired default is never kept
  });

  it("a free service that is down keeps its last working models", async () => {
    const { store, hooks } = setup([]);
    hooks.fetch = (url) => (url === "https://opencode.ai/zen/v1/models" ? new Response("{}", { status: 503 }) : undefined);
    await store.init();
    await store.syncLists();
    expect(store.getState().freeProviders.find((p) => p.id === "builtin-zen")?.defaultModel).toBe("big-pickle");
  });
});

