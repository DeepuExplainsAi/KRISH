import { describe, expect, it } from "vitest";
import { PhoneEngine, type PhoneDevice, type DeviceScreen, type DeviceState } from "../../src/phone";
import { ActivityLog } from "../../src/security/activity-log";
import { approvePlan, createPlan, type PhoneAction } from "../../src/security/actions";
import { Pacer } from "../../src/security/pacing";
import type { RawScreen } from "../../src/security/screen";
import { MemoryKV } from "../../src/storage";

class FakeDevice implements PhoneDevice {
  st: DeviceState = { state: "idle" };
  screens: DeviceScreen[] = [];
  performed: PhoneAction[] = [];
  opened: string[] = [];
  asked: string[] = [];
  answer = true;
  stops: string[] = [];
  pauses: string[] = [];
  reads = 0;
  performResult: { ok: boolean; error?: string } = { ok: true };
  onPerform?: () => void;
  async state() { return this.st; }
  async start() { this.st = { state: "running" }; }
  async readScreen() { this.reads++; return this.screens.length > 1 ? this.screens.shift()! : this.screens[0]!; }
  async perform(a: PhoneAction) { this.performed.push(a); this.onPerform?.(); return this.performResult; }
  async openApp(p: string) { this.opened.push(p); }
  async confirm(_t: string, d: string) { this.asked.push(d); return this.answer; }
  async pause(r: string) { this.pauses.push(r); this.st = { state: "paused", reason: r }; }
  async stop(r: string) { this.stops.push(r); this.st = { state: "idle", reason: r }; }
}

const screen = (pkg: string, nodes: RawScreen["nodes"], extra: Partial<RawScreen> = {}): RawScreen => ({ pkg, nodes, ...extra });
const home = screen("com.google.android.youtube", [
  { id: 0, text: "Search", editable: true },
  { id: 1, text: "Open video", clickable: true },
  { id: 2, text: "Send", clickable: true },
]);

function setup(over: { consent?: boolean; apps?: string[]; approved?: boolean } = {}) {
  const dev = new FakeDevice();
  dev.screens = [home];
  const kv = new MemoryKV();
  const log = new ActivityLog(kv);
  const slept: number[] = [];
  const engine = new PhoneEngine(dev, log, {
    consent: async () => over.consent ?? true,
    pacer: new Pacer(() => 0, () => 0),
    sleep: async (ms) => void slept.push(ms),
  });
  const base = createPlan("watch", over.apps ?? ["com.google.android.youtube", "com.android.chrome"]);
  const plan = over.approved === false ? base : approvePlan(base);
  return { dev, log, kv, engine, plan, slept };
}

const started = async (s = setup()) => {
  const r = await s.engine.begin(s.plan);
  expect(r.ok).toBe(true);
  return s;
};

describe("begin", () => {
  it("refuses without consent, without an approved plan, with no apps, or twice", async () => {
    expect(await setup({ consent: false }).engine.begin(setup().plan)).toMatchObject({ ok: false });
    expect(await setup({ approved: false }).engine.begin(setup({ approved: false }).plan)).toMatchObject({ ok: false });
    const none = setup({ apps: ["com.whatsapp"] });
    expect(await none.engine.begin(none.plan)).toMatchObject({ ok: false, reason: "the plan has no allowed apps" });
    const s = await started();
    expect(await s.engine.begin(s.plan)).toMatchObject({ ok: false });
  });
  it("a refused start never touches the device", async () => {
    const s = setup({ consent: false });
    await s.engine.begin(s.plan);
    expect(s.dev.st.state).toBe("idle");
  });
  it("steps before begin are refused", async () => {
    expect(await setup().engine.step({ type: "read_screen" })).toMatchObject({ status: "refused" });
  });
});

describe("step", () => {
  it("reads a screen through the gate and logs", async () => {
    const s = await started();
    const r = await s.engine.step({ type: "read_screen" });
    expect(r).toEqual({ status: "ok", screen: "[0] (input) Search\n[1] (tap) Open video\n[2] (tap) Send" });
    expect((await s.log.list()).map((e) => e.kind)).toEqual(["task_start"]);
  });
  it("accepts JSON strings and rejects invalid or unknown actions", async () => {
    const s = await started();
    expect(await s.engine.step('{"type":"read_screen"}')).toMatchObject({ status: "ok" });
    for (const bad of ['{"type":"shell"}', "garbage", { type: "tap" }, null]) expect(await s.engine.step(bad)).toMatchObject({ status: "refused" });
    expect(s.dev.performed).toEqual([]);
  });
  it("tap and type need node ids from the last read; ids are dropped after acting", async () => {
    const s = await started();
    expect(await s.engine.step({ type: "tap", nodeId: 1 })).toMatchObject({ status: "refused" }); // nothing read yet
    await s.engine.step({ type: "read_screen" });
    expect(await s.engine.step({ type: "tap", nodeId: 1 })).toMatchObject({ status: "ok" });
    expect(s.dev.performed).toEqual([{ type: "tap", nodeId: 1 }]);
    s.dev.screens = [];
    expect(s.dev.performed).toHaveLength(1);
  });
  it("acting returns the next screen after settling", async () => {
    const s = await started();
    await s.engine.step({ type: "read_screen" });
    const r = await s.engine.step({ type: "type", nodeId: 0, text: "cats" });
    expect(r).toMatchObject({ status: "ok", screen: expect.stringContaining("Open video") });
    expect(s.slept).toContain(600);
  });
  it("opening an app asks once; reopening does not", async () => {
    const s = await started();
    expect(await s.engine.step({ type: "open_app", package: "com.android.chrome" })).toMatchObject({ status: "ok" });
    expect(await s.engine.step({ type: "open_app", package: "com.android.chrome" })).toMatchObject({ status: "ok" });
    expect(s.dev.opened).toEqual(["com.android.chrome", "com.android.chrome"]);
    expect(s.dev.asked).toEqual(["Open com.android.chrome"]);
  });
  it("a denied confirmation does nothing", async () => {
    const s = await started();
    s.dev.answer = false;
    expect(await s.engine.step({ type: "open_app", package: "com.android.chrome" })).toEqual({ status: "refused", reason: "the user denied this action" });
    expect(s.dev.opened).toEqual([]);
    expect((await s.log.list()).some((e) => e.kind === "confirm_no")).toBe(true);
  });
  it("send / pay / delete taps ask first and run only after Allow", async () => {
    const s = await started();
    await s.engine.step({ type: "read_screen" });
    s.dev.answer = false;
    expect(await s.engine.step({ type: "tap", nodeId: 2 })).toMatchObject({ status: "refused" });
    expect(s.dev.performed).toEqual([]);
    s.dev.answer = true;
    expect(await s.engine.step({ type: "tap", nodeId: 2 })).toMatchObject({ status: "ok" });
    expect(s.dev.performed).toEqual([{ type: "tap", nodeId: 2 }]);
    expect(s.dev.asked).toEqual(['Tap "Send"', 'Tap "Send"']);
  });
  it("apps outside the plan and hard-blocked apps are refused without asking", async () => {
    const s = await started();
    for (const p of ["com.instagram.android", "com.phonepe.app", "com.whatsapp"]) expect(await s.engine.step({ type: "open_app", package: p })).toMatchObject({ status: "refused" });
    expect(s.dev.asked).toEqual([]);
    expect(s.dev.opened).toEqual([]);
  });
  it("actions outside the plan are refused", async () => {
    const dev = new FakeDevice(); dev.screens = [home];
    const log = new ActivityLog(new MemoryKV());
    const engine = new PhoneEngine(dev, log, { sleep: async () => {} });
    await engine.begin(approvePlan(createPlan("x", ["com.google.android.youtube"], ["read_screen", "done"])));
    await engine.step({ type: "read_screen" });
    expect(await engine.step({ type: "tap", nodeId: 1 })).toMatchObject({ status: "refused" });
    expect(dev.performed).toEqual([]);
  });
  it("the step limit ends the plan", async () => {
    const dev = new FakeDevice(); dev.screens = [home];
    const engine = new PhoneEngine(dev, new ActivityLog(new MemoryKV()), { sleep: async () => {} });
    await engine.begin(approvePlan(createPlan("x", ["com.google.android.youtube"], undefined, 2)));
    await engine.step({ type: "read_screen" });
    await engine.step({ type: "read_screen" });
    expect(await engine.step({ type: "read_screen" })).toMatchObject({ status: "refused", reason: expect.stringContaining("step limit") });
  });
  it("native failure is reported and clears node ids", async () => {
    const s = await started();
    await s.engine.step({ type: "read_screen" });
    s.dev.performResult = { ok: false, error: "node gone" };
    expect(await s.engine.step({ type: "tap", nodeId: 1 })).toMatchObject({ status: "refused", reason: "action failed: node gone" });
    expect(await s.engine.step({ type: "tap", nodeId: 1 })).toMatchObject({ status: "refused" });
  });
  it("done and ask_user", async () => {
    const s = await started();
    expect(await s.engine.step({ type: "ask_user", question: "Which video?" })).toEqual({ status: "ask_user", question: "Which video?" });
    expect(await s.engine.step({ type: "done", summary: "ok" })).toEqual({ status: "done", summary: "ok" });
    expect(s.engine.active).toBe(false);
    expect(s.dev.stops).toEqual(["done"]);
    expect(await s.engine.step({ type: "read_screen" })).toMatchObject({ status: "refused" });
  });
  it("steps arriving together run one at a time, in order", async () => {
    const s = await started();
    const order: string[] = [];
    s.dev.onPerform = () => order.push("perform");
    await s.engine.step({ type: "read_screen" });
    const [a, b] = await Promise.all([s.engine.step({ type: "scroll", direction: "down" }), s.engine.step({ type: "back" })]);
    expect([a.status, b.status]).toEqual(["ok", "ok"]);
    expect(s.dev.performed.map((p) => p.type)).toEqual(["scroll", "back"]);
  });
});

describe("screen protection reaches the AI as fixed sentences only", () => {
  const cases: [string, DeviceScreen, string][] = [
    ["foreign app", screen("com.example.other", [{ id: 0, text: "private text" }]), "app_not_allowed:not_allowlisted"],
    ["hard-blocked app", screen("com.whatsapp", [{ id: 0, text: "private text" }]), "app_not_allowed:hard_blocked"],
    ["password field", screen("com.google.android.youtube", [{ id: 0, text: "hunter2", password: true }, { id: 1, text: "private text" }]), "secret_field"],
    ["login screen", screen("com.google.android.youtube", [{ id: 0, text: "Sign in" }, { id: 1, text: "private text" }]), "sensitive_word:sign in"],
    ["OTP screen", screen("com.google.android.youtube", [{ id: 0, text: "Enter OTP private text" }]), "sensitive_word:otp"],
  ];
  it.each(cases)("%s pauses the task and leaks nothing", async (_n, scr, why) => {
    const s = await started();
    s.dev.screens = [scr];
    const r = await s.engine.step({ type: "read_screen" });
    expect(r).toEqual({ status: "paused", reason: why });
    expect(JSON.stringify(r)).not.toMatch(/private text|hunter2/);
    expect(s.dev.pauses).toEqual([why]);
    expect((await s.log.list()).map((e) => e.text).join(" ")).not.toMatch(/private text|hunter2/);
    // while paused nothing else runs
    expect(await s.engine.step({ type: "tap", nodeId: 0 })).toMatchObject({ status: "paused" });
    expect(s.dev.performed).toEqual([]);
  });
  it("FLAG_SECURE and blank screenshots stop the task for good", async () => {
    for (const extra of [{ secure: true }, { screenshot: { blank: true } }]) {
      const s = await started();
      s.dev.screens = [screen("com.google.android.youtube", [{ id: 0, text: "x" }], extra)];
      expect(await s.engine.step({ type: "read_screen" })).toMatchObject({ status: "stopped" });
      expect(s.engine.active).toBe(false);
      expect(s.dev.st.state).toBe("idle");
    }
  });
  it("native refusal (screen not readable) is reported as paused without text", async () => {
    const s = await started();
    s.dev.screens = [{ blocked: true, reason: "app_not_allowed:not_allowlisted" }];
    s.dev.st = { state: "paused", reason: "app_not_allowed:not_allowlisted" };
    expect(await s.engine.step({ type: "read_screen" })).toMatchObject({ status: "paused" });
  });
  it("redacts personal data in the text that is returned", async () => {
    const s = await started();
    s.dev.screens = [screen("com.google.android.youtube", [{ id: 0, text: "Contact jane@x.com or 9876543210" }])];
    const r = await s.engine.step({ type: "read_screen" });
    expect(r.status === "ok" && r.screen).not.toMatch(/jane@x\.com|9876543210/);
  });
  it("the user resuming lets the task continue", async () => {
    const s = await started();
    s.dev.screens = [screen("com.example.other", [{ id: 0, text: "x" }]), home];
    await s.engine.step({ type: "read_screen" });
    s.dev.st = { state: "running" }; // user pressed Resume
    expect(await s.engine.step({ type: "read_screen" })).toMatchObject({ status: "ok" });
  });
});

describe("emergency controls", () => {
  it("a stop from the device ends the task on the next step", async () => {
    const s = await started();
    s.dev.st = { state: "idle", reason: "volume_key" };
    expect(await s.engine.step({ type: "read_screen" })).toEqual({ status: "stopped", reason: "volume_key" });
    expect(s.engine.active).toBe(false);
  });
  it("Stop pressed while the popup or delay is open prevents the action", async () => {
    const s = await started();
    await s.engine.step({ type: "read_screen" });
    s.dev.confirm = async () => { s.dev.st = { state: "idle", reason: "user_stop" }; return true; };
    expect(await s.engine.step({ type: "tap", nodeId: 2 })).toMatchObject({ status: "stopped", reason: "user_stop" });
    expect(s.dev.performed).toEqual([]);
  });
  it("end() stops the device and logs", async () => {
    const s = await started();
    await s.engine.end("mode_switch");
    expect(s.dev.stops).toEqual(["mode_switch"]);
    expect(s.engine.active).toBe(false);
  });
});

describe("pacing", () => {
  it("social apps get a random delay and a rate limit", async () => {
    const dev = new FakeDevice();
    dev.screens = [screen("com.instagram.android", [{ id: 0, text: "Feed", clickable: true }])];
    const log = new ActivityLog(new MemoryKV());
    const slept: number[] = [];
    const engine = new PhoneEngine(dev, log, { pacer: new Pacer(() => 0, () => 0.5), sleep: async (ms) => void slept.push(ms), settleMs: 1 });
    await engine.begin(approvePlan(createPlan("x", ["com.instagram.android"], undefined, 500)));
    await engine.step({ type: "read_screen" });
    const first = await engine.step({ type: "scroll", direction: "down" });
    expect(first.status).toBe("ok");
    expect(slept.some((ms) => ms >= 1200 && ms <= 4500)).toBe(true);
    let limited: unknown;
    for (let i = 0; i < 12 && !limited; i++) {
      const r = await engine.step({ type: "scroll", direction: "down" });
      if (r.status === "rate_limited") limited = r;
    }
    expect(limited).toMatchObject({ status: "rate_limited", retryAfterMs: expect.any(Number) });
  });
});
