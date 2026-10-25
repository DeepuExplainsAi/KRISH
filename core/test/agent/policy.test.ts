import { describe, expect, it } from "vitest";
import { gate, sameSite, sandboxWrites, type GateContext } from "../../src/agent/policy";
import type { Action } from "../../src/schema/actions";
import type { PageElement } from "../../src/page/types";

const home = "https://app.test/";
const ctx = (elements: PageElement[], url = home, drafts: string[] = []): GateContext => ({ obs: { url, title: "t", text: "", elements }, homeUrl: home, drafts });
const click = (id: number): Action => ({ type: "click", elementId: id });
const verdict = (e: Partial<PageElement>, over: Partial<GateContext> = {}) => gate(click(1), { ...ctx([{ id: 1, tag: "button", ...e }]), ...over }).verdict;

describe("click gate", () => {
  it("asks for a submit button even when its aria-label looks cosmetic", () => {
    expect(verdict({ type: "submit", label: "Close", text: "Send" })).toBe("confirm");
    expect(verdict({ label: "Close", text: "Send", submits: true })).toBe("confirm");
  });
  it("asks when ANY label is risky, not just the first one", () => {
    expect(verdict({ label: "Continue", text: "Delete account" })).toBe("confirm");
    expect(verdict({ label: "Close", title: "Remove everything" })).toBe("confirm");
  });
  it("treats an implicit-submit button (effective type, no attribute) as a send", () => {
    expect(verdict({ text: "Continue", submits: true })).toBe("confirm");
  });
  it("still dismisses a purely cosmetic popup button", () => {
    expect(verdict({ text: "Not now" })).toBe("allow");
    expect(verdict({ label: "Close", text: "Close" })).toBe("allow");
  });
  it("blocks hidden-word tricks: cosmetic text with a consent label", () => {
    expect(verdict({ label: "Accept all", text: "Close" })).toBe("confirm");
  });
});

describe("site boundary", () => {
  it("separates tenants on shared suffixes", () => {
    expect(sameSite("https://victim.github.io/", "https://attacker.github.io/")).toBe(false);
    expect(sameSite("https://a.blogspot.com/", "https://b.blogspot.com/")).toBe(false);
    expect(sameSite("https://www.example.co.uk/", "https://shop.example.co.uk/")).toBe(true);
    expect(sameSite("https://mail.example.com/", "https://www.example.com/")).toBe(true);
    expect(sameSite("https://10.0.0.1/", "https://10.0.0.2/")).toBe(false);
  });
  it("asks before acting on a page that is no longer on the approved site (redirect or script navigation)", () => {
    const g = gate(click(1), ctx([{ id: 1, tag: "a", text: "Docs" }], "https://evil.test/"));
    expect(g).toMatchObject({ verdict: "confirm", request: { kind: "navigate" } });
    expect(gate({ type: "read" }, ctx([], "https://evil.test/")).verdict).toBe("allow");
  });
});

describe("sandbox write claim", () => {
  const t = (tool: "zip" | "unzip" | "script" | "text", code: string, writesFiles = false): Extract<Action, { type: "run_sandbox_task" }> => ({ type: "run_sandbox_task", tool, code, writesFiles });
  it("never trusts writesFiles:false", () => {
    expect(sandboxWrites(t("zip", "{}"))).toBe(true);
    expect(sandboxWrites(t("unzip", "{}"))).toBe(true);
    expect(sandboxWrites(t("script", 'output["a"]="x"'))).toBe(true);
    expect(sandboxWrites(t("script", "1+1"))).toBe(false);
    expect(gate(t("zip", "{}"), ctx([])).verdict).toBe("confirm");
  });
});
