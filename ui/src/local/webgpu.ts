import type { ChatMessage, LocalEngine, ModelInfo } from "@krish/core";

declare const __KRISH_LOCAL_MODEL__: boolean;

/** False in default builds: the code path (and the 6 MB library) is not compiled in at all. */
export const localModelCompiledIn = __KRISH_LOCAL_MODEL__;
export const webgpuAvailable = () => __KRISH_LOCAL_MODEL__ && typeof navigator !== "undefined" && "gpu" in navigator;

interface MLCEngine {
  chat: { completions: { create(a: unknown): Promise<{ choices: { message: { content: string | null } }[] }> } };
  interruptGenerate(): void;
}

/**
 * Optional on-device model through WebGPU (web-llm). Experimental, off by default, never required.
 * The library is imported lazily, so nothing loads unless the user enabled the flag AND accepted the download notice.
 * NOTE: web-llm fetches model weights and its model-runtime WASM from the model host at first use. See SECURITY.md.
 */
export function createWebGpuEngine(onProgress?: (text: string) => void): LocalEngine {
  let loaded: { model: string; engine: MLCEngine } | undefined;
  const lib = () => (__KRISH_LOCAL_MODEL__ ? import("@mlc-ai/web-llm") : Promise.reject(new Error("on-device model is not compiled into this build")));

  return {
    async listModels(): Promise<ModelInfo[]> {
      const { prebuiltAppConfig } = await lib();
      return prebuiltAppConfig.model_list.map((m) => ({ id: m.model_id, contextWindow: m.overrides?.context_window_size }));
    },
    async complete(model: string, messages: ChatMessage[], signal?: AbortSignal) {
      if (!webgpuAvailable()) throw new Error("WebGPU is not available on this device");
      if (!loaded || loaded.model !== model) {
        const { CreateMLCEngine } = await lib();
        loaded = { model, engine: (await CreateMLCEngine(model, { initProgressCallback: (p) => onProgress?.(p.text) })) as unknown as MLCEngine };
      }
      const stop = () => loaded?.engine.interruptGenerate();
      signal?.addEventListener("abort", stop, { once: true });
      try {
        const r = await loaded.engine.chat.completions.create({
          messages: messages.map((m) => ({ role: m.role, content: m.content })), // images are never sent to the local model
          temperature: 0.2,
          response_format: { type: "json_object" },
        });
        return r.choices[0]?.message.content ?? "";
      } finally {
        signal?.removeEventListener("abort", stop);
      }
    },
  };
}
