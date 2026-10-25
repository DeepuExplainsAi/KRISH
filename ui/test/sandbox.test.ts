import variant from "@jitl/quickjs-singlefile-cjs-release-sync";
import { unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capWasmMemory, LIMITS, runTask, safeName, setQuickJSVariant, type TaskInput } from "../src/sandbox/tasks";

const enc = new TextEncoder();
const run = (tool: TaskInput["tool"], code: string, files: TaskInput["files"] = {}) => runTask({ tool, code, files });
let uncap: () => void;
// Same call the worker makes, installed before the engine loads.
beforeAll(() => ((uncap = capWasmMemory(LIMITS.wasmMemoryCapBytes)), setQuickJSVariant(variant)));
afterAll(() => uncap());

describe("Tier 0 sandbox", () => {
  it("zips and unzips", async () => {
    const z = await run("zip", '{"files":["a.txt","b.txt"],"output":"o.zip"}', { "a.txt": enc.encode("A"), "b.txt": enc.encode("B") });
    expect(Object.keys(unzipSync(z.files["o.zip"]!)).sort()).toEqual(["a.txt", "b.txt"]);
    const u = await run("unzip", '{"input":"o.zip"}', z.files);
    expect(new TextDecoder().decode(u.files["a.txt"])).toBe("A");
  });

  it("refuses zip-slip paths and zip bombs", async () => {
    const evil = zipSync({ "../../etc/x": enc.encode("x") });
    await expect(run("unzip", "{}", { "e.zip": evil })).rejects.toThrow(/unsafe path/);
    const saved = LIMITS.maxTotalBytes;
    LIMITS.maxTotalBytes = 1024 * 1024; // small cap keeps the test light; the check is size-based, not data-based
    try {
      const bomb = zipSync({ "big.bin": new Uint8Array(4 * 1024 * 1024) }); // compresses to a few KB, expands to 4 MB
      expect(bomb.length).toBeLessThan(100_000);
      await expect(run("unzip", "{}", { "b.zip": bomb })).rejects.toThrow(/too large/);
    } finally {
      LIMITS.maxTotalBytes = saved;
    }
    expect(() => safeName("/abs")).toThrow();
    expect(() => safeName("C:\\x")).toThrow();
  });

  it("refuses stored zip entries that lie about their size", async () => {
    const stored = zipSync({ "x.bin": [new Uint8Array(3 * 1024 * 1024), { level: 0 }] });
    const dv = new DataView(stored.buffer, stored.byteOffset);
    for (let i = 0; i < stored.length - 4; i++) if (dv.getUint32(i, true) === 0x02014b50) dv.setUint32(i + 24, 0, true); // originalSize = 0
    const saved = LIMITS.maxTotalBytes;
    LIMITS.maxTotalBytes = 1024 * 1024;
    try {
      await expect(run("unzip", "{}", { "s.zip": stored })).rejects.toThrow(/too large/);
    } finally {
      LIMITS.maxTotalBytes = saved;
    }
  });

  it("bounds print output and aliased output strings", async () => {
    await expect(run("script", 'var s="x".repeat(40000); for(var i=0;i<100;i++) print(s);')).rejects.toThrow(/print output limit/);
    const saved = LIMITS.maxOutputBytes;
    LIMITS.maxOutputBytes = 100_000;
    try {
      await expect(run("script", 'var s="x".repeat(50000); for(var i=0;i<20;i++) output["f"+i]=s;')).rejects.toThrow(/too large/);
    } finally {
      LIMITS.maxOutputBytes = saved;
    }
  });

  it("runs JS in QuickJS with files in and files out", async () => {
    const r = await run("script", 'print("hi"); output["up.txt"] = files["a.txt"].toUpperCase(); 1+1', { "a.txt": enc.encode("abc") });
    expect(r.output).toBe("hi\n2");
    expect(new TextDecoder().decode(r.files["up.txt"])).toBe("ABC");
  });

  it("scripts have no access to host capabilities", async () => {
    const r = await run("script", "JSON.stringify([typeof fetch, typeof XMLHttpRequest, typeof window, typeof document, typeof process, typeof require, typeof setTimeout, typeof localStorage])");
    expect(JSON.parse(r.output)).toEqual(Array(8).fill("undefined"));
  });

  it("stops infinite loops", async () => {
    await expect(run("script", "while(true){}")).rejects.toThrow(/interrupted|script error/i);
  }, 20000);

  it("stops memory hogs", async () => {
    await expect(run("script", "var a=[]; for(;;){a.push(new Array(1e6).fill(1))}")).rejects.toThrow(/script error/);
  }, 20000);

  it("reports script errors without crashing", async () => {
    await expect(run("script", "throw new Error('boom')")).rejects.toThrow(/boom/);
  });
});
