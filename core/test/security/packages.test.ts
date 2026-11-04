import { describe, expect, it } from "vitest";
import { checkPackage, hardBlockGroup, sanitizeAllowlist, SUGGESTED_AI_APPS } from "../../src/security/packages";

const ALLOWED = ["com.android.chrome", "com.google.android.youtube", "com.instagram.android"];

describe("checkPackage", () => {
  it("allows only allowlisted packages", () => {
    expect(checkPackage("com.android.chrome", ALLOWED)).toEqual({ allow: true });
    expect(checkPackage("com.example.game", ALLOWED)).toEqual({ allow: false, reason: "not_allowlisted" });
  });
  it("fails closed on empty, null and malformed packages", () => {
    for (const p of [null, undefined, "", "  "]) expect(checkPackage(p, ["x.y"])).toMatchObject({ allow: false, reason: "empty" });
    for (const p of ["chrome", "com..x", "com.a b", "../etc"]) expect(checkPackage(p, [p])).toMatchObject({ allow: false, reason: "invalid" });
  });
  it("empty allowlist allows nothing", () => {
    expect(checkPackage("com.android.chrome", [])).toMatchObject({ allow: false });
  });
  it("is case-insensitive in both directions", () => {
    expect(checkPackage("COM.Android.Chrome", ALLOWED)).toEqual({ allow: true });
    expect(checkPackage("com.android.chrome", ["Com.Android.CHROME"])).toEqual({ allow: true });
  });
  it.each([
    ["com.phonepe.app", "finance"],
    ["com.google.android.apps.nbu.paisa.user", "finance"],
    ["net.one97.paytm", "finance"],
    ["com.hdfcbank.mobile", "finance"],
    ["in.co.somebank.app", "finance"],
    ["com.unknown.upi.client", "finance"],
    ["com.google.android.gm", "private_chat_and_mail"],
    ["com.whatsapp", "private_chat_and_mail"],
    ["com.whatsapp.w4b", "private_chat_and_mail"],
    ["com.google.android.apps.messaging", "private_chat_and_mail"],
    ["org.telegram.messenger", "private_chat_and_mail"],
    ["com.google.android.apps.authenticator2", "auth_and_passwords"],
    ["com.x8bit.bitwarden", "auth_and_passwords"],
    ["com.example.mypasswordsafe", "auth_and_passwords"],
    ["com.android.settings", "system_and_accounts"],
    ["com.android.settings.intelligence", "system_and_accounts"],
    ["com.android.vending", "system_and_accounts"],
    ["com.google.android.gms", "system_and_accounts"],
  ])("hard-blocks %s (%s) even when the user allowlisted it", (pkg, group) => {
    expect(hardBlockGroup(pkg)).toBe(group);
    expect(checkPackage(pkg, [pkg])).toEqual({ allow: false, reason: "hard_blocked", group });
  });
  it("does not block the apps the owner named", () => {
    for (const p of [...ALLOWED, ...SUGGESTED_AI_APPS]) expect(hardBlockGroup(p), p).toBeUndefined();
  });
});

describe("sanitizeAllowlist", () => {
  it("drops blocked, malformed and duplicate entries and reports why", () => {
    const r = sanitizeAllowlist(["com.android.chrome", "COM.ANDROID.CHROME", "com.whatsapp", "nope", "com.phonepe.app"]);
    expect(r.allowed).toEqual(["com.android.chrome"]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["hard_blocked", "invalid", "hard_blocked"]);
  });
});
