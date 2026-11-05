import {
  DEFAULTS, redactChat, autoFetchOnce, friendlyReason, DEFAULT_BRIEF, History, Memory, newId, Panels, ProviderRouter, Projects, refreshModels, probeModels, withAutoModels,
  Scheduler, Macros, type Repeat, nextRun, nextBriefAt, briefCommand, ConsentStore, ActivityLog, PhoneService, AbortedError,
  type BriefSettings, type ChatMessage, type ProviderConfig, setLocalEngine, type ModelInfo,
  BUILTIN_PROVIDERS, rankModels, LOCAL_MODEL_CATALOG, recommendedLocalModel,
} from "@krish/core";
import type { Platform } from "../platform";
import { phoneDevice } from "../platform/phone-device";
import type { LocalDeviceInfo, LocalProgress } from "../platform/types";
import { createWebGpuEngine, webgpuAvailable } from "../local/webgpu";
import { createNativeEngine } from "../local/native";
import type { LangPref } from "../i18n";
import type { ThemePref } from "../theme";

/** Bump when a default changes and old saved values must be migrated (see `migrateSettings`). */
export const SETTINGS_VERSION = 6;

export interface Settings {
  version: number;
  /** UI language. "auto" follows the device. The agent answers in the language the user writes, independent of this. */
  language: LangPref;
  /** "auto" follows the local time of day, "system" the device light/dark setting. */
  theme: ThemePref;
  liteMode: boolean;
  brief: BriefSettings;
  localModel: boolean;
  /** When your own providers all fail (or none is added), use the built-in free service as the last resort. */
  freeFallback: boolean;
  /** The first-run tour was shown (or skipped). */
  tourDone: boolean;
  /** Set after the user accepted the download notice. */
  localModelConsent: boolean;
  localModelId?: string;
  nativeModelConsent?: boolean;
  nativeSelectedModel?: string;
  /** Defaults off when a native model is installed; APIs remain available otherwise. */
  nativeBackup?: boolean;
  activeProjectId?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  language: "auto",
  theme: "auto",
  liteMode: false,
  brief: DEFAULT_BRIEF,
  freeFallback: true,
  tourDone: false,
  localModel: false,
  localModelConsent: false,
};

/**
 * Settings saved by an older build. v1 saved the then-default theme "light" and v2 the then-default "system" for everybody, so
 * neither can be told apart from a real choice: they move to Auto once. Anything saved later is a real choice and is kept.
 */
/** A new key goes where the preset list puts it (OpenCode Zen, OpenRouter, Gemini first); custom providers stay behind the known ones. */
export function insertByPreset(list: ProviderConfig[], added: ProviderConfig): ProviderConfig[] {
  const rank = (p: ProviderConfig) => {
    const i = DEFAULTS.presets.findIndex((x) => x.name === p.name);
    return i < 0 ? DEFAULTS.presets.length : i;
  };
  const at = list.findIndex((p) => rank(p) > rank(added));
  return at < 0 ? [...list, added] : [...list.slice(0, at), added, ...list.slice(at)];
}

export function migrateSettings(saved: Partial<Settings>): Partial<Settings> {
  const v = saved.version ?? 1;
  if (v >= SETTINGS_VERSION) return saved;
  const old = v === 1 ? saved.theme === undefined || saved.theme === "light" : saved.theme === undefined || saved.theme === "system";
  const theme = v < 3 ? (old ? "auto" : saved.theme) : saved.theme;
  const rest: Record<string, unknown> = { ...saved, version: SETTINGS_VERSION, theme };
  for (const gone of ["aiSeesLogin", "confirmFill", "autoOpenWindow", "screenshots", "desktopLayout", "linuxSandbox"]) delete rest[gone]; // the web browser and its switches no longer exist
  return rest as Partial<Settings>;
}

export type Screen = "home" | "chat" | "menu" | "panels" | "projects" | "tasks" | "history" | "providers" | "settings" | "security" | "phone";

export interface QueuedTask {
  id: number;
  command: string;
}

export interface ChatItem {
  id: number;
  role: "user" | "agent";
  text?: string;
  /** The run ended in an error: shown as an error note, not as an answer. */
  failed?: boolean;
}

export interface State {
  ready: boolean;
  screen: Screen;
  settings: Settings;
  providers: ProviderConfig[];
  /** The built-in free services with their live model lists (OpenCode Zen first). Not the user's keys. */
  freeProviders: ProviderConfig[];
  items: ChatItem[];
  running: boolean;
  /** Messages sent while a task runs. They run one after another in the background, each as its own task. */
  queue: QueuedTask[];
  /** Provider ids whose connection is being tested right now. */
  checking: string[];
  status: "idle" | "running" | "action_required";
  deviceLowRam: boolean;
  /** Android reports actual physical RAM in MiB, or zero when unavailable. */
  deviceTotalRamMB: number;
  notice?: string;
  localModels: ModelInfo[];
  localStatus: string;
  nativeDevice?: LocalDeviceInfo;
  nativeInstalled: string[];
  nativeProgress: Record<string, LocalProgress>;
  nativeError?: string;
}

/** Screens at least this wide get the desktop layout: side panel and chat. */
/** The model is asked for {"reply": "..."}; a plain-text answer is accepted as it is. */
export function parseReply(text: string): string {
  try {
    const o = JSON.parse(text) as { reply?: unknown };
    if (typeof o.reply === "string" && o.reply.trim()) return o.reply;
  } catch { /* not JSON: the model answered in plain text */ }
  if (!text.trim()) throw new Error("empty answer");
  return text.trim();
}

export const WIDE = 900;

const SETTINGS_KEY = "settings";
const PROVIDERS_KEY = "providers";
const FREE_KEY = "freeProviders";
const THREAD_KEY = "thread";
/** Chat messages kept on the device and the number of recent ones the agent is shown. */
const THREAD_KEEP = 60;
const CHAT_CONTEXT = 12;
/** Model lists are fetched again this often while the app is open (and at every start), so new and retired models show up by themselves. */
const LIST_REFRESH_MS = 6 * 36e5;

export class AppStore {
  state: State = {
    ready: false, screen: "home", settings: DEFAULT_SETTINGS, providers: [], freeProviders: BUILTIN_PROVIDERS, items: [], running: false, queue: [], checking: [],
    status: "idle", deviceLowRam: false, deviceTotalRamMB: 0,
    localModels: [], localStatus: "", nativeInstalled: [], nativeProgress: {},
  };
  private listeners = new Set<() => void>();
  private abort?: AbortController;
  private seq = 0;
  private unLocal?: () => void;
  readonly memory: Memory;
  readonly history: History;
  readonly projects: Projects;
  readonly panels: Panels;
  readonly scheduler: Scheduler;
  /** Saved phone-task macros: replayed without an AI, through the same safety gates. */
  readonly macros: Macros;
  readonly router: ProviderRouter;
  /** Phone control: the user's recorded consent and the on-device activity log. */
  readonly consent: ConsentStore;
  readonly activity: ActivityLog;
  /** Phone control engine and mode (Android only). */
  readonly phoneService?: PhoneService;

  constructor(readonly platform: Platform, private readonly opts: { providerWaits?: number[]; sleep?: (ms: number) => Promise<void> } = {}) {
    this.consent = new ConsentStore(platform.kv);
    this.activity = new ActivityLog(platform.kv);
    if (platform.phone?.supported) {
      this.phoneService = new PhoneService(phoneDevice(platform.phone), this.activity, platform.keys, (url) => new WebSocket(url) as never, {
        consent: () => this.consent.accepted(),
      }, () => this.set({}));
    }
    this.memory = new Memory(platform.kv);
    this.history = new History(platform.kv);
    this.projects = new Projects(platform.kv);
    this.panels = new Panels(platform.kv);
    this.scheduler = new Scheduler(platform.kv);
    this.macros = new Macros(platform.kv);
    this.router = new ProviderRouter({
      keys: platform.keys, kv: platform.kv, fetch: platform.fetch,
      providers: () => this.routerProviders(), sleep: opts.sleep,
      onResult: (id, ok, note) => this.recordHealth(id, ok, note),
    });
  }

  private nativeActive(): boolean {
    const selected = this.state.settings.nativeSelectedModel;
    return this.platform.kind === "android" && this.platform.local.supported && !!selected && this.state.nativeInstalled.includes(selected);
  }

  onlineAllowed(): boolean { return !this.nativeActive() || this.state.settings.nativeBackup === true; }

  /** The native model takes priority; online providers are opt-in backup while it is installed. */
  private routerProviders(): ProviderConfig[] {
    const { localModel, localModelConsent, localModelId, nativeSelectedModel } = this.state.settings;
    const all = this.onlineAllowed() ? [...this.state.providers, ...(this.state.settings.freeFallback ? this.state.freeProviders : [])] : [];
    if (this.nativeActive()) return [{ id: "native-local", name: "On-device", kind: "webgpu-local", baseUrl: "local:", enabled: true, defaultModel: nativeSelectedModel }, ...all];
    if (!localModel || !localModelConsent || !localModelId || !webgpuAvailable()) return all;
    return [{ id: "local", name: "On-device", kind: "webgpu-local", baseUrl: "local:", enabled: true, defaultModel: localModelId }, ...all];
  }

  /** Called when the experimental flag changes. Registers or removes the engine; nothing loads until a task needs it. */
  async applyLocalModel() {
    if (this.nativeActive()) {
      setLocalEngine(createNativeEngine(this.platform.local));
      return this.set({ localModels: [], localStatus: "" });
    }
    const { localModel, localModelConsent } = this.state.settings;
    if (!localModel || !localModelConsent || !webgpuAvailable()) {
      setLocalEngine(undefined);
      return this.set({ localModels: [], localStatus: "" });
    }
    const engine = createWebGpuEngine((localStatus) => this.set({ localStatus }));
    setLocalEngine(engine);
    this.set({ localModels: await engine.listModels().catch(() => []) });
  }

  /** The conversation survives a restart: only finished messages (no step pills, no errors) are kept, newest last. */
  private saveThread() {
    const keep = this.state.items.filter((i) => i.text && !i.failed).slice(-THREAD_KEEP).map((i) => ({ ...i, text: redactChat(i.text!) }));
    void this.platform.kv.set(THREAD_KEY, JSON.stringify(keep)).catch(() => undefined);
  }

  /** What the model is shown of this conversation: the recent finished messages of both sides. */
  private chatContext(): ChatMessage[] {
    return this.state.items
      .filter((i): i is ChatItem & { text: string } => Boolean(i.text) && !i.failed)
      .slice(-CHAT_CONTEXT)
      .map((i) => ({ role: i.role === "user" ? "user" : "assistant", content: redactChat(i.text) }));
  }

  subscribe = (l: () => void) => (this.listeners.add(l), () => void this.listeners.delete(l));
  getState = () => this.state;
  private set(patch: Partial<State>) {
    const items = this.state.items;
    this.state = { ...this.state, ...patch };
    if (this.state.items !== items && this.state.ready) this.saveThread();
    this.listeners.forEach((l) => l());
  }

  async init() {
    const [s, p, f, info] = await Promise.all([
      this.platform.kv.get(SETTINGS_KEY), this.platform.kv.get(PROVIDERS_KEY), this.platform.kv.get(FREE_KEY), this.platform.system.deviceInfo(),
    ]);
    // First run on a low-RAM device starts in Lite mode; once the user has saved settings their choice wins.
    const settings = { ...DEFAULT_SETTINGS, liteMode: info.lowRam, ...(s ? migrateSettings(JSON.parse(s)) : {}) } as Settings;
    // Code decides which free services exist; only what was learned about their models is taken from the saved copy.
    const saved: ProviderConfig[] = f ? JSON.parse(f) : [];
    const freeProviders = BUILTIN_PROVIDERS.map((b) => {
      const o = saved.find((x) => x.id === b.id);
      return o?.models ? { ...b, models: o.models, defaultModel: o.defaultModel, modelsChanged: o.modelsChanged } : b;
    });
    const thread = await this.platform.kv.get(THREAD_KEY).then((t) => (t ? (JSON.parse(t) as ChatItem[]) : [])).catch(() => []);
    this.seq = thread.reduce((m, i) => Math.max(m, i.id), this.seq);
    this.set({
      ready: true, settings, providers: p ? JSON.parse(p) : [], freeProviders, deviceLowRam: info.lowRam, deviceTotalRamMB: this.platform.kind === "android" ? info.totalMemMb : 0, items: thread,
    });
    await this.initNativeModels();
    void this.checkUntested();
    void this.syncLists();
    this.listTimer = setInterval(() => void this.syncLists(), LIST_REFRESH_MS);
    await this.applyLocalModel();
    await this.rearmSchedules();
  }

  private listTimer?: ReturnType<typeof setInterval>;

  dispose() {
    clearInterval(this.listTimer);
    this.unLocal?.();
  }

  private async initNativeModels() {
    if (!this.platform.local.supported) return;
    this.unLocal = this.platform.local.onProgress((event) => {
      this.set({ nativeProgress: { ...this.state.nativeProgress, [event.modelId]: event }, nativeError: event.error });
      if (event.status === "installed") void this.refreshNativeModels();
    });
    try {
      const nativeDevice = await this.platform.local.deviceInfo();
      this.set({ nativeDevice, deviceTotalRamMB: nativeDevice.totalRamMB });
      await this.refreshNativeModels();
    } catch {
      this.set({ nativeError: "On-device model storage is unavailable." });
    }
  }

  async refreshNativeModels() {
    const { installed, partial, active } = await this.platform.local.listInstalled();
    const nativeProgress = { ...this.state.nativeProgress };
    for (const p of partial) {
      const model = LOCAL_MODEL_CATALOG.find((m) => m.id === p.modelId);
      if (model && !nativeProgress[p.modelId]) nativeProgress[p.modelId] = {
        modelId: p.modelId, status: p.modelId === active ? "downloading" : "paused", bytes: p.bytes, total: model.sizeBytes,
      };
    }
    this.set({ nativeInstalled: installed, nativeProgress });
    const selected = this.state.settings.nativeSelectedModel;
    if (!selected || !installed.includes(selected)) {
      const recommended = recommendedLocalModel(this.state.deviceTotalRamMB)?.id;
      const next = recommended && installed.includes(recommended) ? recommended : installed[0];
      if (selected !== next) await this.saveSettings({ nativeSelectedModel: next });
    }
    await this.applyLocalModel();
  }

  async startNativeDownload(modelId: string, consentAccepted: boolean) {
    const model = LOCAL_MODEL_CATALOG.find((m) => m.id === modelId);
    if (!model || !consentAccepted) return;
    try {
      const nativeDevice = await this.platform.local.deviceInfo();
      this.set({ nativeDevice, nativeError: undefined });
      if (!this.state.settings.nativeModelConsent) await this.saveSettings({ nativeModelConsent: true });
      await this.platform.local.download(modelId);
    } catch (e) { this.set({ nativeError: e instanceof Error ? e.message : "Download failed." }); }
  }

  async controlNativeDownload(modelId: string, action: "pause" | "resume" | "cancel" | "delete") {
    try {
      this.set({ nativeError: undefined });
      await this.platform.local[action](modelId);
      if (action === "delete") {
        const nativeProgress = { ...this.state.nativeProgress }; delete nativeProgress[modelId];
        this.set({ nativeProgress });
        await this.refreshNativeModels();
      }
    } catch (e) { this.set({ nativeError: e instanceof Error ? e.message : "Action failed." }); }
  }

  async selectNativeModel(modelId: string) {
    if (this.state.nativeInstalled.includes(modelId)) await this.saveSettings({ nativeSelectedModel: modelId });
  }

  go = (screen: Screen) => this.set({ screen });
  private noticeTimer?: ReturnType<typeof setTimeout>;
  /** A notice fades after a few seconds; tapping it dismisses it at once. */
  notify = (notice?: string) => {
    clearTimeout(this.noticeTimer);
    this.set({ notice });
    if (notice) this.noticeTimer = setTimeout(() => this.set({ notice: undefined }), 6000);
  };

  // ---- settings / providers ----
  async saveSettings(patch: Partial<Settings>) {
    const settings = { ...this.state.settings, ...patch };
    this.set({ settings });
    await this.platform.kv.set(SETTINGS_KEY, JSON.stringify(settings));
    if (patch.brief) await this.rearmSchedules();
    if ("nativeSelectedModel" in patch || patch.localModel !== undefined || patch.localModelConsent !== undefined) await this.applyLocalModel();
  }

  private async saveProviders(providers: ProviderConfig[]) {
    this.set({ providers });
    await this.platform.kv.set(PROVIDERS_KEY, JSON.stringify(providers));
  }

  async addProvider(cfg: Omit<ProviderConfig, "id" | "enabled">, apiKey: string) {
    const id = newId();
    await this.platform.keys.set(id, apiKey);
    const base: ProviderConfig = { ...cfg, id, enabled: true };
    await this.saveProviders(insertByPreset(this.state.providers, base));
    // One automatic model fetch, only when the key is first added, then a real test of the best models.
    await this.check(id, async (p) => autoFetchOnce(p, apiKey, { fetch: this.platform.fetch }));
  }

  /** Fetches (optionally), then really asks the best models: the first one that answers becomes the provider's model. */
  private async check(id: string, prepare?: (p: ProviderConfig) => Promise<ProviderConfig>) {
    this.set({ checking: [...this.state.checking, id] });
    try {
      let p = this.state.providers.find((x) => x.id === id);
      const key = await this.platform.keys.get(id);
      if (!p || !key) return;
      if (prepare) p = await prepare(p);
      await this.updateProvider(await probeModels(p, key, { fetch: this.platform.fetch }));
    } finally {
      this.set({ checking: this.state.checking.filter((x) => x !== id) });
    }
  }

  /**
   * At start, in the background and one after the other: providers never tested, not working at last check, or not checked for a
   * day get a fresh model list and a real test. Free model lists change often, so a saved model may be gone by now.
   */
  private async checkUntested() {
    if (!this.onlineAllowed()) return;
    const stale = (x: ProviderConfig) => !x.health || !x.health.ok || Date.now() - x.health.at > 864e5;
    for (const p of this.state.providers.filter((x) => x.enabled && stale(x))) {
      if (!this.onlineAllowed()) break;
      await this.testProvider(p.id).catch(() => undefined);
    }
  }

  /** "Test" button: refetch the list and probe again. Replaces models the user did not pick by hand only when none works. */
  testProvider = (id: string) => this.check(id, async (p) => {
    const key = (await this.platform.keys.get(id)) ?? "";
    return refreshModels(p, key, { fetch: this.platform.fetch });
  }).then(async () => {
    // A Test that passes means the provider answers again (new key, new day): routing must not keep skipping it.
    if (this.state.providers.find((x) => x.id === id)?.health?.ok) await this.router.clearSpent(id);
  });

  /**
   * Live model lists: the built-in free services and every enabled provider with a key and an old list fetch their current list. New models
   * appear, retired ones disappear (`modelsChanged` says which), and a default that is gone is replaced. Runs at start and every few hours.
   */
  async syncLists() {
    if (!this.onlineAllowed()) return;
    const mine = this.state.providers; // a provider added while the free lists load is checked by its own add flow
    await this.syncFree();
    const old = (x: ProviderConfig) => Date.now() - (x.models?.fetchedAt ?? 0) >= LIST_REFRESH_MS;
    for (const p of mine.filter((x) => x.enabled && old(x))) {
      if (!this.onlineAllowed()) break;
      if (await this.platform.keys.get(p.id)) await this.refreshProviderModels(p.id).catch(() => undefined);
    }
  }

  private async syncFree() {
    const next: ProviderConfig[] = [];
    for (const p of this.state.freeProviders) {
      if (!this.onlineAllowed()) return;
      const r = await refreshModels(p, p.anonymousKey ?? "", { fetch: this.platform.fetch });
      const items = r.models?.items ?? [];
      if (r.modelsError || !items.length) { next.push(p); continue; } // the service is down: keep what worked
      // The seeded names stay first while the service still lists them; otherwise the best free models of the live list.
      const listed = (id: string) => items.some((m) => m.id === id);
      const seeds = (BUILTIN_PROVIDERS.find((b) => b.id === p.id)?.models?.items ?? []).map((m) => m.id).filter(listed);
      const [defaultModel] = [...seeds, ...rankModels(items).map((m) => m.id)];
      next.push({ ...r, defaultModel, modelsAutoFetched: true });
    }
    this.set({ freeProviders: next });
    await this.platform.kv.set(FREE_KEY, JSON.stringify(next));
  }

  /** Every real agent call updates the tick; written only when the state changes. */
  private recordHealth(id: string, ok: boolean, note?: string) {
    const p = this.state.providers.find((x) => x.id === id);
    if (!p || (p.health?.ok === ok && p.health.note === note)) return;
    void this.updateProvider({ ...p, health: { ok, at: Date.now(), note } });
    // A model that vanished from the provider: fetch the current list and pick working models again, without the user doing anything.
    if (!ok && note === friendlyReason("bad_request", 404) && !this.state.checking.includes(id)) void this.testProvider(id).catch(() => undefined);
  }

  async updateProvider(p: ProviderConfig) {
    await this.saveProviders(this.state.providers.map((x) => (x.id === p.id ? p : x)));
  }

  async refreshProviderModels(id: string) {
    const p = this.state.providers.find((x) => x.id === id);
    const key = p && (await this.platform.keys.get(id));
    if (!p || !key) return this.notify("Add an API key first");
    const next = await refreshModels(p, key, { fetch: this.platform.fetch });
    const gone = (m?: string) => m !== undefined && next.models !== undefined && !next.models.items.some((i) => i.id === m && !i.expiring);
    await this.updateProvider(withAutoModels({ ...next, defaultModel: gone(next.defaultModel) ? undefined : next.defaultModel }));
  }

  /** Back to automatic model choice: the hand-picked pair is dropped and the working models are found again. */
  async autoModels(id: string) {
    const p = this.state.providers.find((x) => x.id === id);
    if (!p) return;
    await this.updateProvider({ ...p, modelsChosen: false, defaultModel: undefined });
    await this.testProvider(id);
  }

  async setProviderKey(id: string, key: string) {
    await this.platform.keys.set(id, key);
    await this.router.clearSpent(id); // a new key is a new quota
  }

  async removeProvider(id: string) {
    await this.platform.keys.delete(id);
    await this.saveProviders(this.state.providers.filter((p) => p.id !== id));
  }

  async moveProvider(id: string, dir: -1 | 1) {
    const list = [...this.state.providers];
    const i = list.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    await this.saveProviders(list);
  }

  private push(item: Omit<ChatItem, "id">) {
    this.set({ items: [...this.state.items, { ...item, id: ++this.seq }] });
  }

  /**
   * `command` must be text the user typed in this app (or their own saved task/panel). This is the plain AI chat; phone tasks start from the Phone screen.
   * While a reply is pending, a new message joins the queue and runs after it.
   */
  async send(command: string) {
    if (!command.trim()) return;
    if (this.state.running) return this.set({ queue: [...this.state.queue, { id: ++this.seq, command }] });
    this.set({ running: true, status: "running" });
    try {
      let task: { command: string } | undefined = { command };
      while (task) {
        await this.runTask(task.command).catch((e: unknown) => {
          if (!(e instanceof AbortedError)) this.push({ role: "agent", text: e instanceof Error ? e.message : String(e), failed: true });
        });
        task = this.state.queue[0];
        if (task) this.set({ queue: this.state.queue.slice(1) });
      }
    } finally {
      this.set({ running: false, status: "idle", queue: [] });
    }
  }

  dequeue = (id: number) => this.set({ queue: this.state.queue.filter((q) => q.id !== id) });

  private async runTask(command: string) {
    const runId = newId();
    const abort = (this.abort = new AbortController());
    const history = this.chatContext();
    this.set({ screen: "chat" });
    this.push({ role: "user", text: command });
    try {
      await this.history.log(runId, "run_start", command).catch(() => undefined); // a full disk must not lock the chat
      const project = (await this.projects.list()).find((p) => p.id === this.state.settings.activeProjectId);
      const notes = await this.memory.forPrompt(project?.id);
      const system = [
        'You are Krish, a helpful assistant. Answer in the language the user writes. Reply as JSON: {"reply": "<your answer>"}.',
        notes && `Notes the user asked you to remember:\n${notes}`,
        project?.instructions && `Project "${project.name}": ${project.instructions}`,
      ].filter(Boolean).join("\n\n");
      const messages: ChatMessage[] = [{ role: "system", content: system }, ...history, { role: "user", content: redactChat(command) }];
      const { value } = await this.router.run(messages, parseReply, { signal: abort.signal });
      this.push({ role: "agent", text: value });
      void this.history.log(runId, "run_end", "done", value);
    } finally {
      this.abort = undefined;
    }
  }

  /** STOP ends the running reply and drops everything still queued behind it. */
  stop = () => {
    this.set({ queue: [] });
    this.abort?.abort();
  };
  clearChat = () => this.set({ items: [] });
  dismissItem = (id: number) => this.set({ items: this.state.items.filter((i) => i.id !== id) });

  /** Starts an empty chat. Ignored while a run is active (STOP first). History keeps the old run. */
  newChat = () => {
    if (this.state.running) return;
    this.clearChat();
    this.go("chat");
  };

  // ---- schedules ----
  async rearmSchedules() {
    const { system } = this.platform;
    const now = Date.now();
    for (const t of await this.scheduler.list()) {
      const at = nextRun(t, t.lastRunAt ?? now);
      if (at !== undefined) await system.scheduleDue(t.id, at, t.title);
      else await system.cancelDue(t.id);
    }
    for (const m of await this.macros.list()) {
      const at = nextRun(m, m.lastRunAt ?? now);
      if (at !== undefined) await system.scheduleDue(`macro:${m.id}`, at, m.title);
      else await system.cancelDue(`macro:${m.id}`);
    }
    const b = this.state.settings.brief;
    const at = nextBriefAt(b, now);
    if (at !== undefined) await system.scheduleDue("brief", at, "Your morning brief");
    else await system.cancelDue("brief");
  }

  async enableBrief(on: boolean) {
    if (on && !(await this.platform.system.requestNotifications())) {
      return this.notify("Notifications were not allowed. The brief stays off.");
    }
    await this.saveSettings({ brief: { ...this.state.settings.brief, enabled: on } });
  }

  /** User opened the app from a "due" notification or the Tasks screen. Runs only after the user taps Run. */
  async runBrief() {
    await this.send(briefCommand(await this.memory.forPrompt(), await this.scheduler.list()));
  }

  // ---- macros ----
  /** Runs a saved macro now (the user tapped Run, or opened the app from its notification). A failure after the retries notifies the user. */
  async runMacro(id: string): Promise<string> {
    const svc = this.phoneService;
    const macro = await this.macros.get(id);
    if (!svc || !macro) return "Macro not found";
    if (!(await this.consent.accepted())) return "Accept the phone-control consent first";
    const allow = (await this.platform.phone?.status())?.allowlist ?? [];
    const r = await svc.runMacro(macro, allow);
    await this.macros.markRan(id, Date.now());
    await this.rearmSchedules();
    if (r.ok) return `Done: ${macro.title}`;
    await this.platform.system.scheduleDue(`macro-failed:${id}`, Date.now() + 1000, `${macro.title} did not finish: ${r.reason}`).catch(() => undefined);
    return `${macro.title} did not finish: ${r.reason}`;
  }

  /** Saves the steps of the last phone task as a macro. The user has just seen and approved this plan's apps on the Phone screen. */
  async saveLastTaskAsMacro(title: string, when: { repeat: Repeat; hour: number; minute: number; at?: number }): Promise<string> {
    const rec = this.phoneService?.engine.recording;
    if (!rec) return "Run a task first";
    const r = await this.macros.create({ title, task: rec.plan.task, apps: rec.plan.apps, steps: rec.steps, ...when });
    if (!r.ok) return r.reason;
    await this.rearmSchedules();
    return "Saved";
  }
}
