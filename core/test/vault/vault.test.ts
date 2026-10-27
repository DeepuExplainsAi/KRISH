import { describe, expect, it } from "vitest";
import { ALL_SITES, findLoginFields, normalizeSite, Vault, VaultError } from "../../src/vault/vault";
import { MemoryKeyStore } from "../../src/storage";

const fast = { iterations: 1000 };
const entry = { site: "https://www.instagram.com/accounts/login", username: "deepu", password: "p@ss-1234" };

describe("Vault", () => {
  it("stores nothing readable: the stored blob has no password, username or site", async () => {
    const store = new MemoryKeyStore();
    const v = new Vault(store, fast);
    await v.create("master-pass");
    await v.put(entry);
    const raw = (await store.get("krishVault"))!;
    for (const secret of ["p@ss-1234", "deepu", "instagram"]) expect(raw).not.toContain(secret);
  });

  it("survives a restart: unlock with the right passphrase returns the login, a wrong one does not", async () => {
    const store = new MemoryKeyStore();
    const a = new Vault(store, fast);
    await a.create("master-pass");
    await a.put(entry);
    const b = new Vault(store, fast);
    await b.load();
    expect(b.exists).toBe(true);
    expect(b.unlocked).toBe(false);
    expect(await b.unlock("wrong-pass!")).toBe(false);
    expect(b.unlocked).toBe(false);
    expect(await b.unlock("master-pass")).toBe(true);
    expect(b.list()).toMatchObject([{ site: "instagram.com", username: "deepu", password: "p@ss-1234" }]);
  });

  it("is unreadable while locked and refuses a weak passphrase or a second create", async () => {
    const v = new Vault(new MemoryKeyStore(), fast);
    await expect(v.create("short")).rejects.toThrow(VaultError);
    await v.create("master-pass");
    await expect(v.create("another-pass")).rejects.toThrow(VaultError);
    await v.put(entry);
    v.lock();
    expect(() => v.list()).toThrow("locked");
    await expect(v.put(entry)).rejects.toThrow("locked");
  });

  it("uses a fresh IV on every save", async () => {
    const store = new MemoryKeyStore();
    const v = new Vault(store, fast);
    await v.create("master-pass");
    const a = JSON.parse((await store.get("krishVault"))!).iv;
    await v.put(entry);
    const b = JSON.parse((await store.get("krishVault"))!).iv;
    expect(a).not.toBe(b);
  });

  it("a login for every site is a default; a login for the site itself comes first and wins", async () => {
    const v = new Vault(new MemoryKeyStore(), fast);
    await v.create("master-pass");
    await v.put({ site: ALL_SITES, username: "main", password: "main-pw-1" });
    expect(normalizeSite("*")).toBe(ALL_SITES);
    expect(v.logins("https://shop.test/login").map((e) => e.username)).toEqual(["main"]);
    await v.put({ site: "shop.test", username: "work", password: "work-pw-1" });
    expect(v.logins("https://www.shop.test/login").map((e) => e.username)).toEqual(["work", "main"]);
    expect(v.logins("not a url")).toHaveLength(0);
  });

  it("matches logins by registrable site only (a look-alike host gets nothing)", async () => {
    const v = new Vault(new MemoryKeyStore(), fast);
    await v.create("master-pass");
    await v.put(entry);
    expect(v.logins("https://m.instagram.com/")).toHaveLength(1);
    expect(v.logins("https://instagram.com.evil.test/")).toHaveLength(0);
    expect(v.logins("https://notinstagram.com/")).toHaveLength(0);
    expect(v.logins("not a url")).toHaveLength(0);
  });

  it("updates an entry in place, removes it, and erases everything", async () => {
    const store = new MemoryKeyStore();
    const v = new Vault(store, fast);
    await v.create("master-pass");
    const e = await v.put(entry);
    await v.put({ ...entry, id: e.id, password: "new-pass-9" });
    expect(v.list()).toHaveLength(1);
    expect(v.list()[0]!.password).toBe("new-pass-9");
    await v.remove(e.id);
    expect(v.list()).toHaveLength(0);
    await v.erase();
    expect(await store.get("krishVault")).toBeUndefined();
    expect(v.exists).toBe(false);
  });

  it("locks itself after the idle time", async () => {
    const v = new Vault(new MemoryKeyStore(), { ...fast, autoLockMs: 20 });
    await v.create("master-pass");
    await new Promise((r) => setTimeout(r, 60));
    expect(v.unlocked).toBe(false);
  });

  it("rejects an empty password and a site it cannot read", async () => {
    const v = new Vault(new MemoryKeyStore(), fast);
    await v.create("master-pass");
    await expect(v.put({ ...entry, password: "" })).rejects.toThrow("password");
    await expect(v.put({ ...entry, site: "   " })).rejects.toThrow("site");
  });

  it("normalizes sites", () => {
    expect(normalizeSite("Instagram.com")).toBe("instagram.com");
    expect(normalizeSite("https://accounts.google.com/x")).toBe("google.com");
  });
});

describe("Vault lifecycle", () => {
  /** A key store whose writes finish in reverse order, to expose lost updates and resurrected data. */
  const slowStore = (delays: number[]) => {
    const inner = new MemoryKeyStore();
    let n = 0;
    return Object.assign(inner, {
      set: async (k: string, v: string) => { const d = delays[n++ % delays.length]!; await new Promise((r) => setTimeout(r, d)); await MemoryKeyStore.prototype.set.call(inner, k, v); },
    });
  };

  it("two saves started together both end up in storage, even if the first one is slower", async () => {
    const store = slowStore([0, 40, 5]);
    const v = new Vault(store, fast);
    await v.create("master-pass");
    await Promise.all([v.put({ ...entry, site: "a.test" }), v.put({ ...entry, site: "b.test" })]);
    const again = new Vault(store, fast);
    await again.load();
    await again.unlock("master-pass");
    expect(again.list().map((e) => e.site)).toEqual(["a.test", "b.test"]);
  });

  it("erase wins over a save that was still running", async () => {
    const store = slowStore([0, 30]);
    const v = new Vault(store, fast);
    await v.create("master-pass");
    const saving = v.put(entry).catch(() => undefined);
    await v.erase();
    await saving;
    expect(await store.get("krishVault")).toBeUndefined();
    expect(v.exists).toBe(false);
  });

  it("an unlock that was still computing when the vault was locked does not unlock it", async () => {
    const store = new MemoryKeyStore();
    const a = new Vault(store, { iterations: 200_000 });
    await a.create("master-pass");
    a.lock();
    const pending = a.unlock("master-pass");
    a.lock();
    expect(await pending).toBe(false);
    expect(a.unlocked).toBe(false);
  });

  it("a failed save changes nothing in memory", async () => {
    const store = new MemoryKeyStore();
    const v = new Vault(store, fast);
    await v.create("master-pass");
    await v.put(entry);
    const ok = store.set.bind(store);
    store.set = async () => { throw new Error("disk full"); };
    await expect(v.put({ ...entry, site: "x.test" })).rejects.toThrow("disk full");
    expect(v.list().map((e) => e.site)).toEqual(["instagram.com"]);
    store.set = ok;
    await v.put({ ...entry, site: "x.test" });
    expect(v.list()).toHaveLength(2);
  });

  it("a stored vault that cannot be read is never treated as absent (so it cannot be overwritten)", async () => {
    const store = new MemoryKeyStore();
    store.get = async () => { throw new Error("keystore busy"); };
    const v = new Vault(store, fast);
    await v.load();
    expect(v.unreadable).toBe(true);
    await expect(v.create("master-pass")).rejects.toThrow("could not be read");
  });

  it("listing does not extend the idle timer", async () => {
    const v = new Vault(new MemoryKeyStore(), { ...fast, autoLockMs: 60 });
    await v.create("master-pass");
    for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 20)); if (v.unlocked) v.list(); }
    expect(v.unlocked).toBe(false);
  });
});

describe("findLoginFields", () => {
  it("finds the password field and the text field just before it", () => {
    const f = findLoginFields([
      { id: 0, tag: "input", type: "search", label: "Search" },
      { id: 1, tag: "input", type: "text", label: "Username" },
      { id: 2, tag: "input", type: "password", label: "Password" },
    ]);
    expect(f?.password.id).toBe(2);
    expect(f?.username?.id).toBe(1);
  });
  it("is undefined without a password field and works without a username field", () => {
    expect(findLoginFields([{ id: 1, tag: "input", type: "text" }])).toBeUndefined();
    expect(findLoginFields([{ id: 5, tag: "input", type: "password" }])).toEqual({ password: { id: 5, tag: "input", type: "password" }, username: undefined });
  });
});
