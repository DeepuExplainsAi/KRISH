import { ProviderError, type Adapter, type ChatMessage, type ModelInfo } from "./types";

/** On-device engine (WebGPU). Registered by the UI only when the user turns the experimental flag on. */
export interface LocalEngine {
  listModels(): Promise<ModelInfo[]>;
  complete(model: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string>;
}

let engine: LocalEngine | undefined;
export const setLocalEngine = (e: LocalEngine | undefined) => void (engine = e);

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ProviderError("timeout", `local model timed out after ${ms} ms`)), ms);
    p.then(resolve, reject).finally(() => clearTimeout(t));
  });

/** Never needs a key and never touches the network from core. Any failure lets the router fall back to API providers. */
export const localAdapter: Adapter = {
  async complete(call, model, req) {
    if (!engine) throw new ProviderError("network", "on-device model is not available");
    try {
      const text = await withTimeout(engine.complete(model, req.messages, call.signal), call.timeoutMs * 4);
      if (!text) throw new ProviderError("bad_json", "empty completion");
      return text;
    } catch (e) {
      throw e instanceof ProviderError ? e : new ProviderError("server", "on-device model failed");
    }
  },
  async listModels() {
    if (!engine) throw new ProviderError("network", "on-device model is not available");
    return engine.listModels();
  },
};
