import { z } from "zod";

export const ACTION_TYPES = [
  "navigate",
  "read",
  "click",
  "type",
  "paste",
  "upload_selected_file",
  "run_sandbox_task",
  "wait",
  "ask_user",
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

export const SecureKindSchema = z.enum(["password", "otp", "captcha", "2fa"]);

export const ActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("navigate"), url: httpsUrl, thought }),
  z.strictObject({ type: z.literal("read"), elementId: elementId.optional(), thought }),
  z.strictObject({ type: z.literal("click"), elementId, thought }),
  z.strictObject({
    type: z.literal("type"),
    elementId,
    text: z.string().max(10_000),
    submit: z.boolean().optional(),
    thought,
  }),
  z.strictObject({ type: z.literal("paste"), elementId, text: z.string().max(50_000), thought }),
  z.strictObject({ type: z.literal("upload_selected_file"), elementId, thought }),
  z.strictObject({
    type: z.literal("run_sandbox_task"),
    tool: z.enum(["zip", "unzip", "text", "script", "shell"]),
    code: z.string().max(20_000),
    writesFiles: z.boolean(),
    thought,
  }),
  z.strictObject({ type: z.literal("wait"), ms: z.number().int().min(0).max(10_000), thought }),
  z.strictObject({
    type: z.literal("ask_user"),
    question: z.string().min(1).max(500),
    secure: z.strictObject({ kind: SecureKindSchema, elementId: elementId.optional() }).optional(),
    thought,
  }),
  z.strictObject({ type: z.literal("done"), summary: z.string().max(2000), thought }),
]);

export type Action = z.infer<typeof ActionSchema>;

export class ActionParseError extends Error {}

/** Parses untrusted model output. Only strict JSON (optionally in a ```json fence) is accepted. */
export function parseAction(raw: string): Action {
  const body = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ActionParseError("model output is not valid JSON");
  }
  const result = ActionSchema.safeParse(json);
  if (!result.success) throw new ActionParseError(`invalid action: ${result.error.issues[0]?.message ?? "unknown"}`);
  return result.data;
}
