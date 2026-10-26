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

export function classifyStatus(status: number): ProviderError["kind"] {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "payment";
  if (status === 408) return "timeout";
  if (status >= 500) return "server";
  return "bad_request";
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
        classifyStatus(res.status),
        `HTTP ${res.status}: ${redactText(body.slice(0, 200))}`,
        res.status,
        parseRetryAfter(res.headers.get("retry-after")),
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
