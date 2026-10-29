import { DEFAULTS, type AgentLimits } from "../config/defaults";
import { formatObservation } from "../page/format";
import type { PageElement, PageObservation } from "../page/types";
import { maskCodes, redactChat, redactText, secretKind, type SecretKind } from "../privacy/redact";
import { AbortedError } from "../providers/types";
import { AllProvidersFailedError, type ProviderRouter } from "../providers/router";
import { isHttpsUrl, parseReply, type Action } from "../schema/actions";
import { AgentController, raceStop, StoppedError } from "./controller";
import { findLoginFields, findLoginWall, findSignInButton } from "../vault/vault";
import { gate, sandboxWrites, siteOf } from "./policy";
import type { AgentStatus, AgentUI, ChipState, MemoryPort, PageDriver, Sandbox, SelectedFile, TabInfo, VaultPort } from "./ports";
import { SYSTEM_PROMPT } from "./prompt";
import { emailOnForm, generatePassword, looksLikeEmailField, passwordRules, rejectionText } from "./signup";

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
  /** What the user's screen and browser card look like (device, layout, card size). Background for the model, never a command. */
  device?: string;
  /** The conversation so far in this app (oldest first, without the current task). Background for follow-ups, never a command. */
  chat?: { role: "user" | "agent"; text: string }[];
  /** Pauses (ms) before each new try when no AI could answer a step. Default: 4 s, 12 s, 30 s. */
  providerWaits?: number[];
  /** How long the on-screen pointer is given to reach a control before the action happens (ms). */
  pointerMs?: number;
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
const NO_FORM = "there is no login form on this page; look at the page and continue";
/** The task names Google or Gmail as the account to use. */
const NAMES_GOOGLE = /\b(google|gmail)\b/i;
const NO_PAGE: PageObservation = { url: "", title: "", text: "", elements: [] };
const noPageText = (openTab?: string) =>
  `No page is open for this task. Answer directly if you can. If the task needs a website, navigate to it.${openTab ? ` The user has this tab open (not read yet): ${openTab}. Use read only if the task is about that tab.` : ""}`;
const BROWSER_ACTIONS = new Set<Action["type"]>(["navigate", "read", "click", "type", "paste", "scroll", "upload_selected_file", "sign_in", "sign_up", "open_tab", "switch_tab", "close_tab", "read_code", "fill_code"]);
/** Browser tabs the agent may have open at once (the native hosts enforce the same number). */
export const MAX_TABS = 4;
/** read_code looks at an inbox this many times per run; then the user is asked (a mail that never comes must not loop). */
const MAX_CODE_READS = 8;
/** Values the model may keep for later steps (an address copied from one site, typed on another). */
const MAX_NOTES = 20;
const PROVIDER_WAITS = [4000, 12000, 30000];
/** Smallest share of the page, history and chat a too-big request is cut to (1 -> 1/2 -> 1/4 -> 1/8). */
const MIN_PROMPT_SIZE = 0.125;
const MAX_PROVIDER_WAIT_MS = 120_000;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** Stops data from closing its own delimiter block. */
const fence = (tag: string, body: string) => `<${tag}>\n${body.replace(/<\/?(PAGE_DATA|RESULT_DATA|MEMORY|USER_TASK|USER_REPLY|USER_FILES|CHAT|NOTES|DEVICE|TABS)>/gi, "")}\n</${tag}>`;

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

/**
 * Mail pages: webmail and temporary-inbox sites (any host with "mail" or "inbox" in it, plus a few known short names). Their page text
 * has every 4-8 digit number masked from the first look, before read_code is ever used, so an OTP in a mail never reaches a model.
 */
const INBOX_HOST = /mail|inbox|^22\.do$|\.22\.do$|smailpro|emailnator|yopmail|mohmal|dropmail|tempm|10minute|guerrilla|maildrop|getnada|mailinator|^outlook\.(?:live|office|office365)\.com$|(?:^|\.)proton\.me$/i;
export function isInboxUrl(url: string): boolean {
  try { return INBOX_HOST.test(new URL(url).hostname); } catch { return false; }
}

/** Page data with one-time codes masked (see `maskCodes`). `inbox`: the page is a mailbox the app reads codes from. */
function maskObservation(obs: PageObservation, inbox: boolean): PageObservation {
  const m = (v: string | undefined) => (v === undefined ? v : maskCodes(v, inbox));
  return {
    ...obs,
    title: m(obs.title)!,
    text: m(obs.text)!,
    elements: obs.elements.map((e) => ({ ...e, text: m(e.text), label: m(e.label), value: m(e.value), title: m(e.title) })),
    screenshotDataUrl: undefined, // a screenshot of an inbox or code field would show the code
  };
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
  /** Rounds in which the agent was told to try a different method (one round before the user is asked). */
  let otherMethod = 0;
  let lastPage = "";
  /** One line from the app (trusted, unlike page data) for the next step: what to do differently after repeated failures. */
  let appNote = "";
  let lastSig = "";
  let userReply = "";
  let step = 0;
  let planned = false;
  const providerWaits = opts.providerWaits ?? PROVIDER_WAITS;
  const pointerMs = opts.pointerMs ?? DEFAULTS.agent.pointerMs;
  const notes: string[] = [];
  /** Share of the page, history and chat sent to the AI. Halved each time an AI refuses a request as too big and kept for the rest of the run, so it is not refused again at every step. */
  let size = 1;
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
  /** The open tabs as of this step (for the TABS block and for checking a tab id the model names). */
  let tabsShown: TabInfo[] = [];
  /** Tabs the app has read a verification code from: their page text is masked harder before a model sees it. */
  const inboxTabs = new Set<number>();
  /** The code the app last found in an inbox. Never put in a prompt, a result, history or a log; only fill_code uses it. */
  let foundCode: string | undefined;
  let codeReads = 0;
  /** One account per site per user command: a site the app already signed up on in this run is not signed up on again. */
  const signedUp = new Set<string>();
  /** The agent stops and asks when a site turns the email down; it never tries another address by itself. */
  let emailRejected = false;
  /** Sites where an email went into a form in this run (typed by the model or by sign_up): only there is a rejection message acted on. */
  const touchedEmail = new Set<string>();
  /** A site that refused the email while the model was working: no other address may be typed there until the user has answered. */
  let blockedEmailSite: string | undefined;

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
      case "sign_in": return "Signing in";
      case "sign_up": return "Creating an account";
      case "open_tab": return `Opening ${siteOf(a.url) ?? "a page"} in a new tab`;
      case "switch_tab": return `Switching to tab ${a.tabId}`;
      case "close_tab": return `Closing tab ${a.tabId}`;
      case "read_code": return "Looking for the code in the inbox";
      case "fill_code": return "Filling in the code";
      case "note": return "Noting a value";
      case "scroll": return a.direction === "down" ? "Scrolling down" : "Scrolling up";
      case "ask_user": return a.secure ? "Waiting for you" : "Asking you";
      case "done": return "Finished";
    }
  };

  async function execute(a: Action, obs: PageObservation): Promise<string> {
    const withHighlight = async <T>(id: number, fn: () => Promise<T>): Promise<T> => {
      await driver.highlight(id);
      try {
        if (pointerMs > 0) await raceStop(new Promise<void>((r) => setTimeout(r, pointerMs)), signal); // the pointer arrives before the tap
        return await fn();
      } finally {
        await driver.highlight(undefined);
      }
    };
    switch (a.type) {
      case "navigate":
        await driver.navigate(a.url);
        return `navigated to ${redactText(a.url)}`;
      case "read": {
        const text = scrub(redactText(await driver.read(a.elementId)));
        const active = tabsShown.find((t) => t.active);
        const onInbox = (active !== undefined && inboxTabs.has(active.id)) || isInboxUrl(obs.url);
        const codeFlow = tabsShown.length > 1 || inboxTabs.size > 0;
        return clip(codeFlow || onInbox ? maskCodes(text, onInbox) : text, lim.readMaxChars);
      }
      case "click":
        await withHighlight(a.elementId, () => driver.click(a.elementId));
        return "clicked";
      case "type": {
        const target = obs.elements.find((e) => e.id === a.elementId);
        const site = siteOf(obs.url) ?? "";
        if (target && looksLikeEmailField(target)) {
          if (blockedEmailSite === site) return `blocked: ${site} did not accept the email address. Do not try another address by yourself; use ask_user and let the user decide.`;
          touchedEmail.add(site);
        }
        await withHighlight(a.elementId, () => driver.type(a.elementId, a.text, a.submit));
        return "typed";
      }
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
      case "sign_in":
        return signIn(obs);
      case "sign_up":
        return signUp(a, obs);
      case "open_tab": {
        const open = await driver.tabs();
        if (open.length >= MAX_TABS) return `already ${open.length} tabs open (limit ${MAX_TABS}); close one with close_tab first`;
        const id = await driver.openTab(a.url);
        return `opened tab ${id} at ${redactText(a.url)}; it is now the active tab`;
      }
      case "switch_tab":
        if (!tabsShown.some((t) => t.id === a.tabId)) return `no tab ${a.tabId}; use an id from TABS`;
        await driver.switchTab(a.tabId);
        return `tab ${a.tabId} is now the active tab; read it before acting on it`;
      case "close_tab":
        if (!tabsShown.some((t) => t.id === a.tabId)) return `no tab ${a.tabId}; use an id from TABS`;
        await driver.closeTab(a.tabId);
        inboxTabs.delete(a.tabId);
        return `closed tab ${a.tabId}`;
      case "read_code":
        return readCode(a);
      case "fill_code": {
        if (!foundCode) return "no code has been found yet; use read_code on the inbox tab first";
        try {
          remember(foundCode);
          await driver.fillSecret(a.elementId, foundCode);
        } catch {
          return "could not fill the code field; the page may have changed. Read the page again";
        }
        foundCode = undefined;
        return "the code was filled into the field (not visible to you). Send the form next";
      }
      case "note": {
        const text = clip(safe(a.text), 300);
        if (notes.length >= MAX_NOTES) notes.shift();
        notes.push(text);
        return `noted: ${text}`;
      }
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
      blockedEmailSite = undefined; // the user has decided what happens with the refused email
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
  async function askLoginCard(obs: PageObservation, host: string): Promise<string> {
    const form = findLoginFields(obs.elements);
    const wall = form ? undefined : findLoginWall(obs);
    const userField = form?.username ?? wall?.username;
    if (!form && !wall) return NO_FORM;
    const googleButton = wall?.google ?? obs.elements.find((e) => !e.disabled && (e.tag === "button" || e.tag === "a" || e.role === "button") && /google/i.test([e.text, e.label, e.title, e.name].filter(Boolean).join(" ")));
    const answer = await raceStop(ui.askLogin({ site: host, google: Boolean(googleButton) }, signal), signal);
    alive();
    if (!answer) return "the user closed the sign-in card without signing in; ask what to do, or finish";
    if ("signUp" in answer) return "the sign-in card was answered as a sign-up; use sign_up on the sign-up form instead";
    const id = chip("Signing in", "running");
    try {
      if ("google" in answer) {
        if (!googleButton) throw new Error("no Google button");
        await driver.click(googleButton.id);
        chip("Signing in", "done", id);
        return "the user chose Google; its button was clicked. Continue on the Google page.";
      }
      remember(answer.username, answer.password);
      if (userField && answer.username) await driver.fillSecret(userField.id, answer.username);
      alive();
      if (form) await driver.fillSecret(form.password.id, answer.password);
    } catch (e) {
      if (e instanceof StoppedError) throw e;
      chip("Signing in", "error", id);
      return "could not fill the form; the page may have changed";
    }
    try {
      await deps.vault?.put({ site: host, username: answer.username, password: answer.password, label: host });
    } catch {
      chip("Could not save the login", "error");
    }
    if (form) passwordSent.add(`${host}|${answer.username}`);
    const sent = await submitLogin(form?.password ?? userField);
    chip("Signing in", "done", id);
    return filledResult("user", form !== undefined, sent);
  }

  /**
   * The model asked to sign in. A saved login for this site is filled by the app and sent; with none saved, the user gets the sign-in
   * card once (email and password, or Google) and the login is kept for good. The model only learns what happened, never a secret.
   * Logins are matched by site, so a password only ever goes to the site it was saved for.
   */
  async function signIn(obs: PageObservation): Promise<string> {
    const form = findLoginFields(obs.elements);
    const wall = form ? undefined : findLoginWall(obs); // email-first page: no password field yet
    if (!form && !wall) return NO_FORM;
    const key = loginKey(obs.url, Boolean(form));
    if (loginTried.has(key) || loginTried.size >= MAX_LOGIN_TRIES) return "sign-in was already tried on this step; look at the page and say what you see";
    loginTried.add(key);
    const host = new URL(obs.url).hostname;
    const chosen = pickLogin(deps.vault?.logins(obs.url) ?? [], opts.task);
    if (!chosen) {
      // A saved Google login is used only when the task itself names Google or Gmail.
      const google = wall?.google ?? obs.elements.find((e) => !e.disabled && /continue with google|sign in with google/i.test([e.text, e.label, e.title].filter(Boolean).join(" ")));
      if (google && NAMES_GOOGLE.test(opts.task) && deps.vault?.logins("https://accounts.google.com").length) {
        alive();
        await driver.click(google.id);
        return "Continue with Google was clicked (a Google login is saved). Continue on the Google page.";
      }
      return askLoginCard(obs, host);
    }
    // The app already sent this account's password in this run and the site is showing the form again: it was rejected. Do not repeat it.
    const account = `${host}|${chosen.username}`;
    if (form && passwordSent.has(account)) return "the saved password was already sent and the site showed the form again, so it was probably rejected; tell the user";
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
      return "could not fill the form; the page may have changed";
    }
    if (form) passwordSent.add(account);
    const sent = await submitLogin(form?.password ?? form?.username ?? wall?.username);
    chip("Filling saved login", "done", id);
    return filledResult("saved", form !== undefined, sent);
  }

  /**
   * Reads a verification code or link out of an inbox page. The code itself stays in the app: the model is only told that one was
   * found, and `fill_code` puts it into the page. A verification LINK may be opened, because following it is the whole point of it.
   */
  async function readCode(a: Extract<Action, { type: "read_code" }>): Promise<string> {
    if (!tabsShown.some((t) => t.id === a.tabId)) return `no tab ${a.tabId}; use an id from TABS`;
    if (codeReads++ >= MAX_CODE_READS) return `read_code was used ${MAX_CODE_READS} times in this task; ask the user what to do`;
    inboxTabs.add(a.tabId);
    let found;
    try {
      found = await driver.readCode(a.tabId, { from: a.from, subject: a.subject });
    } catch (e) {
      return `could not read the inbox: ${e instanceof Error ? safe(e.message) : "page error"}`;
    }
    if (found.code) {
      foundCode = found.code;
      remember(found.code);
      return "a verification code was found in the inbox (not visible to you). Switch to the tab with the code field and use fill_code on it.";
    }
    if (found.link && isHttpsUrl(found.link)) {
      // The link carries a one-time token: the app opens it in the inbox tab itself and the model never sees the address.
      remember(found.link);
      await driver.switchTab(a.tabId);
      await driver.navigate(found.link);
      return `a verification link was found and opened in tab ${a.tabId} (the link is not shown to you); tab ${a.tabId} is now the active tab. Look at the page.`;
    }
    if (found.link) return "a verification link was found but it is not https, so it was not opened; tell the user";
    return "no verification mail with a code or link yet; wait a few seconds, refresh the inbox and read_code again";
  }

  /**
   * Sign-up on the page: the APP makes the password (from the form's own visible rules), fills it, and saves site + email + password
   * to KrishVault after the user confirms on the sign-in card. The model never sees the password.
   * One account per site per user command, and a site that refuses the email ends the attempt: the agent asks the user instead of
   * trying another address.
   */
  async function signUp(a: Extract<Action, { type: "sign_up" }>, obs: PageObservation): Promise<string> {
    if (!obs.url) return "no page is open; navigate to the sign-up page first";
    const host = new URL(obs.url).hostname;
    const site = siteOf(obs.url) ?? host;
    if (signedUp.has(site)) return `an account was already created on ${site} in this task. One account per site: do not make another. If the user wants another one, they must say so.`;
    const rejection = rejectionText(redactText(obs.text));
    if (rejection) {
      emailRejected = true;
      blockedEmailSite = site;
      return `the site does not accept this email address ("${rejection}"). Do NOT try another address by yourself: use ask_user to ask what the user wants to do.`;
    }
    const field = obs.elements.find((e) => e.id === a.passwordElementId);
    if (!field || secretKind(field) !== "password") return "that element is not a password field; read the page again and give the id of the password box";
    const email = (a.email ?? emailOnForm(obs) ?? "").trim();
    const confirm = a.confirmElementId !== undefined ? obs.elements.find((e) => e.id === a.confirmElementId) : undefined;
    if (a.confirmElementId !== undefined && (!confirm || secretKind(confirm) !== "password")) return "the confirm field is not a password field; read the page again";
    const answer = await raceStop(ui.askLogin({ site: host, google: false, signUp: true, email: email || undefined }, signal), signal);
    alive();
    if (!answer || !("signUp" in answer)) return "the user did not confirm the sign-up; ask what to do, or finish";
    const password = generatePassword(passwordRules(obs.text));
    const username = (answer.username || email).trim();
    const id = chip("Creating the account", "running");
    try {
      remember(password);
      const emailField = username && obs.elements.find((e) => looksLikeEmailField(e) && !e.value);
      if (emailField && username) await driver.fillSecret(emailField.id, username);
      alive();
      await driver.fillSecret(field.id, password);
      alive();
      if (confirm) await driver.fillSecret(confirm.id, password);
    } catch (e) {
      if (e instanceof StoppedError) throw e;
      chip("Creating the account", "error", id);
      return "could not fill the sign-up form; the page may have changed";
    }
    signedUp.add(site);
    touchedEmail.add(site);
    try {
      await deps.vault?.put({ site: host, username, password, label: host });
    } catch {
      chip("Could not save the login", "error");
    }
    chip("Creating the account", "done", id);
    return `a password was made by the app, filled into the form${confirm ? " (and the confirm field)" : ""} and saved with ${username ? "the email" : "this site"} in the vault (not visible to you). Send the form next; then open the inbox tab and use read_code for the verification mail.`;
  }

  try {
    for (; step < lim.maxSteps; ) {
      if (signal.aborted) throw new StoppedError();

      const seen = pageLive ? await driver.observe() : NO_PAGE;
      tabsShown = pageLive ? await driver.tabs().catch(() => []) : [];
      const activeTab = tabsShown.find((t) => t.active)?.id;
      // Once a second tab or an inbox is in play, numbers next to code words are masked on every page, and every 4-8 digit number on an inbox tab.
      const codeFlow = tabsShown.length > 1 || inboxTabs.size > 0;
      const onInbox = (activeTab !== undefined && inboxTabs.has(activeTab)) || isInboxUrl(seen.url);
      const obs = codeFlow || onInbox ? maskObservation(seen, onInbox) : seen;
      // A site that turns the email down stops the sign-up: the user decides, the agent never cycles through new addresses.
      if (pageLive && !emailRejected && touchedEmail.has(siteOf(obs.url) ?? "")) {
        const why = rejectionText(redactText(obs.text));
        if (why) {
          emailRejected = true;
          const id = chip("The site refused the email", "action_required");
          const answer = await raceStop(ui.ask(`${siteOf(obs.url)} did not accept the email address: "${safe(why)}". I will not try other addresses by myself. What should I do? Leave empty to stop.`, signal), signal);
          chip("The site refused the email", "done", id);
          if (!answer?.trim()) return finish("failed", `stopped: ${siteOf(obs.url)} did not accept the email address ("${why}")`);
          userReply = redactText(answer);
        }
      }
      // Saved logins of this site are scrubbed from everything the model sees (and stop screenshots) from the first look, even before sign_in.
      if (pageLive) for (const l of deps.vault?.logins(obs.url) ?? []) remember(l.username, l.password);
      // The numbers the model sees are fixed for this step, so "m2" always means the line it read.
      memoryShown = deps.memory ? await deps.memory.list() : [];
      const memoryText = deps.memory ? memoryShown.map((m, i) => `m${i + 1}: ${m.text}`).join("\n") : opts.memory;
      const chatText = (opts.chat ?? []).map((m) => `${m.role === "user" ? "user" : "krish"}: ${clip(m.text.replace(/\s+/g, " ").trim(), 500)}`).join("\n");
      const note = appNote;
      const reply = userReply;
      const buildPrompt = () => {
        const text = pageLive
          ? formatObservation(obs, Math.round(lim.observationMaxChars * size), Math.max(10, Math.round(lim.observationMaxElements * size)))
          : noPageText(opts.openTab ? redactText(opts.openTab) : undefined);
        const recent = history.slice(-Math.max(2, Math.round(lim.historyWindow * size)));
        const turns = recent.map((t, i) => `${i + 1}. ${t.action}\n   -> ${fence("RESULT_DATA", i === recent.length - 1 ? clip(t.result, lim.readMaxChars * size) : clip(t.result, lim.olderResultChars * size))}`);
        return scrub([
          chatText ? fence("CHAT", redactChat(size < 1 ? clip(chatText, 1000) : chatText)) : "",
          opts.device ? fence("DEVICE", opts.device) : "",
          fence("USER_TASK", redactText(opts.task)),
          notes.length ? fence("NOTES", notes.map((n, i) => `${i + 1}. ${n}`).join("\n")) : "",
          memoryText ? fence("MEMORY", clip(memoryText, 4000)) : "",
          attached.length ? fence("USER_FILES", attachedList) : "",
          reply ? fence("USER_REPLY", reply) : "",
          note ? `App note: ${note}` : "",
          turns.length ? `Previous steps:\n${turns.join("\n")}` : "",
          tabsShown.length > 1 ? fence("TABS", tabsShown.map((t) => `[${t.id}] ${clip(redactText(cleanLabel(t.title)), 80)} — ${clip(redactText(t.url), 160)}${t.active ? " (active)" : ""}`).join("\n")) : "",
          fence("PAGE_DATA", text),
        ].filter(Boolean).join("\n\n"));
      };
      userReply = "";
      appNote = "";

      let action: Action;
      for (let waits = 0; ; waits++) {
        try {
          const run = await router.run(
            [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: buildPrompt(), imageDataUrl: opts.screenshots && typed.size === 0 && size === 1 ? obs.screenshotDataUrl : undefined },
            ],
            (raw) => parseReply(raw, step === 0),
            { signal },
          );
          action = run.value;
          ui.emit({ type: "provider", providerId: run.providerId, model: run.model });
          break;
        } catch (e) {
          if (e instanceof AbortedError) throw new StoppedError();
          // The request was bigger than the AI's size or per-minute token limit: send a shorter one at once (waiting would not help).
          if (e instanceof AllProvidersFailedError && e.tooLarge && size > MIN_PROMPT_SIZE) {
            size /= 2;
            waits--;
            chip("Sending a shorter request", "done");
            continue;
          }
          // Every AI was busy for a moment: a long task waits and tries again instead of being lost.
          if (!(e instanceof AllProvidersFailedError) || !e.transient || waits >= providerWaits.length) throw e;
          const id = chip("Waiting for an AI to answer", "running");
          const wait = Math.max(providerWaits[waits]!, Math.min(await router.retryInMs(), MAX_PROVIDER_WAIT_MS)); // never retry while every service is still cooling down
          await raceStop(new Promise<void>((r) => setTimeout(r, wait)), signal);
          chip("Waiting for an AI to answer", "done", id);
        }
      }
      step += 1;

      const verdict = gate(action, obs);
      // Display-only (the policy gate never reads it). The model's own status line follows the user's language, except for
      // blocked steps and secure-input steps, which keep the app's fixed wording so model text can never dress up a trusted prompt.
      const thought = verdict.verdict === "allow" && !(action.type === "ask_user" && action.secure) ? cleanLabel(action.thought ?? "") : "";
      const label = thought ? clip(safe(thought), 80) : describe(action, obs);
      if (action.plan && !planned && action.type !== "done" && verdict.verdict === "allow") {
        planned = true;
        const plan = clip(safe(cleanLabel(action.plan)), 400);
        if (plan) ui.emit({ type: "plan", text: plan });
      }
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
          const openUrl = !pageLive && (action.type === "navigate" || action.type === "open_tab") ? action.url : undefined;
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
      const pageSig = `${obs.url}|${obs.text.length}`;
      const sig = `${pageSig}|${JSON.stringify({ ...action, thought: undefined, plan: undefined })}`; // the model's own wording must not count as a change
      stalls = sig === lastSig ? stalls + 1 : 0;
      lastSig = sig;
      if (!failed && pageSig !== lastPage) otherMethod = 0; // the page really changed: a later jam gets its own "another way" round
      lastPage = pageSig;

      if (consecutiveErrors >= lim.maxConsecutiveErrors || stalls >= lim.maxStalls) {
        const why = consecutiveErrors >= lim.maxConsecutiveErrors ? "repeated errors" : "no progress";
        // The same approach failed several times: the user is not asked yet. The agent must try something else first.
        if (otherMethod++ < 1) {
          appNote = `${why}: the same approach did not work ${Math.max(consecutiveErrors, stalls)} times in a row. Use a different method now: another element or button, its exact visible text, scroll to find it, submit the form, open the page's direct URL, or another site that does the same. Do not repeat the failed step. Do not ask the user yet.`;
          chip("Trying another way", "done");
          consecutiveErrors = 0;
          stalls = 0;
          continue;
        }
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
