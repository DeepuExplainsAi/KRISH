import { DEFAULTS, type AgentLimits } from "../config/defaults";
import { formatObservation } from "../page/format";
import type { PageObservation } from "../page/types";
import { isSensitivePage, redactText, secretKind, type SecretKind } from "../privacy/redact";
import { AbortedError } from "../providers/types";
import { AllProvidersFailedError, type ProviderRouter } from "../providers/router";
import { parseAction, type Action } from "../schema/actions";
import { AgentController, raceStop, StoppedError } from "./controller";
import { findLoginFields } from "../vault/vault";
import { gate, sameSite, sandboxWrites, siteOf } from "./policy";
import type { AgentStatus, AgentUI, ChipState, MemoryPort, PageDriver, Sandbox, SelectedFile, VaultPort } from "./ports";
import { SYSTEM_PROMPT } from "./prompt";

export interface AgentOptions {
  task: string;
  /** Persistent memory text (data, not instructions). Used only when `deps.memory` is absent. */
  memory?: string;
  screenshots?: boolean;
  /** Files the user attached to this task (picked in the system picker). The model sees names and sizes only. */
  files?: SelectedFile[];
  limits?: Partial<AgentLimits>;
}

export interface AgentDeps {
  driver: PageDriver;
  router: ProviderRouter;
  ui: AgentUI;
  controller: AgentController;
  sandbox?: Sandbox;
  /** Lets the agent save and forget memory items when the user asks. The MEMORY block is then numbered m1, m2... */
  memory?: MemoryPort;
  /** Saved logins (KrishVault). The app fills them into the login form; the model never sees them. */
  vault?: VaultPort;
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
const fence = (tag: string, body: string) => `<${tag}>\n${body.replace(/<\/?(PAGE_DATA|RESULT_DATA|MEMORY|USER_TASK|USER_REPLY|USER_FILES)>/gi, "")}\n</${tag}>`;

/**
 * A normal question must never collect a secret: it goes to the AI and into history. The agent answers in the user's
 * language, so the terms cover every UI language (en, hi, bn, es, fr, de, pt). Unicode-aware: `\b` is ASCII-only.
 */
const SECRET_TERMS = [
  "password", "passcode", "passphrase", "otp", "one[- ]time", "verification code", "security code", "2fa", "cvv", "cvc", "card number", "pin",
  "पासवर्ड", "पासकोड", "ओटीपी", "वन[- ]टाइम", "सत्यापन कोड", "वेरिफिकेशन कोड", "सुरक्षा कोड", "पिन", "कार्ड नंबर", "सीवीवी",
  "পাসওয়ার্ড", "ওটিপি", "যাচাইকরণ কোড", "ভেরিফিকেশন কোড", "পিন", "কার্ড নম্বর",
  "contraseña", "contrasena", "clave", "código de verificación", "codigo de verificacion", "código de seguridad", "número de tarjeta", "numero de tarjeta",
  "mot de passe", "code de vérification", "code de verification", "code de sécurité", "numéro de carte", "numero de carte", "code pin",
  "passwort", "kennwort", "bestätigungscode", "sicherheitscode", "kartennummer",
  "senha", "código de verificação", "codigo de verificacao", "código de segurança", "número do cartão", "numero do cartao",
];
const SECRET_ASK = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])(?:${SECRET_TERMS.join("|")})(?![\\p{L}\\p{N}\\p{M}])`, "iu");

/** The user's task is about logging in. Without this (or a page the agent itself navigated to) a login form that merely happens to be open is left alone. */
const LOGIN_INTENT = /log[\s-]*(me\s+|us\s+)?(in|on)|sign[\s-]*(me\s+|us\s+)?in|logg?in|vault|लॉग\s?इन|लॉगिन|साइन\s?इन/iu;

/** Model-written step label: single line, no control / bidi / zero-width characters (they can reorder or hide text). */
export const cleanLabel = (s: string) => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();

/**
 * Attached files as the model sees them: a stable id (f1, f2...) is what it selects by, so a hostile or duplicate file name can
 * neither collide nor change the selection. The display name is redacted and cannot contain angle brackets (no fence tags).
 */
function nameFiles(files: SelectedFile[] = []): { id: string; name: string; file: SelectedFile }[] {
  return files.map((file, i) => ({
    id: `f${i + 1}`,
    name: clip(redactText(cleanLabel(file.name).replace(/[<>]/g, "")) || "file", 120),
    file,
  }));
}

const kindOfSecret = (k: SecretKind | undefined): "password" | "otp" | undefined =>
  k === "password" ? "password" : k === "otp" || k === "card" ? "otp" : undefined;

export async function runAgent(opts: AgentOptions, deps: AgentDeps): Promise<AgentResult> {
  const lim = { ...DEFAULTS.agent, ...opts.limits };
  const { driver, router, ui, controller } = deps;
  const signal = controller.signal;
  const history: Turn[] = [];
  const drafts: string[] = [];
  const attached = nameFiles(opts.files);
  const attachedList = attached.map((f) => `${f.id}: ${f.name} (${f.file.size} bytes)`).join("\n");
  let chipId = 0;
  let consecutiveErrors = 0;
  let stalls = 0;
  let lastSig = "";
  let userReply = "";
  let homeUrl = "";
  let step = 0;
  /** Login pages already offered a saved login in this run: one try per page, so a wrong password is never retried in a loop. */
  const vaultTried = new Set<string>();
  const loginAsked = LOGIN_INTENT.test(opts.task);
  let startUrl = "";
  /** Values the app typed into a page for the user (saved logins, secure-card entries). Scrubbed from everything bound for a model. */
  const typed = new Set<string>();
  const scrub = (text: string) => [...typed].reduce((t, v) => t.split(v).join("[REDACTED]"), text);
  let memoryShown: { id: string; text: string }[] = [];

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
      case "memory_add": return "Saving to memory";
      case "memory_remove": return "Removing from memory";
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
        return clip(scrub(redactText(await driver.read(a.elementId))), lim.readMaxChars);
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
        let chosen: ReturnType<typeof nameFiles>[number] | undefined;
        if (attached.length) {
          chosen = a.file ? attached.find((f) => f.id === a.file) : attached.length === 1 ? attached[0] : undefined;
          if (!chosen) return `${a.file ? "no such attached file" : "several files are attached"}; call upload_selected_file again with "file" set to one id:\n${attachedList}`;
        } else {
          const picked = await raceStop(ui.pickFile(signal), signal);
          if (!picked) return "user did not select a file";
          chosen = nameFiles([picked])[0]!;
        }
        const { name, file } = chosen;
        const ok = await raceStop(
          ui.confirm({ kind: "upload", title: `Upload to ${new URL(obs.url).hostname}?`, preview: `${name} (${file.size} bytes)` }, signal),
          signal,
        );
        if (!ok) return "user declined the upload";
        await withHighlight(a.elementId, () => driver.upload(a.elementId, file));
        return `uploaded ${name}`;
      }
      case "run_sandbox_task": {
        if (!deps.sandbox) return "sandbox unavailable";
        const out = await deps.sandbox.run({ tool: a.tool, code: a.code, writesFiles: sandboxWrites(a) }, signal);
        return clip(redactText(out), lim.sandboxOutputMaxChars);
      }
      case "memory_add": {
        if (!deps.memory) return "memory unavailable";
        const text = clip(redactText(a.text), 500);
        if (!(await raceStop(ui.confirm({ kind: "memory", title: "Remember this?", preview: text }, signal), signal))) return "user declined; nothing was saved";
        await deps.memory.add(text);
        return `saved to memory: ${text}`;
      }
      case "memory_remove": {
        if (!deps.memory) return "memory unavailable";
        const picked = a.ids.map((key) => ({ key, item: memoryShown[Number(key.slice(1)) - 1] }));
        const unknown = picked.filter((p) => !p.item).map((p) => p.key);
        if (unknown.length) return `no such memory item: ${unknown.join(", ")}; ids must come from MEMORY. Nothing was removed.`;
        const chosen = [...new Map(picked.map((p) => [p.item!.id, p.item!])).values()];
        const preview = chosen.map((m) => `- ${m.text}`).join("\n");
        if (!(await raceStop(ui.confirm({ kind: "memory", title: "Forget this?", preview }, signal), signal))) return "user declined; nothing was removed";
        for (const m of chosen) await deps.memory.remove(m.id);
        return `removed from memory:\n${preview}`;
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
      if (SECRET_ASK.test(a.question)) return "blocked: never ask for a secret in a normal question; use ask_user with secure input on the field";
      const reply = await raceStop(ui.ask(a.question, signal), signal);
      if (reply === undefined) return "user cancelled the question";
      userReply = redactText(reply);
      return "user replied (see USER_REPLY)";
    }
    if (a.secure.kind === "captcha") {
      await raceStop(ui.takeOver("CAPTCHA: please solve it, then tap Resume", signal), signal);
      return "user handled the CAPTCHA";
    }
    // An explicit id must resolve exactly and be a secret field; there is no silent fallback to another element.
    const requested = a.secure.elementId;
    const field = requested !== undefined ? obs.elements.find((e) => e.id === requested) : obs.elements.find((e) => kindOfSecret(secretKind(e)) !== undefined);
    if (!field) return "no matching field on this page; read the page again";
    if (kindOfSecret(secretKind(field)) === undefined) return "blocked: that field is not a secret field";
    const value = await raceStop(
      ui.askSecure({ kind: a.secure.kind, title: a.question, site: new URL(obs.url).hostname, field: clip(field.label ?? field.name ?? field.placeholder ?? field.tag, 60) }, signal),
      signal,
    );
    if (value === undefined) return "user cancelled secure input";
    try {
      if (value.length >= 3) typed.add(value);
      await driver.fillSecret(field.id, value); // value is never stored, logged or sent to a model
    } catch {
      // Page-originated error text could echo the value (a hostile page can hook setters), so it is never passed on.
      return "could not fill the field; the page may have changed. Try again or ask the user to take over";
    }
    return "the user entered the value; it was filled into the page (not visible to you)";
  }

  /** One offer per login page (query and fragment ignored) and at most 3 per run, so a page that rewrites its URL cannot make the agent ask forever. */
  const pageKey = (url: string) => { const u = new URL(url); return `${u.origin}${u.pathname}`; };

  /**
   * Fills a saved login into the login form, with the user's OK. The app does it natively: the model sees only that it happened.
   * Returns true when something was done (re-observe). Before filling, the page is looked at again: the unlock and confirm cards can
   * take a long time and the page may have moved on, so the fields and the site are re-checked against the page that is live now.
   */
  async function autofillLogin(obs: PageObservation): Promise<boolean> {
    const vault = deps.vault;
    const form = vault?.exists ? findLoginFields(obs.elements) : undefined;
    if (!vault || !form || !sameSite(obs.url, homeUrl) || vaultTried.has(pageKey(obs.url)) || vaultTried.size >= 3) return false;
    if (!loginAsked && obs.url === startUrl) return false; // an unrelated task (e.g. "remember this") never triggers a login
    vaultTried.add(pageKey(obs.url));
    const host = new URL(obs.url).hostname;
    if (!vault.unlocked) {
      const pass = await raceStop(ui.askSecure({ kind: "password", title: "Unlock KrishVault to use your saved login", site: "KrishVault", field: "Master passphrase" }, signal), signal);
      if (pass === undefined || !(await vault.unlock(pass))) {
        history.push({ action: "KrishVault autofill", result: "KrishVault stayed locked; no saved login was used" });
        return false;
      }
    }
    const logins = vault.logins(obs.url);
    const chosen = logins[0];
    if (!chosen) return false;
    const who = logins.length > 1 ? `${chosen.label} (${chosen.username}); ${logins.length - 1} more saved` : `${chosen.label} (${chosen.username})`;
    const ok = await raceStop(ui.confirm({ kind: "vault", title: `Fill your saved login on ${host}?`, preview: who }, signal), signal);
    if (!ok) {
      history.push({ action: "KrishVault autofill", result: "user declined the saved login" });
      return false;
    }
    const id = chip("Filling saved login", "running");
    const abort = (why: string) => {
      chip("Filling saved login", "error", id);
      history.push({ action: "KrishVault autofill", result: why });
      return true;
    };
    try {
      const live = await driver.observe();
      const liveForm = findLoginFields(live.elements);
      // Credentials are read from the vault only now, and only if it is still unlocked and the live page is the approved site.
      const login = vault.unlocked && sameSite(live.url, homeUrl) ? vault.logins(live.url).find((e) => e.id === chosen.id) : undefined;
      if (!liveForm || !login) return abort("the page changed or KrishVault was locked before the login could be filled; nothing was filled");
      for (const v of [login.username, login.password]) if (v.length >= 3) typed.add(v);
      if (liveForm.username && login.username) await driver.fillSecret(liveForm.username.id, login.username);
      await driver.fillSecret(liveForm.password.id, login.password);
    } catch {
      return abort("could not fill the form; the page may have changed");
    }
    chip("Filling saved login", "done", id);
    history.push({ action: "KrishVault autofill", result: "the saved username and password were filled into the login form (not visible to you). Submit the form next." });
    return true;
  }

  try {
    for (; step < lim.maxSteps; ) {
      await controller.whenRunning();
      if (signal.aborted) throw new StoppedError();

      const obs = await driver.observe();
      homeUrl ||= obs.url;
      startUrl ||= obs.url;
      if (await autofillLogin(obs)) continue;
      const sensitive = isSensitivePage(obs);
      const text = formatObservation(obs);
      // The numbers the model sees are fixed for this step, so "m2" always means the line it read.
      memoryShown = deps.memory ? await deps.memory.list() : [];
      const memoryText = deps.memory ? memoryShown.map((m, i) => `m${i + 1}: ${m.text}`).join("\n") : opts.memory;
      const turns = history.slice(-DEFAULTS.agent.historyWindow).map((t, i) => `${i + 1}. ${t.action}\n   -> ${fence("RESULT_DATA", t.result)}`);
      const prompt = scrub([
        fence("USER_TASK", redactText(opts.task)),
        memoryText ? fence("MEMORY", memoryText) : "",
        attached.length ? fence("USER_FILES", attachedList) : "",
        userReply ? fence("USER_REPLY", userReply) : "",
        turns.length ? `Previous steps:\n${turns.join("\n")}` : "",
        fence("PAGE_DATA", text),
      ].filter(Boolean).join("\n\n"));
      userReply = "";

      let action: Action;
      try {
        const run = await router.run(
          [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt, imageDataUrl: opts.screenshots && !sensitive && typed.size === 0 ? obs.screenshotDataUrl : undefined },
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

      const verdict = gate(action, { obs, homeUrl, drafts });
      // Display-only (the policy gate never reads it). The model's own status line follows the user's language, but only
      // for steps that need no approval: a step that asks, confirms or is blocked keeps the app's fixed wording, and
      // secure-input steps always say "Action required", so model text can never dress up a trusted prompt.
      const thought = verdict.verdict === "allow" && !(action.type === "ask_user" && action.secure) ? cleanLabel(action.thought ?? "") : "";
      const label = thought ? clip(redactText(thought), 80) : describe(action, obs);
      // A plain answer (done as the very first step) is just chat text: no step pill for it.
      const plainAnswer = action.type === "done" && step === 1;
      const id = plainAnswer ? 0 : chip(label, action.type === "ask_user" && action.secure ? "action_required" : "running");
      const actionText = redactText(JSON.stringify(action.type === "type" || action.type === "paste" ? { ...action, text: clip(action.text, 200) } : action));

      if (action.type === "done") {
        if (!plainAnswer) chip(label, "done", id);
        ui.emit({ type: "action", step, action, result: action.summary });
        return finish("done", action.summary);
      }

      let result: string;
      let failed = false;
      try {
        if (verdict.verdict === "block") {
          result = `blocked: ${verdict.reason}`;
          failed = true;
        } else if (verdict.verdict === "confirm" && !(await raceStop(ui.confirm(verdict.request, signal), signal))) {
          result = "user declined this action; ask what to change or finish";
        } else {
          if (verdict.verdict === "confirm" && verdict.request.kind === "navigate") homeUrl = verdict.request.preview; // previews of navigate confirmations are URLs
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
