import policy from "../../security-policy/blocklist.json";

/** Why a package may not be used. */
export type BlockReason = "empty" | "invalid" | "not_allowlisted" | "hard_blocked";
export type PackageVerdict = { allow: true } | { allow: false; reason: BlockReason; group?: string };

interface Group {
  packages: string[];
  prefixes: string[];
  contains: string[];
  words: string[];
}

const GROUPS = Object.entries(policy.groups as Record<string, Group>);
const PACKAGE_NAME = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i;

/** Android package names are case-insensitive for our purposes: the same app must not slip through by casing. */
export const normalizePackage = (pkg: string) => pkg.trim().toLowerCase();

/** The hard-blocklist group a package belongs to, if any. Applies even to packages the user allowlisted. */
export function hardBlockGroup(pkg: string): string | undefined {
  const p = normalizePackage(pkg);
  const words = p.split(/[._]/);
  for (const [name, g] of GROUPS) {
    if (
      g.packages.some((x) => normalizePackage(x) === p) ||
      g.prefixes.some((x) => p.startsWith(normalizePackage(x))) ||
      g.contains.some((x) => p.includes(x)) ||
      g.words.some((x) => words.includes(x))
    ) return name;
  }
  return undefined;
}

/**
 * The single question the engine asks for every foreground package. Fails closed: an unknown, empty or malformed package is never allowed,
 * and the hard blocklist wins over the user's allowlist.
 */
export function checkPackage(pkg: string | null | undefined, allowlist: readonly string[]): PackageVerdict {
  if (pkg == null || pkg.trim() === "") return { allow: false, reason: "empty" };
  if (!PACKAGE_NAME.test(pkg.trim())) return { allow: false, reason: "invalid" };
  const group = hardBlockGroup(pkg);
  if (group) return { allow: false, reason: "hard_blocked", group };
  const p = normalizePackage(pkg);
  return allowlist.some((a) => normalizePackage(a) === p) ? { allow: true } : { allow: false, reason: "not_allowlisted" };
}

/** Cleans what the user picked: drops malformed and hard-blocked packages (with the reason, to show in the picker) and duplicates. */
export function sanitizeAllowlist(input: readonly string[]): { allowed: string[]; rejected: { pkg: string; reason: BlockReason; group?: string }[] } {
  const allowed: string[] = [];
  const rejected: { pkg: string; reason: BlockReason; group?: string }[] = [];
  for (const raw of input) {
    const v = checkPackage(raw, [raw]);
    if (v.allow) {
      const p = normalizePackage(raw);
      if (!allowed.includes(p)) allowed.push(p);
    } else rejected.push({ pkg: raw, reason: v.reason, group: v.group });
  }
  return { allowed, rejected };
}

/** Packages the agent itself needs for Mode A (the chat apps it types into). They still go through the same allowlist: the user must pick them. */
export const SUGGESTED_AI_APPS = ["com.openai.chatgpt", "com.google.android.apps.bard", "com.anthropic.claude"] as const;
