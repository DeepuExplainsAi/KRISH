import { DEFAULTS, type AgentLimits } from "../config/defaults";
import { formatObservation } from "../page/format";
import type { PageElement, PageObservation } from "../page/types";
import { redactText, secretKind, type SecretKind } from "../privacy/redact";
import { AbortedError } from "../providers/types";
import type { ProviderRouter } from "../providers/router";
import { parseReply, type Action } from "../schema/actions";
import { AgentController, raceStop, StoppedError } from "./controller";
import { findLoginFields, findLoginWall, findSignInButton } from "../vault/vault";
import { gate, sandboxWrites, siteOf } from "./policy";
import type { AgentStatus, AgentUI, ChipState, MemoryPort, PageDriver, Sandbox, SelectedFile, VaultPort } from "./ports";
import { SYSTEM_PROMPT } from "./prompt";

export interface AgentOptions {
  task: string;
  /** Persistent memory text (data, not instructions). Used only when `deps.memory` is absent. */
  memory?: string;
  screenshots?: boolean;
  /** Files the user attached to this task (picked in the system picker). The model sees names and sizes only. */
  files?: SelectedFile[];
  /** True when the app opened a page for this task (saved task, panel). Otherwise the agent starts without a page and opens one itself, so a plain chat never touches the browser. */
  startOnPage?: boolean;
  /** One line about a tab the user left open ("site: title"). The model sees only this line until it chooses to read the tab. */
  openTab?: string;
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
  /** Saved logins (KrishVault). The app fills them into the login form on its own; the model never sees them. */
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

/** Sign-in steps one run handles (each page and step is tried once, so a wrong password is never retried in a loop). */
const MAX_LOGIN_TRIES = 6;
/** What the agent sees while it has no page open. */
const NO_PAGE: PageObservation = { url: "", title: "", text: "", elements: [] };
const noPageText = (openTab?: string) =>
  `No page is open for this task. Answer directly if you can. If the task needs a website, navigate to it.${openTab ? ` The user has this tab open (not read yet): ${openTab}. Use read only if the task is about that tab.` : ""}`;
const BROWSER_ACTIONS = new Set<Action["type"]>(["navigate", "read", "click", "type", "paste", "scroll", "upload_selected_file"]);

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

/** Words in the task that name a saved login ("log in with this gmail", "use deepu's account"): the best match among the site's logins goes first. */
export function pickLogin<T extends { label: string; username: string }>(logins: T[], task: string): T | undefined {
  const text = task.toLowerCase();
  const words = text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const score = (e: T) => {
    const user = e.username.toLowerCase();
    const hay = `${e.label} ${user}`.toLowerCase();
    return (user && text.includes(user) ? 100 : 0) + words.filter((w) => hay.includes(w)).length;
  };
  return logins.reduce<T | undefined>((best, e) => (best === undefined || score(e) > score(best) ? e : best), undefined);
}

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
  const attached = nameFiles(opts.files);
  const attachedList = attached.map((f) => `${f.id}: ${f.name} (${f.file.size} bytes)`).join("\n");
  let chipId = 0;
  let consecutiveErrors = 0;
  let stalls = 0;
  let lastSig = "";
  let userReply = "";
  let step = 0;
  /** False until the task needs a page: the app's page (maybe an old tab) is neither read nor shown to the model before that. */
  let pageLive = Boolean(opts.startOnPage);
  /** Login steps already handled in this run: one try per page and step, so a wrong password is never retried in a loop. */
  const loginTried = new Set<string>();
  /** Values the app typed into a page for the user (saved logins, secure-card entries). Scrubbed from everything bound for a model. */
  const typed = new Set<string>();
  const scrub = (text: string) => [...typed].reduce((t, v) => t.split(v).join("[REDACTED]"), text);
  /** For everything shown or stored (chips, events, history, results): the generic redaction plus the values the app typed itself. */
  const safe = (text: string) => scrub(redactText(text));
  /** The model's action as shown to the UI: every string in it is scrubbed (the model may have copied a value from an echoing page). */
  const scrubAction = (a: Action): Action => {
    const walk = (v: unknown): unknown => (typeof v === "string" ? scrub(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
    return walk(a) as Action;
  };
  /** The login steps are several awaits long: STOP must be honoured between them, never after a fill or click that was still pending. */
  const alive = () => {
    if (signal.aborted) throw new StoppedError();
  };
  /** Values shorter than 3 characters are not scrubbed: replacing every "a" in a page would destroy it. */
  const remember = (...values: string[]) => values.forEach((v) => v.length >= 3 && typed.add(v));
  let memoryShown: { id: string; text: string }[] = [];

  const chip = (label: string, state: ChipState, id = ++chipId) => {
    ui.emit({ type: "chip", id, label, state });
    return id;
  };

  const finish = (status: AgentStatus, text: string): AgentResult => {
    const summary = safe(text);
    ui.emit({ type: "end", status, summary });
    return { status, summary, steps: step };
  };

  const describe = (a: Action, obs: PageObservation): string => {
    const el = "elementId" in a && a.elementId !== undefined ? obs.elements.find((e) => e.id === a.elementId) : undefined;
    const name = el ? safe((el.label ?? el.text ?? el.name ?? "").trim()).slice(0, 40) : "";
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
      case "scroll": return a.direction === "down" ? "Scrolling down" : "Scrolling up";
      case "ask_user": return a.secure ? "Waiting for you" : "Asking you";
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
        return "clicked";
      case "type":
        await withHighlight(a.elementId, () => driver.type(a.elementId, a.text, a.submit));
        return "typed";
      case "paste":
        await withHighlight(a.elementId, () => driver.paste(a.elementId, a.text));
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
        for (const m of chosen) await deps.memory.remove(m.id);
        return `removed from memory:\n${preview}`;
      }
      case "scroll":
        await driver.scroll(a.direction);
        return `scrolled ${a.direction}`;
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
      await raceStop(ui.solveCaptcha("Solve the CAPTCHA in the page, then tap Done.", signal), signal);
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
      remember(value);
      await driver.fillSecret(field.id, value); // value is never stored, logged or sent to a model
    } catch {
      // Page-originated error text could echo the value (a hostile page can hook setters), so it is never passed on.
      return "could not fill the field; the page may have changed. Try again or ask the user";
    }
    return "the user entered the value; it was filled into the page (not visible to you)";
  }

  /** One login step: the page without query and fragment, and whether it is the email step or the password step. */
  const loginKey = (url: string, form: boolean) => {
    try { const u = new URL(url); return `${u.origin}${u.pathname}|${form ? "pw" : "email"}`; } catch { return url; }
  };

  const filledResult = (who: "saved" | "user", withPassword: boolean, sent: "sent" | "unsure" | "none") =>
    `the ${who === "saved" ? "saved" : "user's"} ${withPassword ? "username and password were" : "email was"} filled into the login form (not visible to you)` +
    (sent === "sent" ? " and the form was sent. Look at the page: if it asks for another step, continue; the app fills sign-in fields itself. Do not click the button again unless the page still shows the form."
      : sent === "unsure" ? ". The app tried to send the form but is not sure it went out. Look at the page before clicking anything."
      : ". Click the page's sign-in button next.");

  /** Logins whose password the app already sent this run (site|username): a rejected password is never sent again by the app. */
  const passwordSent = new Set<string>();

  /**
   * After a login form was filled: the app sends it itself (Log in / Continue), choosing only a button of that form.
   * "sent" = a click went out; "unsure" = the click threw, so it may or may not have gone out; "none" = no confident button.
   */
  async function submitLogin(near: PageElement | undefined): Promise<"sent" | "unsure" | "none"> {
    alive();
    let button: PageElement | undefined;
    try {
      button = findSignInButton((await driver.observe()).elements, near?.form);
    } catch {
      return "none";
    }
    if (!button) return "none";
    alive();
    try {
      await driver.click(button.id);
      return "sent";
    } catch {
      alive();
      return "unsure";
    }
  }

  /**
   * No saved login for this site: the user gets the sign-in card once (email and password, or Google). The app types the values into
   * the page and keeps the login for good, so the next visit needs nothing. The model only learns that it happened.
   */
  async function askLoginCard(obs: PageObservation, host: string): Promise<boolean> {
    const form = findLoginFields(obs.elements);
    const wall = form ? undefined : findLoginWall(obs);
    const userField = form?.username ?? wall?.username;
    if (!form && !wall) return false;
    const googleButton = wall?.google ?? obs.elements.find((e) => !e.disabled && (e.tag === "button" || e.tag === "a" || e.role === "button") && /google/i.test([e.text, e.label, e.title, e.name].filter(Boolean).join(" ")));
    const answer = await raceStop(ui.askLogin({ site: host, google: Boolean(googleButton) }, signal), signal);
    alive();
    if (!answer) {
      history.push({ action: "sign-in card", result: "the user closed the sign-in card without signing in; ask what to do, or finish" });
      return true;
    }
    const id = chip("Signing in", "running");
    try {
      if ("google" in answer) {
        if (!googleButton) throw new Error("no Google button");
        await driver.click(googleButton.id);
        chip("Signing in", "done", id);
        history.push({ action: "sign-in card", result: "the user chose Google; its button was clicked. Continue on the Google page." });
        return true;
      }
      remember(answer.username, answer.password);
      if (userField && answer.username) await driver.fillSecret(userField.id, answer.username);
      alive();
      if (form) await driver.fillSecret(form.password.id, answer.password);
    } catch (e) {
      if (e instanceof StoppedError) throw e;
      chip("Signing in", "error", id);
      history.push({ action: "sign-in card", result: "could not fill the form; the page may have changed" });
      return true;
    }
    try {
      await deps.vault?.put({ site: host, username: answer.username, password: answer.password, label: host });
    } catch {
      chip("Could not save the login", "error");
    }
    if (form) passwordSent.add(`${host}|${answer.username}`);
    const sent = await submitLogin(form?.password ?? userField);
    chip("Signing in", "done", id);
    history.push({ action: "sign-in card", result: filledResult("user", form !== undefined, sent) });
    return true;
  }

  /**
   * Fills the saved login for this site into the login form, silently. The app does it natively: the model sees only that it
   * happened. Logins are matched by site, so a password only ever goes to the site it was saved for.
   * Returns true when something was done (look at the page again).
   */
  async function autofillLogin(obs: PageObservation): Promise<boolean> {
    const form = findLoginFields(obs.elements);
    const wall = form ? undefined : findLoginWall(obs); // email-first page: no password field yet
    if (!form && !wall) return false;
    const key = loginKey(obs.url, Boolean(form));
    if (loginTried.has(key) || loginTried.size >= MAX_LOGIN_TRIES) return false;
    loginTried.add(key);
    const host = new URL(obs.url).hostname;
    const chosen = pickLogin(deps.vault?.logins(obs.url) ?? [], opts.task);
    if (!chosen) {
      // "Continue with Google" with a saved Google login: no card, the Google page is filled by the app next.
      const google = wall?.google ?? obs.elements.find((e) => !e.disabled && /continue with google|sign in with google/i.test([e.text, e.label, e.title].filter(Boolean).join(" ")));
      if (google && deps.vault?.logins("https://accounts.google.com").length) {
        alive();
        await driver.click(google.id);
        history.push({ action: "KrishVault autofill", result: "Continue with Google was clicked (a Google login is saved). Continue on the Google page." });
        return true;
      }
      return askLoginCard(obs, host);
    }
    // The app already sent this account's password in this run and the site is showing the form again: it was rejected. Do not repeat it.
    const account = `${host}|${chosen.username}`;
    if (form && passwordSent.has(account)) return false;
    const id = chip("Filling saved login", "running");
    try {
      const userField = form?.username ?? wall?.username;
      remember(chosen.username, form ? chosen.password : "");
      alive();
      if (userField && chosen.username) await driver.fillSecret(userField.id, chosen.username);
      alive();
      if (form) await driver.fillSecret(form.password.id, chosen.password);
    } catch (e) {
      if (e instanceof StoppedError) throw e;
      chip("Filling saved login", "error", id);
      history.push({ action: "KrishVault autofill", result: "could not fill the form; the page may have changed" });
      return true;
    }
    if (form) passwordSent.add(account);
    const sent = await submitLogin(form?.password ?? form?.username ?? wall?.username);
    chip("Filling saved login", "done", id);
    history.push({ action: "KrishVault autofill", result: filledResult("saved", form !== undefined, sent) });
    return true;
  }

  try {
    for (; step < lim.maxSteps; ) {
      if (signal.aborted) throw new StoppedError();

      const obs = pageLive ? await driver.observe() : NO_PAGE;
      if (pageLive && (await autofillLogin(obs))) continue;
      const text = pageLive ? formatObservation(obs) : noPageText(opts.openTab ? redactText(opts.openTab) : undefined);
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
            { role: "user", content: prompt, imageDataUrl: opts.screenshots && typed.size === 0 ? obs.screenshotDataUrl : undefined },
          ],
          (raw) => parseReply(raw, step === 0),
          { signal },
        );
        action = run.value;
        ui.emit({ type: "provider", providerId: run.providerId, model: run.model });
      } catch (e) {
        if (e instanceof AbortedError) throw new StoppedError();
        throw e;
      }
      step += 1;

      const verdict = gate(action, obs);
      // Display-only (the policy gate never reads it). The model's own status line follows the user's language, except for
      // blocked steps and secure-input steps, which keep the app's fixed wording so model text can never dress up a trusted prompt.
      const thought = verdict.verdict === "allow" && !(action.type === "ask_user" && action.secure) ? cleanLabel(action.thought ?? "") : "";
      const label = thought ? clip(safe(thought), 80) : describe(action, obs);
      // A plain answer (done as the very first step) is just chat text: no step pill for it.
      const plainAnswer = action.type === "done" && step === 1;
      const id = plainAnswer ? 0 : chip(label, action.type === "ask_user" && action.secure ? "action_required" : "running");
      const actionText = redactText(JSON.stringify(action.type === "type" || action.type === "paste" ? { ...action, text: clip(action.text, 200) } : action));

      if (action.type === "done") {
        if (!plainAnswer) chip(label, "done", id);
        ui.emit({ type: "action", step, action: scrubAction(action), result: safe(action.summary) });
        return finish("done", action.summary);
      }

      // Without a page, "read" means "look at the tab the user has open". Only a tab that exists can be looked at.
      const openingTab = !pageLive && action.type === "read" && action.elementId === undefined && verdict.verdict === "allow";
      if (openingTab && opts.openTab) {
        pageLive = true;
        ui.emit({ type: "browser" });
        chip(label, "done", id);
        history.push({ action: actionText, result: "now looking at the tab the user has open" });
        continue;
      }

      let result: string;
      let failed = false;
      try {
        if (verdict.verdict === "block") {
          result = `blocked: ${verdict.reason}`;
          failed = true;
        } else if (openingTab) {
          result = "blocked: no page is open; navigate to a site first";
          failed = true;
        } else {
          if (BROWSER_ACTIONS.has(action.type)) ui.emit({ type: "browser" });
          const openUrl = !pageLive && action.type === "navigate" ? action.url : undefined;
          result = await execute(action, obs);
          // Only a page that really opened becomes the page the agent reads; a failed navigation leaves the old tab alone.
          if (openUrl) pageLive = true;
        }
      } catch (e) {
        if (e instanceof StoppedError) throw e;
        result = `error: ${e instanceof Error ? safe(e.message) : "action failed"}`;
        failed = true;
      }

      result = scrub(result);
      chip(label, failed ? "error" : "done", id);
      ui.emit({ type: "action", step, action: scrubAction(action), result });
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
    return finish("failed", e instanceof Error ? e.message : "unexpected error");
  } finally {
    if (pageLive) await driver.highlight(undefined).catch(() => undefined); // a plain chat never touches the browser, not even to clean up
  }
}
