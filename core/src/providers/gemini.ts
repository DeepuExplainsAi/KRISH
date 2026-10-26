import { request } from "./http";
import { ProviderError, type Adapter, type AdapterCall, type CompletionRequest, type ModelInfo } from "./types";

const stripPrefix = (name: string) => name.replace(/^models\//, "");
const headers = (key: string) => ({ "x-goog-api-key": key });
const base = (call: AdapterCall) => call.config.baseUrl.replace(/\/+$/, "");

function toBody(req: CompletionRequest, inlineSystem = false) {
  const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  let first = true;
  const contents = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      // Some models (Gemma, previews) reject systemInstruction: the rules go in front of the first user turn instead.
      const text = inlineSystem && system && first && m.role === "user" ? `${system}\n\n${m.content}` : m.content;
      first = first && m.role !== "user";
      const parts: unknown[] = [{ text }];
      const img = m.imageDataUrl?.match(/^data:([\w/+.-]+);base64,(.+)$/);
      if (img) parts.push({ inlineData: { mimeType: img[1], data: img[2] } });
      return { role: m.role === "assistant" ? "model" : "user", parts };
    });
  return {
    ...(system && !inlineSystem && { systemInstruction: { parts: [{ text: system }] } }),
    contents,
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };
}

export const geminiAdapter: Adapter = {
  async complete(call, model, req) {
    const url = `${base(call)}/v1beta/models/${encodeURIComponent(stripPrefix(model))}:generateContent`;
    const send = (inline: boolean) => request(call, url, { method: "POST", headers: headers(call.apiKey), body: toBody(req, inline) });
    const data = (await send(false).catch((e: unknown) => {
      if (e instanceof ProviderError && e.status === 400 && /instruction/i.test(e.message)) return send(true);
      throw e;
    })) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) throw new ProviderError("bad_json", "empty completion");
    return text;
  },

  async listModels(call) {
    const items: ModelInfo[] = [];
    let pageToken = "";
    for (let page = 0; page < 10; page++) {
      const url = `${base(call)}/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const data = (await request(call, url, { method: "GET", headers: headers(call.apiKey) })) as {
        models?: { name: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }[];
        nextPageToken?: string;
      };
      if (!Array.isArray(data.models)) throw new ProviderError("bad_json", "unexpected model list shape");
      for (const m of data.models) {
        if (!m.supportedGenerationMethods?.includes("generateContent")) continue;
        items.push({ id: stripPrefix(m.name), displayName: m.displayName, contextWindow: m.inputTokenLimit });
      }
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    return items; // Gemini's response has no pricing field, so nothing is marked free.
  },
};
