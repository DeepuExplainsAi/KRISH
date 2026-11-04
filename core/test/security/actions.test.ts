import { describe, expect, it } from "vitest";
import { approvePlan, consentKindOf, createPlan, describePlan, gatePhoneAction, parsePhoneAction, TaskSession, type PhoneAction } from "../../src/security/actions";
import type { SafeNode } from "../../src/security/screen";

const nodes: SafeNode[] = [
  { id: 1, text: "Search", editable: true },
  { id: 2, text: "Send", clickable: true },
  { id: 3, text: "Open video", clickable: true },
  { id: 4, text: "", clickable: true },
  { id: 5, text: "Pay now", clickable: true },
  { id: 6, text: "Delete account", clickable: true },
  { id: 7, text: "Share", clickable: true },
];
const plan = approvePlan(createPlan("watch a video", ["com.android.chrome", "com.google.android.youtube"]));
const ctx = (over = {}) => ({ plan, nodes, opened: new Set<string>(), steps: 0, ...over });
const g = (a: PhoneAction, over = {}) => gatePhoneAction(a, ctx(over));

describe("parsePhoneAction", () => {
  it("accepts strict JSON actions", () => {
    expect(parsePhoneAction('{"type":"tap","nodeId":3}')).toEqual({ type: "tap", nodeId: 3 });
    expect(parsePhoneAction({ type: "open_app", package: "com.android.chrome" })).toBeDefined();
  });
  it.each([
    "not json", '{"type":"tap"}', '{"type":"tap","nodeId":-1}', '{"type":"tap","nodeId":1,"extra":1}', '{"type":"shell","cmd":"rm -rf /"}',
    '{"type":"wait","ms":999999}', "null", "[]",
  ])("rejects %s", (s) => expect(parsePhoneAction(s)).toBeUndefined());
});

describe("consentKindOf", () => {
  it.each([
    ["Send", "send"], ["send message", "send"], ["Post", "post"], ["Publish", "post"], ["Pay now", "pay"], ["Pay and send", "pay"], ["Buy now", "pay"],
    ["Delete", "delete"], ["Remove photo", "delete"], ["Submit", "submit"], ["Place order", "pay"], ["Install", "install"], ["Share", "share"],
    ["भेजें", "send"], ["डिलीट करें", "delete"], ["शेयर", "share"], ["भुगतान करें", "pay"],
  ])("%s -> %s", (label, kind) => expect(consentKindOf(label)).toBe(kind));
  it("ignores harmless labels", () => {
    for (const l of ["Open video", "Back", "Search", "Home", "Playlist", "Postal code", "Like", "Done", "Messages", "Message"]) expect(consentKindOf(l), l).toBeUndefined();
  });
});

describe("gatePhoneAction", () => {
  it("blocks everything until the user approved the plan", () => {
    const unapproved = createPlan("x", ["com.android.chrome"]);
    expect(gatePhoneAction({ type: "read_screen" }, ctx({ plan: unapproved }))).toMatchObject({ verdict: "block" });
  });
  it("blocks actions outside the plan and past the step limit", () => {
    const small = approvePlan(createPlan("x", ["com.android.chrome"], ["read_screen", "done"]));
    expect(g({ type: "tap", nodeId: 3 }, { plan: small })).toMatchObject({ verdict: "block" });
    expect(g({ type: "read_screen" }, { plan: small })).toEqual({ verdict: "allow" });
    expect(g({ type: "read_screen" }, { steps: 60 })).toMatchObject({ verdict: "block" });
  });
  it("open_app: plan apps only, hard-blocked never, new app asks, reopened app does not", () => {
    expect(g({ type: "open_app", package: "com.android.chrome" })).toMatchObject({ verdict: "confirm", kind: "open_app" });
    expect(g({ type: "open_app", package: "com.android.chrome" }, { opened: new Set(["com.android.chrome"]) })).toEqual({ verdict: "allow" });
    expect(g({ type: "open_app", package: "com.instagram.android" })).toMatchObject({ verdict: "block", blockReason: "not_allowlisted" });
    expect(g({ type: "open_app", package: "com.phonepe.app" })).toMatchObject({ verdict: "block", blockReason: "hard_blocked" });
    const sneaky = { ...plan, apps: ["com.whatsapp"] };
    expect(g({ type: "open_app", package: "com.whatsapp" }, { plan: sneaky })).toMatchObject({ verdict: "block", blockReason: "hard_blocked" });
  });
  it("tap: confirms send/pay/delete/share and unlabeled controls, allows the rest", () => {
    expect(g({ type: "tap", nodeId: 3 })).toEqual({ verdict: "allow" });
    expect(g({ type: "tap", nodeId: 2 })).toMatchObject({ verdict: "confirm", kind: "send" });
    expect(g({ type: "tap", nodeId: 5 })).toMatchObject({ verdict: "confirm", kind: "pay" });
    expect(g({ type: "tap", nodeId: 6 })).toMatchObject({ verdict: "confirm", kind: "delete" });
    expect(g({ type: "tap", nodeId: 7 })).toMatchObject({ verdict: "confirm", kind: "share" });
    expect(g({ type: "tap", nodeId: 4 })).toMatchObject({ verdict: "confirm", kind: "unlabeled" });
  });
  it("tap/type: node must exist on the last screen; type needs an editable field", () => {
    expect(g({ type: "tap", nodeId: 99 })).toMatchObject({ verdict: "block" });
    expect(g({ type: "tap", nodeId: 3 }, { nodes: [] })).toMatchObject({ verdict: "block" });
    expect(g({ type: "type", nodeId: 3, text: "hi" })).toMatchObject({ verdict: "block" });
    expect(g({ type: "type", nodeId: 1, text: "cats" })).toEqual({ verdict: "allow" });
  });
  it("type: refuses placeholders, confirms line breaks", () => {
    expect(g({ type: "type", nodeId: 1, text: "[REDACTED:otp]" })).toMatchObject({ verdict: "block" });
    expect(g({ type: "type", nodeId: 1, text: "cats\n" })).toMatchObject({ verdict: "confirm", kind: "submit" });
  });
});

describe("TaskSession", () => {
  it("tracks opened apps, steps, and drops node ids after an action", () => {
    const s = new TaskSession(plan);
    s.setScreen(nodes);
    expect(s.check({ type: "tap", nodeId: 3 })).toEqual({ verdict: "allow" });
    s.executed({ type: "tap", nodeId: 3 });
    expect(s.steps).toBe(1);
    expect(s.check({ type: "tap", nodeId: 3 })).toMatchObject({ verdict: "block" }); // stale ids
    const open: PhoneAction = { type: "open_app", package: "com.google.android.youtube" };
    expect(s.check(open)).toMatchObject({ verdict: "confirm" });
    s.executed(open);
    expect(s.check(open)).toEqual({ verdict: "allow" });
  });
  it("read_screen keeps the nodes it just got", () => {
    const s = new TaskSession(plan);
    s.setScreen(nodes);
    s.executed({ type: "read_screen" });
    expect(s.nodes).toBe(nodes);
  });
});

describe("plan", () => {
  it("drops blocked apps when created and describes itself", () => {
    const p = createPlan("t", ["com.android.chrome", "com.whatsapp"]);
    expect(p.apps).toEqual(["com.android.chrome"]);
    expect(p.approved).toBe(false);
    expect(describePlan(p).join("\n")).toContain("com.android.chrome");
  });
});
