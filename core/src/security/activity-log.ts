import type { KVStore } from "../storage";
import { Collection, newId } from "../memory/stores";
import { redactForModel } from "./screen";

export type LogKind = "task_start" | "action" | "confirm_yes" | "confirm_no" | "pause" | "stop" | "blocked" | "done" | "error";

export interface LogEntry {
  id: string;
  at: number;
  taskId: string;
  kind: LogKind;
  /** Redacted one-liner shown to the user. */
  text: string;
  pkg?: string;
  /** Opaque name of a screenshot file kept in app-private storage on this device. Never a path or bytes. */
  shot?: string;
}

export interface ActivityLogOptions {
  /** Called with screenshot names when entries are deleted, so native code removes the files too. */
  deleteShots?: (names: string[]) => Promise<void> | void;
  now?: () => number;
  max?: number;
}

/**
 * The user's record of everything the agent did. Stays on this device (KVStore is local storage; there is no network code here).
 * Every text is redacted before it is written, so a password or code cannot end up in the log by accident.
 */
export class ActivityLog {
  private items: Collection<LogEntry>;
  private now: () => number;
  constructor(kv: KVStore, private opts: ActivityLogOptions = {}) {
    this.items = new Collection(kv, "activity-log", opts.max ?? 2000);
    this.now = opts.now ?? Date.now;
  }

  async add(taskId: string, kind: LogKind, text: string, extra: { pkg?: string; shot?: string } = {}): Promise<LogEntry> {
    const entry: LogEntry = { id: newId(), at: this.now(), taskId, kind, text: redactForModel(text).slice(0, 300), ...extra };
    const before = await this.items.all();
    await this.items.put(entry);
    const kept = new Set((await this.items.all()).map((e) => e.id));
    await this.dropShots(before.filter((e) => !kept.has(e.id))); // trimmed by the size cap: their screenshots go too
    return entry;
  }

  list = async (taskId?: string) => (await this.items.all()).filter((e) => !taskId || e.taskId === taskId).sort((a, b) => a.at - b.at);

  async deleteTask(taskId: string) {
    const gone = (await this.items.all()).filter((e) => e.taskId === taskId);
    await this.dropShots(gone);
    await Promise.all(gone.map((e) => this.items.remove(e.id)));
  }

  async clear() {
    await this.dropShots(await this.items.all());
    await this.items.clear();
  }

  private async dropShots(entries: LogEntry[]) {
    const names = entries.flatMap((e) => (e.shot ? [e.shot] : []));
    if (names.length) await this.opts.deleteShots?.(names);
  }
}
