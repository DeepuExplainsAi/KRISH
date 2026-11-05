
const mark = (kind: string) => `[REDACTED:${kind}]`;

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

/** Chat messages are free text, so a spoken "password is hunter2" must go too (not applied to page text: "password is incorrect" matters there). */
export function redactChat(input: string): string {
  return redactText(input).replace(/\b(password|passwd|pwd|passcode|pin|otp|cvv|cvc)\b(\s+(?:is|was|hai|hain|=|:)\s+)("[^"]*"|'[^']*'|\S+)/gi, (_m, k: string, sep: string) => `${k}${sep}${mark("secret")}`);
}

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
