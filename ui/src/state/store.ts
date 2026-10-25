import {
  AgentController, autoFetchOnce, DEFAULT_BRIEF, History, Memory, newId, Panels, ProviderRouter, Projects, refreshModels,
  runAgent, Scheduler, nextRun, nextBriefAt, briefCommand,
  type AgentEvent, type AgentUI, type BriefSettings, type ChipState, type ConfirmRequest, type PageDriver, type ProviderConfig,
  type SecureKind, type SelectedFile, type Sandbox, setLocalEngine, type ModelInfo,
} from "@krish/core";
import type { Platform } from "../platform";
import { Tier0Sandbox } from "../sandbox/tier0";
import { createWebGpuEngine, webgpuAvailable } from "../local/webgpu";

export type WindowSize = "mini" | "medium" | "large" | "full";

export interface Settings {
  liteMode: boolean;
  screenshots: boolean;
  desktopLayout: boolean;
  window: { size: WindowSize; x: number; y: number; w: number; h: number };
  brief: BriefSettings;
  linuxSandbox: boolean;
  localModel: boolean;
  /** Set after the user accepted the download notice. */
  localModelConsent: boolean;
  localModelId?: string;
  activeProjectId?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  liteMode: false,
  screenshots: false,
  desktopLayout: false,
  window: { size: "medium", x: 16, y: 96, w: 340, h: 320 },
  brief: DEFAULT_BRIEF,
  linuxSandbox: false,
  localModel: false,
  localModelConsent: false,
};

export type Screen = "home" | "chat" | "panels" | "projects" | "tasks" | "history" | "providers" | "settings" | "security";

export type Prompt =
  | { id: number; type: "confirm"; req: ConfirmRequest; resolve: (ok: boolean) => void }
  | { id: number; type: "ask"; question: string; resolve: (v: string | undefined) => void }
  | { id: number; type: "secure"; kind: SecureKind; title: string; site: string; field: string; resolve: (v: string | undefined) => void }
  | { id: number; type: "takeover"; reason: string; resolve: () => void };

export interface ChatItem {
  id: number;
  role: "user" | "agent";
  text?: string;
  chip?: { label: string; state: ChipState };
}

export interface State {
  ready: boolean;
  screen: Screen;
  settings: Settings;
  providers: ProviderConfig[];
  items: ChatItem[];
  prompts: Prompt[];
  running: boolean;
  paused: boolean;
  windowOpen: boolean;
  windowMinimized: boolean;
  page: { url: string; title: string; loading: boolean };
  status: "idle" | "running" | "action_required" | "paused";
  snapshot: string;
  deviceLowRam: boolean;
  linuxAvailable: boolean;
  notice?: string;
  localModels: ModelInfo[];
  localStatus: string;
}

export const WINDOW_PRESETS: Record<WindowSize, (vw: number, vh: number) => { w: number; h: number }> = {
  mini: () => ({ w: 180, h: 130 }),
  medium: (vw) => ({ w: Math.min(vw - 24, 360), h: 320 }),
  large: (vw, vh) => ({ w: vw - 16, h: Math.round(vh * 0.62) }),
  full: (vw, vh) => ({ w: vw, h: vh }),
};

const SETTINGS_KEY = "settings";
const PROVIDERS_KEY = "providers";

export class AppStore {
  state: State = {
    ready: false, screen: "home", settings: DEFAULT_SETTINGS, providers: [], items: [], prompts: [],
    running: false, paused: false, windowOpen: false, windowMinimized: false,
    page: { url: "", title: "", loading: false }, status: "idle", snapshot: "", deviceLowRam: false, linuxAvailable: false,
    localModels: [], localStatus: "",
  };
  private listeners = new Set<() => void>();
  private controller?: AgentController;
  private seq = 0;
  private unPage?: () => void;
  private snapTimer?: ReturnType<typeof setInterval>;
  /** Tier 0 is always on. Tier 1 / Docker replace it per task when enabled (see sandbox/). */
  readonly tier0 = new Tier0Sandbox();
  /** shell -> Tier 1 / Docker (only when enabled and available); everything else -> Tier 0. Files are shared. */
  sandbox: Sandbox = {
    run: async (task, signal) => {
      if (task.tool !== "shell") return this.tier0.run(task, signal);
      const { linux } = this.platform;
      if (!linux || !this.state.settings.linuxSandbox || !this.state.linuxAvailable) {
        return "Linux sandbox is off or unavailable. Ask the user to enable it in Settings, or use another tool.";
      }
      const r = await linux.run(task.code, { ...this.tier0.files });
      for (const [n, d] of Object.entries(r.files)) this.tier0.addFile(n, d);
      this.sandboxFiles = this.tier0.list();
      return r.output;
    },
  };
  sandboxFiles: { name: string; size: number }[] = [];

  readonly memory: Memory;
  readonly history: History;
  readonly projects: Projects;
  readonly panels: Panels;
  readonly scheduler: Scheduler;
  readonly router: ProviderRouter;

  constructor(readonly platform: Platform) {
    this.memory = new Memory(platform.kv);
    this.history = new History(platform.kv);
    this.projects = new Projects(platform.kv);
    this.panels = new Panels(platform.kv);
    this.scheduler = new Scheduler(platform.kv);
    this.router = new ProviderRouter({
      keys: platform.keys, kv: platform.kv, fetch: platform.fetch,
      providers: () => this.routerProviders(),
    });
  }

  /** The on-device model, when enabled and usable, goes first; API providers follow as the automatic fallback. */
  private routerProviders(): ProviderConfig[] {
    const { localModel, localModelConsent, localModelId } = this.state.settings;
    if (!localModel || !localModelConsent || !localModelId || !webgpuAvailable()) return this.state.providers;
    const local: ProviderConfig = {
      id: "local", name: "On-device", kind: "webgpu-local", baseUrl: "local:", enabled: true, allowSensitive: true, defaultModel: localModelId,
    };
    return [local, ...this.state.providers];
  }

  /** Called when the experimental flag changes. Registers or removes the engine; nothing loads until a task needs it. */
  async applyLocalModel() {
    const { localModel, localModelConsent } = this.state.settings;
    if (!localModel || !localModelConsent || !webgpuAvailable()) {
      setLocalEngine(undefined);
      return this.set({ localModels: [], localStatus: "" });
    }
    const engine = createWebGpuEngine((localStatus) => this.set({ localStatus }));
    setLocalEngine(engine);
    this.set({ localModels: await engine.listModels().catch(() => []) });
  }

  subscribe = (l: () => void) => (this.listeners.add(l), () => void this.listeners.delete(l));
  getState = () => this.state;
  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  async init() {
    const [s, p, info] = await Promise.all([
      this.platform.kv.get(SETTINGS_KEY), this.platform.kv.get(PROVIDERS_KEY), this.platform.system.deviceInfo(),
    ]);
    const settings = { ...DEFAULT_SETTINGS, ...(s ? JSON.parse(s) : {}) } as Settings;
    // Tier 1 is disabled on low-RAM devices regardless of the saved flag.
    if (info.lowRam) settings.linuxSandbox = false;
    this.unPage = this.platform.browser.onPage((page) => this.set({ page }));
    this.set({
      ready: true, settings, providers: p ? JSON.parse(p) : [], deviceLowRam: info.lowRam,
      linuxAvailable: info.linuxSandbox && !info.lowRam,
    });
    await this.applyLocalModel();
    await this.rearmSchedules();
  }

  dispose() {
    this.unPage?.();
    clearInterval(this.snapTimer);
  }

  go = (screen: Screen) => this.set({ screen });
  notify = (notice?: string) => this.set({ notice });

  // ---- settings / providers ----
  async saveSettings(patch: Partial<Settings>) {
    const settings = { ...this.state.settings, ...patch };
    this.set({ settings });
    await this.platform.kv.set(SETTINGS_KEY, JSON.stringify(settings));
    if (patch.desktopLayout !== undefined) await this.platform.browser.setDesktopLayout(patch.desktopLayout);
    if (patch.brief) await this.rearmSchedules();
    if (patch.localModel !== undefined || patch.localModelConsent !== undefined) await this.applyLocalModel();
  }

  private async saveProviders(providers: ProviderConfig[]) {
    this.set({ providers });
    await this.platform.kv.set(PROVIDERS_KEY, JSON.stringify(providers));
  }

  async addProvider(cfg: Omit<ProviderConfig, "id" | "enabled" | "allowSensitive">, apiKey: string) {
    const id = newId();
    await this.platform.keys.set(id, apiKey);
    const base: ProviderConfig = { ...cfg, id, enabled: true, allowSensitive: false };
    await this.saveProviders([...this.state.providers, base]);
    // One automatic model fetch, only when the key is first added.
    const fetched = await autoFetchOnce(base, apiKey, { fetch: this.platform.fetch });
    await this.updateProvider(fetched);
  }

  async updateProvider(p: ProviderConfig) {
    await this.saveProviders(this.state.providers.map((x) => (x.id === p.id ? p : x)));
  }

  async refreshProviderModels(id: string) {
    const p = this.state.providers.find((x) => x.id === id);
    const key = p && (await this.platform.keys.get(id));
    if (!p || !key) return this.notify("Add an API key first");
    await this.updateProvider(await refreshModels(p, key, { fetch: this.platform.fetch }));
  }

  async setProviderKey(id: string, key: string) {
    await this.platform.keys.set(id, key);
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

  async clearAllSiteData() {
    await this.platform.browser.clearSiteData();
    this.notify("Site data cleared");
  }

  // ---- live window ----
  openWindow = () => this.set({ windowOpen: true, windowMinimized: false });
  closeWindow = () => this.set({ windowOpen: false });
  minimizeWindow = (v: boolean) => this.set({ windowMinimized: v });
  async setWindowRect(w: Partial<Settings["window"]>) {
    await this.saveSettings({ window: { ...this.state.settings.window, ...w } });
  }
  async setWindowSize(size: WindowSize) {
    const { w, h } = WINDOW_PRESETS[size](window.innerWidth, window.innerHeight);
    const x = size === "full" ? 0 : this.state.settings.window.x;
    const y = size === "full" ? 0 : this.state.settings.window.y;
    await this.setWindowRect({ size, w, h, x, y });
  }

  /** Mini size on a slow device uses ~1 snapshot/second instead of a live view. */
  syncSnapshots(active: boolean) {
    clearInterval(this.snapTimer);
    if (!active) return this.set({ snapshot: "" });
    const tick = async () => this.set({ snapshot: await this.platform.browser.snapshot(360, 50).catch(() => "") });
    void tick();
    this.snapTimer = setInterval(tick, 1000);
  }

  // ---- prompts ----
  private prompt<T extends Prompt["type"]>(build: (id: number) => Extract<Prompt, { type: T }>, status: State["status"] = "action_required") {
    const p = build(++this.seq);
    this.set({ prompts: [...this.state.prompts, p], status });
    return p.id;
  }
  private settle(id: number) {
    const prompts = this.state.prompts.filter((p) => p.id !== id);
    this.set({ prompts, status: this.state.running ? (this.state.paused ? "paused" : "running") : "idle" });
  }
  answer(id: number, value: unknown) {
    const p = this.state.prompts.find((x) => x.id === id);
    if (!p) return;
    this.settle(id);
    (p.resolve as (v: unknown) => void)(value);
  }

  private buildUI(runId: string): AgentUI {
    const wait = <V>(add: (resolve: (v: V) => void, signal: AbortSignal) => number, signal: AbortSignal, fallback: V) =>
      new Promise<V>((resolve) => {
        const id = add(resolve, signal);
        signal.addEventListener("abort", () => (this.settle(id), resolve(fallback)), { once: true });
      });
    return {
      confirm: (req, signal) =>
        wait<boolean>((resolve) => this.prompt((id) => ({ id, type: "confirm", req, resolve })), signal, false),
      ask: (question, signal) =>
        wait<string | undefined>((resolve) => this.prompt((id) => ({ id, type: "ask", question, resolve })), signal, undefined),
      askSecure: ({ kind, title, site, field }, signal) =>
        wait<string | undefined>((resolve) => this.prompt((id) => ({ id, type: "secure", kind, title, site, field, resolve })), signal, undefined),
      takeOver: (reason, signal) => {
        this.openWindow();
        void this.platform.browser.setMode("live");
        return wait<void>((resolve) => this.prompt((id) => ({ id, type: "takeover", reason, resolve })), signal, undefined);
      },
      pickFile: async () => this.platform.files.pick(),
      emit: (e) => this.onAgentEvent(runId, e),
    };
  }

  private chipItems = new Map<number, number>();
  private onAgentEvent(runId: string, e: AgentEvent) {
    if (e.type === "chip") {
      const existing = this.chipItems.get(e.id);
      if (existing !== undefined) {
        this.set({ items: this.state.items.map((i) => (i.id === existing ? { ...i, chip: { label: e.label, state: e.state } } : i)) });
      } else {
        const id = ++this.seq;
        this.chipItems.set(e.id, id);
        this.set({ items: [...this.state.items, { id, role: "agent", chip: { label: e.label, state: e.state } }] });
      }
      void this.history.log(runId, "chip", e.label, undefined, e.state);
    } else if (e.type === "action") {
      void this.history.log(runId, "action", e.action.type, e.result);
    } else if (e.type === "end") {
      this.push({ role: "agent", text: e.summary });
      void this.history.log(runId, "run_end", e.status, e.summary);
    }
  }

  private push(item: Omit<ChatItem, "id">) {
    this.set({ items: [...this.state.items, { ...item, id: ++this.seq }] });
  }

  // ---- running the agent ----
  private driver(): PageDriver {
    const b = this.platform.browser;
    let fps = new Map<number, string | undefined>();
    return {
      observe: async () => {
        const o = await b.observe();
        fps = new Map(o.elements.map((e) => [e.id, e.fp]));
        if (this.state.settings.screenshots) o.screenshotDataUrl = await b.snapshot(768, 60).catch(() => undefined);
        return o;
      },
      navigate: (url) => b.open(url),
      read: (id) => b.read(id),
      click: (id) => b.click(id, fps.get(id)),
      type: (id, text, submit) => b.type(id, text, submit, fps.get(id)),
      paste: (id, text) => b.fill(id, text, fps.get(id)),
      upload: (id, f: SelectedFile) => b.upload(id, f.token, fps.get(id)),
      fillSecret: (id, value) => b.fill(id, value, fps.get(id)),
      highlight: (id) => b.highlight(id),
    };
  }

  /** `command` must be text the user typed in this app (or their own saved task/panel). */
  async send(command: string, opts: { startUrl?: string } = {}) {
    if (this.state.running || !command.trim()) return;
    const runId = newId();
    const controller = (this.controller = new AgentController());
    this.chipItems.clear();
    this.set({ running: true, paused: false, status: "running", screen: "chat" });
    this.push({ role: "user", text: command });
    await this.history.log(runId, "run_start", command);
    try {
      if (opts.startUrl) await this.platform.browser.open(opts.startUrl);
      const memory = await this.memory.forPrompt(this.state.settings.activeProjectId);
      const project = (await this.projects.list()).find((p) => p.id === this.state.settings.activeProjectId);
      const task = project?.instructions ? `${command}\n\n(Project "${project.name}": ${project.instructions})` : command;
      await runAgent(
        { task, memory, screenshots: this.state.settings.screenshots },
        { driver: this.driver(), router: this.router, ui: this.buildUI(runId), controller, sandbox: this.sandbox },
      );
    } finally {
      this.controller = undefined;
      this.set({ running: false, paused: false, status: "idle", prompts: [] });
      await this.platform.browser.setMode("hidden").catch(() => undefined);
    }
  }

  stop = () => this.controller?.stop();
  takeOver() {
    this.controller?.pause();
    this.set({ paused: true, status: "paused" });
    this.openWindow();
    void this.platform.browser.setMode("live");
  }
  resume() {
    this.controller?.resume();
    this.set({ paused: false, status: "running" });
  }
  clearChat = () => this.set({ items: [] });

  // ---- sandbox files (system picker in, system picker out) ----
  async addSandboxFile() {
    const picked = await this.platform.files.pick();
    if (!picked) return;
    try {
      this.tier0.addFile(picked.name, await this.platform.files.read(picked.token));
      this.sandboxFiles = this.tier0.list();
      this.set({});
    } catch (e) {
      this.notify(e instanceof Error ? e.message : "Could not read that file");
    }
  }
  async saveSandboxFile(name: string) {
    const bytes = this.tier0.files[name];
    if (bytes) await this.platform.files.save(name, bytes);
  }
  removeSandboxFile(name: string) {
    delete this.tier0.files[name];
    this.sandboxFiles = this.tier0.list();
    this.set({});
  }

  // ---- schedules ----
  async rearmSchedules() {
    const { system } = this.platform;
    const now = Date.now();
    for (const t of await this.scheduler.list()) {
      const at = nextRun(t, t.lastRunAt ?? now);
      if (at !== undefined) await system.scheduleDue(t.id, at, t.title);
      else await system.cancelDue(t.id);
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
}
