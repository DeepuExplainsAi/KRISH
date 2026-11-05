import type { KeyStore } from "../storage";
import type { ActivityLog } from "../security/activity-log";
import type { TaskPlan } from "../security/actions";
import type { PhoneDevice } from "./device";
import { ChatDriver, type PhoneRunResult } from "./chat-driver";
import { PhoneEngine, type EngineOptions } from "./engine";
import type { Macro } from "./macro";
import { replayMacro, replayWithRetry, type MacroResult } from "./replay";
import { createMcpHandler } from "./mcp";
import { isPairingToken, newPairingToken, RelayClient, type RelayStatus, type SocketLike } from "./relay-client";

const TOKEN_KEY = "phone-relay-token";

export type Mode = "off" | "mcp" | "chat" | "macro";

/** `https://host` only: no path, no credentials, no query. Returns the origin, or undefined. */
export function parseRelayUrl(input: string): URL | undefined {
  try {
    const u = new URL(input.trim());
    const ok = u.protocol === "https:" && !u.username && !u.password && u.pathname === "/" && !u.search && !u.hash && u.hostname.includes(".");
    return ok ? u : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Owns the engine and the active mode. One mode at a time: Mode B (an AI client calls tools through the relay) or Mode A (the app drives
 * a chat app). Switching ends any running task first.
 */
export class PhoneService {
  readonly engine: PhoneEngine;
  private relay?: RelayClient;
  private mode: Mode = "off";
  private relayStatus: RelayStatus = "off";
  private abort?: AbortController;

  constructor(
    device: PhoneDevice,
    log: ActivityLog,
    private readonly keys: KeyStore,
    private readonly connect: (url: string) => SocketLike,
    opts: EngineOptions = {},
    private readonly onChange: () => void = () => {},
  ) {
    this.engine = new PhoneEngine(device, log, opts);
    this.device = device;
    this.log = log;
  }
  private readonly device: PhoneDevice;
  private readonly log: ActivityLog;

  get current() {
    return { mode: this.mode, relay: this.relayStatus, taskActive: this.engine.active };
  }

  /** The pairing token is created once and kept in the secure key store. */
  private async token(): Promise<string> {
    const saved = await this.keys.get(TOKEN_KEY);
    if (saved && isPairingToken(saved)) return saved;
    const t = newPairingToken();
    await this.keys.set(TOKEN_KEY, t);
    return t;
  }

  /** Switches to Mode B. Returns the connector URL to paste into the AI client. */
  async enableMcp(relayUrl: string): Promise<{ ok: true; connectorUrl: string } | { ok: false; reason: string }> {
    const base = parseRelayUrl(relayUrl);
    if (!base) return { ok: false, reason: "Relay URL must look like https://name.workers.dev" };
    await this.disable();
    const token = await this.token();
    this.mode = "mcp";
    this.relay = new RelayClient({
      url: `wss://${base.host}/phone/${token}`,
      connect: this.connect,
      handler: createMcpHandler(this.engine),
      onStatus: (s) => { this.relayStatus = s; this.onChange(); },
    });
    this.relay.start();
    this.onChange();
    return { ok: true, connectorUrl: `https://${base.host}/mcp/${token}` };
  }

  /** Mode A: the app drives a chat app (ChatGPT / Gemini / Claude) on this phone as the brain. Resolves when the task ends. */
  async runChat(plan: TaskPlan, chatPkg: string, ask?: (q: string) => Promise<string | undefined>): Promise<PhoneRunResult> {
    await this.disable();
    this.mode = "chat";
    this.abort = new AbortController();
    this.onChange();
    try {
      return await new ChatDriver(this.engine, this.device, this.log, { chatPkg, ask, signal: this.abort.signal }).run(plan);
    } finally {
      this.abort = undefined;
      this.mode = "off";
      this.onChange();
    }
  }

  /**
   * Schedule flow: replays a saved macro without an AI (same engine gates). Retries a failure that may be temporary, then returns the
   * result so the caller can notify the user. Refuses while another task is running.
   */
  async runMacro(macro: Macro, allowlist: readonly string[], o: { retries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<MacroResult & { attempts: number }> {
    if (this.engine.active) return { ok: false, reason: "a task is already running", retryable: false, attempts: 0 };
    await this.disable();
    this.mode = "macro";
    this.abort = new AbortController();
    this.onChange();
    const signal = this.abort.signal;
    try {
      return await replayWithRetry(async () => (signal.aborted ? { ok: false, reason: "stopped", retryable: false } : replayMacro(this.engine, macro, allowlist, { sleep: o.sleep })), { ...o, sleep: o.sleep });
    } finally {
      this.abort = undefined;
      this.mode = "off";
      this.onChange();
    }
  }

  /** Ends the running task and closes the relay. */
  async disable() {
    this.abort?.abort();
    await this.engine.end("mode_change");
    this.relay?.stop();
    this.relay = undefined;
    this.relayStatus = "off";
    this.mode = "off";
    this.onChange();
  }

  /** New pairing token: every AI client that had the old connector URL is cut off. The relay reconnects under the new one. */
  async rotateToken(relayUrl: string) {
    await this.keys.delete(TOKEN_KEY);
    return this.mode === "mcp" ? this.enableMcp(relayUrl) : { ok: true as const, connectorUrl: "" };
  }

  /** Starts a task from the plan the user approved. */
  begin(plan: TaskPlan) {
    return this.engine.begin(plan);
  }
}
