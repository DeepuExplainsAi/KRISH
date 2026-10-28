import { MemoryKeyStore, MemoryKV, type PageObservation, type ProviderConfig } from "@krish/core";
import { describe, expect, it } from "vitest";
import type { Platform } from "../src/platform/types";
import { AppStore, insertByPreset, migrateSettings, SETTINGS_VERSION } from "../src/state/store";

const reply = (o: object) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }), { status: 200 });

function setup(script: object[]) {
  const filled: [number, string][] = [];
  const prompts: string[] = [];
  const hooks: { fetch?: (url: string, init?: RequestInit) => Response | undefined } = {}; // tests can take over the network after the store exists
  let i = 0;
  const pageListeners = new Set<(p: { url: string; title: string; loading: boolean }) => void>();
  const page: PageObservation = {
    url: "https://site.test/login", title: "Login", text: "Sign in",
    elements: [{ id: 0, tag: "input", label: "Verification code", autocomplete: "one-time-code" }], // a code field, not a login form: the sign-in card stays out of these tests
  };
  const platform: Platform = {
    kind: "web",
    kv: new MemoryKV(),
    keys: new MemoryKeyStore(),
    fetch: async (url, init) => {
      const forced = hooks.fetch?.(url, init);
      if (forced) return forced;
      if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 });
      prompts.push(JSON.parse(String(init?.body)).messages[1].content);
      return reply(script[Math.min(i++, script.length - 1)]!);
    },
    browser: {
      open: async (url) => { for (const loading of [true, false]) for (const cb of pageListeners) cb({ url, title: "", loading }); }, observe: async () => page, read: async () => "", click: async () => {}, type: async () => {},
      fill: async (id, v) => void filled.push([id, v]), upload: async () => {}, highlight: async () => {}, scroll: async () => {}, setBounds: async () => {},
      setMode: async () => {}, setDesktopLayout: async () => {}, snapshot: async () => "", stopLoading: async () => {}, clearSiteData: async () => {},
      onPage: (cb) => (pageListeners.add(cb), () => void pageListeners.delete(cb)),
    },
    files: { pick: async () => undefined, read: async () => new Uint8Array(), save: async () => false },
    system: { deviceInfo: async () => ({ lowRam: false, totalMemMb: 4096, linuxSandbox: false }), requestNotifications: async () => true, scheduleDue: async () => {}, cancelDue: async () => {}, openExternal: async () => {} },
  };
  return { store: new AppStore(platform, { providerWaits: [] }), filled, prompts, platform, hooks };
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

  it("a provider added with a key is ready at once: enabled, last in the fallback list, best model chosen", async () => {
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
    expect(b).toMatchObject({ enabled: true, defaultModel: "chat-3-pro", fallbackModel: "chat-small-mini", health: { ok: true } });
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
    expect(store.getState().providers[0]).toMatchObject({ defaultModel: "chat-7", fallbackModel: undefined, health: { ok: true } });

    platform.fetch = async (url) => (url.endsWith("/models") ? new Response(JSON.stringify({ data: [{ id: "chat-1" }] }), { status: 200 }) : new Response("{}", { status: 402 }));
    await store.addProvider({ name: "Z", kind: "openai-compat", baseUrl: "https://z.test/v1" }, "k");
    expect(store.getState().providers[1]).toMatchObject({ health: { ok: false, note: "needs paid credit" } });
    expect(store.getState().providers[1]!.defaultModel).toBeUndefined();
    expect(store.getState().checking).toEqual([]);
  });

  it("a real agent call updates the tick; a failed call clears it with the reason; the message can be dismissed", async () => {
    const { store, hooks } = setup([{ type: "done", summary: "Hello" }]);
    hooks.fetch = (_url, init) => (JSON.parse(String(init?.body ?? "{}")).messages?.length === 1 ? reply({ ok: true }) : undefined); // the one-message connection test
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]! });
    expect(store.getState().providers[0]!.health?.ok).toBe(true);
    hooks.fetch = () => new Response("{}", { status: 429 });
    await store.send("hi");
    expect(store.getState().providers[0]!.health).toMatchObject({ ok: false, note: "free limit used up, try again later" });
    const failed = store.getState().items.find((i) => i.failed)!;
    expect(failed.text).toMatch(/^No AI provider could answer\. .*free limit used up, try again later/);
    expect(failed.text).toContain("shared free limit is full right now (not your usage)"); // the built-in free services say it is their shared pool, not the user's
    store.dismissItem(failed.id);
    expect(store.getState().items.some((i) => i.failed)).toBe(false);
  });

  it("secure prompt: user value reaches the page, never the model or history", async () => {
    const { store, filled, prompts } = setup([
      { type: "navigate", url: "https://site.test/login" },
      { type: "ask_user", question: "Enter your password", secure: { kind: "password", elementId: 0 } },
      { type: "done", summary: "logged in" },
    ]);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    const p = store.getState().providers[0]!;
    await store.updateProvider({ ...p, defaultModel: "m1" });

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
    expect(store.getState().items.some((i) => i.chip?.label === "Waiting for you")).toBe(true);
    expect(store.getState().status).toBe("idle");
  });

  it("a plain chat answer never opens the browser card and ignores the tab left open; using a site opens the card", async () => {
    const { store, platform, prompts } = setup([{ type: "done", summary: "Hi!" }, { type: "navigate", url: "https://site.test/" }, { type: "done", summary: "ok" }]);
    let listener: (p: { url: string; title: string; loading: boolean }) => void = () => {};
    platform.browser.onPage = (cb) => ((listener = cb), () => {});
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1" });
    listener({ url: "https://www.instagram.com/accounts/login/", title: "Login", loading: false }); // an old tab
    store.openWindow();
    await store.send("hi");
    expect(store.getState().windowOpen).toBe(false);
    expect(store.getState().items.some((i) => i.chip)).toBe(false);
    expect(prompts[0]).toContain("No page is open");
    await store.send("open site.test");
    expect(store.getState().windowOpen).toBe(true);
  });

  it("STOP resolves pending prompts and ends the run", async () => {
    const { store } = setup([{ type: "navigate", url: "https://site.test/login" }, { type: "ask_user", question: "Code?", secure: { kind: "otp", elementId: 0 } }]);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1" });
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

  it("New chat clears the thread and returns to Chat, but is ignored while a run is active", async () => {
    const { store } = setup([{ type: "navigate", url: "https://site.test/login" }, { type: "ask_user", question: "Code?", secure: { kind: "otp", elementId: 0 } }, { type: "done", summary: "ok" }]);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1" });
    const run = store.send("hello");
    await tick(); await tick();
    store.newChat();
    expect(store.getState().items.length).toBeGreaterThan(0);
    store.answer(store.getState().prompts[0]!.id, "123456");
    await run;
    store.go("home");
    store.newChat();
    expect(store.getState().items).toEqual([]);
    expect(store.getState().screen).toBe("chat");
  });

  it("language defaults to auto and is saved", async () => {
    const { store, platform } = setup([]);
    await store.init();
    expect(store.getState().settings.language).toBe("auto");
    await store.saveSettings({ language: "hi" });
    expect(JSON.parse((await platform.kv.get("settings"))!).language).toBe("hi");
  });
});

describe("attachments", () => {
  const picked = [
    { name: "clip.mp4", size: 5_000_000, token: "t1" },
    { name: "a\u202Egnp.exe", size: 3, token: "t2" },
  ];
  function withPicker(script: object[]) {
    const ctx = setup(script);
    let n = 0;
    ctx.platform.files.pick = async () => picked[n++];
    return ctx;
  }

  it("attach adds a cleaned name, detach removes it, New chat clears them", async () => {
    const { store } = withPicker([{ type: "done", summary: "ok" }]);
    await store.init();
    await store.attach();
    await store.attach();
    expect(store.getState().attachments.map((f) => f.name)).toEqual(["clip.mp4", "a gnp.exe"]);
    store.detach("t1");
    expect(store.getState().attachments.map((f) => f.token)).toEqual(["t2"]);
    store.newChat();
    expect(store.getState().attachments).toEqual([]);
  });

  it("cancelling the picker adds nothing; the limit is enforced", async () => {
    const { store, platform } = setup([{ type: "done", summary: "ok" }]);
    await store.init();
    await store.attach();
    expect(store.getState().attachments).toEqual([]);
    let i = 0;
    platform.files.pick = async () => ({ name: `f${i}`, size: i++, token: `k${i}` });
    for (let k = 0; k < 15; k++) await store.attach();
    expect(store.getState().attachments).toHaveLength(10);
  });

  it("send hands the files to the agent (names + sizes only in the prompt), shows them in the thread and clears the tray", async () => {
    const { store, prompts, platform } = withPicker([{ type: "done", summary: "ok" }]);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1" });
    await store.attach();
    await store.send("post this video", { files: store.getState().attachments });
    const user = store.getState().items.find((i) => i.role === "user")!;
    expect(user.files).toEqual([{ name: "clip.mp4", size: 5_000_000 }]);
    expect(store.getState().attachments).toEqual([]);
    expect(prompts[0]).toContain("<USER_FILES>\nf1: clip.mp4 (5000000 bytes)\n</USER_FILES>");
    expect(JSON.stringify(prompts)).not.toContain("t1");
    void platform;
  });

  it("a picker result that arrives after New chat is dropped; two picks cannot run at once", async () => {
    const { store, platform } = setup([{ type: "done", summary: "ok" }]);
    await store.init();
    let release!: (f: { name: string; size: number; token: string }) => void;
    let calls = 0;
    platform.files.pick = () => (calls++, new Promise((r) => (release = r)));
    const first = store.attach();
    void store.attach(); // ignored: a picker is already open
    expect(calls).toBe(1);
    store.newChat();
    release({ name: "late.zip", size: 1, token: "x" });
    await first;
    expect(store.getState().attachments).toEqual([]);
  });

  it("only the composer passes attachments: a saved task or panel run neither sends nor clears them", async () => {
    const { store, prompts } = withPicker([{ type: "done", summary: "ok" }]);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1" });
    await store.attach();
    await store.send("run saved task");
    expect(prompts[0]).not.toContain("USER_FILES");
    expect(store.getState().attachments.map((f) => f.name)).toEqual(["clip.mp4"]);
  });

  it("with no key added, the built-in free AI answers; model and provider names never reach the chat", async () => {
    const { store, hooks } = setup([{ type: "done", summary: "Hello" }]);
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
    const { store } = setup([{ type: "done", summary: "Hello" }]);
    await store.init();
    await store.saveSettings({ freeFallback: false });
    await store.send("hi");
    expect(store.getState().items.find((i) => i.failed)?.text).toMatch(/^No AI provider could answer\. Nothing is set up/);
  });

  it("a question or an approval is not 'action required'; a password prompt is", async () => {
    const { store } = setup([{ type: "navigate", url: "https://site.test/x" }, { type: "ask_user", question: "Which one?" }, { type: "done", summary: "ok" }]);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1" });
    const run = store.send("do it");
    await tick(); await tick();
    expect(store.getState().prompts[0]?.type).toBe("ask");
    expect(store.getState().status).toBe("running");
    store.answer(store.getState().prompts[0]!.id, "the first");
    await run;
  });

  it("a login page with no saved login opens the sign-in card in the chat; its values go to the page, not the AI", async () => {
    const { store, filled, prompts, platform } = setup([{ type: "navigate", url: "https://site.test/login" }, { type: "sign_in" }, { type: "done", summary: "in" }]);
    platform.browser.observe = async () => ({
      url: "https://site.test/login", title: "Login", text: "Sign in",
      elements: [{ id: 0, tag: "input", type: "text", label: "Email" }, { id: 1, tag: "input", type: "password", label: "Password" }],
    });
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1" });
    const run = store.send("log me in to site.test");
    await tick(); await tick();
    const card = store.getState().prompts[0]!;
    expect(card.type).toBe("login");
    expect(store.getState().status).toBe("action_required");
    store.answer(card.id, { username: "me@x.com", password: "Card-pw-9" });
    await run;
    expect(filled).toEqual([[0, "me@x.com"], [1, "Card-pw-9"]]);
    expect(prompts.join("\n")).not.toContain("Card-pw-9");
  });

  it("defaults: the free AI is the last resort, and the old confirmation switches are gone (also from saved settings)", async () => {
    expect(setup([]).store.getState().settings).toMatchObject({ freeFallback: true, tourDone: false });
    expect(setup([]).store.getState().settings).not.toHaveProperty("confirmFill");
    const { store, platform } = setup([]);
    await platform.kv.set("settings", JSON.stringify({ version: 4, confirmFill: true, aiSeesLogin: false, liteMode: true }));
    await store.init();
    expect(store.getState().settings).toMatchObject({ liteMode: true, version: 5 });
    expect(store.getState().settings).not.toHaveProperty("confirmFill");
    expect(store.getState().settings).not.toHaveProperty("aiSeesLogin");
  });

  it("a new key is placed by the preset order: OpenCode Zen, OpenRouter, Gemini, then the others, custom last", () => {
    const p = (name: string) => ({ id: name, name, kind: "openai-compat" as const, baseUrl: "https://x.test", enabled: true, allowSensitive: false });
    let list: ProviderConfig[] = [p("Groq"), p("My own")];
    for (const n of ["Google Gemini", "OpenRouter", "OpenCode Zen"]) list = insertByPreset(list, p(n));
    expect(list.map((x) => x.name)).toEqual(["OpenCode Zen", "OpenRouter", "Google Gemini", "Groq", "My own"]);
  });

  it("the free fallback is more than one service, tried after the user's own keys", async () => {
    const { store, hooks } = setup([{ type: "done", summary: "Hello" }]);
    const hosts: string[] = [];
    hooks.fetch = (url) => (hosts.push(new URL(url).host), url.includes("pollinations") ? new Response("{}", { status: 429 }) : undefined);
    await store.init();
    await store.send("hi");
    expect(hosts.filter((h) => h === "text.pollinations.ai" || h === "api.llm7.io")).toEqual(expect.arrayContaining(["text.pollinations.ai", "api.llm7.io"]));
    expect(store.getState().items.map((i) => i.text ?? "").join(" ")).toContain("Hello");
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

  it("the browser card is part of the layout: open, expand and close", async () => {
    const { store } = setup([]);
    await store.init();
    store.openWindow();
    store.toggleWindowExpanded();
    expect(store.getState()).toMatchObject({ windowOpen: true, windowExpanded: true });
    store.closeWindow();
    expect(store.getState()).toMatchObject({ windowOpen: false, windowExpanded: false });
  });

  it("saved logins live in the key store (never in kv) and survive a restart with nothing to unlock", async () => {
    const { store, platform } = setup([]);
    await store.init();
    await store.vault.put({ site: "site.test", username: "me", password: "Sup3r-Secret" });
    expect(await platform.keys.get("krishLogins")).toContain("me");
    expect(await platform.kv.get("krishLogins")).toBeUndefined();
    const again = setup([]);
    await again.platform.keys.set("krishLogins", (await platform.keys.get("krishLogins"))!);
    await again.store.init();
    expect(again.store.vault.logins("https://site.test/login")[0]?.password).toBe("Sup3r-Secret");
  });

  it("a chat run fills the saved login into the page and sends it, with no card (value never in the prompt)", async () => {
    const { store, filled, prompts, platform } = setup([{ type: "navigate", url: "https://site.test/login" }, { type: "sign_in" }, { type: "done", summary: "ok" }]);
    platform.browser.observe = async () => ({
      url: "https://site.test/login", title: "Login", text: "Sign in",
      elements: [{ id: 0, tag: "input", type: "text", label: "Email" }, { id: 1, tag: "input", type: "password", label: "Password" }, { id: 2, tag: "button", text: "Log in", submits: true }],
    });
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1" });
    await store.vault.put({ site: "site.test", username: "me", password: "Sup3r-Secret" });
    const seen: string[] = [];
    const off = store.subscribe(() => store.getState().prompts.forEach((p) => seen.push(p.type)));
    await store.send("log me in to site.test");
    off();
    expect(seen).toEqual([]);
    expect(filled.map(([, v]) => v)).toEqual(["me", "Sup3r-Secret"]);
    expect(prompts.join("\n")).not.toContain("Sup3r-Secret");
  });
});

describe("free services and live model lists", () => {
  const zenList = (ids: string[]) => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });

  it("OpenCode Zen's free models are asked first, with the public key, before the user's own keys", async () => {
    const { store, hooks } = setup([{ type: "done", summary: "Hello" }]);
    const calls: { host: string; auth: string }[] = [];
    hooks.fetch = (url, init) => (url.endsWith("/chat/completions") && calls.push({ host: new URL(url).host, auth: String((init?.headers as Record<string, string>).authorization) }), undefined);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "mine");
    calls.length = 0;
    await store.send("hi");
    expect(calls[0]).toEqual({ host: "opencode.ai", auth: "Bearer public" });
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
