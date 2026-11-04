import { ActivityLog, type LogKind } from "../security/activity-log";
import { parsePhoneAction, TaskSession, describePlan, type PhoneAction, type TaskPlan } from "../security/actions";
import { Pacer } from "../security/pacing";
import { sanitizeScreen, type ScreenResult } from "../security/screen";
import { newId } from "../memory/stores";
import type { PhoneDevice } from "./device";

/** What the AI (or the macro replayer) gets back for one step. Never contains text from a screen that was refused. */
export type StepOutcome =
  | { status: "ok"; screen?: string; note?: string }
  | { status: "done"; summary: string }
  | { status: "ask_user"; question: string }
  | { status: "refused"; reason: string }
  | { status: "rate_limited"; retryAfterMs: number }
  | { status: "paused"; reason: string }
  | { status: "stopped"; reason: string };

export interface EngineOptions {
  /** The user's recorded consent; checked before every task. */
  consent?: () => Promise<boolean>;
  pacer?: Pacer;
  sleep?: (ms: number) => Promise<void>;
  /** Wait after an action before the screen is read again. */
  settleMs?: number;
  /** Take a blank-check screenshot with every screen read (needed to stop on FLAG_SECURE windows). */
  screenshots?: boolean;
  /** Soft words (e.g. "pay") the user approved for this task. */
  approvedWords?: string[];
}

const ACTING = new Set<PhoneAction["type"]>(["open_app", "tap", "type", "scroll", "back"]);

const PAUSE_TEXT: Record<string, string> = {
  package: "Paused: another app is in front. Nothing was read. The user must return to an allowed app and resume.",
  secret_field: "Paused: this screen has a password or secret field. Nothing was read. The user must log in or enter it themselves, then resume.",
  sensitive_word: "Paused: this screen asks for a login, password, PIN, code or payment. Nothing was read. The user must handle it, then resume.",
  blocked_host: "Paused: this site is blocked (account or payment page). Nothing was read.",
};
const STOP_TEXT: Record<string, string> = {
  flag_secure: "Stopped: this screen is protected and cannot be captured.",
  blank_screenshot: "Stopped: the screen came back blank, so it cannot be checked safely.",
};

/**
 * The single path every phone action takes, for Mode A, Mode B and macro replay:
 * state -> task plan + confirmation gate -> pacing -> act -> screen gate -> activity log.
 * Steps run one at a time, whatever order they arrive in.
 */
export class PhoneEngine {
  private queue: Promise<unknown> = Promise.resolve();
  private session?: TaskSession;
  private taskId = "";
  private lastPkg = "";
  private readonly pacer: Pacer;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly device: PhoneDevice,
    private readonly log: ActivityLog,
    private readonly opts: EngineOptions = {},
  ) {
    this.pacer = opts.pacer ?? new Pacer();
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get active() {
    return this.session !== undefined;
  }

  /** Starts a task from a plan the user approved. */
  async begin(plan: TaskPlan, taskId: string = newId()): Promise<{ ok: true; taskId: string } | { ok: false; reason: string }> {
    if (this.session) return { ok: false, reason: "a task is already running" };
    if (!plan.approved) return { ok: false, reason: "the plan was not approved by the user" };
    if (plan.apps.length === 0) return { ok: false, reason: "the plan has no allowed apps" };
    if (this.opts.consent && !(await this.opts.consent())) return { ok: false, reason: "consent screen not accepted" };
    try {
      await this.device.start(taskId);
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "could not start" };
    }
    this.session = new TaskSession(plan);
    this.taskId = taskId;
    this.lastPkg = "";
    await this.log.add(taskId, "task_start", describePlan(plan).join(" | "));
    return { ok: true, taskId };
  }

  /** One action from the AI. Accepts a validated action or raw JSON/object; anything invalid is refused. */
  step(input: unknown): Promise<StepOutcome> {
    const run = this.queue.then(() => this.run(input));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Ends the task from the app side (Stop in the UI, Mode switch, done). */
  async end(reason: string): Promise<void> {
    if (!this.session) return;
    await this.finish("stop", `Task ended: ${reason}`);
    await this.device.stop(reason).catch(() => undefined);
  }

  private async finish(kind: LogKind, text: string) {
    await this.log.add(this.taskId, kind, text);
    this.session = undefined;
    this.lastPkg = "";
  }

  private async run(input: unknown): Promise<StepOutcome> {
    const s = this.session;
    if (!s) return { status: "refused", reason: "no task is running" };

    const action = parsePhoneAction(input);
    if (!action) {
      await this.log.add(this.taskId, "blocked", "Refused an invalid action");
      return { status: "refused", reason: "invalid action: send strict JSON for one of the allowed action types" };
    }

    const dev = await this.device.state();
    if (dev.state === "idle") {
      await this.finish("stop", `Task stopped: ${dev.reason ?? "stopped"}`);
      return { status: "stopped", reason: dev.reason ?? "stopped" };
    }
    if (dev.state === "paused") return { status: "paused", reason: dev.reason ?? "paused" };

    const decision = s.check(action);
    if (decision.verdict === "block") {
      await this.log.add(this.taskId, "blocked", `Blocked ${action.type}: ${decision.reason}`, { pkg: this.lastPkg || undefined });
      return { status: "refused", reason: decision.reason };
    }

    const pkg = action.type === "open_app" ? action.package : this.lastPkg;
    const pace = this.pacer.check(pkg, action);
    if (!pace.ok) {
      await this.log.add(this.taskId, "pause", `Rate limit (${pace.window}) in ${pkg}; wait ${Math.ceil(pace.retryAfterMs / 1000)} s`, { pkg });
      return { status: "rate_limited", retryAfterMs: pace.retryAfterMs };
    }

    if (decision.verdict === "confirm") {
      const yes = await this.device.confirm(`Allow: ${decision.kind}?`, decision.preview);
      await this.log.add(this.taskId, yes ? "confirm_yes" : "confirm_no", decision.preview, { pkg: pkg || undefined });
      if (!yes) return { status: "refused", reason: "the user denied this action" };
    }

    if (pace.delayMs) await this.sleep(pace.delayMs);

    // The user may have pressed Stop, locked the phone or left the app while a popup or delay was open.
    const again = await this.device.state();
    if (again.state !== "running") {
      if (again.state === "idle") await this.finish("stop", `Task stopped: ${again.reason ?? "stopped"}`);
      return { status: again.state === "idle" ? "stopped" : "paused", reason: again.reason ?? again.state };
    }

    return this.execute(s, action, pkg);
  }

  private async execute(s: TaskSession, action: PhoneAction, pkg: string): Promise<StepOutcome> {
    switch (action.type) {
      case "read_screen":
        s.executed(action);
        return this.observe(s);
      case "wait":
        await this.sleep(action.ms);
        return { status: "ok" };
      case "ask_user":
        await this.log.add(this.taskId, "pause", `Asked the user: ${action.question}`);
        return { status: "ask_user", question: action.question };
      case "done":
        await this.finish("done", `Done: ${action.summary}`);
        await this.device.stop("done").catch(() => undefined);
        return { status: "done", summary: action.summary };
      default:
    }

    const label = this.describe(s, action);
    let ok = false;
    let error: string | undefined;
    try {
      if (action.type === "open_app") await this.device.openApp(action.package).then(() => void (ok = true));
      else ({ ok, error } = await this.device.perform(action));
    } catch (e) {
      error = e instanceof Error ? e.message : "failed";
    }
    if (!ok) {
      s.setScreen([]);
      const st = await this.device.state();
      await this.log.add(this.taskId, "error", `${label} failed: ${error ?? "unknown"}`, { pkg: pkg || undefined });
      return st.state === "idle" ? { status: "stopped", reason: st.reason ?? "stopped" } : { status: "refused", reason: `action failed: ${error ?? "unknown"}` };
    }
    s.executed(action);
    this.pacer.record(pkg, action);
    await this.log.add(this.taskId, "action", label, { pkg: pkg || undefined });
    if (!ACTING.has(action.type)) return { status: "ok" };
    await this.sleep(this.opts.settleMs ?? 600);
    return this.observe(s);
  }

  private describe(s: TaskSession, a: PhoneAction): string {
    const label = (id: number) => s.nodes.find((n) => n.id === id)?.text.slice(0, 60) || `#${id}`;
    switch (a.type) {
      case "open_app": return `Open ${a.package}`;
      case "tap": return `Tap "${label(a.nodeId)}"`;
      case "type": return `Type "${a.text.slice(0, 80)}" into "${label(a.nodeId)}"`;
      case "scroll": return `Scroll ${a.direction}`;
      default: return a.type;
    }
  }

  /** Reads the screen through the gate. Only an `ok` screen returns text; every other result returns a fixed sentence. */
  private async observe(s: TaskSession): Promise<StepOutcome> {
    const raw = await this.device.readScreen(this.opts.screenshots ?? true);
    if ("blocked" in raw) {
      s.setScreen([]);
      const st = await this.device.state();
      await this.log.add(this.taskId, "pause", `Screen not read: ${raw.reason}`);
      if (st.state === "idle") { await this.finish("stop", `Task stopped: ${st.reason ?? raw.reason}`); return { status: "stopped", reason: st.reason ?? raw.reason }; }
      return { status: "paused", reason: raw.reason };
    }
    const r: ScreenResult = sanitizeScreen(raw, { allowlist: s.plan.apps, approvedWords: this.opts.approvedWords });
    if (r.kind === "ok") {
      this.lastPkg = raw.pkg ?? "";
      s.setScreen(r.nodes);
      return { status: "ok", screen: r.text };
    }
    s.setScreen([]);
    if (r.kind === "stop") {
      await this.device.stop(r.reason).catch(() => undefined);
      await this.finish("stop", STOP_TEXT[r.reason] ?? "Stopped");
      return { status: "stopped", reason: r.reason };
    }
    const why = r.reason === "package" ? `app_not_allowed:${r.detail}` : r.reason === "sensitive_word" ? `sensitive_word:${r.words.join("+")}` : r.reason;
    await this.device.pause(why).catch(() => undefined);
    await this.log.add(this.taskId, "pause", PAUSE_TEXT[r.reason] ?? "Paused", { pkg: r.reason === "package" ? undefined : raw.pkg ?? undefined });
    return { status: "paused", reason: why };
  }
}
