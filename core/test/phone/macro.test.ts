import { describe, expect, it } from "vitest";
import { Macros, PhoneEngine, replayMacro, replayWithRetry, stepFromAction, resolveStep, type Macro, type MacroInput, type PhoneDevice, type DeviceScreen, type DeviceState } from "../../src/phone";
import { isDue } from "../../src/memory/schedule";
import { ActivityLog } from "../../src/security/activity-log";
import { approvePlan, createPlan, type PhoneAction } from "../../src/security/actions";
import { Pacer } from "../../src/security/pacing";
import { MemoryKV } from "../../src/storage";

const YT = "com.google.android.youtube";
const page = (nodes: { id: number; text?: string; clickable?: boolean; editable?: boolean; password?: boolean }[], pkg = YT): DeviceScreen => ({ pkg, nodes });
const search = page([{ id: 0, text: "Search", editable: true }, { id: 1, text: "Trending", clickable: true }, { id: 2, text: "Trending", clickable: true }]);

class Dev implements PhoneDevice {
  st: DeviceState = { state: "idle" };
  screens: DeviceScreen[] = [search];
  performed: PhoneAction[] = [];
  asked: string[] = [];
  async state() { return this.st; }
  async start() { this.st = { state: "running" }; }
  async readScreen() { return this.screens.length > 1 ? this.screens.shift()! : this.screens[0]!; }
  async perform(a: PhoneAction) { this.performed.push(a); return { ok: true }; }
  async openApp() {}
  async confirm(_t: string, d: string) { this.asked.push(d); return true; }
  async pause(r: string) { this.st = { state: "paused", reason: r }; }
  async stop(r: string) { this.st = { state: "idle", reason: r }; }
}
const rig = () => {
  const dev = new Dev();
  const engine = new PhoneEngine(dev, new ActivityLog(new MemoryKV()), { pacer: new Pacer(() => 0, () => 0), sleep: async () => {}, consent: async () => true });
  return { dev, engine };
};
const input = (steps: MacroInput["steps"], over: Partial<MacroInput> = {}): MacroInput => ({
  title: "Trending", task: "open trending", apps: [YT], steps, repeat: { every: "daily" }, hour: 18, minute: 0, ...over,
});
const make = async (m: MacroInput) => {
  const r = await new Macros(new MemoryKV()).create(m);
  if (!r.ok) throw new Error(r.reason);
  return r.macro;
};
const fast = { sleep: async () => {}, findDelayMs: 0 };

describe("recording", () => {
  it("stores labels and position, never node ids", async () => {
    const { engine } = rig();
    await engine.begin(approvePlan(createPlan("t", [YT])));
    await engine.step({ type: "open_app", package: YT });
    await engine.step({ type: "read_screen" });
    await engine.step({ type: "tap", nodeId: 2 });
    expect(engine.recording?.steps).toEqual([{ type: "open_app", package: YT }, { type: "tap", label: "Trending", nth: 1 }]);
  });
  it("does not record refused or denied actions", async () => {
    const { engine } = rig();
    await engine.begin(approvePlan(createPlan("t", [YT], ["read_screen", "tap"])));
    await engine.step({ type: "scroll", direction: "down" });
    expect(engine.recording?.steps).toEqual([]);
  });
  it("stepFromAction ignores an unknown node", () => {
    expect(stepFromAction({ type: "tap", nodeId: 9 }, [])).toBeUndefined();
  });
});

describe("Macros store", () => {
  it("refuses empty, unlabeled-tap and blocked-app macros", async () => {
    const m = new Macros(new MemoryKV());
    expect(await m.create(input([]))).toMatchObject({ ok: false });
    expect(await m.create(input([{ type: "tap", label: " ", nth: 0 }]))).toMatchObject({ ok: false });
    expect(await m.create(input([{ type: "back" }], { apps: ["com.google.android.gm"] }))).toMatchObject({ ok: false });
  });
  it("lists due macros by schedule", async () => {
    const m = new Macros(new MemoryKV(), () => 1_000);
    await m.create(input([{ type: "back" }], { repeat: { every: "interval", minutes: 1 } }));
    expect(await m.due(1_000 + 30_000)).toHaveLength(0);
    const [due] = await m.due(1_000 + 61_000);
    await m.markRan(due!.id, 62_000);
    expect(await m.due(63_000)).toHaveLength(0);
  });
  it("isDue: a once-macro runs once", () => {
    const base = { enabled: true, repeat: { every: "once" as const }, hour: 0, minute: 0, at: 100, createdAt: 0 };
    expect(isDue(base, 99)).toBe(false);
    expect(isDue(base, 100)).toBe(true);
    expect(isDue({ ...base, lastRunAt: 100 }, 200)).toBe(false);
  });
});

describe("replayMacro", () => {
  const steps: MacroInput["steps"] = [{ type: "open_app", package: YT }, { type: "tap", label: "Trending", nth: 1 }];

  it("replays through the engine (the new-app popup still appears) and finds the element by label", async () => {
    const { dev, engine } = rig();
    const r = await replayMacro(engine, await make(input(steps)), [YT], fast);
    expect(r).toEqual({ ok: true, steps: 2 });
    expect(dev.asked).toEqual([`Open ${YT}`]);
    expect(dev.performed).toEqual([{ type: "tap", nodeId: 2 }]);
    expect(engine.active).toBe(false);
  });
  it("asks again for a send/pay tap: confirmation is never skipped", async () => {
    const { dev, engine } = rig();
    dev.screens = [page([{ id: 0, text: "Send", clickable: true }])];
    await replayMacro(engine, await make(input([{ type: "tap", label: "Send", nth: 0 }])), [YT], fast);
    expect(dev.asked).toEqual(['Tap "Send"']);
  });
  it("does not run when the user denies the popup", async () => {
    const { dev, engine } = rig();
    dev.screens = [page([{ id: 0, text: "Send", clickable: true }])];
    dev.confirm = async () => false;
    const r = await replayMacro(engine, await make(input([{ type: "tap", label: "Send", nth: 0 }])), [YT], fast);
    expect(r).toMatchObject({ ok: false, retryable: false });
    expect(dev.performed).toEqual([]);
  });
  it("refuses when an app left the allowlist, or the macro is unapproved", async () => {
    const { engine } = rig();
    const m = await make(input(steps));
    expect(await replayMacro(engine, m, ["com.android.chrome"], fast)).toMatchObject({ ok: false, retryable: false });
    expect(await replayMacro(engine, { ...m, approvedAt: 0 } as Macro, [YT], fast)).toMatchObject({ ok: false });
    expect(engine.active).toBe(false);
  });
  it("fails retryably when the element is missing, never taps a guess", async () => {
    const { dev, engine } = rig();
    dev.screens = [page([{ id: 0, text: "Home", clickable: true }])];
    const r = await replayMacro(engine, await make(input([{ type: "tap", label: "Trending", nth: 0 }])), [YT], fast);
    expect(r).toMatchObject({ ok: false, retryable: true });
    expect(dev.performed).toEqual([]);
    expect(engine.active).toBe(false);
  });
  it("waits for a screen that is still loading", async () => {
    const { dev, engine } = rig();
    dev.screens = [page([]), search];
    const r = await replayMacro(engine, await make(input([{ type: "tap", label: "Trending", nth: 0 }])), [YT], fast);
    expect(r.ok).toBe(true);
    expect(dev.performed).toEqual([{ type: "tap", nodeId: 1 }]);
  });
  it("stops at a login screen: nothing is read or typed, not retryable", async () => {
    const { dev, engine } = rig();
    dev.screens = [page([{ id: 0, text: "Password", editable: true, password: true }])];
    const r = await replayMacro(engine, await make(input([{ type: "type", label: "Search", nth: 0, text: "x" }])), [YT], fast);
    expect(r).toMatchObject({ ok: false, retryable: false });
    expect(dev.performed).toEqual([]);
  });
  it("stops when another app is in front", async () => {
    const { dev, engine } = rig();
    dev.screens = [page([{ id: 0, text: "Trending", clickable: true }], "com.google.android.gm")];
    const r = await replayMacro(engine, await make(input([{ type: "tap", label: "Trending", nth: 0 }])), [YT], fast);
    expect(r.ok).toBe(false);
    expect(dev.performed).toEqual([]);
  });
  it("resolveStep needs the exact label", () => {
    expect(resolveStep({ type: "tap", label: "trend", nth: 0 }, [{ id: 1, text: "Trending", clickable: true }])).toBeUndefined();
  });
});

describe("replayWithRetry", () => {
  it("retries only retryable failures, then reports", async () => {
    let n = 0;
    const r = await replayWithRetry(async () => (++n, { ok: false as const, reason: "x", retryable: true }), { retries: 2, sleep: async () => {} });
    expect(n).toBe(3);
    expect(r).toMatchObject({ ok: false, attempts: 3 });
    n = 0;
    expect(await replayWithRetry(async () => (++n, { ok: false as const, reason: "login", retryable: false }), { sleep: async () => {} })).toMatchObject({ attempts: 1 });
    n = 0;
    expect(await replayWithRetry(async () => (++n === 2 ? { ok: true as const, steps: 1 } : { ok: false as const, reason: "x", retryable: true }), { sleep: async () => {} })).toMatchObject({ ok: true, attempts: 2 });
  });
});
