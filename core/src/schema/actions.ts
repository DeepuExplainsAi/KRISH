import { z } from "zod";

export const ACTION_TYPES = [
  "navigate",
  "read",
  "click",
  "type",
  "paste",
  "upload_selected_file",
  "run_sandbox_task",
  "memory_add",
  "memory_remove",
  "wait",
  "scroll",
  "ask_user",
  "sign_in",
  "sign_up",
  "open_tab",
  "switch_tab",
  "close_tab",
  "read_code",
  "fill_code",
  "note",
  "done",
] as const;

export function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

const httpsUrl = z.string().max(2048).refine(isHttpsUrl, "must be an https URL without credentials");
const elementId = z.number().int().nonnegative();
const thought = z.string().max(300).optional();
/** One or two sentences on the first step of a task: what the agent is about to do. Shown in the chat before the work starts. */
const plan = z.string().max(400).optional();

export const SecureKindSchema = z.enum(["password", "otp", "captcha", "2fa"]);

export const ActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("navigate"), url: httpsUrl, thought, plan }),
  z.strictObject({ type: z.literal("read"), elementId: elementId.optional(), thought, plan }),
  z.strictObject({ type: z.literal("click"), elementId, thought, plan }),
  z.strictObject({
    type: z.literal("type"),
    elementId,
    text: z.string().max(10_000),
    submit: z.boolean().optional(),
    thought,
    plan,
  }),
  z.strictObject({ type: z.literal("paste"), elementId, text: z.string().max(50_000), thought, plan }),
  z.strictObject({ type: z.literal("upload_selected_file"), elementId, file: z.string().regex(/^f\d{1,2}$/).optional(), thought, plan }),
  z.strictObject({
    type: z.literal("run_sandbox_task"),
    tool: z.enum(["zip", "unzip", "text", "script", "shell"]),
    code: z.string().max(20_000),
    writesFiles: z.boolean(),
    thought,
    plan,
  }),
  z.strictObject({ type: z.literal("memory_add"), text: z.string().min(1).max(500), thought, plan }),
  z.strictObject({ type: z.literal("memory_remove"), ids: z.array(z.string().regex(/^m\d{1,3}$/)).min(1).max(20), thought, plan }),
  z.strictObject({ type: z.literal("scroll"), direction: z.enum(["down", "up"]), thought, plan }),
  z.strictObject({ type: z.literal("wait"), ms: z.number().int().min(0).max(10_000), thought, plan }),
  z.strictObject({
    type: z.literal("ask_user"),
    question: z.string().min(1).max(500),
    secure: z.strictObject({ kind: SecureKindSchema, elementId: elementId.optional() }).optional(),
    thought,
    plan,
  }),
  z.strictObject({ type: z.literal("sign_in"), thought, plan }),
  // The app generates the password, fills it and saves the login. The model never sees the value.
  z.strictObject({
    type: z.literal("sign_up"),
    passwordElementId: elementId,
    confirmElementId: elementId.optional(),
    email: z.string().max(200).optional(),
    thought,
    plan,
  }),
  z.strictObject({ type: z.literal("open_tab"), url: httpsUrl, thought, plan }),
  z.strictObject({ type: z.literal("switch_tab"), tabId: z.number().int().nonnegative(), thought, plan }),
  z.strictObject({ type: z.literal("close_tab"), tabId: z.number().int().nonnegative(), thought, plan }),
  // Reads a verification code or link out of an inbox page. The value stays in the app; the model is only told whether one was found.
  z.strictObject({
    type: z.literal("read_code"),
    tabId: z.number().int().nonnegative(),
    from: z.string().max(120).optional(),
    subject: z.string().max(120).optional(),
    thought,
    plan,
  }),
  z.strictObject({ type: z.literal("fill_code"), elementId, thought, plan }),
  z.strictObject({ type: z.literal("note"), text: z.string().min(1).max(300), thought, plan }),
  z.strictObject({ type: z.literal("done"), summary: z.string().max(6000), thought, plan }),
]);

export type Action = z.infer<typeof ActionSchema>;

export class ActionParseError extends Error {}

/** Reasoning a model writes before its answer. Only a leading block is removed, so answer text is never edited. */
const THINK = /^\s*(?:<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>\s*)+/i;

/** First balanced {...} object in the text (string-aware), for models that wrap their JSON in prose. */
function firstObject(s: string): string | undefined {
  const start = s.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return undefined;
}

const parseJson = (body: string): Action => {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ActionParseError("model output is not valid JSON");
  }
  const result = ActionSchema.safeParse(json);
  if (!result.success) throw new ActionParseError(`invalid action: ${result.error.issues[0]?.message ?? "unknown"}`);
  return result.data;
};

const unwrap = (raw: string) => raw.replace(THINK, "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

/** Parses untrusted model output. Only strict JSON (optionally in a ```json fence, after reasoning tags) is accepted. */
export const parseAction = (raw: string): Action => parseJson(unwrap(raw));

/**
 * What the agent loop accepts from a model. Free models often add a sentence around the JSON or answer a greeting in plain
 * prose, so this also takes the first JSON object inside prose and, on the first step of a run, plain prose as the final answer.
 * The result still passes the same schema and the policy gate.
 */
export function parseReply(raw: string, firstStep: boolean): Action {
  const body = unwrap(raw);
  // Plain prose is an answer only on the first step, and only when it does not look like an attempted action.
  const prose = firstStep && body !== "" && !/"type"\s*:/.test(body);
  try {
    return parseJson(body);
  } catch (e) {
    const inner = firstObject(body);
    if (inner) {
      try {
        return parseJson(inner);
      } catch (e2) {
        if (!prose) throw e2; // "Use {name} as the placeholder." is a sentence, not a broken action
      }
    }
    if (prose) return { type: "done", summary: body.slice(0, 6000) };
    throw e;
  }
}
