import { request } from "./http";
import { ProviderError, type Adapter, type AdapterCall, type CompletionRequest, type ModelInfo } from "./types";

const base = (call: AdapterCall) => call.config.baseUrl.replace(/\/+$/, "");
const headers = (key: string) => ({ authorization: `Bearer ${key}` });

function toBody(model: string, req: CompletionRequest) {
  return {
    model,
    temperature: 0,
    messages: req.messages.map((m) => ({
      role: m.role,
      content: m.imageDataUrl
        ? [
            { type: "text", text: m.content },
            { type: "image_url", image_url: { url: m.imageDataUrl } },
          ]
        : m.content,
    })),
  };
}

const isZero = (v: unknown) => v !== undefined && v !== null && v !== "" && Number(v) === 0;

export const openaiCompatAdapter: Adapter = {
  async complete(call, model, req) {
    const data = (await request(call, `${base(call)}/chat/completions`, {
      method: "POST",
      headers: headers(call.apiKey),
      body: toBody(model, req),
    })) as { choices?: { message?: { content?: string | null } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new ProviderError("bad_json", "empty completion");
    return text;
  },

  async listModels(call) {
    const url = call.config.modelsUrl ?? `${base(call)}/models`;
    const data = (await request(call, url, { method: "GET", headers: headers(call.apiKey) })) as unknown;
    const rows = Array.isArray(data) ? data : (data as { data?: unknown }).data;
    if (!Array.isArray(rows)) throw new ProviderError("bad_json", "unexpected model list shape");
    const items: ModelInfo[] = [];
    for (const r of rows as Record<string, unknown>[]) {
      if (typeof r?.id !== "string") continue;
      const pricing = r.pricing as { prompt?: unknown; completion?: unknown } | undefined;
      const free = pricing ? isZero(pricing.prompt) && isZero(pricing.completion) : undefined;
      items.push({
        id: r.id,
        displayName: typeof r.name === "string" ? r.name : undefined,
        contextWindow: typeof r.context_length === "number" ? r.context_length : undefined,
        ...(free ? { free: true } : {}),
      });
    }
    return items;
  },
};
