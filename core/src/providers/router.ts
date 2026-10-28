import { DEFAULTS, type RouterConfig } from "../config/defaults";
import type { KeyStore, KVStore } from "../storage";
import { adapters, rankModels, withAutoModels } from "./models";
import {
  AbortedError,
  ProviderError,
  type ChatMessage,
  type FetchLike,
  type ProviderConfig,
  friendlyReason,
  type ProviderErrorKind,
} from "./types";

export interface RouterDeps {
  keys: KeyStore;
  kv: KVStore;
  fetch: FetchLike;
  /** Returns providers in the user's order. */
  providers: () => ProviderConfig[];
  now?: () => number;
  config?: Partial<RouterConfig>;
  /** Called after every real attempt, so the UI can show a green tick or the reason. */
  onResult?: (providerId: string, ok: boolean, note?: string) => void;
}

export interface Attempt {
  providerId: string;
  providerName: string;
  model?: string;
  outcome: "ok" | "skipped" | ProviderErrorKind;
  /** Raw reason (may be long). Logs only; never shown in chat. */
  detail?: string;
  /** One short line for the user. */
  reason?: string;
}

/** Start of the error shown when no provider could answer; the UI offers a shortcut to API Keys for it. */
const MAX_MODELS_PER_PROVIDER = 4;
export const NO_PROVIDER_PREFIX = "No AI provider could answer.";

/** The distinct reasons, without provider or model names: "free limit used up, try again later · no connection". */
function summarize(attempts: Attempt[]): string {
  const reasons = new Set<string>();
  for (const a of attempts) if (a.outcome !== "skipped" && a.reason) reasons.add(a.reason);
  if (reasons.size) return [...reasons].join(" · ");
  return attempts.some((a) => a.detail === "cooldown" || a.detail === "circuit open") ? "the AI services are busy, trying again shortly" : "Nothing is set up to answer yet.";
}

export class AllProvidersFailedError extends Error {
  constructor(readonly attempts: Attempt[]) {
    super(`${NO_PROVIDER_PREFIX} ${summarize(attempts)}`);
  }
  /** Trying again later can help: something answered badly or was busy (not just a missing key, a refused key or no credit). */
  get transient() {
    return this.attempts.some((a) => (a.outcome === "skipped" ? a.detail === "cooldown" || a.detail === "circuit open" : a.outcome !== "auth" && a.outcome !== "payment"));
  }
}

export interface RunOptions {
  signal?: AbortSignal;
}

export interface RunResult<T> {
  value: T;
  providerId: string;
  model: string;
  attempts: Attempt[];
}

interface Health {
  cooldownUntil: number;
  failures: number;
  circuitOpenUntil: number;
}

const dayKey = (id: string, ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `usage:${id}:${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export class ProviderRouter {
  private health = new Map<string, Health>();
  private readonly cfg: RouterConfig;
  private readonly now: () => number;

  constructor(private deps: RouterDeps) {
    this.cfg = { ...DEFAULTS.router, ...deps.config };
    this.now = deps.now ?? Date.now;
  }

  async usageToday(providerId: string): Promise<number> {
    return Number((await this.deps.kv.get(dayKey(providerId, this.now()))) ?? 0);
  }

  private async bump(providerId: string) {
    await this.deps.kv.set(dayKey(providerId, this.now()), String((await this.usageToday(providerId)) + 1));
  }

  private h(id: string): Health {
    let v = this.health.get(id);
    if (!v) this.health.set(id, (v = { cooldownUntil: 0, failures: 0, circuitOpenUntil: 0 }));
    return v;
  }

  /** Milliseconds until the first usable provider is out of its cooldown (0 when one is usable now or none could ever be). */
  async retryInMs(): Promise<number> {
    const t = this.now();
    let soonest = Infinity;
    for (const p of this.deps.providers()) {
      if (!p.enabled || !p.defaultModel) continue;
      if (p.kind !== "webgpu-local" && !p.keyless && !(await this.deps.keys.get(p.id))) continue;
      const h = this.h(p.id);
      soonest = Math.min(soonest, Math.max(0, Math.max(h.cooldownUntil, h.circuitOpenUntil) - t));
    }
    return soonest === Infinity ? 0 : soonest;
  }

  /** Why a provider is unavailable right now, or undefined if usable. */
  private async blockedReason(p: ProviderConfig, opts: RunOptions, hasKey: boolean): Promise<string | undefined> {
    const h = this.h(p.id);
    const t = this.now();
    if (!p.enabled) return "disabled";
    if (!hasKey) return "no key";
    if (!p.defaultModel) return "no model selected";
    if (t < h.cooldownUntil) return "cooldown";
    if (t < h.circuitOpenUntil) return "circuit open";
    if (p.dailyLimit !== undefined && (await this.usageToday(p.id)) >= p.dailyLimit) return "daily limit";
    return undefined;
  }

  private onSuccess(id: string) {
    const h = this.h(id);
    h.failures = 0;
    h.cooldownUntil = 0;
    h.circuitOpenUntil = 0;
  }

  private onFailure(id: string, e: ProviderError) {
    const h = this.h(id);
    const t = this.now();
    h.failures += 1;
    const wait =
      e.kind === "auth"
        ? this.cfg.authCooldownMs
        : e.kind === "rate_limit"
          ? (e.retryAfterMs ?? this.cfg.defaultCooldownMs * 2 ** Math.min(h.failures - 1, 5)) // a limit that keeps coming back (a shared free pool) is left alone for longer each time
          : 0;
    h.cooldownUntil = t + Math.min(wait, this.cfg.maxCooldownMs);
    if (h.failures >= this.cfg.circuitThreshold) h.circuitOpenUntil = t + this.cfg.circuitOpenMs;
  }

  /**
   * Runs one agent step: tries providers in order until one returns output that `parse` accepts.
   * `parse` throwing counts as invalid JSON and moves on to the next provider.
   */
  async run<T>(messages: ChatMessage[], parse: (text: string) => T, opts: RunOptions = {}): Promise<RunResult<T>> {
    const attempts: Attempt[] = [];
    for (const configured of this.deps.providers()) {
      const p = withAutoModels(configured);
      if (opts.signal?.aborted) throw new AbortedError();
      const needsKey = p.kind !== "webgpu-local" && !p.keyless;
      const apiKey = needsKey ? await this.deps.keys.get(p.id) : (p.anonymousKey ?? "");
      const blocked = await this.blockedReason(p, opts, !needsKey || Boolean(apiKey));
      if (blocked || (needsKey && !apiKey)) {
        attempts.push({ providerId: p.id, providerName: p.name, outcome: "skipped", detail: blocked });
        continue;
      }
      // The chosen pair first, then the next best models the provider lists: one model being rate-limited or retired never ends the step.
      const models = [...new Set([p.defaultModel!, p.fallbackModel, ...rankModels(p.models?.items ?? []).slice(0, 4).map((m) => m.id)])].filter((m): m is string => Boolean(m)).slice(0, MAX_MODELS_PER_PROVIDER);
      let lastError: ProviderError | undefined;
      let limited = 0;
      for (const model of models) {
        await this.bump(p.id);
        try {
          const text = await adapters[p.kind].complete(
            { config: p, apiKey: apiKey ?? "", fetch: this.deps.fetch, timeoutMs: this.cfg.requestTimeoutMs, signal: opts.signal },
            model,
            { messages },
          );
          let value: T;
          try {
            value = parse(text);
          } catch {
            throw new ProviderError("bad_json", "model output rejected by schema");
          }
          this.onSuccess(p.id);
          this.deps.onResult?.(p.id, true);
          attempts.push({ providerId: p.id, providerName: p.name, model, outcome: "ok" });
          return { value, providerId: p.id, model, attempts };
        } catch (e) {
          if (e instanceof AbortedError) throw e;
          lastError = e instanceof ProviderError ? e : new ProviderError("network", "unexpected provider failure");
          // A keyless free service has one limit shared by every user of the app: that is not the user's own usage.
          const reason = p.keyless && lastError.kind === "rate_limit" ? "shared free limit is full right now (not your usage)" : friendlyReason(lastError.kind, lastError.status);
          attempts.push({ providerId: p.id, providerName: p.name, model, outcome: lastError.kind, detail: lastError.message, reason });
          this.deps.onResult?.(p.id, false, reason);
          if (lastError.kind === "auth" || lastError.kind === "payment") break; // same key or account: another model will not help
          if (p.keyless && lastError.kind === "rate_limit" && ++limited >= 2) break; // a keyless service has one shared pool: two limits in a row mean all its models are out
        }
      }
      if (lastError) this.onFailure(p.id, lastError);
    }
    throw new AllProvidersFailedError(attempts);
  }
}
