import { Collection, newId } from "../memory/stores";
import { isDue, type Repeat } from "../memory/schedule";
import type { PhoneAction } from "../security/actions";
import { sanitizeAllowlist } from "../security/packages";
import type { KVStore } from "../storage";
import type { SafeNode } from "../security/screen";

/**
 * One recorded step. Screen elements are stored by their visible label (+ position among equal labels), never by node id:
 * ids change on every screen read. At replay the label is looked up on the freshly gated screen.
 */
export type MacroStep =
  | { type: "open_app"; package: string }
  | { type: "tap"; label: string; nth: number }
  | { type: "type"; label: string; nth: number; text: string }
  | { type: "scroll"; direction: "up" | "down" }
  | { type: "back" }
  | { type: "wait"; ms: number };

const norm = (s: string) => s.trim().toLowerCase();
const candidates = (nodes: readonly SafeNode[], kind: "tap" | "type", label: string) =>
  nodes.filter((n) => norm(n.text) === norm(label) && (kind === "tap" || n.editable));

/** The step to record for an action that just ran, given the nodes of the screen it ran on. */
export function stepFromAction(a: PhoneAction, nodes: readonly SafeNode[]): MacroStep | undefined {
  switch (a.type) {
    case "open_app": return { type: "open_app", package: a.package.trim().toLowerCase() };
    case "tap":
    case "type": {
      const node = nodes.find((n) => n.id === a.nodeId);
      if (!node) return undefined;
      const nth = candidates(nodes, a.type, node.text).findIndex((n) => n.id === node.id);
      return a.type === "tap" ? { type: "tap", label: node.text, nth } : { type: "type", label: node.text, nth, text: a.text };
    }
    case "scroll": return { type: "scroll", direction: a.direction };
    case "back": return { type: "back" };
    case "wait": return { type: "wait", ms: a.ms };
    default: return undefined;
  }
}

/** Steps that need no screen element. */
export function directAction(step: MacroStep): PhoneAction | undefined {
  switch (step.type) {
    case "open_app": return { type: "open_app", package: step.package };
    case "scroll": return { type: "scroll", direction: step.direction };
    case "back": return { type: "back" };
    case "wait": return { type: "wait", ms: step.ms };
    default: return undefined;
  }
}

/** Finds the step's element on the current gated screen. Exact label and position, otherwise nothing (never a guess). */
export function resolveStep(step: MacroStep, nodes: readonly SafeNode[]): PhoneAction | undefined {
  if (step.type !== "tap" && step.type !== "type") return directAction(step);
  const node = candidates(nodes, step.type, step.label)[step.nth];
  if (!node) return undefined;
  return step.type === "tap" ? { type: "tap", nodeId: node.id } : { type: "type", nodeId: node.id, text: step.text };
}

export interface Macro {
  id: string;
  title: string;
  task: string;
  /** Apps the user approved on the plan screen when saving. A replay refuses if any is no longer allowed. */
  apps: string[];
  steps: MacroStep[];
  repeat: Repeat;
  hour: number;
  minute: number;
  at?: number;
  enabled: boolean;
  lastRunAt?: number;
  createdAt: number;
  /** Set only when the user approved the saved plan. A macro without it never runs. */
  approvedAt: number;
}

export const MAX_MACRO_STEPS = 100;

export type MacroInput = Pick<Macro, "title" | "task" | "apps" | "steps" | "repeat" | "hour" | "minute" | "at"> & { enabled?: boolean };

export class Macros {
  private items: Collection<Macro>;
  constructor(kv: KVStore, private now: () => number = Date.now) {
    this.items = new Collection(kv, "macros", 50);
  }

  /** Call only after the user approved the plan on screen. Returns the reason when the recording cannot be replayed safely. */
  async create(m: MacroInput): Promise<{ ok: true; macro: Macro } | { ok: false; reason: string }> {
    if (!m.title.trim()) return { ok: false, reason: "give the macro a name" };
    if (m.steps.length === 0) return { ok: false, reason: "nothing was recorded" };
    if (m.steps.length > MAX_MACRO_STEPS) return { ok: false, reason: `more than ${MAX_MACRO_STEPS} steps` };
    if (m.steps.some((s) => s.type === "tap" && !s.label.trim())) return { ok: false, reason: "a step taps an unlabeled control, which cannot be found again" };
    const apps = sanitizeAllowlist(m.apps).allowed;
    if (apps.length === 0) return { ok: false, reason: "no allowed app" };
    const macro: Macro = { ...m, title: m.title.trim().slice(0, 80), apps, enabled: m.enabled ?? true, id: newId(), createdAt: this.now(), approvedAt: this.now() };
    await this.items.put(macro);
    return { ok: true, macro };
  }

  list = () => this.items.all();
  get = async (id: string) => (await this.items.all()).find((m) => m.id === id);
  remove = (id: string) => this.items.remove(id);
  update = (m: Macro) => this.items.put(m);
  async due(now: number): Promise<Macro[]> {
    return (await this.items.all()).filter((m) => isDue(m, now));
  }
  async markRan(id: string, at: number) {
    const m = await this.get(id);
    if (m) await this.items.put({ ...m, lastRunAt: at });
  }
}
