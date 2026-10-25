import { DEFAULTS, type AgentLimits } from "../config/defaults";
import { formatObservation } from "../page/format";
import type { PageObservation } from "../page/types";
import { isSensitivePage, redactText, secretKind, type SecretKind } from "../privacy/redact";
import { AbortedError } from "../providers/types";
import { AllProvidersFailedError, type ProviderRouter } from "../providers/router";
import { parseAction, type Action } from "../schema/actions";
import { AgentController, raceStop, StoppedError } from "./controller";
import { gate, siteOf } from "./policy";
import type { AgentStatus, AgentUI, ChipState, PageDriver, Sandbox } from "./ports";
import { SYSTEM_PROMPT } from "./prompt";

export interface AgentOptions {
  task: string;
  /** Persistent memory text (data, not instructions). */
  memory?: string;
  screenshots?: boolean;
  limits?: Partial<AgentLimits>;
}

export interface AgentDeps {
  driver: PageDriver;
  router: ProviderRouter;
  ui: AgentUI;
  controller: AgentController;
  sandbox?: Sandbox;
}

export interface AgentResult {
  status: AgentStatus;
  summary: string;
  steps: number;
}

interface Turn {
  action: string;
  result: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** Stops data from closing its own delimiter block. */
const fence = (tag: string, body: string) => `<${tag}>\n${body.replace(/<\/?(PAGE_DATA|RESULT_DATA|MEMORY|USER_TASK|USER_REPLY)>/gi, "")}\n</${tag}>`;

const kindOfSecret = (k: SecretKind | undefined): "password" | "otp" | undefined =>
  k === "password" ? "password" : k === "otp" || k === "card" ? "otp" : undefined;

export async function runAgent(opts: AgentOptions, deps: AgentDeps): Promise<AgentResult> {
  const lim = { ...DEFAULTS.agent, ...opts.limits };
  const { driver, router, ui, controller } = deps;
  const signal = controller.signal;
  const history: Turn[] = [];
  const drafts: string[] = [];
  let chipId = 0;
  let consecutiveErrors = 0;
  let stalls = 0;
  let lastSig = "";
  let userReply = "";
  let homeUrl = "";
  let step = 0;

  const chip = (label: string, state: ChipState, id = ++chipId) => {
    ui.emit({ type: "chip", id, label, state });
    return id;
  };

  const finish = (status: AgentStatus, summary: string): AgentResult => {
    ui.emit({ type: "end", status, summary });
    return { status, summary, steps: step };
  };

  const describe = (a: Action, obs: PageObservation): string => {
    const el = "elementId" in a && a.elementId !== undefined ? obs.elements.find((e) => e.id === a.elementId) : undefined;
    const name = el ? redactText((el.label ?? el.text ?? el.name ?? "").trim()).slice(0, 40) : "";
    switch (a.type) {
      case "navigate": return `Opening ${siteOf(a.url) ?? "a page"}`;
      case "read": return "Reading a page";
      case "click": return name ? `Clicking “${name}”` : "Clicking";
      case "type": return name ? `Typing in “${name}”` : "Typing";
      case "paste": return "Pasting text";
      case "upload_selected_file": return "Uploading a file";
      case "run_sandbox_task": return "Running a sandbox task";
      case "wait": return "Waiting";
      case "ask_user": return a.secure ? "Action required" : "Asking you";
      case "done": return "Finished";
    }
  };

  async function execute(a: Action, obs: PageObservation): Promise<string> {
    const withHighlight = async <T>(id: number, fn: () => Promise<T>): Promise<T> => {
      await driver.highlight(id);
      try {
        return await fn();
      } finally {
        await driver.highlight(undefined);
      }
    };
    switch (a.type) {
      case "navigate":
        await driver.navigate(a.url);
        return `navigated to ${redactText(a.url)}`;
      case "read":
        return clip(redactText(await driver.read(a.elementId)), lim.readMaxChars);
      case "click":
        await withHighlight(a.elementId, () => driver.click(a.elementId));
        drafts.length = 0;
        return "clicked";
      case "type":
        await withHighlight(a.elementId, () => driver.type(a.elementId, a.text, a.submit));
        if (a.submit) drafts.length = 0;
        else drafts.push(a.text);
        return "typed";
      case "paste":
        await withHighlight(a.elementId, () => driver.paste(a.elementId, a.text));
        drafts.push(a.text);
        return "pasted";
      case "upload_selected_file": {
        const file = await raceStop(ui.pickFile(signal), signal);
        if (!file) return "user did not select a file";
        const ok = await raceStop(
          ui.confirm({ kind: "upload", title: `Upload to ${new URL(obs.url).hostname}?`, preview: `${file.name} (${file.size} bytes)` }, signal),
          signal,
        );
        if (!ok) return "user declined the upload";
        await withHighlight(a.elementId, () => driver.upload(a.elementId, file));
        return `uploaded ${file.name}`;
      }
      case "run_sandbox_task": {
        if (!deps.sandbox) return "sandbox unavailable";
        const out = await deps.sandbox.run({ tool: a.tool, code: a.code, writesFiles: a.writesFiles }, signal);
        return clip(redactText(out), lim.sandboxOutputMaxChars);
      }
      case "wait":
        await new Promise((r) => setTimeout(r, a.ms));
        return `waited ${a.ms} ms`;
      case "ask_user":
        return askUser(a, obs);
      case "done":
        return a.summary;
    }
  }

  async function askUser(a: Extract<Action, { type: "ask_user" }>, obs: PageObservation): Promise<string> {
    if (!a.secure) {
      const reply = await raceStop(ui.ask(a.question, signal), signal);
      if (reply === undefined) return "user cancelled the question";
      userReply = reply;
      return "user replied (see USER_REPLY)";
    }
    if (a.secure.kind === "captcha") {
      await raceStop(ui.takeOver("CAPTCHA: please solve it, then tap Resume", signal), signal);
      return "user handled the CAPTCHA";
    }
    const field =
      obs.elements.find((e) => e.id === a.secure?.elementId) ??
      obs.elements.find((e) => kindOfSecret(secretKind(e)) !== undefined);
    if (!field) return "no secret field found on this page";
    const value = await raceStop(ui.askSecure({ kind: a.secure.kind, title: a.question }, signal), signal);
    if (value === undefined) return "user cancelled secure input";
    await driver.fillSecret(field.id, value); // value is never stored, logged or sent to a model
    return "the user entered the value; it was filled into the page (not visible to you)";
  }

  try {
    for (; step < lim.maxSteps; ) {
      await controller.whenRunning();
      if (signal.aborted) throw new StoppedError();

      const obs = await driver.observe();
      homeUrl ||= obs.url;
      const sensitive = isSensitivePage(obs);
      const text = formatObservation(obs);
      const turns = history.slice(-DEFAULTS.agent.historyWindow).map((t, i) => `${i + 1}. ${t.action}\n   -> ${fence("RESULT_DATA", t.result)}`);
      const prompt = [
        fence("USER_TASK", opts.task),
        opts.memory ? fence("MEMORY", opts.memory) : "",
        userReply ? fence("USER_REPLY", userReply) : "",
        turns.length ? `Previous steps:\n${turns.join("\n")}` : "",
        fence("PAGE_DATA", text),
      ].filter(Boolean).join("\n\n");
      userReply = "";

      let action: Action;
      try {
        const run = await router.run(
          [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt, imageDataUrl: opts.screenshots && !sensitive ? obs.screenshotDataUrl : undefined },
          ],
          parseAction,
          { sensitive, signal },
        );
        action = run.value;
        ui.emit({ type: "provider", providerId: run.providerId, model: run.model });
      } catch (e) {
        if (e instanceof AbortedError) throw new StoppedError();
        if (e instanceof AllProvidersFailedError) {
          const blockedBySensitive = e.attempts.some((a) => a.detail === "sensitive page not allowed");
          if (sensitive && blockedBySensitive) {
            const id = chip("Action required", "action_required");
            await raceStop(ui.takeOver("This page looks sensitive and no provider is allowed on it. Act yourself, then tap Resume.", signal), signal);
            chip("Action required", "done", id);
            continue;
          }
          return finish("failed", e.message);
        }
        throw e;
      }
      step += 1;

      const label = describe(action, obs);
      const id = chip(label, action.type === "ask_user" && action.secure ? "action_required" : "running");
      const actionText = JSON.stringify(action.type === "type" || action.type === "paste" ? { ...action, text: clip(action.text, 200) } : action);

      if (action.type === "done") {
        chip(label, "done", id);
        ui.emit({ type: "action", step, action, result: action.summary });
        return finish("done", action.summary);
      }

      const verdict = gate(action, { obs, homeUrl, drafts });
      let result: string;
      let failed = false;
      try {
        if (verdict.verdict === "block") {
          result = `blocked: ${verdict.reason}`;
          failed = true;
        } else if (verdict.verdict === "confirm" && !(await raceStop(ui.confirm(verdict.request, signal), signal))) {
          result = "user declined this action; ask what to change or finish";
        } else {
          if (verdict.verdict === "confirm" && verdict.request.kind === "navigate" && action.type === "navigate") homeUrl = action.url;
          result = await execute(action, obs);
        }
      } catch (e) {
        if (e instanceof StoppedError) throw e;
        result = `error: ${e instanceof Error ? redactText(e.message) : "action failed"}`;
        failed = true;
      }

      chip(label, failed ? "error" : "done", id);
      ui.emit({ type: "action", step, action, result });
      history.push({ action: actionText, result });

      consecutiveErrors = failed ? consecutiveErrors + 1 : 0;
      const sig = `${obs.url}|${obs.text.length}|${actionText}`;
      stalls = sig === lastSig ? stalls + 1 : 0;
      lastSig = sig;

      if (consecutiveErrors >= lim.maxConsecutiveErrors || stalls >= lim.maxStalls) {
        const why = consecutiveErrors >= lim.maxConsecutiveErrors ? "repeated errors" : "no progress";
        const reply = await raceStop(ui.ask(`I'm stuck (${why}). What should I do? Leave empty to stop.`, signal), signal);
        if (!reply?.trim()) return finish("failed", `stopped: ${why}`);
        userReply = reply;
        consecutiveErrors = 0;
        stalls = 0;
      }
    }
    return finish("max_steps", `step limit (${lim.maxSteps}) reached`);
  } catch (e) {
    if (e instanceof StoppedError) return finish("stopped", "stopped by user");
    return finish("failed", e instanceof Error ? redactText(e.message) : "unexpected error");
  } finally {
    await driver.highlight(undefined).catch(() => undefined);
  }
}
