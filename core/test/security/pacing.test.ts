import { describe, expect, it } from "vitest";
import { isInstagram, isSocialApp, Pacer, SOCIAL_PACING } from "../../src/security/pacing";
import type { PhoneAction } from "../../src/security/actions";

const tap: PhoneAction = { type: "tap", nodeId: 1 };

describe("social detection", () => {
  it("flags social apps only", () => {
    for (const p of ["com.instagram.android", "com.zhiliaoapp.musically", "com.twitter.android", "com.google.android.youtube"]) expect(isSocialApp(p), p).toBe(true);
    for (const p of ["com.android.chrome", "com.openai.chatgpt", null, ""]) expect(isSocialApp(p), String(p)).toBe(false);
    expect(isInstagram("com.instagram.android")).toBe(true);
    expect(isInstagram("com.facebook.katana")).toBe(false);
  });
});

describe("Pacer", () => {
  it("random delay stays inside the social range; plain apps are quick", () => {
    for (const r of [0, 0.5, 0.999]) {
      const p = new Pacer(() => 0, () => r).check("com.instagram.android", tap);
      expect(p.ok && p.delayMs).toBeGreaterThanOrEqual(SOCIAL_PACING.minDelayMs);
      expect(p.ok && p.delayMs).toBeLessThanOrEqual(SOCIAL_PACING.maxDelayMs);
    }
    const q = new Pacer(() => 0, () => 1).check("com.android.chrome", tap);
    expect(q.ok && q.delayMs).toBeLessThan(1000);
  });
  it("reading and waiting are not delayed or counted", () => {
    const pacer = new Pacer(() => 0);
    for (let i = 0; i < 50; i++) pacer.record("com.instagram.android", { type: "read_screen" });
    expect(pacer.check("com.instagram.android", { type: "read_screen" })).toEqual({ ok: true, delayMs: 0 });
    expect(pacer.check("com.instagram.android", tap).ok).toBe(true);
  });
  it("caps per minute with a retry time, then recovers", () => {
    let now = 1_000_000;
    const pacer = new Pacer(() => now);
    for (let i = 0; i < SOCIAL_PACING.maxPerMinute; i++) {
      expect(pacer.check("com.instagram.android", tap).ok).toBe(true);
      pacer.record("com.instagram.android", tap);
      now += 1000;
    }
    const r = pacer.check("com.instagram.android", tap);
    expect(r).toMatchObject({ ok: false, window: "minute" });
    expect(!r.ok && r.retryAfterMs).toBeGreaterThan(0);
    now += 61_000;
    expect(pacer.check("com.instagram.android", tap).ok).toBe(true);
  });
  it("limits are per app", () => {
    const pacer = new Pacer(() => 5);
    for (let i = 0; i < SOCIAL_PACING.maxPerMinute; i++) pacer.record("com.instagram.android", tap);
    expect(pacer.check("com.instagram.android", tap).ok).toBe(false);
    expect(pacer.check("com.google.android.youtube", tap).ok).toBe(true);
  });
  it("daily cap holds even when minute and hour windows are clear", () => {
    let now = 0;
    const pacer = new Pacer(() => now);
    // 1 action per 2 minutes = 30/hour (< 120) but 720/day (> 600)
    let blocked: ReturnType<Pacer["check"]> | undefined;
    for (let i = 0; i < 700 && !blocked; i++) {
      const r = pacer.check("com.instagram.android", tap);
      if (!r.ok) blocked = r;
      else pacer.record("com.instagram.android", tap);
      now += 120_000;
    }
    expect(blocked).toMatchObject({ ok: false, window: "day" });
  });
});
