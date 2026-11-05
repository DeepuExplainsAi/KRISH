import { approvePlan, createPlan, type PhoneActionType } from "../security/actions";
import type { PhoneEngine, StepOutcome } from "./engine";
import { directAction, resolveStep, type Macro } from "./macro";

export type MacroResult = { ok: true; steps: number } | { ok: false; reason: string; retryable: boolean };

export interface ReplayOptions {
  sleep?: (ms: number) => Promise<void>;
  /** Tries to find a step's element (the screen may still be loading). */
  findTries?: number;
  findDelayMs?: number;
}

const fail = (reason: string, retryable: boolean): MacroResult => ({ ok: false, reason, retryable });
const norm = (s: string) => s.trim().toLowerCase();
const ACTING = new Set(["open_app", "tap", "type", "scroll", "back"]);

const why = (o: StepOutcome): string => {
  switch (o.status) {
    case "ok": return "ok";
    case "done": return o.summary;
    case "ask_user": return o.question;
    case "refused":
    case "paused":
    case "stopped": return o.reason;
    case "rate_limited": return `rate limit, try again in ${Math.ceil(o.retryAfterMs / 1000)} s`;
  }
};

/**
 * Replays a saved macro WITHOUT an AI. Every step still goes through `PhoneEngine.step`, so the task plan, the confirmation popups,
 * pacing, the screen gate (login, OTP, secret fields, FLAG_SECURE) and the activity log apply exactly as in Mode A and B.
 * Anything unexpected ends the run; the macro never improvises.
 */
export async function replayMacro(engine: PhoneEngine, macro: Macro, allowlist: readonly string[], o: ReplayOptions = {}): Promise<MacroResult> {
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const tries = o.findTries ?? 3;
  if (!macro.approvedAt) return fail("the macro was not approved by the user", false);
  const allowed = new Set(allowlist.map(norm));
  const gone = macro.apps.filter((a) => !allowed.has(norm(a)));
  if (gone.length) return fail(`app no longer allowed: ${gone.join(", ")}`, false);

  const actions = [...new Set<PhoneActionType>(["read_screen", "done", ...macro.steps.map((s) => s.type)])];
  const plan = createPlan(macro.task || macro.title, macro.apps, actions, Math.min(400, macro.steps.length * 4 + 10));
  if (plan.apps.length !== macro.apps.length) return fail("an app of this macro is blocked", false);

  const begun = await engine.begin(approvePlan(plan));
  if (!begun.ok) return fail(begun.reason, false);
  const stop = async (reason: string, retryable: boolean) => {
    await engine.end(reason);
    return fail(reason, retryable);
  };

  let fresh = false; // the engine's last screen read is current
  for (const step of macro.steps) {
    let action = directAction(step);
    for (let i = 0; !action; i++) {
      if (!fresh) {
        const read = await engine.step({ type: "read_screen" });
        if (read.status !== "ok") return stop(why(read), false);
        fresh = true;
      }
      action = resolveStep(step, engine.screenNodes);
      if (action) break;
      if (i + 1 >= tries) return stop(`could not find "${"label" in step ? step.label : step.type}" on the screen`, true);
      await sleep(o.findDelayMs ?? 1200);
      fresh = false;
    }
    const out = await engine.step(action);
    if (out.status !== "ok") return stop(why(out), out.status === "refused" && out.reason.startsWith("action failed"));
    fresh = ACTING.has(step.type); // after an acting step the engine already re-read the screen
  }
  const end = await engine.step({ type: "done", summary: `Macro "${macro.title}" finished` });
  return end.status === "done" ? { ok: true, steps: macro.steps.length } : fail(why(end), false);
}

/** Runs `run` again after a retryable failure; the last failure is returned so the caller can notify the user. */
export async function replayWithRetry(
  run: () => Promise<MacroResult>,
  o: { retries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<MacroResult & { attempts: number }> {
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const max = (o.retries ?? 2) + 1;
  let last: MacroResult = fail("did not run", false);
  for (let attempts = 1; attempts <= max; attempts++) {
    last = await run();
    if (last.ok || !last.retryable || attempts === max) return { ...last, attempts };
    await sleep(o.delayMs ?? 30_000);
  }
  return { ...last, attempts: max };
}
