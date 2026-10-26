import { redactText } from "../privacy/redact";
import type { KVStore } from "../storage";

/**
 * Small JSON collection on top of KVStore. Every write passes through redaction.
 * Writes are queued: the KVStore is async, so unqueued read-modify-write calls would overwrite each other.
 */
export class Collection<T extends { id: string }> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private kv: KVStore,
    private key: string,
    private max = 1000,
  ) {}

  /** Waits for writes queued before this call, so a read never misses an entry that was already submitted. */
  all(): Promise<T[]> {
    return this.serial(() => this.read());
  }

  private async read(): Promise<T[]> {
    const raw = await this.kv.get(this.key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  }

  private serial<R>(job: () => Promise<R>): Promise<R> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  put(item: T): Promise<void> {
    return this.serial(async () => {
      const rest = (await this.read()).filter((x) => x.id !== item.id);
      await this.save([...rest, item].slice(-this.max));
    });
  }

  remove(id: string): Promise<void> {
    return this.serial(async () => this.save((await this.read()).filter((x) => x.id !== id)));
  }

  clear(): Promise<void> {
    return this.serial(() => this.kv.delete(this.key));
  }

  private save(items: T[]) {
    return this.kv.set(this.key, JSON.stringify(items));
  }
}

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ---- Memory: facts the user (or the agent, on request) wants remembered ----
export interface MemoryItem {
  id: string;
  text: string;
  createdAt: number;
  projectId?: string;
}

export class Memory {
  private items: Collection<MemoryItem>;
  constructor(kv: KVStore, private now = Date.now) {
    this.items = new Collection(kv, "memory", 500);
  }
  async add(text: string, projectId?: string): Promise<MemoryItem> {
    const item = { id: newId(), text: redactText(text).slice(0, 500), createdAt: this.now(), projectId };
    await this.items.put(item);
    return item;
  }
  list = () => this.items.all();
  remove = (id: string) => this.items.remove(id);
  clear = () => this.items.clear();
  /** Global facts plus the active project's, newest kept first while they fit `maxChars`; returned oldest to newest. */
  async recall(projectId?: string, maxChars = 2000): Promise<MemoryItem[]> {
    const rows = (await this.items.all()).filter((m) => !m.projectId || m.projectId === projectId);
    const picked: MemoryItem[] = [];
    let used = 0;
    for (const m of rows.reverse()) {
      if (used + m.text.length > maxChars) break;
      picked.push(m);
      used += m.text.length;
    }
    return picked.reverse();
  }
  /** Memory text for the model prompt: global facts plus the active project's. Newest last, size-capped. */
  async forPrompt(projectId?: string, maxChars = 2000): Promise<string> {
    return (await this.recall(projectId, maxChars)).map((m) => `- ${m.text}`).join("\n");
  }
}

// ---- History: local log of every action ----
export interface HistoryEntry {
  id: string;
  runId: string;
  at: number;
  kind: "run_start" | "chip" | "action" | "run_end";
  label: string;
  detail?: string;
  state?: string;
}

export class History {
  private items: Collection<HistoryEntry>;
  constructor(kv: KVStore, private now = Date.now) {
    // Every write rewrites the whole list, so the cap keeps that cheap on low-end phones.
    this.items = new Collection(kv, "history", 2000);
  }
  async log(runId: string, kind: HistoryEntry["kind"], label: string, detail?: string, state?: string) {
    await this.items.put({
      id: newId(),
      runId,
      at: this.now(),
      kind,
      label: redactText(label).slice(0, 200),
      detail: detail === undefined ? undefined : redactText(detail).slice(0, 1000),
      state,
    });
  }
  list = () => this.items.all();
  async byRun(runId: string) {
    return (await this.items.all()).filter((e) => e.runId === runId);
  }
  clear = () => this.items.clear();
}

// ---- Projects: named context bundles ----
export interface Project {
  id: string;
  name: string;
  instructions: string;
  startUrl?: string;
  createdAt: number;
}

export class Projects {
  private items: Collection<Project>;
  constructor(kv: KVStore, private now = Date.now) {
    this.items = new Collection(kv, "projects", 100);
  }
  async create(name: string, instructions = "", startUrl?: string): Promise<Project> {
    const p = { id: newId(), name: name.slice(0, 80), instructions: redactText(instructions).slice(0, 2000), startUrl, createdAt: this.now() };
    await this.items.put(p);
    return p;
  }
  update = (p: Project) => this.items.put(p);
  list = () => this.items.all();
  remove = (id: string) => this.items.remove(id);
}

// ---- Panels: user-made mini-apps (a saved prompt template with named inputs) ----
export interface Panel {
  id: string;
  title: string;
  /** Uses {{name}} placeholders filled from `fields`. */
  template: string;
  fields: string[];
}

export class Panels {
  private items: Collection<Panel>;
  constructor(kv: KVStore) {
    this.items = new Collection(kv, "panels", 100);
  }
  async create(title: string, template: string): Promise<Panel> {
    const fields = [...new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))];
    const p = { id: newId(), title: title.slice(0, 60), template: template.slice(0, 4000), fields };
    await this.items.put(p);
    return p;
  }
  list = () => this.items.all();
  remove = (id: string) => this.items.remove(id);
  /** Plain substitution; values are user-typed. The result is a USER command, so it is only built from the user's own input. */
  static render(panel: Panel, values: Record<string, string>): string {
    return panel.template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => values[k] ?? "");
  }
}
