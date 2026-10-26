import { DEFAULTS, type RouterConfig } from "../config/defaults";
import type { KeyStore, KVStore } from "../storage";
import { adapters, withAutoModels } from "./models";
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
export const NO_PROVIDER_PREFIX = "No AI provider could answer.";

/** One short line per provider (its last attempt): "Gemini: free limit used up · Groq: key rejected". */
function summarize(attempts: Attempt[]): string {
  const last = new Map<string, Attempt>();
  for (const a of attempts) last.set(a.providerId, a);
  const lines = [...last.values()].map((a) => `${a.providerName}: ${a.reason ?? a.detail ?? a.outcome}`);
  return lines.length ? lines.join(" · ") : "No provider added yet.";
}

export class AllProvidersFailedError extends Error {
  constructor(readonly attempts: Attempt[]) {
    super(`${NO_PROVIDER_PREFIX} ${summarize(attempts)}`);
  }
}

export interface RunOptions {
  /** True when the observation came from a sensitive page. */
  sensitive?: boolean;
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

  /** Why a provider is unavailable right now, or undefined if usable. */
  private async blockedReason(p: ProviderConfig, opts: RunOptions, hasKey: boolean): Promise<string | undefined> {
    const h = this.h(p.id);
    const t = this.now();
    if (!p.enabled) return "disabled";
    if (!hasKey) return "no key";
    if (opts.sensitive && !p.allowSensitive) return "sensitive page not allowed";
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
          ? (e.retryAfterMs ?? this.cfg.defaultCooldownMs)
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
      const needsKey = p.kind !== "webgpu-local";
      const apiKey = needsKey ? await this.deps.keys.get(p.id) : "";
      const blocked = await this.blockedReason(p, opts, !needsKey || Boolean(apiKey));
      if (blocked || (needsKey && !apiKey)) {
        attempts.push({ providerId: p.id, providerName: p.name, outcome: "skipped", detail: blocked });
        continue;
      }
      const models = [p.defaultModel!, ...(p.fallbackModel && p.fallbackModel !== p.defaultModel ? [p.fallbackModel] : [])];
      let lastError: ProviderError | undefined;
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
          const reason = friendlyReason(lastError.kind, lastError.status);
          attempts.push({ providerId: p.id, providerName: p.name, model, outcome: lastError.kind, detail: lastError.message, reason });
          this.deps.onResult?.(p.id, false, reason);
          if (lastError.kind === "auth") break; // same key: fallback model will not help
        }
      }
      if (lastError) this.onFailure(p.id, lastError);
    }
    throw new AllProvidersFailedError(attempts);
  }
}
