import { AbortedError, ProviderError, type ChatMessage, type LocalEngine } from "@krish/core";
import type { LocalModelHost } from "../platform/types";

/** The chat asks for {"reply": "..."}; the grammar keeps a small model on that shape. */
const REPLY_SCHEMA = JSON.stringify({ type: "object", properties: { reply: { type: "string" } }, required: ["reply"], additionalProperties: false });

/** Native process receives only the already fenced/redacted text; never send screenshot data. */
export function createNativeEngine(host: LocalModelHost): LocalEngine {
  return {
    listModels: async () => (await host.listInstalled()).installed.map((id) => ({ id })),
    async complete(model: string, messages: ChatMessage[], signal?: AbortSignal) {
      if (signal?.aborted) throw new AbortedError();
      const stop = () => { void host.stop().catch(() => undefined); };
      signal?.addEventListener("abort", stop, { once: true });
      try {
        const text = await host.complete(model, JSON.stringify(messages.map(({ role, content }) => ({ role, content }))), REPLY_SCHEMA);
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
