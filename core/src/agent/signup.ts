import type { PageElement, PageObservation } from "../page/types";

/** What a sign-up form says about its password, read from the visible page text. */
export interface PasswordRules {
  length: number;
  symbols: boolean;
}

export const DEFAULT_PASSWORD_LENGTH = 14;
const MIN_LENGTH = 8;
const MAX_LENGTH = 64;

/**
 * Reads the visible password rules ("at least 10 characters", "8-20 characters", "no special characters"). Without rules: 14 characters
 * with upper and lower case letters, digits and one "!". A minimum longer than 14 is met; a maximum shorter than 14 is kept.
 */
export function passwordRules(text: string): PasswordRules {
  const t = text.replace(/\s+/g, " ").toLowerCase();
  let length = DEFAULT_PASSWORD_LENGTH;
  const range = /(\d{1,2})\s*(?:-|–|to|and)\s*(\d{1,2})\s*(?:characters|chars|letters|symbols)/.exec(t);
  const min = /(?:at least|minimum(?: of)?|min\.?|no fewer than|more than)\s*(\d{1,2})\s*(?:characters|chars|letters)/.exec(t) ?? /(\d{1,2})\s*(?:\+|or more)\s*(?:characters|chars)/.exec(t);
  const max = /(?:at most|maximum(?: of)?|max\.?|no more than|up to|less than)\s*(\d{1,2})\s*(?:characters|chars|letters)/.exec(t);
  if (range) {
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    if (lo <= hi) length = Math.min(Math.max(length, lo), hi);
  }
  if (min) length = Math.max(length, Number(min[1]) + (/more than/.test(min[0]) ? 1 : 0));
  if (max) length = Math.min(length, Number(max[1]) - (/less than/.test(max[0]) ? 1 : 0));
  length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, length));
  const symbols = !/(no|without|not allowed|cannot (?:contain|use|include))\s*(?:any\s*)?(?:special|symbol)|(?:special characters?|symbols?) (?:are )?not allowed|only letters and (?:numbers|digits)|letters and numbers only|alphanumeric only/.test(t);
  return { length, symbols };
}

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";

/** Uniform random index below n (rejection sampling, no modulo bias). */
function randomBelow(n: number, rand: (buf: Uint32Array<ArrayBuffer>) => unknown): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    rand(buf);
    if (buf[0]! < limit) return buf[0]! % n;
  }
}

const cryptoRand = (buf: Uint32Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(buf);

/** A new password: at least one upper case letter, one lower case letter and one digit, plus exactly one "!" when symbols are allowed. */
export function generatePassword(rules: PasswordRules = { length: DEFAULT_PASSWORD_LENGTH, symbols: true }, rand: (buf: Uint32Array<ArrayBuffer>) => unknown = cryptoRand): string {
  const all = UPPER + LOWER + DIGITS;
  const pick = (set: string) => set[randomBelow(set.length, rand)]!;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  if (rules.symbols) chars.push("!");
  while (chars.length < rules.length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1, rand);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

/** The site turned the email down: a temporary/disposable address is refused, or it is already used. The agent must stop and ask, never try another address on its own. */
export const REJECTED_EMAIL =
  /(?:temporary|disposable|throw-?away|burner|temp)\s*(?:e-?mails?|addresses|e-?mail addresses?|inboxes)?\s*(?:are|is)?\s*(?:not\s*(?:allowed|supported|accepted|permitted)|blocked|banned|unsupported)|(?:e-?mail|address|account)[^.!?\n]{0,40}(?:already\s*(?:in use|registered|taken|exists|used|associated)|not\s*(?:allowed|supported|accepted|permitted)|is\s*(?:invalid|blocked|banned))|(?:use|enter|try)\s*(?:a\s*)?(?:different|another|valid|real|permanent)\s*e-?mail|e-?mail\s*(?:domain|provider)\s*(?:is\s*)?not\s*(?:allowed|supported|accepted)|we (?:don't|do not|cannot|can't) accept (?:this|that|these)\s*e-?mail/i;

/** The sentence around a rejection, for the question to the user (page text, already redacted by the caller). */
export function rejectionText(text: string): string | undefined {
  const m = REJECTED_EMAIL.exec(text);
  if (!m) return undefined;
  const start = Math.max(0, text.lastIndexOf(".", m.index) + 1, m.index - 120);
  return text.slice(start, Math.min(text.length, m.index + m[0].length + 60)).replace(/\s+/g, " ").trim().slice(0, 200);
}

const isEmailField = (e: PageElement) =>
  e.tag === "input" && (e.type === "email" || /e-?mail/i.test([e.name, e.label, e.placeholder, e.autocomplete].filter(Boolean).join(" ")));

export const looksLikeEmailField = isEmailField;

/** The email typed into the sign-up form (an email field's value), for the vault entry. */
export function emailOnForm(obs: PageObservation): string | undefined {
  for (const e of obs.elements) if (isEmailField(e) && e.value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.value.trim())) return e.value.trim();
  return undefined;
}
