import { DEFAULTS } from "../config/defaults";
import { secretKind } from "../privacy/redact";
import type { Action } from "../schema/actions";
import type { PageElement, PageObservation } from "../page/types";
import type { ConfirmRequest } from "./ports";

export type Gate =
  | { verdict: "allow" }
  | { verdict: "confirm"; request: ConfirmRequest }
  | { verdict: "block"; reason: string };

const re = (src: string) => new RegExp(src, "i");
const COSMETIC = re(DEFAULTS.patterns.cosmeticClick);
const CONSENT = re(DEFAULTS.patterns.consentClick);
const RISKY = re(DEFAULTS.patterns.riskyClick);

const MULTI_PART_TLDS = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "co.in", "co.jp", "com.br", "co.nz", "com.sg"]);

/** Approximate registrable domain (no public-suffix list; small multi-part allowlist). */
export function siteOf(url: string): string | undefined {
  try {
    const labels = new URL(url).hostname.toLowerCase().split(".");
    if (labels.length <= 2) return labels.join(".");
    const lastTwo = labels.slice(-2).join(".");
    return labels.slice(MULTI_PART_TLDS.has(lastTwo) ? -3 : -2).join(".");
  } catch {
    return undefined;
  }
}

export const sameSite = (a: string, b: string) => {
  const sa = siteOf(a);
  return sa !== undefined && sa === siteOf(b);
};

const labelOf = (e: PageElement) => (e.label ?? e.text ?? e.name ?? e.placeholder ?? "").replace(/\s+/g, " ").trim();

export interface GateContext {
  obs: PageObservation;
  /** URL of the tab the user opened. */
  homeUrl: string;
  /** Text the agent typed or pasted since the last send. */
  drafts: string[];
}

/** Decides whether a validated action may run, needs the user's confirmation, or is refused. */
export function gate(action: Action, ctx: GateContext): Gate {
  const el = "elementId" in action && action.elementId !== undefined
    ? ctx.obs.elements.find((e) => e.id === action.elementId)
    : undefined;
  if ("elementId" in action && action.elementId !== undefined && !el) {
    return { verdict: "block", reason: `no element [${action.elementId}] on this page; read the page again` };
  }
  const host = new URL(ctx.obs.url).hostname;

  switch (action.type) {
    case "navigate":
      return sameSite(action.url, ctx.homeUrl)
        ? { verdict: "allow" }
        : { verdict: "confirm", request: { kind: "navigate", title: "Leave this site?", preview: action.url } };

    case "type":
    case "paste": {
      if (el && secretKind(el)) {
        return { verdict: "block", reason: "secret field: use ask_user with secure input; the model never types secrets" };
      }
      if (action.text.includes("[REDACTED")) {
        return { verdict: "block", reason: "text contains a redaction placeholder; ask the user for the real value" };
      }
      if (action.type === "type" && action.submit) {
        return { verdict: "confirm", request: { kind: "send", title: `Send on ${host}?`, preview: action.text } };
      }
      return { verdict: "allow" };
    }

    case "click": {
      if (!el) return { verdict: "allow" };
      const label = labelOf(el);
      if (el.href && !sameSite(new URL(el.href, ctx.obs.url).href, ctx.homeUrl)) {
        return { verdict: "confirm", request: { kind: "navigate", title: "Leave this site?", preview: el.href } };
      }
      if (CONSENT.test(label)) {
        return { verdict: "confirm", request: { kind: "consent", title: "Grant consent or permission?", preview: label } };
      }
      if (COSMETIC.test(label)) return { verdict: "allow" };
      if (el.type === "submit" || RISKY.test(label)) {
        const draft = ctx.drafts.length ? `\n\n${ctx.drafts.join("\n---\n")}` : "";
        return { verdict: "confirm", request: { kind: "send", title: `"${label || "Submit"}" on ${host}?`, preview: `Click "${label || "Submit"}"${draft}` } };
      }
      return { verdict: "allow" };
    }

    case "upload_selected_file":
      return { verdict: "allow" }; // confirmed after the user picks the file (needs the file name)

    case "run_sandbox_task":
      return action.writesFiles
        ? { verdict: "confirm", request: { kind: "sandbox", title: "Run task that writes files?", preview: `${action.tool}:\n${action.code}` } }
        : { verdict: "allow" };

    case "read":
    case "wait":
    case "ask_user":
    case "done":
      return { verdict: "allow" };
  }
}
