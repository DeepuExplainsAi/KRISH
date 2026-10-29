import { redactText } from "../privacy/redact";
import { isHttpsUrl } from "../schema/actions";
import { AbortedError, ProviderError, type AdapterCall } from "./types";

function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** Pollinations answers its per-IP free limit ("1 reply every 30 seconds") with HTTP 402; that is a wait, not a missing payment. */
const FREE_LIMIT_BODY = /free[ _]limit|retry after \d+\s*s/i;
/** A limit that names a day (OpenRouter "free-models-per-day", Groq "(RPD)"/"(TPD)", OpenCode "FreeUsageLimit"). */
const DAILY_LIMIT_TEXT = /per[ _-]?day|daily|FreeUsageLimit|\b(?:RPD|TPD)\b/i;
/** "Please retry in 27.3s" (Gemini), "try again in 7m12.5s" (Groq), "retry after 30s". */
const RETRY_TEXT = /(?:retry|try again) (?:in|after) (?:(\d+)m)?\s*(\d+(?:\.\d+)?)s/i;
const TOO_LARGE_TEXT = /request too large|payload too large|context[_ ]length|maximum context|too many tokens|reduce the length|prompt is too long/i;

const asRecords = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : []);

/**
 * What a rate-limit body says. The structure wins over the words: Gemini lists every quota of the project in its text, so a
 * per-minute limit mentions "PerDay" too; only the violated quota's id (`...PerMinute...` / `...PerDay...`) tells the window.
 */
export function limitInfo(body: string, now = Date.now()): { daily: boolean; retryMs?: number } {
  let err: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (parsed && typeof parsed.error === "object" && parsed.error) err = parsed.error as Record<string, unknown>;
  } catch {
    /* plain text body */
  }
  const text = [err.message, err.type, err.status, err.code].filter((v): v is string => typeof v === "string").join(" ") || body;
  const details = asRecords(err.details);
  const quotaIds = details.flatMap((d) => asRecords(d.violations).map((v) => String(v.quotaId ?? "")));
  const delay = details.map((d) => /^(\d+(?:\.\d+)?)s$/.exec(String(d.retryDelay ?? ""))).find(Boolean);
  const said = RETRY_TEXT.exec(text);
  // OpenRouter: metadata.headers["X-RateLimit-Reset"] is the moment (epoch ms) the limit is lifted.
  const reset = Number(((err.metadata as { headers?: Record<string, unknown> } | undefined)?.headers ?? {})["X-RateLimit-Reset"]);
  const retryMs = delay ? Math.ceil(Number(delay[1]) * 1000) : said ? Math.ceil((Number(said[1] ?? 0) * 60 + Number(said[2])) * 1000) : reset > now ? reset - now : undefined;
  return { daily: quotaIds.length ? quotaIds.some((id) => /PerDay/i.test(id)) : DAILY_LIMIT_TEXT.test(text), retryMs };
}

export function classifyStatus(status: number, body = ""): ProviderError["kind"] {
  if (status === 402 && FREE_LIMIT_BODY.test(body)) return "rate_limit";
  if (status === 429) return limitInfo(body).daily ? "quota" : "rate_limit";
  if (status === 413 || ((status === 400 || status === 422) && TOO_LARGE_TEXT.test(body))) return "too_large";
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "payment";
  if (status === 408) return "timeout";
  if (status >= 500) return "server";
  return "bad_request";
}

/**
 * Sends the variants of one request, fullest first, starting with the one that last worked for this provider and model. A 400/422 means the model
 * does not take that option (JSON mode, system prompt, temperature): the next, plainer variant is tried and the winner remembered,
 * so later steps spend one request, not two or three.
 */
export async function firstWorking<T>(call: AdapterCall, model: string, variants: number, send: (variant: number) => Promise<T>): Promise<T> {
  const key = `${call.config.id}|${call.config.baseUrl}|${model}`;
  for (let v = call.memo?.get(key) ?? 0; ; v++) {
    try {
      const out = await send(v);
      call.memo?.set(key, v);
      return out;
    } catch (e) {
      if (!(e instanceof ProviderError) || (e.status !== 400 && e.status !== 422) || e.kind === "too_large" || v >= variants - 1) throw e;
    }
  }
}

/** Sends a request with timeout; maps every failure to a ProviderError. Key goes in headers only. */
export async function request(
  call: AdapterCall,
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: unknown },
): Promise<unknown> {
  if (!isHttpsUrl(url)) throw new ProviderError("bad_request", "provider URL must be https");
  if (call.signal?.aborted) throw new AbortedError();
  const timeout = new AbortController();
  let timedOut = false;
  // Some fetch implementations ignore `signal` (Capacitor's native POST bridge does), so the wait itself is raced
  // against the timeout and STOP. Otherwise a hung provider would block fallback and STOP forever.
  let giveUp: (e: unknown) => void = () => undefined;
  const gaveUp = new Promise<never>((_, reject) => (giveUp = reject));
  gaveUp.catch(() => undefined); // never an unhandled rejection
  const timer = setTimeout(() => {
    timedOut = true;
    timeout.abort();
    giveUp(new Error("timeout"));
  }, call.timeoutMs);
  const onAbort = () => {
    timeout.abort();
    giveUp(new Error("aborted"));
  };
  call.signal?.addEventListener("abort", onAbort);
  try {
    const res = await Promise.race([
      call.fetch(url, {
        method: init.method,
        headers: { "content-type": "application/json", ...init.headers },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: timeout.signal,
        credentials: "omit",
      }),
      gaveUp,
    ]);
    // Cancellation wins over anything the response said or failed to say.
    const cancelled = () => timedOut || call.signal?.aborted === true;
    if (!res.ok) {
      const body = await Promise.race([res.text(), gaveUp]).catch(() => "");
      if (cancelled()) throw new Error("cancelled"); // classified by the outer handler
      throw new ProviderError(
        classifyStatus(res.status, body),
        `HTTP ${res.status}: ${redactText(body.slice(0, 200))}`,
        res.status,
        parseRetryAfter(res.headers.get("retry-after")) ?? ((res.status === 402 || res.status === 429 ? limitInfo(body).retryMs : undefined)),
      );
    }
    try {
      return await Promise.race([res.json(), gaveUp]);
    } catch (e) {
      if (cancelled() || !(e instanceof SyntaxError)) throw e; // a body that cannot be read is not "bad JSON"
      throw new ProviderError("bad_json", "provider returned a non-JSON body");
    }
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (call.signal?.aborted) throw new AbortedError();
    if (timedOut) throw new ProviderError("timeout", `timed out after ${call.timeoutMs} ms`);
    throw new ProviderError("network", "network error");
  } finally {
    clearTimeout(timer);
    call.signal?.removeEventListener("abort", onAbort);
  }
}
