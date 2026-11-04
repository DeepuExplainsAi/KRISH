import { describe, expect, it } from "vitest";
import { ActivityLog } from "../../src/security/activity-log";
import { MemoryKV } from "../../src/storage";

describe("ActivityLog", () => {
  it("stores redacted entries in order and filters by task", async () => {
    let t = 0;
    const log = new ActivityLog(new MemoryKV(), { now: () => ++t });
    await log.add("a", "task_start", "Open YouTube");
    await log.add("a", "action", "typed to a@b.com, password: hunter2, call 9876543210", { pkg: "com.google.android.youtube" });
    await log.add("b", "done", "ok");
    const a = await log.list("a");
    expect(a.map((e) => e.kind)).toEqual(["task_start", "action"]);
    expect(a[1]?.text).not.toMatch(/a@b\.com|hunter2|9876543210/);
    expect(await log.list()).toHaveLength(3);
  });
  it("never writes plaintext secrets to the underlying store", async () => {
    const kv = new MemoryKV();
    await new ActivityLog(kv).add("a", "action", "Bearer abcdefghijklmnop12345 otp: 123456");
    const raw = (await kv.get("activity-log")) ?? "";
    expect(raw).not.toMatch(/abcdefghijklmnop12345|123456/);
  });
  it("deleteTask removes entries and asks native to delete that task's screenshots", async () => {
    const deleted: string[] = [];
    const log = new ActivityLog(new MemoryKV(), { deleteShots: (n) => void deleted.push(...n) });
    await log.add("a", "action", "x", { shot: "s1.png" });
    await log.add("b", "action", "y", { shot: "s2.png" });
    await log.deleteTask("a");
    expect(deleted).toEqual(["s1.png"]);
    expect((await log.list()).map((e) => e.shot)).toEqual(["s2.png"]);
  });
  it("clear removes everything including screenshots", async () => {
    const deleted: string[] = [];
    const kv = new MemoryKV();
    const log = new ActivityLog(kv, { deleteShots: (n) => void deleted.push(...n) });
    await log.add("a", "action", "x", { shot: "s1.png" });
    await log.add("b", "action", "y", { shot: "s2.png" });
    await log.clear();
    expect(await log.list()).toEqual([]);
    expect(deleted.sort()).toEqual(["s1.png", "s2.png"]);
    expect(await kv.get("activity-log")).toBeUndefined();
  });
  it("keeps only the newest `max` entries and deletes the trimmed entries' screenshots", async () => {
    let t = 0;
    const deleted: string[] = [];
    const log = new ActivityLog(new MemoryKV(), { max: 3, now: () => ++t, deleteShots: (n) => void deleted.push(...n) });
    await log.add("a", "action", "step first", { shot: "old.png" });
    await log.add("a", "action", "step 0");
    for (let i = 1; i < 5; i++) await log.add("a", "action", `step ${i}`);
    expect(deleted).toContain("old.png");
    await log.clear();
    for (let i = 0; i < 5; i++) await log.add("a", "action", `step ${i}`);
    expect((await log.list()).map((e) => e.text)).toEqual(["step 2", "step 3", "step 4"]);
  });
});
