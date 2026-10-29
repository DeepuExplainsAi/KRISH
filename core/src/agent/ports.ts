import type { Action } from "../schema/actions";
import type { PageObservation } from "../page/types";

export interface SelectedFile {
  name: string;
  size: number;
  /** Opaque handle from the system file picker; the platform layer resolves it. */
  token: string;
}

/** One open browser tab of the agent. Ids are small numbers the model can name. */
export interface TabInfo {
  id: number;
  title: string;
  url: string;
  /** True for the tab every other action works on. */
  active?: boolean;
}

/** What the app found in an inbox page. Both values stay in the app: a model is only told that something was found. */
export interface CodeFound {
  code?: string;
  link?: string;
}

/** Native page control. Every page action works on the ACTIVE tab; the tab actions change which one that is. */
export interface PageDriver {
  observe(): Promise<PageObservation>;
  navigate(url: string): Promise<void>;
  read(elementId?: number): Promise<string>;
  click(elementId: number): Promise<void>;
  type(elementId: number, text: string, submit?: boolean): Promise<void>;
  paste(elementId: number, text: string): Promise<void>;
  upload(elementId: number, file: SelectedFile): Promise<void>;
  /** Native fill. The value goes straight into the page and is never returned or retained. */
  fillSecret(elementId: number, value: string): Promise<void>;
  /** Scrolls the page by about one screen. */
  scroll(direction: "down" | "up"): Promise<void>;
  highlight(elementId: number | undefined): Promise<void>;
  /** The open tabs, oldest first. */
  tabs(): Promise<TabInfo[]>;
  /** Opens a new tab and makes it the active one. Returns its id. */
  openTab(url: string): Promise<number>;
  switchTab(tabId: number): Promise<void>;
  closeTab(tabId: number): Promise<void>;
  /**
   * Looks at the inbox page in `tabId` for the newest message matching the hint and extracts a verification code or link.
   * The value is returned to the app only; it never goes into a prompt, a result, history or a log.
   */
  readCode(tabId: number, hint?: { from?: string; subject?: string }): Promise<CodeFound>;
}

export interface SandboxTask {
  tool: "zip" | "unzip" | "text" | "script" | "shell";
  code: string;
  writesFiles: boolean;
}

/** Output is untrusted DATA. */
export interface Sandbox {
  run(task: SandboxTask, signal?: AbortSignal): Promise<string>;
}

/** KrishVault as the agent loop sees it. Passwords only ever go from here into the page (never to a model, log or history). */
export interface VaultPort {
  put(input: { site: string; username: string; password: string; label?: string }): Promise<unknown>;
  logins(url: string): { id: string; label: string; username: string; password: string }[];
}

/** Persistent memory as the agent loop sees it. The loop numbers the listed items m1, m2... for the model; ids stay internal. */
export interface MemoryPort {
  list(): Promise<{ id: string; text: string }[]>;
  add(text: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export type ChipState = "running" | "done" | "error" | "action_required";

export type AgentEvent =
  | { type: "chip"; id: number; label: string; state: ChipState }
  | { type: "action"; step: number; action: Action; result: string }
  | { type: "provider"; providerId: string; model: string }
  /** What the agent is about to do, in one or two sentences, said before the work starts. */
  | { type: "plan"; text: string }
  /** The agent is about to use the browser (navigate, read, click, type...). A plain chat answer never emits this. */
  | { type: "browser" }
  | { type: "end"; status: AgentStatus; summary: string };

export type AgentStatus = "done" | "stopped" | "failed" | "max_steps";

export type SecureKind = "password" | "otp" | "captcha" | "2fa";

/** The in-chat sign-in card. A typed login is always saved to KrishVault. */
export interface LoginRequest {
  site: string;
  /** The page has a "Continue with Google" button. */
  google: boolean;
  /**
   * A sign-up: the card asks the user to confirm creating ONE account on this site with this email. The app makes the password
   * itself; the card never shows it. Confirming saves site, email and password to KrishVault.
   */
  signUp?: boolean;
  /** The email already on the sign-up form (not secret). */
  email?: string;
}

/** What the user did on the card: typed a login, chose Google, or nothing (undefined = closed the card). */
export type LoginAnswer = { google: true } | { username: string; password: string } | { signUp: true; username: string };

export interface AgentUI {
  /** Plain question to the user. undefined = cancelled. */
  ask(question: string, signal: AbortSignal): Promise<string | undefined>;
  /** Native masked input card. The APP (never the model) puts the value into the page. */
  askSecure(req: { kind: SecureKind; title: string; site: string; field: string }, signal: AbortSignal): Promise<string | undefined>;
  /** Native sign-in card. The APP puts the values into the page; they never reach a model. */
  askLogin(req: LoginRequest, signal: AbortSignal): Promise<LoginAnswer | undefined>;
  /** CAPTCHA: the user solves it in the live view. Resolves when the user taps Done. */
  solveCaptcha(reason: string, signal: AbortSignal): Promise<void>;
  pickFile(signal: AbortSignal): Promise<SelectedFile | undefined>;
  emit(event: AgentEvent): void;
}
