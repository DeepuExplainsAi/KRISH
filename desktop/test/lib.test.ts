import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const lib = createRequire(import.meta.url)("../lib.cjs");

describe("desktop lib", () => {
  it("https only, no credentials", () => {
    expect(lib.isHttps("https://a.test/x")).toBe(true);
    for (const u of ["http://a.test", "file:///etc/passwd", "javascript:1", "https://u:p@a.test", "nope"]) expect(lib.isHttps(u)).toBe(false);
  });

  it("validateFetch limits scheme, method, headers", () => {
    expect(lib.validateFetch("https://a.test", { method: "post", headers: { "x-goog-api-key": "k", "bad header": "x" }, body: "{}" })).toEqual({
      method: "POST", headers: { "x-goog-api-key": "k" }, body: "{}",
    });
    expect(() => lib.validateFetch("http://a.test")).toThrow();
    expect(() => lib.validateFetch("https://a.test", { method: "DELETE" })).toThrow();
    expect(() => lib.validateFetch("https://a.test", { method: "POST", body: { x: 1 } })).toThrow();
  });

  it("browser helpers are gone", () => {
    for (const k of ["expr", "wrapCall", "tapPoint", "tabId", "layoutWidth", "parseCallResult"]) expect(lib[k]).toBeUndefined();
  });

  it("file tokens", () => {
    let n = 0;
    const t = new lib.FileTokens(() => `t${++n}`);
    const tok = t.put("/a/b.zip");
    expect(t.get(tok)).toBe("/a/b.zip");
    expect(() => t.get("forged")).toThrow();
    t.clear();
    expect(() => t.get(tok)).toThrow();
  });

  it("secret store encrypts via safeStorage and refuses plaintext fallback", () => {
    const disk = new Map<string, string>();
    const fs = {
      readFileSync: (f: string) => { const v = disk.get(f); if (!v) throw new Error("ENOENT"); return v; },
      writeFileSync: (f: string, v: string) => void disk.set(f, v),
      mkdirSync: () => {},
    };
    const ss = { available: true, isEncryptionAvailable() { return this.available; }, encryptString: (s: string) => Buffer.from(`enc:${s}`), decryptString: (b: Buffer) => b.toString().slice(4) };
    const store = lib.createSecretStore({ dir: "/d", safeStorage: ss, fs, platform: "darwin" });
    store.set("p1", "SECRET");
    expect([...disk.values()].join("")).not.toContain("SECRET");
    expect(store.get("p1")).toBe("SECRET");
    store.delete("p1");
    expect(store.get("p1")).toBeUndefined();
    ss.available = false;
    expect(() => store.set("p1", "SECRET")).toThrow(/refusing/);
  });

  it("linux: refuses the basic_text backend, accepts a real keyring", () => {
    const fs = { readFileSync: () => { throw new Error("ENOENT"); }, writeFileSync: () => {}, mkdirSync: () => {} };
    const mk = (backend: string) => ({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });
    for (const bad of ["basic_text", "unknown"]) {
      expect(() => lib.createSecretStore({ dir: "/d", safeStorage: mk(bad), fs, platform: "linux" }).set("k", "v")).toThrow(/refusing/);
    }
    expect(() => lib.createSecretStore({ dir: "/d", safeStorage: mk("gnome_libsecret"), fs, platform: "linux" }).set("k", "v")).not.toThrow();
  });

  it("docker args: offline, unprivileged, no pulls", () => {
    const a = lib.dockerArgs({ image: "alpine:3", workDir: "/w", name: "n" }).join(" ");
    for (const f of ["--network none", "--pull never", "--cap-drop ALL", "--read-only", "no-new-privileges", "--user 65534:65534"]) expect(a).toContain(f);
  });
});
