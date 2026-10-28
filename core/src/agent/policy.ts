import { getDomain } from "tldts";
import { secretKind } from "../privacy/redact";
import type { Action } from "../schema/actions";
import type { PageObservation } from "../page/types";

export type Gate = { verdict: "allow" } | { verdict: "block"; reason: string };

/**
 * Registrable domain from the Public Suffix List INCLUDING private suffixes, so victim.github.io and
 * attacker.github.io are different sites. IP addresses and unknown hosts compare by full hostname.
 */
export function siteOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return getDomain(host, { allowPrivateDomains: true }) ?? host;
  } catch {
    return undefined;
  }
}

export const sameSite = (a: string, b: string) => {
  const sa = siteOf(a);
  return sa !== undefined && sa === siteOf(b);
};

/** Sandbox tasks write files if declared, if the tool always writes, or if a script touches `output`. Never trust the claim alone. */
export const sandboxWrites = (a: Extract<Action, { type: "run_sandbox_task" }>) =>
  a.writesFiles || a.tool === "zip" || a.tool === "unzip" || a.tool === "shell" || /\boutput\b/.test(a.code);

/**
 * The user's own task is the permission, so nothing here asks. Only what can never be right is refused: an element that is not on
 * the page, and the model typing a secret or a redaction placeholder (the app fills secrets itself).
 */
export function gate(action: Action, obs: PageObservation): Gate {
  const el = "elementId" in action && action.elementId !== undefined ? obs.elements.find((e) => e.id === action.elementId) : undefined;
  if ("elementId" in action && action.elementId !== undefined && !el) {
    return { verdict: "block", reason: obs.url === "" ? "no page is open; navigate to a site first" : `no element [${action.elementId}] on this page; read the page again` };
  }
  if (action.type === "type" || action.type === "paste") {
    if (el && secretKind(el)) return { verdict: "block", reason: "secret field: use ask_user with secure input; the model never types secrets" };
    if (action.text.includes("[REDACTED")) return { verdict: "block", reason: "text contains a redaction placeholder; ask the user for the real value" };
  }
  return { verdict: "allow" };
}
