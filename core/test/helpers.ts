import { MemoryKeyStore, MemoryKV } from "../src/storage";
import type { FetchLike, ProviderConfig } from "../src/providers/types";

export type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export const mockFetch = (handlers: Record<string, Handler>) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const host = new URL(url).host;
    const h = handlers[host];
    if (!h) throw new TypeError("no mock for " + host);
    return h(url, init);
  };
  return { fn, calls };
};

export const provider = (id: string, over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id,
  name: id,
  kind: "openai-compat",
  baseUrl: `https://${id}.test/v1`,
  enabled: true,
  allowSensitive: false,
  defaultModel: "m1",
  ...over,
});

export const openaiReply = (content: string) => json({ choices: [{ message: { content } }] });

export const stores = async (ids: string[]) => {
  const keys = new MemoryKeyStore();
  for (const id of ids) await keys.set(id, `key-${id}`);
  return { keys, kv: new MemoryKV() };
};
