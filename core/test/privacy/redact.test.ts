import { describe, expect, it } from "vitest";
import { formatObservation } from "../../src/page/format";
import { isSensitivePage, luhn, redactElement, redactText, secretKind } from "../../src/privacy/redact";

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

describe("fields and pages", () => {
  const el = (o: object) => ({ id: 1, tag: "input", ...o });
  it("detects secret fields", () => {
    expect(secretKind(el({ type: "password" }))).toBe("password");
    expect(secretKind(el({ type: "text", name: "otp" }))).toBe("otp");
    expect(secretKind(el({ type: "text", autocomplete: "one-time-code" }))).toBe("otp");
    expect(secretKind(el({ type: "text", autocomplete: "cc-number" }))).toBe("card");
    expect(secretKind(el({ type: "text", placeholder: "Card number" }))).toBe("card");
    expect(secretKind(el({ type: "text", name: "email" }))).toBeUndefined();
  });

  it("drops values of secret fields", () => {
    expect(redactElement(el({ type: "password", value: "hunter2" })).value).toBeUndefined();
    expect(redactElement(el({ type: "text", name: "q", value: "password: x1" })).value).toContain("[REDACTED");
  });

  it("flags sensitive pages by url and by fields", () => {
    expect(isSensitivePage({ url: "https://x.com/login", elements: [] })).toBe(true);
    expect(isSensitivePage({ url: "https://mybank.com/home", elements: [] })).toBe(true);
    expect(isSensitivePage({ url: "https://x.com/a", elements: [el({ type: "password" })] })).toBe(true);
    expect(isSensitivePage({ url: "https://x.com/a", elements: [el({ type: "text", name: "q" })] })).toBe(false);
    expect(isSensitivePage({ url: "garbage", elements: [] })).toBe(true);
  });

  it("formatObservation marks a hidden file input so the model can still target it", () => {
    const out = formatObservation({ url: "https://x.com/", title: "t", text: "", elements: [el({ tag: "input", type: "file", label: "Add your photo", hidden: true })] });
    expect(out).toMatch(/input\(file\) "Add your photo".*hidden-input/);
  });

  it("formatObservation never leaks secrets", () => {
    const out = formatObservation({
      url: "https://x.com/a?token=abc12345",
      title: "t",
      text: "Your code is fine. password: hunter2",
      elements: [el({ type: "password", value: "hunter2", label: "Password" })],
    });
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("abc12345");
    expect(out).toContain("(secret field)");
  });
});
