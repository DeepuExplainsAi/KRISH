import { DEFAULTS } from "../config/defaults";
import { luhn, redactText } from "../privacy/redact";
import policy from "../../security-policy/blocklist.json";
import { checkPackage, type BlockReason } from "./packages";

/** One accessibility node as the native service reports it. Native code never reports text for password nodes, but this gate does not rely on that. */
export interface RawNode {
  id: number;
  cls?: string;
  text?: string;
  desc?: string;
  hint?: string;
  password?: boolean;
  editable?: boolean;
  clickable?: boolean;
}

export interface RawScreen {
  pkg: string | null;
  nodes: RawNode[];
  /** Window has FLAG_SECURE (native check). */
  secure?: boolean;
  /** Present only when a screenshot was taken; `blank` = every pixel identical (native check). */
  screenshot?: { blank: boolean };
  /** Address shown by an allowed browser, if the native side found it. */
  url?: string;
}

export interface SafeNode {
  id: number;
  cls?: string;
  text: string;
  editable?: boolean;
  clickable?: boolean;
}

export type PauseReason = "package" | "sensitive_word" | "secret_field" | "blocked_host";
export type StopReason = "flag_secure" | "blank_screenshot";

/** Nothing here ever carries screen text except `ok`. */
export type ScreenResult =
  | { kind: "ok"; text: string; nodes: SafeNode[] }
  | { kind: "pause"; reason: "package"; detail: BlockReason; group?: string }
  | { kind: "pause"; reason: "sensitive_word"; words: string[] }
  | { kind: "pause"; reason: "secret_field" | "blocked_host" }
  | { kind: "stop"; reason: StopReason };

/**
 * Words that mean the screen handles credentials or money. Hard words can never be waved through: the user does the login or code entry
 * themselves and the next screen no longer has them. Soft words ("pay") may be approved by the user for the current task.
 */
const HARD_WORDS: Record<string, RegExp> = {
  otp: /\b(?:otp|one[- ]?time (?:password|code|pin))\b|ओटीपी/i,
  pin: /\b(?:pin|upi[- ]?pin|mpin)\b/i,
  cvv: /\b(?:cvv|cvc|cvn)\b/i,
  password: /\b(?:password|passcode|passwd)\b|पासवर्ड/i,
  login: /\blog[ -]?in\b|लॉग\s?इन/i,
  "sign in": /\bsign[ -]?in\b/i,
};
const SOFT_WORDS: Record<string, RegExp> = {
  pay: /\bpay(?:ment|ments|ing)?\b/i,
};
export const SOFT_WORD_NAMES = Object.keys(SOFT_WORDS);

const SECRET_HINT = new RegExp(DEFAULTS.patterns.secretField, "i");

const hostBlocked = (url: string | undefined): boolean => {
  if (!url) return false;
  let host: string;
  let path: string;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return false;
  }
  return (policy.hosts as string[]).some((entry) => {
    const [h = "", ...rest] = entry.split("/");
    const underPath = rest.length === 0 || path.startsWith(`/${rest.join("/")}`);
    return underPath && (host === h || host.endsWith(`.${h}`));
  });
};

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w.])\+?\d[\d ()-]{8,}\d(?!\w)/g;
const CODE_CUE = /(code|otp|one[- ]?time|verif|confirm|passcode|कोड|ओटीपी)/i;
const mark = (kind: string) => `[REDACTED:${kind}]`;

/**
 * Removes what the brief forbids sending: phone numbers, card numbers, e-mails, OTP-like numbers (plus cookies, tokens and keys via redactText).
 * Over-redaction is accepted; a missed secret is not.
 */
export function redactForModel(input: string): string {
  let s = redactText(input);
  s = s.replace(EMAIL, mark("email"));
  s = s.replace(PHONE, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return mark("card");
    return digits.length >= 10 && digits.length <= 15 ? mark("phone") : m;
  });
  return s.replace(/(?<![\w@.-])\d{4,8}(?![\w@-]|\.\w)/g, (m, at: number) => {
    if (m.length === 6) return mark("otp");
    return CODE_CUE.test(s.slice(Math.max(0, at - 120), at + m.length + 120)) ? mark("otp") : m;
  });
}

export interface ScreenOptions {
  allowlist: readonly string[];
  /** Soft words (see SOFT_WORD_NAMES) the user approved for this task. Hard words are ignored here by design. */
  approvedWords?: readonly string[];
}

const sensitiveWords = (texts: string[], approved: readonly string[]): string[] => {
  const hits = new Set<string>();
  for (const t of texts) {
    for (const [name, re] of Object.entries(HARD_WORDS)) if (re.test(t)) hits.add(name);
    for (const [name, re] of Object.entries(SOFT_WORDS)) if (re.test(t) && !approved.includes(name)) hits.add(name);
  }
  return [...hits];
};

/**
 * The only door between a phone screen and a model. Order matters and every early exit returns without looking at the nodes:
 * package -> FLAG_SECURE -> blank screenshot -> blocked site -> secret fields -> sensitive words -> redacted text.
 */
export function sanitizeScreen(screen: RawScreen, opts: ScreenOptions): ScreenResult {
  const pkg = checkPackage(screen.pkg, opts.allowlist);
  if (!pkg.allow) return { kind: "pause", reason: "package", detail: pkg.reason, group: pkg.group };
  if (screen.secure) return { kind: "stop", reason: "flag_secure" };
  if (screen.screenshot?.blank) return { kind: "stop", reason: "blank_screenshot" };
  if (hostBlocked(screen.url)) return { kind: "pause", reason: "blocked_host" };

  const isSecret = (n: RawNode) => n.password === true || (n.editable === true && SECRET_HINT.test([n.hint, n.desc].filter(Boolean).join(" ")));
  if (screen.nodes.some(isSecret)) return { kind: "pause", reason: "secret_field" };

  const texts = screen.nodes.flatMap((n) => [n.text, n.desc, n.hint]).filter((t): t is string => !!t);
  const words = sensitiveWords(texts, opts.approvedWords ?? []);
  if (words.length) return { kind: "pause", reason: "sensitive_word", words };

  const nodes: SafeNode[] = [];
  for (const n of screen.nodes) {
    const text = redactForModel([n.text, n.desc].filter(Boolean).join(" ").trim());
    if (!text && !n.clickable && !n.editable) continue;
    nodes.push({ id: n.id, ...(n.cls ? { cls: n.cls } : {}), text, ...(n.editable ? { editable: true } : {}), ...(n.clickable ? { clickable: true } : {}) });
  }
  const text = nodes.map((n) => `[${n.id}]${n.clickable ? " (tap)" : ""}${n.editable ? " (input)" : ""} ${n.text}`.trimEnd()).join("\n");
  return { kind: "ok", text, nodes };
}
