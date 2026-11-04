import { z } from "zod";
import { checkPackage, sanitizeAllowlist, type BlockReason } from "./packages";
import type { SafeNode } from "./screen";

/** What an AI (Mode A reply or Mode B tool call) may ask the phone to do. Strict: unknown fields and types are rejected. */
const nodeId = z.number().int().nonnegative();
export const PhoneActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("open_app"), package: z.string().min(3).max(255) }),
  z.strictObject({ type: z.literal("read_screen") }),
  z.strictObject({ type: z.literal("tap"), nodeId }),
  z.strictObject({ type: z.literal("type"), nodeId, text: z.string().max(2000) }),
  z.strictObject({ type: z.literal("scroll"), direction: z.enum(["up", "down"]) }),
  z.strictObject({ type: z.literal("back") }),
  z.strictObject({ type: z.literal("wait"), ms: z.number().int().min(100).max(10_000) }),
  z.strictObject({ type: z.literal("ask_user"), question: z.string().max(300) }),
  z.strictObject({ type: z.literal("done"), summary: z.string().max(500) }),
]);
export type PhoneAction = z.infer<typeof PhoneActionSchema>;
export type PhoneActionType = PhoneAction["type"];
export const PHONE_ACTION_TYPES = PhoneActionSchema.options.map((o) => o.shape.type.value) as PhoneActionType[];

/** Strict JSON in, validated action out. Anything else is `undefined`; model text is never evaluated. */
export function parsePhoneAction(input: unknown): PhoneAction | undefined {
  const r = PhoneActionSchema.safeParse(typeof input === "string" ? safeJson(input) : input);
  return r.success ? r.data : undefined;
}
const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

/** Things that always need a fresh yes from the user, each time, no matter what the task plan says. */
export type ConsentKind = "send" | "post" | "pay" | "delete" | "submit" | "install" | "share" | "open_app" | "unlabeled";

const KINDS: [Exclude<ConsentKind, "open_app" | "unlabeled">, RegExp][] = [
  ["pay", /\b(pay|pays|paying|payment|purchase|buy|checkout|check out|place order|donate|transfer)\b|भुगतान|खरीदें/i],
  ["delete", /\b(delete|remove|erase|discard|clear all|unsend|deactivate|unfollow)\b|डिलीट|हटाएं|हटाएँ|मिटाएं/i],
  ["send", /\b(send|reply|forward)\b|भेजें|भेजो/i],
  ["post", /\b(post|publish|tweet|upload|comment)\b|पोस्ट/i],
  ["share", /\b(share|repost|retweet|invite)\b|शेयर/i],
  ["install", /\b(install|update|download|get app)\b|इंस्टॉल/i],
  ["submit", /\b(submit|confirm|apply|agree|accept|continue to|finish|complete|subscribe|follow)\b|सबमिट/i],
];

/**
 * Which consequential verb a control label carries, if any. Deliberately over-eager: a needless popup costs a tap, a missed one costs a message.
 * "Pay" is checked first so "Pay and send" is a payment.
 */
export function consentKindOf(label: string): ConsentKind | undefined {
  for (const [kind, re] of KINDS) if (re.test(label)) return kind;
  return undefined;
}

/** What the user approves BEFORE the task starts. Nothing outside it ever runs. */
export interface TaskPlan {
  task: string;
  /** Allowlisted, non-blocked packages this task may use. */
  apps: string[];
  actions: PhoneActionType[];
  maxSteps: number;
  /** Set only by the UI after the user taps Start on the plan screen. */
  approved: boolean;
}

export function createPlan(task: string, apps: readonly string[], actions: readonly PhoneActionType[] = PHONE_ACTION_TYPES, maxSteps = 60): TaskPlan {
  return { task: task.trim(), apps: sanitizeAllowlist(apps).allowed, actions: [...new Set(actions)], maxSteps, approved: false };
}

export const approvePlan = (plan: TaskPlan): TaskPlan => ({ ...plan, approved: true });

/** The text of the pre-task screen: which apps and which actions will be used. */
export function describePlan(plan: TaskPlan): string[] {
  return [`Task: ${plan.task}`, `Apps: ${plan.apps.join(", ") || "none"}`, `Actions: ${plan.actions.join(", ")}`, `Up to ${plan.maxSteps} steps. You confirm every send, post, pay, delete, submit, install, share and every newly opened app.`];
}

export type Decision =
  | { verdict: "allow" }
  | { verdict: "confirm"; kind: ConsentKind; preview: string }
  | { verdict: "block"; reason: string; blockReason?: BlockReason };

export interface GateContext {
  plan: TaskPlan;
  /** Nodes of the last screen that passed `sanitizeScreen`, or none. Targets and their labels come from here, never from the model. */
  nodes: readonly SafeNode[];
  /** Packages already opened (and confirmed) during this task. */
  opened: ReadonlySet<string>;
  steps: number;
}

const block = (reason: string, blockReason?: BlockReason): Decision => ({ verdict: "block", reason, blockReason });

/** Pure decision for one action. The engine runs it only on `allow`, or on `confirm` after the user said yes. */
export function gatePhoneAction(action: PhoneAction, ctx: GateContext): Decision {
  const { plan } = ctx;
  if (!plan.approved) return block("task plan not approved by the user");
  if (ctx.steps >= plan.maxSteps) return block("step limit of the approved plan reached");
  if (!plan.actions.includes(action.type)) return block(`action "${action.type}" is not in the approved plan`);

  switch (action.type) {
    case "open_app": {
      const v = checkPackage(action.package, plan.apps);
      if (!v.allow) return block(v.reason === "not_allowlisted" ? "app is not in the approved plan" : `app refused: ${v.reason}`, v.reason);
      return ctx.opened.has(action.package.trim().toLowerCase()) ? { verdict: "allow" } : { verdict: "confirm", kind: "open_app", preview: `Open ${action.package}` };
    }
    case "tap":
    case "type": {
      const node = ctx.nodes.find((n) => n.id === action.nodeId);
      if (!node) return block(`no element [${action.nodeId}] on the last screen; read the screen first`);
      if (action.type === "type") {
        if (!node.editable) return block(`element [${node.id}] is not a text field`);
        if (action.text.includes("[REDACTED")) return block("text contains a redaction placeholder; ask the user for the real value");
        if (/[\r\n]/.test(action.text)) return { verdict: "confirm", kind: "submit", preview: `Type text with a line break (may submit) into [${node.id}]` };
        return { verdict: "allow" };
      }
      const label = node.text.trim();
      if (!label) return { verdict: "confirm", kind: "unlabeled", preview: `Tap unlabeled control [${node.id}]` };
      const kind = consentKindOf(label);
      return kind ? { verdict: "confirm", kind, preview: `Tap "${label.slice(0, 80)}"` } : { verdict: "allow" };
    }
    default:
      return { verdict: "allow" };
  }
}

/** Per-task state: counts steps and remembers which apps the user already let it open. */
export class TaskSession {
  readonly opened = new Set<string>();
  steps = 0;
  nodes: readonly SafeNode[] = [];
  constructor(readonly plan: TaskPlan) {}

  /** Call with the nodes of every screen that passed the gate; call with `[]` when a screen was refused. */
  setScreen(nodes: readonly SafeNode[]) {
    this.nodes = nodes;
  }

  check(action: PhoneAction): Decision {
    return gatePhoneAction(action, { plan: this.plan, nodes: this.nodes, opened: this.opened, steps: this.steps });
  }

  /** Call once the action was actually executed. A screen changes after any action, so its node ids are dropped. */
  executed(action: PhoneAction) {
    this.steps++;
    if (action.type === "open_app") this.opened.add(action.package.trim().toLowerCase());
    if (action.type !== "read_screen") this.nodes = [];
  }
}
