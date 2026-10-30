import { AbortedError, ProviderError, type Adapter, type ChatMessage, type ModelInfo } from "./types";

/** On-device engine registered by the UI for Android or the optional WebGPU implementation. */
export interface LocalEngine {
  listModels(): Promise<ModelInfo[]>;
  complete(model: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string>;
}

let engine: LocalEngine | undefined;
export const setLocalEngine = (e: LocalEngine | undefined) => void (engine = e);

/** Never needs a key and never touches the network from core. Any failure lets the router fall back to API providers. */
export const localAdapter: Adapter = {
  async complete(call, model, req) {
    if (!engine) throw new ProviderError("network", "on-device model is not available");
    const controller = new AbortController();
    const stop = () => controller.abort();
    if (call.signal?.aborted) throw new AbortedError();
    call.signal?.addEventListener("abort", stop, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutMs = Math.max(call.timeoutMs * 4, 600_000); // CPU inference can be much slower than an API request
      const text = await Promise.race([
        engine.complete(model, req.messages, controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new ProviderError("timeout", "on-device model timed out")); }, timeoutMs);
          controller.signal.addEventListener("abort", () => { if (call.signal?.aborted) reject(new AbortedError()); }, { once: true });
        }),
      ]);
      if (call.signal?.aborted) throw new AbortedError();
      if (!text) throw new ProviderError("bad_json", "empty completion");
      return text;
    } catch (e) {
      if (call.signal?.aborted || e instanceof AbortedError) throw new AbortedError();
      throw e instanceof ProviderError ? e : new ProviderError("server", "on-device model failed");
    } finally {
      clearTimeout(timer);
      call.signal?.removeEventListener("abort", stop);
    }
  },
  async listModels() {
    if (!engine) throw new ProviderError("network", "on-device model is not available");
    return engine.listModels();
  },
};
