import { unzipSync, zipSync } from "fflate";
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSWASMModule } from "quickjs-emscripten-core";

export type Files = Record<string, Uint8Array>;
export interface TaskInput {
  tool: "zip" | "unzip" | "text" | "script";
  code: string;
  files: Files;
}
export interface TaskOutput {
  output: string;
  /** Files created or changed by the task. */
  files: Files;
}

export const LIMITS = {
  maxEntries: 2000,
  maxTotalBytes: 100 * 1024 * 1024,
  scriptMemoryBytes: 32 * 1024 * 1024,
  wasmMemoryCapBytes: 96 * 1024 * 1024,
  scriptTimeoutMs: 5000,
  maxOutputChars: 20_000,
  maxPrintBytes: 64 * 1024,
  maxOutputFiles: 50,
  maxOutputBytes: 20 * 1024 * 1024,
  maxTextFileBytes: 2 * 1024 * 1024,
};

const dec = new TextDecoder("utf-8", { fatal: false });
const enc = new TextEncoder();

/** Rejects absolute paths, drive letters and traversal ("zip slip"). */
export function safeName(name: string): string {
  const n = name.replace(/\\/g, "/");
  if (!n || n.startsWith("/") || /^[a-zA-Z]:/.test(n) || n.split("/").some((p) => p === "..") || n.includes("\0")) {
    throw new Error(`unsafe path: ${name}`);
  }
  return n;
}

function parseSpec(code: string): Record<string, unknown> {
  try {
    const v = JSON.parse(code || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fallthrough */
  }
  throw new Error("code must be a JSON object for this tool");
}

const strList = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined);

function zipTask(input: TaskInput): TaskOutput {
  const spec = parseSpec(input.code);
  const names = strList(spec.files) ?? Object.keys(input.files);
  const out = typeof spec.output === "string" ? safeName(spec.output) : "archive.zip";
  if (names.length > LIMITS.maxEntries) throw new Error("too many files");
  const entries: Files = {};
  let total = 0;
  for (const n of names) {
    const data = input.files[n];
    if (!data) throw new Error(`no such file: ${n}`);
    total += data.length;
    if (total > LIMITS.maxTotalBytes) throw new Error("input too large");
    entries[safeName(n)] = data;
  }
  return { output: `created ${out} with ${names.length} file(s)`, files: { [out]: zipSync(entries) } };
}

function unzipTask(input: TaskInput): TaskOutput {
  const spec = parseSpec(input.code);
  const src = typeof spec.input === "string" ? spec.input : Object.keys(input.files).find((n) => n.endsWith(".zip"));
  const data = src ? input.files[src] : undefined;
  if (!src || !data) throw new Error("no zip file to extract");
  let count = 0;
  let total = 0;
  const files: Files = {};
  const extracted = unzipSync(data, {
    // Size is checked from the central directory BEFORE inflating, so zip bombs are refused early.
    filter: (f) => {
      if (f.name.endsWith("/")) return false;
      safeName(f.name);
      count += 1;
      // Stored entries are copied at their COMPRESSED size, so the declared originalSize alone cannot be trusted.
      total += Math.max(f.size, f.originalSize);
      if (count > LIMITS.maxEntries) throw new Error("too many entries");
      if (total > LIMITS.maxTotalBytes) throw new Error("archive expands too large");
      return true;
    },
  });
  for (const [n, d] of Object.entries(extracted)) files[safeName(n)] = d;
  return { output: `extracted ${count} file(s): ${Object.keys(files).slice(0, 50).join(", ")}`, files };
}

/**
 * Hard cap on WebAssembly memory growth. QuickJS's own setMemoryLimit proved unreliable in testing
 * (a 32 MB limit let ~96 MB through), so growth past `maxBytes` is refused and QuickJS reports "out of memory".
 * Call before the engine loads. Returns a function that restores the original behavior (used by tests).
 */
export function capWasmMemory(maxBytes: number): () => void {
  const proto = WebAssembly.Memory.prototype;
  const original = proto.grow;
  proto.grow = function (this: WebAssembly.Memory, delta: number) {
    if (this.buffer.byteLength + delta * 65536 > maxBytes) throw new RangeError("sandbox memory cap reached");
    return original.call(this, delta);
  };
  return () => void (proto.grow = original);
}

let qjs: Promise<QuickJSWASMModule> | undefined;
export const setQuickJSVariant = (variant: Parameters<typeof newQuickJSWASMModuleFromVariant>[0]) => {
  qjs = newQuickJSWASMModuleFromVariant(variant);
};

/**
 * Model-written JS runs only inside QuickJS (WASM). The VM has no host bindings except `print`:
 * no network, DOM, timers, storage, native bridge or app globals. Memory and time are capped.
 * Globals: files (name -> text), output (assign output["x.txt"]="..." to create files), print(...).
 */
async function scriptTask(input: TaskInput): Promise<TaskOutput> {
  if (!qjs) throw new Error("script engine not loaded");
  const mod = await qjs;
  const rt = mod.newRuntime();
  rt.setMemoryLimit(LIMITS.scriptMemoryBytes);
  rt.setMaxStackSize(512 * 1024);
  rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + LIMITS.scriptTimeoutMs));
  const vm = rt.newContext();
  const printed: string[] = [];
  try {
    const text: Record<string, string> = {};
    for (const [n, d] of Object.entries(input.files)) if (d.length <= LIMITS.maxTextFileBytes) text[n] = dec.decode(d);
    let printedBytes = 0;
    const print = vm.newFunction("print", (...args) => {
      const line = args.map((a) => String(vm.dump(a))).join(" ");
      printedBytes += line.length + 1;
      if (printedBytes > LIMITS.maxPrintBytes) throw new Error("print output limit reached");
      printed.push(line);
    });
    vm.setProp(vm.global, "print", print);
    print.dispose();
    vm.unwrapResult(vm.evalCode(`globalThis.files = ${JSON.stringify(text)}; globalThis.output = {};`)).dispose();
    const res = vm.unwrapResult(vm.evalCode(input.code, "task.js"));
    const value = vm.dump(res);
    res.dispose();
    // Bound the guest object BEFORE it is copied to the host: many keys can alias one large guest string.
    const check = vm.unwrapResult(
      vm.evalCode(`(function(){var k=Object.keys(output),t=0;if(k.length>${LIMITS.maxOutputFiles})return -1;for(var i=0;i<k.length;i++){var v=output[k[i]];if(typeof v==="string")t+=v.length+k[i].length;}return t;})()`),
    );
    const guestBytes = vm.getNumber(check);
    check.dispose();
    if (guestBytes < 0 || guestBytes > LIMITS.maxOutputBytes) throw new Error("script output too large");
    const outObj = vm.dump(vm.unwrapResult(vm.evalCode("JSON.stringify(output)"))) as string;
    const files: Files = {};
    for (const [n, v] of Object.entries(JSON.parse(outObj) as Record<string, unknown>)) {
      if (typeof v === "string") files[safeName(n)] = enc.encode(v);
    }
    const parts = [...printed, value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value)].filter(Boolean);
    return { output: parts.join("\n"), files };
  } catch (e) {
    const err = e as { message?: string; name?: string };
    throw new Error(`script error: ${err?.name ?? "Error"}: ${err?.message ?? String(e)}`);
  } finally {
    vm.dispose();
    rt.dispose();
  }
}

const sum = (f: Files) => Object.values(f).reduce((n, b) => n + b.length, 0);

export async function runTask(input: TaskInput): Promise<TaskOutput> {
  const r = await (input.tool === "zip" ? zipTask(input) : input.tool === "unzip" ? unzipTask(input) : scriptTask(input));
  if (sum(r.files) > LIMITS.maxOutputBytes) throw new Error("task output too large");
  return { ...r, output: r.output.slice(0, LIMITS.maxOutputChars) };
}
