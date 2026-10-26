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

const NOT_CHAT = /embed|tts|whisper|transcri|speech|audio|realtime|image|imagen|dall|veo|video|moderation|guard|rerank|aqa|vision-only/i;
const TOP = /pro|opus|large|ultra|max|sonnet/i;
const MID = /flash|plus|turbo/i;
const SMALL = /lite|mini|small|nano|tiny|instant|haiku/i;
const UNSTABLE = /preview|exp|beta|deprecated|legacy/i;
const PARAMS = /(\d+(?:\.\d+)?)b\b/i; // "70b", "8b"

/** Higher = better general chat model for agent steps: newer version, bigger tier, stable, long context. */
function score(m: ModelInfo): number {
  const text = `${m.id} ${m.displayName ?? ""}`;
  const params = Number(PARAMS.exec(m.id)?.[1] ?? 0);
  const version = Number(/\d+(?:\.\d+)?/.exec(m.id.replace(PARAMS, ""))?.[0] ?? 0);
  const tier = TOP.test(text) ? 5 : MID.test(text) ? 3 : 0;
  const small = SMALL.test(text) || (params > 0 && params <= 14);
  return version * 10 + tier - (small ? 12 : 0) - (UNSTABLE.test(text) ? 3 : 0) + Math.min(params / 100, 4) + Math.min((m.contextWindow ?? 0) / 1e6, 2);
}

/**
 * Best default and fallback model of a fetched list. When the provider marks some models free, only those are
 * considered, so a free key is never pointed at a paid model.
 */
export function pickModels(items: ModelInfo[]): Pick<ProviderConfig, "defaultModel" | "fallbackModel"> {
  const chat = items.filter((m) => !NOT_CHAT.test(m.id));
  const free = chat.filter((m) => m.free);
  const ranked = [...(free.length ? free : chat)].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  return { defaultModel: ranked[0]?.id, fallbackModel: ranked[1]?.id };
}

/** Fills a missing default / fallback model from the fetched list; models the user chose are kept. */
export function withAutoModels(p: ProviderConfig): ProviderConfig {
  if (p.defaultModel && p.fallbackModel) return p;
  const auto = pickModels(p.models?.items ?? []);
  const defaultModel = p.defaultModel ?? auto.defaultModel;
  const fallbackModel = p.fallbackModel ?? (auto.fallbackModel !== defaultModel ? auto.fallbackModel : auto.defaultModel !== defaultModel ? auto.defaultModel : undefined);
  return defaultModel === p.defaultModel && fallbackModel === p.fallbackModel ? p : { ...p, defaultModel, fallbackModel };
}

export function searchModels(items: ModelInfo[], query: string): ModelInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((m) => `${m.id} ${m.displayName ?? ""}`.toLowerCase().includes(q));
}
