import { geminiAdapter } from "./gemini";
import { localAdapter } from "./local";
import { openaiCompatAdapter } from "./openaiCompat";
import type { Adapter, FetchLike, ModelInfo, ProviderConfig, ProviderKind } from "./types";
import { DEFAULTS } from "../config/defaults";

export const adapters: Record<ProviderKind, Adapter> = {
  gemini: geminiAdapter,
  "openai-compat": openaiCompatAdapter,
  "webgpu-local": localAdapter,
};

export interface RefreshDeps {
  fetch: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

/** Fetches the live model list. On failure the cached list stays and the error is recorded. */
export async function refreshModels(config: ProviderConfig, apiKey: string, deps: RefreshDeps): Promise<ProviderConfig> {
  try {
    const items = await adapters[config.kind].listModels({
      config,
      apiKey,
      fetch: deps.fetch,
      timeoutMs: deps.timeoutMs ?? DEFAULTS.router.requestTimeoutMs,
    });
    return { ...config, models: { fetchedAt: (deps.now ?? Date.now)(), items }, modelsError: undefined };
  } catch (e) {
    return { ...config, modelsError: e instanceof Error ? e.message : "refresh failed" };
  }
}

/** Automatic fetch happens exactly once, right after the key is first added. */
export async function autoFetchOnce(config: ProviderConfig, apiKey: string, deps: RefreshDeps): Promise<ProviderConfig> {
  if (config.modelsAutoFetched) return config;
  return { ...(await refreshModels(config, apiKey, deps)), modelsAutoFetched: true };
}

export function searchModels(items: ModelInfo[], query: string): ModelInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((m) => `${m.id} ${m.displayName ?? ""}`.toLowerCase().includes(q));
}
