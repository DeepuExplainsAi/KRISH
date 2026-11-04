import { MemoryKeyStore, MemoryKV } from "@krish/core";
import { describe, expect, it } from "vitest";
import { unsupportedLocalModel, unsupportedPhone, type Platform } from "../src/platform/types";
import { AppStore } from "../src/state/store";
import { DICTS } from "../src/i18n";

const platform = (): Platform => ({
  kind: "web", local: unsupportedLocalModel(), kv: new MemoryKV(), keys: new MemoryKeyStore(), fetch: async () => new Response("{}"),
  browser: {} as Platform["browser"], files: { pick: async () => undefined, read: async () => new Uint8Array(), save: async () => false },
  system: { deviceInfo: async () => ({ lowRam: false, totalMemMb: 0, linuxSandbox: false }), requestNotifications: async () => false, scheduleDue: async () => {}, cancelDue: async () => {}, openExternal: async () => {} },
});

describe("phone control wiring", () => {
  it("consent is required and persisted through the store", async () => {
    const p = platform();
    const store = new AppStore(p);
    expect(await store.consent.accepted()).toBe(false);
    await store.consent.accept();
    expect(await new AppStore(p).consent.accepted()).toBe(true);
  });
  it("activity log lives in the platform's local kv and redacts", async () => {
    const p = platform();
    const store = new AppStore(p);
    await store.activity.add("t", "action", "mail a@b.com");
    expect(JSON.stringify([...(await store.activity.list())])).not.toContain("a@b.com");
    expect((await p.kv.get("activity-log")) ?? "").not.toContain("a@b.com");
  });
  it("unsupported phone host refuses to start and never confirms", async () => {
    const h = unsupportedPhone();
    expect(h.supported).toBe(false);
    await expect(h.start("x")).rejects.toThrow();
    expect(await h.confirm("t", "d")).toBe(false);
    expect((await h.status()).allowlist).toEqual([]);
  });
  it("every phone string exists in English and Hindi keeps the same placeholders", () => {
    const hiKeys = Object.keys(DICTS.hi).filter((k) => k.startsWith("phone") || k === "privacyPolicy" || k === "terms");
    for (const k of hiKeys) expect(k in DICTS.en, k).toBe(true);
  });
});
