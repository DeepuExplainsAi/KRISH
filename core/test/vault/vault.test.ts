import { describe, expect, it } from "vitest";
import { ALL_SITES, findLoginFields, findLoginWall, findSignInButton, normalizeSite, Vault, VaultError } from "../../src/vault/vault";
import { MemoryKeyStore } from "../../src/storage";

const entry = { site: "https://www.instagram.com/accounts/login", username: "deepu", password: "p@ss-1234" };

describe("Vault", () => {
  it("keeps logins for good: a new Vault on the same store has them, with nothing to unlock", async () => {
    const store = new MemoryKeyStore();
    await new Vault(store).put(entry);
    const b = new Vault(store);
    await b.load();
    expect(b.list()).toMatchObject([{ site: "instagram.com", username: "deepu", password: "p@ss-1234" }]);
  });

  it("saving the same site and username again replaces the login instead of adding a second", async () => {
    const v = new Vault(new MemoryKeyStore());
    await v.put(entry);
    await v.put({ ...entry, password: "new-pass-9" });
    await v.put({ ...entry, username: "other" });
    expect(v.list().map((e) => [e.username, e.password])).toEqual([["deepu", "new-pass-9"], ["other", "p@ss-1234"]]);
  });

  it("a login for every site is a default; a login for the site itself comes first and wins", async () => {
    const v = new Vault(new MemoryKeyStore());
    await v.put({ site: ALL_SITES, username: "main", password: "main-pw-1" });
    expect(normalizeSite("*")).toBe(ALL_SITES);
    expect(v.logins("https://shop.test/login").map((e) => e.username)).toEqual(["main"]);
    await v.put({ site: "shop.test", username: "work", password: "work-pw-1" });
    expect(v.logins("https://www.shop.test/login").map((e) => e.username)).toEqual(["work", "main"]);
    expect(v.logins("not a url")).toHaveLength(0);
  });

  it("matches logins by registrable site only (a look-alike host gets nothing)", async () => {
    const v = new Vault(new MemoryKeyStore());
    await v.put(entry);
    expect(v.logins("https://m.instagram.com/")).toHaveLength(1);
    expect(v.logins("https://instagram.com.evil.test/")).toHaveLength(0);
    expect(v.logins("https://notinstagram.com/")).toHaveLength(0);
  });

  it("removes a login", async () => {
    const store = new MemoryKeyStore();
    const v = new Vault(store);
    const e = await v.put(entry);
    await v.remove(e.id);
    expect(v.list()).toHaveLength(0);
    const again = new Vault(store);
    await again.load();
    expect(again.list()).toHaveLength(0);
  });

  it("rejects an empty password and a site it cannot read", async () => {
    const v = new Vault(new MemoryKeyStore());
    await expect(v.put({ ...entry, password: "" })).rejects.toThrow(VaultError);
    await expect(v.put({ ...entry, site: "   " })).rejects.toThrow("site");
  });

  it("normalizes sites", () => {
    expect(normalizeSite("Instagram.com")).toBe("instagram.com");
    expect(normalizeSite("https://accounts.google.com/x")).toBe("google.com");
  });

  it("the same login saved twice at once is still one entry", async () => {
    const v = new Vault(new MemoryKeyStore());
    await Promise.all([v.put(entry), v.put({ ...entry, password: "second-pw-2" })]);
    expect(v.list()).toHaveLength(1);
    expect(v.list()[0]!.password).toBe("second-pw-2");
  });

  it("two saves started together both end up in storage, even if the first one is slower", async () => {
    const store = new MemoryKeyStore();
    const slow = store.set.bind(store);
    let n = 0;
    store.set = async (k, v) => { await new Promise((r) => setTimeout(r, [40, 0][n++ % 2]!)); await slow(k, v); };
    const v = new Vault(store);
    await Promise.all([v.put({ ...entry, site: "a.test" }), v.put({ ...entry, site: "b.test" })]);
    const again = new Vault(store);
    await again.load();
    expect(again.list().map((e) => e.site)).toEqual(["a.test", "b.test"]);
  });

  it("a failed save changes nothing in memory", async () => {
    const store = new MemoryKeyStore();
    const v = new Vault(store);
    await v.put(entry);
    const ok = store.set.bind(store);
    store.set = async () => { throw new Error("disk full"); };
    await expect(v.put({ ...entry, site: "x.test" })).rejects.toThrow("disk full");
    expect(v.list().map((e) => e.site)).toEqual(["instagram.com"]);
    store.set = ok;
    await v.put({ ...entry, site: "x.test" });
    expect(v.list()).toHaveLength(2);
  });

  it("stored logins that cannot be read are never treated as empty (so they cannot be overwritten)", async () => {
    const store = new MemoryKeyStore();
    store.get = async () => { throw new Error("keystore busy"); };
    const v = new Vault(store);
    await v.load();
    expect(v.unreadable).toBe(true);
    await expect(v.put(entry)).rejects.toThrow("could not be read");
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

describe("findLoginWall", () => {
  const email = { id: 0, tag: "input", type: "email", label: "Your email" };
  it("matches an email box on a 'log in or create account' page", () => {
    expect(findLoginWall({ text: "Log In or Create Account", elements: [email] })?.username.id).toBe(0);
  });
  it("matches an email box beside Continue with Google, and reports the button", () => {
    const w = findLoginWall({ text: "Welcome", elements: [email, { id: 1, tag: "button", text: "Continue with Google" }] });
    expect(w?.google?.id).toBe(1);
  });
  it("ignores a newsletter box and a page without an email box", () => {
    expect(findLoginWall({ text: "Get our newsletter. Sign in to your account", elements: [email] })).toBeUndefined();
    expect(findLoginWall({ text: "Log in or create account", elements: [{ id: 1, tag: "button", text: "Go" }] })).toBeUndefined();
  });
});

describe("findLoginWall: two-step sign-in", () => {
  const email = { id: 0, tag: "input", type: "email", label: "Email" };
  it("an email box under a Sign in heading with a Next button is the first step", () => {
    expect(findLoginWall({ text: "Sign in", elements: [email, { id: 1, tag: "button", text: "Next", submits: true }] })?.username.id).toBe(0);
  });
  it("Apple or Facebook alone is not Google; the Google button is found among several", () => {
    expect(findLoginWall({ text: "Welcome", elements: [email, { id: 1, tag: "button", text: "Continue with Apple" }] })?.google).toBeUndefined();
    expect(findLoginWall({ text: "Welcome", elements: [email, { id: 1, tag: "button", text: "Continue with Apple" }, { id: 2, tag: "button", text: "Continue with Google" }] })?.google?.id).toBe(2);
  });
  it("a plain page with an email box and no sign-in wording is left alone", () => {
    expect(findLoginWall({ text: "Join our newsletter", elements: [email, { id: 1, tag: "button", text: "Subscribe", submits: true }] })).toBeUndefined();
  });
});

describe("findSignInButton", () => {
  const b = (id: number, text: string, o: object = {}) => ({ id, tag: "button", text, submits: true, ...o });
  it("takes the Log in button, not Sign up, Google or Apple, even when Sign up comes first", () => {
    const els = [b(1, "Sign up"), b(2, "Continue with Google"), b(3, "Continue with Apple"), b(4, "Log in")];
    expect(findSignInButton(els)?.id).toBe(4);
  });
  it("only looks inside the form that was filled", () => {
    const els = [b(1, "Log in", { form: 1 }), b(2, "Log in", { form: 2 }), b(3, "Search", { form: 1 })];
    expect(findSignInButton(els, 2)?.id).toBe(2);
  });
  it("an input submit whose value repeats as its text and aria-label still matches", () => {
    expect(findSignInButton([{ id: 1, tag: "input", type: "submit", text: "Sign in", value: "Sign in", label: "Sign in", submits: true }])?.id).toBe(1);
  });
  it("custom wording is accepted only as the single submit of that form; with two it guesses nothing", () => {
    expect(findSignInButton([b(1, "Enter", { form: 1 })], 1)?.id).toBe(1);
    expect(findSignInButton([b(1, "Enter", { form: 1 }), b(2, "Go", { form: 1 })], 1)).toBeUndefined();
    expect(findSignInButton([b(1, "Enter")])).toBeUndefined();
  });
  it("skips disabled buttons and non-login words like Forgot password", () => {
    expect(findSignInButton([b(1, "Log in", { disabled: true }), b(2, "Forgot password?"), b(3, "Next")])?.id).toBe(3);
  });
});
