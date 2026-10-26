import { geminiAdapter } from "./gemini";
import { localAdapter } from "./local";
import { openaiCompatAdapter } from "./openaiCompat";
import { friendlyReason, ProviderError, type Adapter, type FetchLike, type ModelInfo, type ProviderConfig, type ProviderKind } from "./types";
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
const UNSTABLE = /preview|exp|beta|deprecated|legacy|antigravity|nightly/i;
const PARAMS = /(\d+(?:\.\d+)?)b\b/i; // "70b", "8b"

/** Higher = better general chat model for agent steps: newer version, bigger tier, stable, long context. */
function score(m: ModelInfo): number {
  const text = `${m.id} ${m.displayName ?? ""}`;
  const params = Number(PARAMS.exec(m.id)?.[1] ?? 0);
  const version = Number(/\d+(?:\.\d+)?/.exec(m.id.replace(PARAMS, ""))?.[0] ?? 0);
  const tier = TOP.test(text) ? 5 : MID.test(text) ? 3 : 0;
  const small = SMALL.test(text) || (params > 0 && params <= 14);
  return version * 10 + tier - (small ? 12 : 0) - (UNSTABLE.test(text) ? 8 : 0) + Math.min(params / 100, 4) + Math.min((m.contextWindow ?? 0) / 1e6, 2);
}

/** Every model for a picker: free ones first, then the rest, each group best first; non-chat models (embeddings, audio, image) last. */
export function sortModels(items: ModelInfo[]): ModelInfo[] {
  const group = (m: ModelInfo) => (NOT_CHAT.test(m.id) ? 2 : m.free ? 0 : 1);
  return [...items].sort((a, b) => group(a) - group(b) || score(b) - score(a) || a.id.localeCompare(b.id));
}

/** Chat models to use automatically, best first. Models that are leaving are skipped; when some are free, only those (a free key is never pointed at a paid model). */
export function rankModels(items: ModelInfo[]): ModelInfo[] {
  const chat = items.filter((m) => !NOT_CHAT.test(m.id) && !m.expiring);
  const free = chat.filter((m) => m.free);
  return sortModels(free.length ? free : chat);
}

/** Best default and fallback model by name alone (a guess: `probeModels` checks it with real calls). */
export function pickModels(items: ModelInfo[]): Pick<ProviderConfig, "defaultModel" | "fallbackModel"> {
  const ranked = rankModels(items);
  return { defaultModel: ranked[0]?.id, fallbackModel: ranked[1]?.id };
}

const PROBE = [{ role: "user" as const, content: 'Reply with exactly this JSON and nothing else: {"ok":true}' }];
const PROBE_OK = /\{\s*"ok"\s*:\s*true\s*\}/;
const PROBE_BATCH = 3;

/**
 * Finds models that really answer: sends one tiny request to the best-ranked models (at most `tries`, three at a time) and
 * keeps the first two, in rank order, that reply with the JSON asked for. Models that are gone, rate-limited, unpaid or that
 * cannot follow the format are skipped; a rejected key stops the search. `health.ok` is true when at least one model answered.
 */
export async function probeModels(config: ProviderConfig, apiKey: string, deps: RefreshDeps & { tries?: number }): Promise<ProviderConfig> {
  const candidates = rankModels(config.models?.items ?? []).slice(0, deps.tries ?? 9);
  const worked: string[] = [];
  let note = "no chat model found";
  for (let i = 0; i < candidates.length && worked.length < 2; i += PROBE_BATCH) {
    const batch = candidates.slice(i, i + PROBE_BATCH);
    const results = await Promise.all(
      batch.map(async (model) => {
        try {
          const text = await adapters[config.kind].complete({ config, apiKey, fetch: deps.fetch, timeoutMs: deps.timeoutMs ?? 20_000 }, model.id, { messages: PROBE });
          return PROBE_OK.test(text) ? "ok" : new ProviderError("bad_json", "probe reply is not the requested JSON");
        } catch (e) {
          return e instanceof ProviderError ? e : new ProviderError("network", "unexpected provider failure");
        }
      }),
    );
    for (const [j, r] of results.entries()) {
      if (r === "ok") worked.push(batch[j]!.id);
      else note = friendlyReason(r.kind, r.status);
    }
    if (results.some((r) => r !== "ok" && r.kind === "auth")) break;
  }
  const at = (deps.now ?? Date.now)();
  // Hand-picked models stay while the provider still lists them; automatic choices are replaced by what really answered.
  const items = config.models?.items ?? [];
  const listed = (id?: string) => (config.modelsChosen && id && (items.length === 0 || items.some((m) => m.id === id && !m.expiring)) ? id : undefined);
  const defaultModel = listed(config.defaultModel) ?? worked.find((w) => w !== listed(config.fallbackModel));
  const fallbackModel = listed(config.fallbackModel) ?? worked.find((w) => w !== defaultModel);
  return { ...config, defaultModel, fallbackModel, health: worked.length ? { ok: true, at } : { ok: false, at, note } };
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
