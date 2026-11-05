import { describe, expect, it } from "vitest";
import { luhn, redactText } from "../../src/privacy/redact";

describe("redactText", () => {
  it.each([
    ["password: hunter2", "hunter2"],
    ['{"password":"hunter2"}', "hunter2"],
    ["api_key=abc123secret", "abc123secret"],
    ["Authorization: Bearer abcdefghijklmnop12345", "abcdefghijklmnop12345"],
    ["Cookie: sid=abc; theme=dark", "sid=abc"],
    ["Set-Cookie: session=zzz; HttpOnly", "session=zzz"],
    ["card 4111 1111 1111 1111 exp", "4111 1111 1111 1111"],
    ["Your verification code is 482913", "482913"],
    ["OTP: 123456", "123456"],
    ["482913 is your login code", "482913"],
    ["key AIzaSyA1234567890abcdefghijklmnopqrstuv", "AIzaSyA1234567890abcdefghijklmnopqrstuv"],
    ["token ghp_abcdefghijklmnopqrstuvwxyz0123456789", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["jwt eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSMeKKF2QT4", "eyJhbGciOiJI"],
  ])("redacts %s", (input, secret) => {
    const out = redactText(input);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED");
  });

  it("keeps ordinary text and non-card numbers", () => {
    const s = "Order 1234567890123 shipped on 2026-10-23, total 4,999 rupees";
    expect(redactText(s)).toBe(s);
  });

  it("luhn", () => {
    expect(luhn("4111111111111111")).toBe(true);
    expect(luhn("4111111111111112")).toBe(false);
  });
});
