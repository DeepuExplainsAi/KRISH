import { DEFAULTS } from "../config/defaults";
import type { PageElement, PageObservation } from "../page/types";

const mark = (kind: string) => `[REDACTED:${kind}]`;
const re = (src: string) => new RegExp(src, "i");
const SECRET_FIELD = re(DEFAULTS.patterns.secretField);
const SENSITIVE_URL = re(DEFAULTS.patterns.sensitiveUrl);
const SENSITIVE_HOST = re(DEFAULTS.patterns.sensitiveHost);

export function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double && (d *= 2) > 9) d -= 9;
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const KEY_SHAPES = [
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g, // JWT
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bgsk_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

/** Removes secrets from text before it can reach a model, log or history. */
export function redactText(input: string): string {
  let s = input;
  s = s.replace(/\b(set-cookie|cookie)\s*:\s*[^\n]+/gi, `$1: ${mark("cookie")}`);
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, `Bearer ${mark("token")}`);
  s = s.replace(
    /\b(password|passwd|pwd|passcode|secret|token|api[_-]?key|access[_-]?key|auth|session(?:id)?|cvv|cvc|pin)\b(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi,
    (_m, k: string, sep: string) => `${k}${sep}${mark("secret")}`,
  );
  for (const shape of KEY_SHAPES) s = s.replace(shape, mark("token"));
  s = s.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? mark("card") : m;
  });
  s = s.replace(
    /\b(otp|one[- ]?time (?:code|password)|(?:verification|security|login|sign-?in|auth(?:entication)?|2fa) code|passcode)\b([^\n\d]{0,20})(\d{4,8})\b/gi,
    (_m, k: string, sep: string) => `${k}${sep}${mark("otp")}`,
  );
  s = s.replace(
    /\b\d{4,8}\b([^\n\d]{0,20}\bis your (?:\w+ )?code)/gi,
    (_m, tail: string) => `${mark("otp")}${tail}`,
  );
  return s;
}

export type SecretKind = "password" | "otp" | "card" | "hidden";

/** Which kind of secret an input field collects, if any. */
export function secretKind(el: PageElement): SecretKind | undefined {
  const ac = el.autocomplete ?? "";
  if (el.type === "password" || /password/i.test(ac)) return "password";
  if (/one-time-code/i.test(ac)) return "otp";
  if (/^cc-/i.test(ac)) return "card";
  if (el.type === "hidden") return "hidden";
  if (el.tag !== "input" && el.tag !== "textarea") return undefined;
  const hint = [el.name, el.label, el.placeholder].filter(Boolean).join(" ");
  if (!SECRET_FIELD.test(hint)) return undefined;
  if (/otp|2fa|mfa|one.?time|verification|security.?code/i.test(hint)) return "otp";
  if (/card|cc|cvv|cvc/i.test(hint)) return "card";
  return "password";
}

export function redactElement(el: PageElement): PageElement {
  const out: PageElement = { ...el };
  if (secretKind(el)) delete out.value;
  else if (out.value !== undefined) out.value = redactText(out.value);
  if (out.text) out.text = redactText(out.text);
  if (out.href) out.href = redactText(out.href);
  return out;
}

export function isSensitivePage(obs: Pick<PageObservation, "url" | "elements">): boolean {
  let url: URL | undefined;
  try {
    url = new URL(obs.url);
  } catch {
    return true; // unknown page: treat as sensitive
  }
  if (SENSITIVE_HOST.test(url.hostname) || SENSITIVE_URL.test(url.pathname)) return true;
  return obs.elements.some((e) => {
    const k = secretKind(e);
    return k === "password" || k === "otp" || k === "card";
  });
}
