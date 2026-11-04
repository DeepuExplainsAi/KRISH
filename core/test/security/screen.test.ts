import { describe, expect, it } from "vitest";
import { redactForModel, sanitizeScreen, type RawNode, type RawScreen } from "../../src/security/screen";

const allowlist = ["com.android.chrome", "com.instagram.android"];
const n = (id: number, text: string, extra: Partial<RawNode> = {}): RawNode => ({ id, text, ...extra });
const screen = (nodes: RawNode[], extra: Partial<RawScreen> = {}): RawScreen => ({ pkg: "com.android.chrome", nodes, ...extra });
const run = (s: RawScreen, approvedWords?: string[]) => sanitizeScreen(s, { allowlist, approvedWords });

describe("sanitizeScreen: gate order", () => {
  it("passes a harmless screen with ids and redacted text", () => {
    const r = run(screen([n(1, "Top videos"), n(2, "", { clickable: true, desc: "Search" })]));
    expect(r).toMatchObject({ kind: "ok" });
    if (r.kind === "ok") expect(r.text).toBe("[1] Top videos\n[2] (tap) Search");
  });
  it("pauses on a non-allowlisted or blocked app and returns no screen text", () => {
    for (const pkg of ["com.example.other", "com.whatsapp", "com.phonepe.app", null]) {
      const r = run(screen([n(1, "secret chat text")], { pkg }));
      expect(r).toMatchObject({ kind: "pause", reason: "package" });
      expect(JSON.stringify(r)).not.toContain("secret chat");
    }
  });
  it("hard-blocked app stays blocked even if allowlisted", () => {
    const r = sanitizeScreen(screen([n(1, "x")], { pkg: "com.google.android.gm" }), { allowlist: ["com.google.android.gm"] });
    expect(r).toMatchObject({ kind: "pause", reason: "package", detail: "hard_blocked" });
  });
  it("stops on FLAG_SECURE and on a blank screenshot", () => {
    expect(run(screen([n(1, "x")], { secure: true }))).toEqual({ kind: "stop", reason: "flag_secure" });
    expect(run(screen([n(1, "x")], { screenshot: { blank: true } }))).toEqual({ kind: "stop", reason: "blank_screenshot" });
    expect(run(screen([n(1, "x")], { screenshot: { blank: false } })).kind).toBe("ok");
  });
  it("package check wins over FLAG_SECURE (nothing about a foreign screen is reported)", () => {
    expect(run(screen([], { pkg: "com.example.other", secure: true }))).toMatchObject({ kind: "pause", reason: "package" });
  });
  it("pauses on blocked sites inside an allowed browser", () => {
    for (const url of ["https://accounts.google.com/signin", "myaccount.google.com", "https://sub.paypal.com/x", "https://play.google.com/store/apps"])
      expect(run(screen([n(1, "x")], { url }))).toEqual({ kind: "pause", reason: "blocked_host" });
    expect(run(screen([n(1, "x")], { url: "https://www.youtube.com/watch?v=1" })).kind).toBe("ok");
    expect(run(screen([n(1, "x")], { url: "https://notpaypal.com" })).kind).toBe("ok");
  });
});

describe("secret fields", () => {
  it("pauses on password nodes and never returns their text", () => {
    const r = run(screen([n(1, "hunter2", { password: true }), n(2, "Welcome")]));
    expect(r).toEqual({ kind: "pause", reason: "secret_field" });
  });
  it("pauses on editable fields whose hint asks for a code or card", () => {
    expect(run(screen([n(1, "", { editable: true, hint: "Enter card number" })])).kind).toBe("pause");
    expect(run(screen([n(1, "", { editable: true, hint: "Search" })])).kind).toBe("ok");
  });
});

describe("sensitive words", () => {
  it.each([
    ["Enter OTP", "otp"], ["Your PIN", "pin"], ["CVV", "cvv"], ["Password", "password"], ["Log in", "login"], ["Login", "login"],
    ["Sign in with Google", "sign in"], ["sign-in", "sign in"], ["Pay now", "pay"], ["Payment method", "pay"], ["पासवर्ड डालें", "password"],
  ])("pauses on %s", (text, word) => {
    const r = run(screen([n(1, text)]));
    expect(r).toMatchObject({ kind: "pause", reason: "sensitive_word" });
    if (r.kind === "pause" && r.reason === "sensitive_word") expect(r.words).toContain(word);
  });
  it("also looks at content descriptions and hints", () => {
    expect(run(screen([n(1, "", { desc: "Enter PIN" })])).kind).toBe("pause");
    expect(run(screen([n(1, "", { hint: "Password" })])).kind).toBe("pause");
  });
  it("does not trigger on look-alike words", () => {
    for (const t of ["Pinterest", "Spinning", "Payload", "Paycheck? no", "Logistics", "Singing"]) expect(run(screen([n(1, t)])).kind, t).toBe("ok");
  });
  it("lets the user approve the soft word 'pay' but never hard words", () => {
    expect(run(screen([n(1, "Please pay attention")]), ["pay"]).kind).toBe("ok");
    expect(run(screen([n(1, "Enter OTP")]), ["otp", "pay"]).kind).toBe("pause");
    expect(run(screen([n(1, "Log in"), n(2, "Pay")]), ["pay", "login"])).toMatchObject({ kind: "pause", words: ["login"] });
  });
});

describe("redactForModel", () => {
  it.each([
    ["call +91 98765 43210 now", "98765"],
    ["call 9876543210", "9876543210"],
    ["(415) 555-2671", "555-2671"],
    ["mail me at jane.doe+x@example.co.uk", "jane.doe"],
    ["card 4111 1111 1111 1111", "4111"],
    ["code 4821 for you", "4821"],
    ["482913", "482913"],
    ["Bearer abcdefghijklmnop12345", "abcdefghijklmnop12345"],
  ])("removes secrets from %s", (input, secret) => {
    const out = redactForModel(input);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED");
  });
  it("keeps ordinary numbers", () => {
    expect(redactForModel("1,234 likes, 56 comments, since 2024")).toBe("1,234 likes, 56 comments, since 2024");
  });
  it("is applied to every returned node", () => {
    const r = run(screen([n(1, "Mail a@b.com or 9876543210", { desc: "x@y.org" })]));
    expect(r.kind === "ok" && r.text).not.toMatch(/a@b\.com|9876543210|x@y\.org/);
  });
});
