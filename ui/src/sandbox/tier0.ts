import type { Sandbox, SandboxTask } from "@krish/core";
import { LIMITS, safeName, type Files } from "./tasks";

type WorkerReply = { ok: true; output: string; files: Files } | { ok: false; error: string };

/**
 * Tier 0 sandbox, always on. A fresh Worker per task (terminated on timeout).
 * Holds an in-memory virtual file set; files enter only from the system picker and leave only via save().
 * Output is untrusted data and has no path back into the native bridge.
 */
export class Tier0Sandbox implements Sandbox {
  readonly files: Files = {};
  constructor(private makeWorker: () => Worker = () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })) {}

  addFile(name: string, bytes: Uint8Array) {
    this.files[safeName(name)] = bytes;
  }
  list = () => Object.entries(this.files).map(([name, b]) => ({ name, size: b.length }));
  clear() {
    for (const k of Object.keys(this.files)) delete this.files[k];
  }

  run(task: SandboxTask, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const w = this.makeWorker();
      const done = (f: () => void) => (clearTimeout(timer), signal?.removeEventListener("abort", onAbort), w.terminate(), f());
      const timer = setTimeout(() => done(() => reject(new Error("sandbox task timed out"))), LIMITS.scriptTimeoutMs + 5000);
      const onAbort = () => done(() => reject(new Error("stopped")));
      signal?.addEventListener("abort", onAbort, { once: true });
      w.onerror = () => done(() => reject(new Error("sandbox worker crashed")));
      w.onmessage = (e: MessageEvent<WorkerReply>) =>
        done(() => {
          const r = e.data;
          if (!r.ok) return reject(new Error(r.error));
          for (const [n, d] of Object.entries(r.files)) this.files[n] = d;
          const names = Object.keys(r.files);
          resolve(names.length ? `${r.output}\n(new files in sandbox: ${names.join(", ")})` : r.output);
        });
      w.postMessage({ tool: task.tool, code: task.code, files: { ...this.files } });
    });
  }
}
