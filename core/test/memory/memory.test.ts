import { describe, expect, it } from "vitest";
import { briefCommand, History, Memory, MemoryKV, nextBriefAt, nextRun, Panels, Projects, Scheduler, type ScheduledTask } from "../../src";

const T = (o: Partial<ScheduledTask>): ScheduledTask => ({
  id: "t", title: "x", command: "c", repeat: { every: "daily" }, hour: 9, minute: 30, enabled: true, requiresConfirmation: true, createdAt: 0, ...o,
});
const at = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

describe("Memory", () => {
  it("redacts on write, scopes by project, caps size", async () => {
    const m = new Memory(new MemoryKV());
    await m.add("my password: hunter2");
    await m.add("global fact");
    await m.add("project fact", "p1");
    await m.add("other project", "p2");
    const text = await m.forPrompt("p1");
    expect(text).not.toContain("hunter2");
    expect(text).toContain("global fact");
    expect(text).toContain("project fact");
    expect(text).not.toContain("other project");
    expect((await m.forPrompt("p1", 20)).length).toBeLessThanOrEqual(30);
  });
});

describe("History", () => {
  it("logs redacted entries grouped by run and can be cleared", async () => {
    const h = new History(new MemoryKV());
    await h.log("r1", "action", "typed", "token=abcdef123456");
    await h.log("r2", "action", "other");
    expect(await h.byRun("r1")).toHaveLength(1);
    expect((await h.list())[0]?.detail).not.toContain("abcdef123456");
    await h.clear();
    expect(await h.list()).toHaveLength(0);
  });
});

describe("Projects and Panels", () => {
  it("creates projects", async () => {
    const p = new Projects(new MemoryKV());
    const x = await p.create("Work", "be brief", "https://a.test");
    expect((await p.list())[0]?.id).toBe(x.id);
  });
  it("panels extract fields and render", async () => {
    const p = new Panels(new MemoryKV());
    const x = await p.create("Reply", "Reply to {{who}} about {{topic}}; thanks {{who}}");
    expect(x.fields).toEqual(["who", "topic"]);
    expect(Panels.render(x, { who: "Sam", topic: "launch" })).toBe("Reply to Sam about launch; thanks Sam");
  });
});

describe("schedule", () => {
  it("daily: later today or tomorrow", () => {
    expect(nextRun(T({}), at(2026, 10, 25, 8))).toBe(at(2026, 10, 25, 9, 30));
    expect(nextRun(T({}), at(2026, 10, 25, 10))).toBe(at(2026, 10, 26, 9, 30));
  });
  it("weekly picks the next listed weekday", () => {
    const sun = new Date(2026, 9, 25).getDay(); // 2026-10-25
    const next = nextRun(T({ repeat: { every: "weekly", days: [(sun + 2) % 7] } }), at(2026, 10, 25, 12));
    expect(next).toBe(at(2026, 10, 27, 9, 30));
  });
  it("once and disabled", () => {
    expect(nextRun(T({ repeat: { every: "once" }, at: 500 }), 100)).toBe(500);
    expect(nextRun(T({ repeat: { every: "once" }, at: 500 }), 600)).toBeUndefined();
    expect(nextRun(T({ enabled: false }), 0)).toBeUndefined();
  });
  it("interval counts from last run", () => {
    expect(nextRun(T({ repeat: { every: "interval", minutes: 30 }, lastRunAt: 1000 }), 5000)).toBe(1000 + 30 * 60_000);
  });
  it("scheduler.due returns overdue tasks once, then not again after markRan", async () => {
    let now = at(2026, 10, 25, 8);
    const s = new Scheduler(new MemoryKV(), () => now);
    const t = await s.add({ title: "d", command: "c", repeat: { every: "daily" }, hour: 9, minute: 0 });
    expect(await s.due(now)).toHaveLength(0);
    now = at(2026, 10, 25, 9, 5);
    expect(await s.due(now)).toHaveLength(1);
    await s.markRan(t.id, now);
    expect(await s.due(now)).toHaveLength(0);
    now = at(2026, 10, 26, 9, 1);
    expect(await s.due(now)).toHaveLength(1);
  });
  it("once tasks run a single time", async () => {
    const s = new Scheduler(new MemoryKV(), () => 0);
    const t = await s.add({ title: "o", command: "c", repeat: { every: "once" }, hour: 0, minute: 0, at: 100 });
    expect(await s.due(200)).toHaveLength(1);
    await s.markRan(t.id, 200);
    expect(await s.due(300)).toHaveLength(0);
  });
  it("morning brief is opt-in and never mentions opening sites", () => {
    expect(nextBriefAt({ enabled: false, hour: 8, minute: 0 }, 0)).toBeUndefined();
    expect(nextBriefAt({ enabled: true, hour: 8, minute: 0 }, at(2026, 10, 25, 7))).toBe(at(2026, 10, 25, 8));
    expect(briefCommand("- a", [T({ title: "Pay rent" })])).toContain("Do not open any website");
  });
});

describe("concurrent writes", () => {
  it("keep every entry even when the store is slow (read-modify-write must not interleave)", async () => {
    class SlowKV extends MemoryKV {
      async get(k: string) {
        const v = await super.get(k);
        await new Promise((r) => setTimeout(r, 2));
        return v;
      }
    }
    const h = new History(new SlowKV());
    await Promise.all(Array.from({ length: 12 }, (_, i) => h.log("run", "chip", `c${i}`)));
    expect((await h.list()).map((e) => e.label).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `c${i}`).sort());
  });
});

describe("reads see queued writes", () => {
  it("History.list() called while log() calls are still pending includes them", async () => {
    class SlowKV extends MemoryKV {
      async set(k: string, v: string) {
        await new Promise((r) => setTimeout(r, 5));
        return super.set(k, v);
      }
    }
    const h = new History(new SlowKV());
    void h.log("run", "chip", "one");
    void h.log("run", "chip", "two");
    expect((await h.list()).map((e) => e.label)).toEqual(["one", "two"]);
  });
});
