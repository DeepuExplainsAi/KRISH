import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import { capWasmMemory, LIMITS, runTask, setQuickJSVariant, type TaskInput, type TaskOutput } from "./tasks";

// Defense in depth: this worker has no reason to reach the network, other workers, or the page.
const g = self as unknown as Record<string, unknown>;
for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "indexedDB", "caches", "WebTransport", "Worker", "SharedWorker", "BroadcastChannel"]) {
  try {
    Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false });
  } catch {
    g[k] = undefined;
  }
}

capWasmMemory(LIMITS.wasmMemoryCapBytes);
setQuickJSVariant(variant);

self.onmessage = async (e: MessageEvent<TaskInput>) => {
  try {
    const out = await runTask(e.data);
    (self as unknown as Worker).postMessage({ ok: true, ...out } satisfies { ok: true } & TaskOutput, Object.values(out.files).map((f) => f.buffer));
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : "task failed" });
  }
};
