import { describe, expect, it } from "vitest";
import { gate, sameSite, sandboxWrites } from "../../src/agent/policy";
import type { Action } from "../../src/schema/actions";
import type { PageElement } from "../../src/page/types";

const obs = (elements: PageElement[], url = "https://app.test/") => ({ url, title: "t", text: "", elements });
const click = (id: number): Action => ({ type: "click", elementId: id });

describe("gate", () => {
  it("lets every step the task needs through: send, submit, consent, other sites", () => {
    for (const e of [{ text: "Send", submits: true }, { text: "Delete account" }, { text: "Accept all" }, { text: "Pay now", type: "submit" }]) {
      expect(gate(click(1), obs([{ id: 1, tag: "button", ...e }])).verdict).toBe("allow");
    }
    expect(gate({ type: "navigate", url: "https://other.test/" }, obs([])).verdict).toBe("allow");
    expect(gate(click(1), obs([{ id: 1, tag: "a", text: "Docs", href: "https://other.test/" }])).verdict).toBe("allow");
    expect(gate(click(1), obs([{ id: 1, tag: "a", text: "Docs" }], "https://evil.test/")).verdict).toBe("allow");
  });
  it("blocks an element that is not on the page", () => {
    expect(gate(click(9), obs([{ id: 1, tag: "button" }]))).toMatchObject({ verdict: "block" });
    expect(gate(click(1), obs([], ""))).toMatchObject({ verdict: "block", reason: expect.stringContaining("no page") });
  });
  it("blocks the model typing into a secret field or typing a redaction placeholder", () => {
    const page = obs([{ id: 1, tag: "input", type: "password" }, { id: 2, tag: "input", type: "text" }]);
    expect(gate({ type: "type", elementId: 1, text: "x" }, page).verdict).toBe("block");
    expect(gate({ type: "paste", elementId: 1, text: "x" }, page).verdict).toBe("block");
    expect(gate({ type: "type", elementId: 2, text: "[REDACTED]" }, page).verdict).toBe("block");
    expect(gate({ type: "type", elementId: 2, text: "hello", submit: true }, page).verdict).toBe("allow");
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
});

describe("sandbox write claim", () => {
  const t = (tool: "zip" | "unzip" | "script" | "text", code: string, writesFiles = false): Extract<Action, { type: "run_sandbox_task" }> => ({ type: "run_sandbox_task", tool, code, writesFiles });
  it("never trusts writesFiles:false", () => {
    expect(sandboxWrites(t("zip", "{}"))).toBe(true);
    expect(sandboxWrites(t("unzip", "{}"))).toBe(true);
    expect(sandboxWrites(t("script", 'output["a"]="x"'))).toBe(true);
    expect(sandboxWrites(t("script", "1+1"))).toBe(false);
  });
});
