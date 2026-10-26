export type ProviderKind = "gemini" | "openai-compat" | "webgpu-local";

export interface ModelInfo {
  id: string;
  displayName?: string;
  /** true only when the provider's own response says the model is free. */
  free?: boolean;
  contextWindow?: number;
}

export interface ModelCache {
  fetchedAt: number;
  items: ModelInfo[];
}

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Optional override for the model-list endpoint (when it differs from {baseUrl}/models). */
  modelsUrl?: string;
  enabled: boolean;
  /** Per-provider privacy flag. Default false. */
  allowSensitive: boolean;
  defaultModel?: string;
  fallbackModel?: string;
  /** Optional user-set local daily request cap. */
  dailyLimit?: number;
  models?: ModelCache;
  modelsError?: string;
  /** Result of the last real call (a connection test or an agent step). Drives the green tick in the UI. */
  health?: { ok: boolean; at: number; note?: string };
  /** Set after the single automatic fetch on first key add. */
  modelsAutoFetched?: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** data: URL; only attached when the user enabled screenshots. */
  imageDataUrl?: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ProviderErrorKind =
  | "rate_limit"
  | "server"
  | "timeout"
  | "network"
  | "auth"
  | "payment"
  | "bad_request"
  | "bad_json";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** The user pressed STOP. Never triggers fallback. */
export class AbortedError extends Error {
  constructor() {
    super("aborted");
  }
}

export interface AdapterCall {
  config: ProviderConfig;
  apiKey: string;
  fetch: FetchLike;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface Adapter {
  complete(call: AdapterCall, model: string, req: CompletionRequest): Promise<string>;
  listModels(call: AdapterCall): Promise<ModelInfo[]>;
}

/** One short line for the user. The raw provider body stays in `Attempt.detail` and never reaches the chat. */
export function friendlyReason(kind: ProviderErrorKind, status?: number): string {
  switch (kind) {
    case "rate_limit": return "free limit used up, try again later";
    case "auth": return "key rejected";
    case "payment": return "needs paid credit";
    case "timeout": return "too slow";
    case "network": return "no connection";
    case "server": return "provider is down";
    case "bad_json": return "unusable reply";
    default: return status ? `model not usable (HTTP ${status})` : "model not usable";
  }
}
