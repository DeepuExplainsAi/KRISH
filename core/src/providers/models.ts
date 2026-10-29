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
    const at = (deps.now ?? Date.now)();
    return { ...config, models: { fetchedAt: at, items }, modelsError: undefined, modelsChanged: diffModels(config, items, at) };
  } catch (e) {
    return { ...config, modelsError: e instanceof Error ? e.message : "refresh failed" };
  }
}

/** Models that appeared or vanished since the last list. A first list is not a change; an unchanged list keeps the last report. */
function diffModels(config: ProviderConfig, items: ModelInfo[], at: number): ProviderConfig["modelsChanged"] {
  const before = config.models?.items;
  if (!before?.length) return config.modelsChanged;
  const was = new Set(before.map((m) => m.id));
  const now = new Set(items.map((m) => m.id));
  const added = [...now].filter((id) => !was.has(id));
  const removed = [...was].filter((id) => !now.has(id));
  return added.length || removed.length ? { at, added, removed } : config.modelsChanged;
}

/** Automatic fetch happens exactly once, right after the key is first added. */
export async function autoFetchOnce(config: ProviderConfig, apiKey: string, deps: RefreshDeps): Promise<ProviderConfig> {
  if (config.modelsAutoFetched) return config;
  return { ...(await refreshModels(config, apiKey, deps)), modelsAutoFetched: true };
}

const NOT_CHAT = /embed|tts|whisper|transcri|speech|audio|realtime|image|imagen|dall|veo|video|moderation|guard|rerank|aqa|vision-only|live|robotics|computer-use|learnlm/i;
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
  // Gemini's free tier gives "flash" models a quota and most "pro" models none, so on a free key flash must come first.
  const geminiFlash = /^(models\/)?gemini-/i.test(m.id) && /flash/i.test(m.id) && !SMALL.test(m.id);
  const tier = geminiFlash ? 7 : TOP.test(text) ? 5 : MID.test(text) ? 3 : 0;
  const small = SMALL.test(text) || (params > 0 && params <= 14);
  // OpenRouter's own free router picks whichever free model is up; Gemma (Google's open model) often rejects JSON mode, so Gemini goes first.
  const bias = /^openrouter\/free$/.test(m.id) ? 100 : /(^|\/)gemma/i.test(m.id) ? -60 : 0;
  return bias + version * 10 + tier - (small ? 12 : 0) - (UNSTABLE.test(text) ? 8 : 0) + Math.min(params / 100, 4) + Math.min((m.contextWindow ?? 0) / 1e6, 2);
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

/** Best model by name alone (a guess: `probeModels` checks it with a real call). */
export function pickModels(items: ModelInfo[]): Pick<ProviderConfig, "defaultModel"> {
  return { defaultModel: rankModels(items)[0]?.id };
}

const PROBE = [{ role: "user" as const, content: 'Reply with exactly this JSON and nothing else: {"ok":true}' }];
const PROBE_OK = /\{\s*"ok"\s*:\s*true\s*\}/;
/** These say something about the whole provider, not about one model: asking the next model would only spend more of the same quota. */
const PROVIDER_WIDE = new Set<ProviderError["kind"]>(["auth", "network", "timeout"]);
/** A quota or an outage can belong to one model (Gemini: a daily quota per model, most "pro" ones none on a free key), so it stops the search only when two models in a row fail with it. */
const MODEL_OR_PROVIDER = new Set<ProviderError["kind"]>(["quota", "server"]);

/**
 * Finds a model that really answers: sends one tiny request at a time to the best-ranked models (at most `tries`) and keeps the
 * first, in rank order, that replies with the JSON asked for. Models that are gone, rate-limited, unpaid or that cannot follow the
 * format are skipped. A rejected key or a dead connection stops the search at once, a spent quota or an outage after two models in a row:
 * the rest would fail the same way and each try costs quota. `health.ok` is true when a model answered.
 * A model the user chose by hand stays while the provider still lists it.
 */
export async function probeModels(config: ProviderConfig, apiKey: string, deps: RefreshDeps & { tries?: number }): Promise<ProviderConfig> {
  const items = config.models?.items ?? [];
  const listed = (id?: string) => (config.modelsChosen && id && (items.length === 0 || items.some((m) => m.id === id && !m.expiring)) ? id : undefined);
  const chosen = listed(config.defaultModel);
  const candidates = chosen ? [{ id: chosen }] : rankModels(items).slice(0, deps.tries ?? 5);
  let worked: string | undefined;
  let note = "no chat model found";
  let last: ProviderError["kind"] | undefined;
  for (const model of candidates) {
    try {
      const text = await adapters[config.kind].complete({ config, apiKey, fetch: deps.fetch, timeoutMs: deps.timeoutMs ?? 20_000 }, model.id, { messages: PROBE });
      if (PROBE_OK.test(text)) {
        worked = model.id;
        break;
      }
      note = friendlyReason("bad_json");
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError("network", "unexpected provider failure");
      note = friendlyReason(err.kind, err.status);
      if (PROVIDER_WIDE.has(err.kind) || (MODEL_OR_PROVIDER.has(err.kind) && last === err.kind)) break;
      last = err.kind;
    }
  }
  const at = (deps.now ?? Date.now)();
  // A hand-picked model is kept even when the test failed (a spent quota is not a reason to forget the user's choice).
  const defaultModel = chosen ?? worked;
  return { ...config, defaultModel, health: worked ? { ok: true, at } : { ok: false, at, note } };
}

/** Fills a missing model from the fetched list; a model the user chose is kept. */
export function withAutoModels(p: ProviderConfig): ProviderConfig {
  if (p.defaultModel) return p;
  const defaultModel = pickModels(p.models?.items ?? []).defaultModel;
  return defaultModel ? { ...p, defaultModel } : p;
}

export function searchModels(items: ModelInfo[], query: string): ModelInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((m) => `${m.id} ${m.displayName ?? ""}`.toLowerCase().includes(q));
}
