import { DEFAULTS } from "../config/defaults";
import { redactElement, redactText } from "../privacy/redact";
import type { PageObservation } from "./types";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Simplified, redacted text view of a page for the model. */
export function formatObservation(obs: PageObservation, maxChars: number = DEFAULTS.agent.observationMaxChars): string {
  const lines = obs.elements.slice(0, DEFAULTS.agent.observationMaxElements).map((raw) => {
    const e = redactElement(raw);
    const name = oneLine(e.label ?? e.text ?? e.placeholder ?? e.name ?? "");
    const parts = [`[${e.id}] ${e.tag}${e.type ? `(${e.type})` : ""}`, `"${clip(name, 80)}"`];
    if (e.value !== undefined) parts.push(`value="${clip(oneLine(e.value), 60)}"`);
    else if (raw.type === "password" || raw.autocomplete) parts.push("(secret field)");
    if (e.href) parts.push(`href=${clip(e.href, 120)}`);
    if (e.disabled) parts.push("disabled");
    if (e.hidden) parts.push("hidden-input");
    return parts.join(" ");
  });
  return [
    `url: ${redactText(obs.url)}`,
    `title: ${clip(redactText(obs.title), 120)}`,
    `text:\n${clip(redactText(oneLine(obs.text)), maxChars)}`,
    `elements:\n${lines.join("\n")}`,
  ].join("\n");
}
