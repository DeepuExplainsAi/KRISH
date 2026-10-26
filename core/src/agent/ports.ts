import type { Action } from "../schema/actions";
import type { PageObservation } from "../page/types";

export interface SelectedFile {
  name: string;
  size: number;
  /** Opaque handle from the system file picker; the platform layer resolves it. */
  token: string;
}

/** Native page control. Implemented by the Android plugin and the desktop shell. */
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
  highlight(elementId: number | undefined): Promise<void>;
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

export type ConfirmKind = "send" | "upload" | "sandbox" | "navigate" | "consent" | "settings" | "memory" | "vault" | "sensitive";

/** KrishVault as the agent loop sees it. Passwords only ever go from here into the page (never to a model, log or history). */
export interface VaultPort {
  readonly exists: boolean;
  readonly unlocked: boolean;
  unlock(passphrase: string): Promise<boolean>;
  logins(url: string): { id: string; label: string; username: string; password: string }[];
}

/** Persistent memory as the agent loop sees it. The loop numbers the listed items m1, m2... for the model; ids stay internal. */
export interface MemoryPort {
  list(): Promise<{ id: string; text: string }[]>;
  add(text: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface ConfirmRequest {
  kind: ConfirmKind;
  title: string;
  /** Exact content the user is approving. */
  preview: string;
}

export type ChipState = "running" | "done" | "error" | "action_required";

export type AgentEvent =
  | { type: "chip"; id: number; label: string; state: ChipState }
  | { type: "action"; step: number; action: Action; result: string }
  | { type: "provider"; providerId: string; model: string }
  /** The agent is about to use the browser (navigate, read, click, type...). A plain chat answer never emits this. */
  | { type: "browser" }
  | { type: "end"; status: AgentStatus; summary: string };

export type AgentStatus = "done" | "stopped" | "failed" | "max_steps";

export type SecureKind = "password" | "otp" | "captcha" | "2fa";

export interface AgentUI {
  confirm(req: ConfirmRequest, signal: AbortSignal): Promise<boolean>;
  /** Plain question to the user. undefined = cancelled. */
  ask(question: string, signal: AbortSignal): Promise<string | undefined>;
  /** Native masked input card. The APP (never the model) puts the value into the page. */
  askSecure(req: { kind: SecureKind; title: string; site: string; field: string }, signal: AbortSignal): Promise<string | undefined>;
  /** CAPTCHA / sensitive page: user acts in the live view. Resolves when the user taps Resume. */
  takeOver(reason: string, signal: AbortSignal): Promise<void>;
  pickFile(signal: AbortSignal): Promise<SelectedFile | undefined>;
  emit(event: AgentEvent): void;
}
