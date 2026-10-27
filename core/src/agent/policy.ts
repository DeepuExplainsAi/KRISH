import { getDomain } from "tldts";
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

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
/** Every visible-meaning label of a control. Pages control these, so a risky word in ANY of them counts. */
const labelsOf = (e: PageElement) => [e.label, e.text, e.title].map(norm).filter(Boolean);

/** A search field only looks things up: pressing Enter in it sends nothing anywhere, so it needs no approval. */
const SEARCH = /\bsearch\b|\bfind\b|\bsuche\b|\bbuscar\b|खोज|सर्च/i;
const isSearchBox = (e: PageElement) => e.tag === "input" && (e.type === "search" || SEARCH.test([e.label, e.placeholder, e.name, e.title, e.autocomplete].map(norm).join(" ")));

/** Sandbox tasks write files if declared, if the tool always writes, or if a script touches `output`. Never trust the claim alone. */
export const sandboxWrites = (a: Extract<Action, { type: "run_sandbox_task" }>) =>
  a.writesFiles || a.tool === "zip" || a.tool === "unzip" || a.tool === "shell" || /\boutput\b/.test(a.code);

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
  // No page open yet (url ""): there is nothing to protect or leave, and the first navigation picks the site.
  const pageless = ctx.obs.url === "";
  if ("elementId" in action && action.elementId !== undefined && !el) {
    return { verdict: "block", reason: pageless ? "no page is open; navigate to a site first" : `no element [${action.elementId}] on this page; read the page again` };
  }
  const host = pageless ? "" : new URL(ctx.obs.url).hostname;

  // The page may have moved to another site by redirect or script, not by an action we approved.
  const passive = action.type === "read" || action.type === "wait" || action.type === "scroll" || action.type === "ask_user" || action.type === "done" || action.type === "navigate";
  if (!passive && !pageless && !sameSite(ctx.obs.url, ctx.homeUrl)) {
    return { verdict: "confirm", request: { kind: "navigate", title: "The page moved to another site. Continue here?", preview: ctx.obs.url } };
  }

  switch (action.type) {
    case "navigate":
      return pageless || sameSite(action.url, ctx.homeUrl)
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
      if (action.type === "type" && action.submit && !(el && isSearchBox(el))) {
        return { verdict: "confirm", request: { kind: "send", title: `Send on ${host}?`, preview: action.text } };
      }
      return { verdict: "allow" };
    }

    case "click": {
      if (!el) return { verdict: "allow" };
      const labels = labelsOf(el);
      const label = labels[0] ?? "";
      const all = labels.join(" ");
      if (el.href && !sameSite(new URL(el.href, ctx.obs.url).href, ctx.homeUrl)) {
        return { verdict: "confirm", request: { kind: "navigate", title: "Leave this site?", preview: new URL(el.href, ctx.obs.url).href } };
      }
      if (CONSENT.test(all)) {
        return { verdict: "confirm", request: { kind: "consent", title: "Grant consent or permission?", preview: label } };
      }
      const submits = Boolean(el.submits) || el.type === "submit";
      if (!submits && labels.length > 0 && labels.every((l) => COSMETIC.test(l))) return { verdict: "allow" };
      if (submits || RISKY.test(all)) {
        const draft = ctx.drafts.length ? `\n\n${ctx.drafts.join("\n---\n")}` : "";
        return { verdict: "confirm", request: { kind: "send", title: `"${label || "Submit"}" on ${host}?`, preview: `Click "${label || "Submit"}"${draft}` } };
      }
      return { verdict: "allow" };
    }

    case "upload_selected_file":
      return { verdict: "allow" }; // confirmed after the user picks the file (needs the file name)

    case "run_sandbox_task":
      return sandboxWrites(action)
        ? { verdict: "confirm", request: { kind: "sandbox", title: action.tool === "shell" ? "Run this command in the Linux sandbox?" : "Run task that creates or changes sandbox files?", preview: `${action.tool}:\n${action.code}` } }
        : { verdict: "allow" };

    case "memory_add": // confirmed inside the loop, where the exact text (or the items to forget) is known
    case "memory_remove":
    case "read":
    case "wait":
    case "scroll":
    case "ask_user":
    case "done":
      return { verdict: "allow" };
  }
}
