import { ACTION_GRAMMAR_SCHEMA_JSON, AbortedError, ProviderError, type ChatMessage, type LocalEngine } from "@krish/core";
import type { LocalModelHost } from "../platform/types";

/** Native process receives only the already fenced/redacted text; never send screenshot data. */
export function createNativeEngine(host: LocalModelHost): LocalEngine {
  const schema = ACTION_GRAMMAR_SCHEMA_JSON;
  return {
    listModels: async () => (await host.listInstalled()).installed.map((id) => ({ id })),
    async complete(model: string, messages: ChatMessage[], signal?: AbortSignal) {
      if (signal?.aborted) throw new AbortedError();
      const stop = () => { void host.stop().catch(() => undefined); };
      signal?.addEventListener("abort", stop, { once: true });
      try {
        const text = await host.complete(model, JSON.stringify(messages.map(({ role, content }) => ({ role, content }))), schema);
        if (signal?.aborted) throw new AbortedError();
        return text;
      } catch (error) {
        if (signal?.aborted) throw new AbortedError();
        if (error instanceof Error && error.message === "On-device prompt is too long") throw new ProviderError("too_large", error.message);
        throw error;
      } finally { signal?.removeEventListener("abort", stop); }
    },
  };
}
