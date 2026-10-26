import { MemoryKeyStore, MemoryKV, type PageObservation } from "@krish/core";
import { describe, expect, it } from "vitest";
import type { Platform } from "../src/platform/types";
import { APP_MAX, AppStore, firstWindow, migrateSettings, SETTINGS_VERSION } from "../src/state/store";

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
    system: { deviceInfo: async () => ({ lowRam: false, totalMemMb: 4096, linuxSandbox: false }), requestNotifications: async () => true, scheduleDue: async () => {}, cancelDue: async () => {}, openExternal: async () => {} },
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

  it("New chat clears the thread and returns to Chat, but is ignored while a run is active", async () => {
    const { store } = setup([{ type: "ask_user", question: "Code?", secure: { kind: "otp", elementId: 0 } }, { type: "done", summary: "ok" }]);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1", allowSensitive: true });
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
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1", allowSensitive: true });
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
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1", allowSensitive: true });
    await store.attach();
    await store.send("run saved task");
    expect(prompts[0]).not.toContain("USER_FILES");
    expect(store.getState().attachments.map((f) => f.name)).toEqual(["clip.mp4"]);
  });

  it("the default theme is Auto (follows the device)", () => {
    expect(setup([]).store.getState().settings.theme).toBe("system");
  });

  it("an old saved 'light' (the previous default) moves to Auto once; a later choice is kept", () => {
    expect(migrateSettings({ theme: "light" })).toMatchObject({ theme: "system", version: SETTINGS_VERSION });
    expect(migrateSettings({ theme: "dark" })).toMatchObject({ theme: "dark", version: SETTINGS_VERSION });
    expect(migrateSettings({ version: SETTINGS_VERSION, theme: "light" })).toEqual({ version: SETTINGS_VERSION, theme: "light" });
  });

  it("the window card starts docked at the right of the centered column on PC and in the lower half on a phone", () => {
    const pc = firstWindow(1600, 900);
    expect(pc.x + pc.w).toBe(Math.round((1600 + APP_MAX) / 2 - 20));
    expect(pc.y).toBe(84);
    const phone = firstWindow(467, 922);
    expect(phone).toMatchObject({ x: 16 });
    expect(phone.y).toBeGreaterThan(300);
    expect(phone.w).toBeLessThanOrEqual(467 - 24);
  });
});

describe("KrishVault in the store", () => {
  it("is created in the store and kept in the key store as ciphertext, never in kv", async () => {
    const { store, platform } = setup([]);
    await store.init();
    expect(store.vault.exists).toBe(false);
    await store.vault.create("master-pass");
    await store.vault.put({ site: "site.test", username: "me", password: "Sup3r-Secret" });
    expect((await platform.keys.get("krishVault"))!).not.toContain("Sup3r-Secret");
    expect(await platform.kv.get("krishVault")).toBeUndefined();
    store.vault.lock();
    expect(store.vault.unlocked).toBe(false);
  });

  it("a chat run fills the saved login into the page natively after the user confirms (value never in the prompt)", async () => {
    const { store, filled, prompts } = setup([{ type: "navigate", url: "https://site.test/login" }, { type: "done", summary: "ok" }]);
    await store.init();
    await store.addProvider({ name: "P", kind: "openai-compat", baseUrl: "https://p.test/v1" }, "k");
    await store.updateProvider({ ...store.getState().providers[0]!, defaultModel: "m1", allowSensitive: true });
    await store.vault.create("master-pass");
    await store.vault.put({ site: "site.test", username: "me", password: "Sup3r-Secret" });
    const run = store.send("log me in to site.test");
    await tick(); await tick();
    const card = store.getState().prompts[0]!;
    expect(card).toMatchObject({ type: "confirm", req: { kind: "vault" } });
    store.answer(card.id, true);
    await run;
    expect(filled.map(([, v]) => v)).toContain("Sup3r-Secret");
    expect(prompts.join("\n")).not.toContain("Sup3r-Secret");
  });
});
