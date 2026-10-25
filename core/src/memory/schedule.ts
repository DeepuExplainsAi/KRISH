import type { KVStore } from "../storage";
import { Collection, newId } from "./stores";

export type Repeat = { every: "once" } | { every: "daily" } | { every: "weekly"; days: number[] } | { every: "interval"; minutes: number };

export interface ScheduledTask {
  id: string;
  title: string;
  /** The user's own command text. */
  command: string;
  projectId?: string;
  repeat: Repeat;
  /** Local time of day for once/daily/weekly. */
  hour: number;
  minute: number;
  /** For "once": epoch ms of the run. */
  at?: number;
  enabled: boolean;
  lastRunAt?: number;
  /** Tasks that need the user (confirmations) open a notification instead of running silently. */
  requiresConfirmation: true;
  createdAt: number;
}

/** Next run time after `from` (for interval: after the last run, else `from`). Pure: tested without a device. */
export function nextRun(t: ScheduledTask, from: number): number | undefined {
  if (!t.enabled) return undefined;
  const r = t.repeat;
  if (r.every === "once") return t.at !== undefined && t.at > from ? t.at : undefined;
  if (r.every === "interval") return (t.lastRunAt ?? from) + Math.max(1, r.minutes) * 60_000;
  const d = new Date(from);
  for (let i = 0; i < 8; i++) {
    const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, t.hour, t.minute, 0, 0);
    if (c.getTime() > from && (r.every === "daily" || r.days.includes(c.getDay()))) return c.getTime();
  }
  return undefined;
}

export class Scheduler {
  private items: Collection<ScheduledTask>;
  constructor(kv: KVStore, private now = Date.now) {
    this.items = new Collection(kv, "tasks", 100);
  }
  async add(t: Omit<ScheduledTask, "id" | "requiresConfirmation" | "enabled" | "createdAt"> & { enabled?: boolean }): Promise<ScheduledTask> {
    const task: ScheduledTask = { ...t, id: newId(), enabled: t.enabled ?? true, requiresConfirmation: true, createdAt: this.now() };
    await this.items.put(task);
    return task;
  }
  list = () => this.items.all();
  remove = (id: string) => this.items.remove(id);
  update = (t: ScheduledTask) => this.items.put(t);
  /** Enabled tasks whose next run, counted from their last run (or creation), has passed. */
  async due(now: number): Promise<ScheduledTask[]> {
    return (await this.items.all()).filter((t) => {
      if (t.repeat.every === "once") return t.enabled && t.lastRunAt === undefined && t.at !== undefined && t.at <= now;
      const n = nextRun(t, t.lastRunAt ?? t.createdAt);
      return n !== undefined && n <= now;
    });
  }
  async markRan(id: string, at: number) {
    const t = (await this.items.all()).find((x) => x.id === id);
    if (t) await this.items.put({ ...t, lastRunAt: at });
  }
}

// ---- Opt-in morning brief ----
export interface BriefSettings {
  enabled: boolean;
  hour: number;
  minute: number;
}

export const DEFAULT_BRIEF: BriefSettings = { enabled: false, hour: 8, minute: 0 };

/** Brief is a scheduled prompt built only from local data (memory, tasks); it never runs unless enabled. */
export function briefCommand(memoryText: string, tasks: ScheduledTask[]): string {
  const todo = tasks.filter((t) => t.enabled).map((t) => `- ${t.title}`).join("\n") || "- none";
  return `Write a short morning brief for me. Remembered notes:\n${memoryText || "- none"}\nMy scheduled tasks:\n${todo}\nDo not open any website.`;
}

export const nextBriefAt = (b: BriefSettings, from: number): number | undefined =>
  b.enabled ? nextRun({ id: "brief", title: "brief", command: "", repeat: { every: "daily" }, hour: b.hour, minute: b.minute, enabled: true, requiresConfirmation: true, createdAt: 0 }, from) : undefined;
