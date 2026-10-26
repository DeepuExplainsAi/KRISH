import { request } from "./http";
import { ProviderError, type Adapter, type AdapterCall, type CompletionRequest, type ModelInfo } from "./types";

const base = (call: AdapterCall) => call.config.baseUrl.replace(/\/+$/, "");
const headers = (key: string) => ({ authorization: `Bearer ${key}` });

function toBody(model: string, req: CompletionRequest, jsonMode: boolean) {
  return {
    model,
    temperature: 0,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
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
    const send = (jsonMode: boolean) => request(call, `${base(call)}/chat/completions`, { method: "POST", headers: headers(call.apiKey), body: toBody(model, req, jsonMode) });
    // JSON mode makes most models answer with clean JSON. A model or provider that does not know it answers 400/422: ask again without it.
    const data = (await send(true).catch((e: unknown) => {
      if (e instanceof ProviderError && (e.status === 400 || e.status === 422)) return send(false);
      throw e;
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
      // Free when the provider's pricing says so, or its own naming does (OpenRouter ":free", OpenCode Zen "-free").
      const free = (pricing ? isZero(pricing.prompt) && isZero(pricing.completion) : false) || /(?::|-)free$/i.test(r.id);
      items.push({
        id: r.id,
        displayName: typeof r.name === "string" ? r.name : undefined,
        contextWindow: typeof r.context_length === "number" ? r.context_length : undefined,
        ...(typeof r.expiration_date === "string" && Date.parse(r.expiration_date) < Date.now() + 14 * 864e5 ? { expiring: true } : {}),
        ...(free ? { free: true } : {}),
      });
    }
    return items;
  },
};
