import {
  AgentController, autoFetchOnce, cleanLabel, friendlyReason, DEFAULT_BRIEF, History, Memory, newId, Panels, ProviderRouter, Projects, refreshModels, probeModels, withAutoModels,
  runAgent, Scheduler, nextRun, nextBriefAt, briefCommand, Vault,
  type AgentEvent, type AgentUI, type BriefSettings, type ChipState, type ConfirmRequest, type PageDriver, type ProviderConfig,
  type MemoryPort, type SecureKind, type SelectedFile, type Sandbox, setLocalEngine, type ModelInfo,
} from "@krish/core";
import type { Platform } from "../platform";
import { Tier0Sandbox } from "../sandbox/tier0";
import { createWebGpuEngine, webgpuAvailable } from "../local/webgpu";
import type { LangPref } from "../i18n";
import type { ThemePref } from "../theme";

export const MAX_ATTACHMENTS = 10;

/** Bump when a default changes and old saved values must be migrated (see `migrateSettings`). */
export const SETTINGS_VERSION = 2;

export interface Settings {
  version: number;
  /** UI language. "auto" follows the device. The agent answers in the language the user writes, independent of this. */
  language: LangPref;
  /** "system" follows the device light/dark setting. */
  theme: ThemePref;
  liteMode: boolean;
  /** Open the browser card when the agent loads a site (plain answers never open it). Off: open it by tapping a step. */
  autoOpenWindow: boolean;
  screenshots: boolean;
  desktopLayout: boolean;
  brief: BriefSettings;
  linuxSandbox: boolean;
  localModel: boolean;
  /** Set after the user accepted the download notice. */
  localModelConsent: boolean;
  localModelId?: string;
  activeProjectId?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  language: "auto",
  theme: "system",
  liteMode: false,
  autoOpenWindow: true,
  screenshots: false,
  desktopLayout: false,
  brief: DEFAULT_BRIEF,
  linuxSandbox: false,
  localModel: false,
  localModelConsent: false,
};

/**
 * Settings saved by an older build. v1 saved the then-default theme "light" for everybody, so it cannot be told apart from a
 * real choice: it moves to Auto once. Anything saved later is a real choice and is kept.
 */
export function migrateSettings(saved: Partial<Settings>): Partial<Settings> {
  if ((saved.version ?? 1) >= SETTINGS_VERSION) return saved;
  return { ...saved, version: SETTINGS_VERSION, theme: saved.theme === undefined || saved.theme === "light" ? "system" : saved.theme };
}

export type Screen = "home" | "chat" | "menu" | "vault" | "panels" | "projects" | "tasks" | "history" | "providers" | "settings" | "security";

export type Prompt =
  | { id: number; type: "confirm"; req: ConfirmRequest; resolve: (ok: boolean) => void }
  | { id: number; type: "ask"; question: string; resolve: (v: string | undefined) => void }
  | { id: number; type: "secure"; kind: SecureKind; title: string; site: string; field: string; resolve: (v: string | undefined) => void }
  | { id: number; type: "takeover"; reason: string; resolve: () => void };

export interface ChatItem {
  id: number;
  role: "user" | "agent";
  text?: string;
  /** Files attached to a user message (name and size only). */
  files?: { name: string; size: number }[];
  chip?: { label: string; state: ChipState };
  /** The run ended in an error: shown as an error note, not as an answer. */
  failed?: boolean;
  /** Which provider and model produced this answer (shown small under it). */
  via?: string;
}

export interface State {
  ready: boolean;
  screen: Screen;
  settings: Settings;
  providers: ProviderConfig[];
  items: ChatItem[];
  /** Files picked for the next message. They go to the agent with it; the model sees names and sizes only. */
  attachments: SelectedFile[];
  prompts: Prompt[];
  running: boolean;
  paused: boolean;
  /** The browser card is shown (in the layout, never floating). */
  /** Provider ids whose connection is being tested right now. */
  checking: string[];
  windowOpen: boolean;
  /** The card fills the screen. */
  windowExpanded: boolean;
  page: { url: string; title: string; loading: boolean };
  status: "idle" | "running" | "action_required" | "paused";
  deviceLowRam: boolean;
  linuxAvailable: boolean;
  notice?: string;
  localModels: ModelInfo[];
  localStatus: string;
}

/** Most recent step chip of the chat (old WebViews lack Array.prototype.findLast). */
export const lastChip = (items: ChatItem[]): ChatItem | undefined => {
  for (let i = items.length - 1; i >= 0; i--) if (items[i]!.chip) return items[i];
  return undefined;
};

/** Screens at least this wide get the desktop layout: side panel, chat, and the browser card as a right column. */
export const WIDE = 900;

const SETTINGS_KEY = "settings";
const PROVIDERS_KEY = "providers";

export class AppStore {
  state: State = {
    ready: false, screen: "home", settings: DEFAULT_SETTINGS, providers: [], items: [], attachments: [], prompts: [],
    running: false, paused: false, checking: [], windowOpen: false, windowExpanded: false,
    page: { url: "", title: "", loading: false }, status: "idle", deviceLowRam: false, linuxAvailable: false,
    localModels: [], localStatus: "",
  };
  private listeners = new Set<() => void>();
  private controller?: AgentController;
  private seq = 0;
  private unPage?: () => void;
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
  /** KrishVault: saved logins, encrypted with the user's master passphrase, stored through the platform key store. */
  readonly vault: Vault;

  constructor(readonly platform: Platform) {
    this.vault = new Vault(platform.keys);
    this.vault.onChange(() => this.set({}));
    this.memory = new Memory(platform.kv);
    this.history = new History(platform.kv);
    this.projects = new Projects(platform.kv);
    this.panels = new Panels(platform.kv);
    this.scheduler = new Scheduler(platform.kv);
    this.router = new ProviderRouter({
      keys: platform.keys, kv: platform.kv, fetch: platform.fetch,
      providers: () => this.routerProviders(),
      onResult: (id, ok, note) => this.recordHealth(id, ok, note),
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
    // First run on a low-RAM device starts in Lite mode; once the user has saved settings their choice wins.
    const settings = { ...DEFAULT_SETTINGS, liteMode: info.lowRam, ...(s ? migrateSettings(JSON.parse(s)) : {}) } as Settings;
    // Tier 1 is disabled on low-RAM devices regardless of the saved flag.
    if (info.lowRam) settings.linuxSandbox = false;
    // The native view reports every load step; only a real change re-renders the app.
    this.unPage = this.platform.browser.onPage((page) => {
      const old = this.state.page;
      if (old.url !== page.url || old.title !== page.title || old.loading !== page.loading) this.set({ page });
    });
    this.set({
      ready: true, settings, providers: p ? JSON.parse(p) : [], deviceLowRam: info.lowRam,
      linuxAvailable: info.linuxSandbox && !info.lowRam,
    });
    await this.vault.load();
    void this.checkUntested();
    await this.applyLocalModel();
    await this.rearmSchedules();
  }

  dispose() {
    this.vault.lock();
    this.unPage?.();
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
    // One automatic model fetch, only when the key is first added, then a real test of the best models.
    await this.check(id, async (p) => autoFetchOnce(p, apiKey, { fetch: this.platform.fetch }));
  }

  /** Fetches (optionally), then really asks the best models: the first two that answer become default and fallback. */
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
    const stale = (x: ProviderConfig) => !x.health || !x.health.ok || Date.now() - x.health.at > 864e5;
    for (const p of this.state.providers.filter((x) => x.enabled && stale(x))) await this.testProvider(p.id).catch(() => undefined);
  }

  /** "Test" button: refetch the list and probe again. Replaces models the user did not pick by hand only when none works. */
  testProvider = (id: string) => this.check(id, async (p) => {
    const key = (await this.platform.keys.get(id)) ?? "";
    return refreshModels(p, key, { fetch: this.platform.fetch });
  });

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
    await this.updateProvider(withAutoModels({ ...next, defaultModel: gone(next.defaultModel) ? undefined : next.defaultModel, fallbackModel: gone(next.fallbackModel) ? undefined : next.fallbackModel }));
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
  openWindow = () => this.set({ windowOpen: true });
  closeWindow = () => this.set({ windowOpen: false, windowExpanded: false });
  toggleWindowExpanded = () => this.set({ windowExpanded: !this.state.windowExpanded });

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

  private via?: string;
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
    } else if (e.type === "provider") {
      const name = this.routerProviders().find((p) => p.id === e.providerId)?.name ?? "";
      this.via = name ? `${name} · ${e.model}` : e.model;
    } else if (e.type === "browser") {
      // The card opens when the agent really uses the browser, never for a plain chat or an old tab.
      if (this.state.settings.autoOpenWindow) this.openWindow();
    } else if (e.type === "action") {
      void this.history.log(runId, "action", e.action.type, e.result);
    } else if (e.type === "end") {
      const bad = e.status === "failed" || e.status === "max_steps";
      // Steps still open when the run ends (stopped, failed) must not stay "running" or "action required" in the thread.
      const closed = bad || e.status === "stopped" ? "error" : "done";
      this.set({ items: this.state.items.map((i) => (i.chip && (i.chip.state === "running" || i.chip.state === "action_required") ? { ...i, chip: { ...i.chip, state: closed } } : i)) });
      this.push({ role: "agent", text: e.summary, ...(bad ? { failed: true } : this.via ? { via: this.via } : {}) });
      this.via = undefined;
      void this.history.log(runId, "run_end", e.status, e.summary);
    }
  }

  private push(item: Omit<ChatItem, "id">) {
    this.set({ items: [...this.state.items, { ...item, id: ++this.seq }] });
  }

  // ---- running the agent ----
  /**
   * Opens a page and returns once it has loaded, so the next read sees the new page and not the one that was open before.
   * Waits up to 1.5 s for the load to start and 20 s for it to finish; a host that reports no load events returns after the first wait.
   */
  private async openAndWait(url: string) {
    let started = false;
    let finish: () => void = () => {};
    const done = new Promise<void>((r) => (finish = r));
    const off = this.platform.browser.onPage((p) => {
      if (p.loading) started = true;
      else if (started) finish();
    });
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    try {
      await this.platform.browser.open(url);
      await Promise.race([done, wait(1500)]);
      if (started) await Promise.race([done, wait(20_000)]);
    } finally {
      off();
    }
  }

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
      navigate: (url) => this.openAndWait(url),
      read: (id) => b.read(id),
      click: (id) => b.click(id, fps.get(id)),
      type: (id, text, submit) => b.type(id, text, submit, fps.get(id)),
      paste: (id, text) => b.fill(id, text, fps.get(id)),
      upload: (id, f: SelectedFile) => b.upload(id, f.token, fps.get(id)),
      fillSecret: (id, value) => b.fill(id, value, fps.get(id)),
      highlight: (id) => b.highlight(id),
    };
  }

  /** Memory for the agent: it saves or forgets only what the user's chat message asks (see the loop). Global facts and the active project's. */
  private memoryPort(): MemoryPort {
    const project = () => this.state.settings.activeProjectId;
    return {
      list: async () => (await this.memory.recall(project())).map(({ id, text }) => ({ id, text })),
      add: async (text) => void (await this.memory.add(text)),
      remove: (id) => this.memory.remove(id),
    };
  }

  /** `command` must be text the user typed in this app (or their own saved task/panel). */
  async send(command: string, opts: { startUrl?: string; files?: SelectedFile[] } = {}) {
    if (this.state.running || !command.trim()) return;
    const runId = newId();
    const controller = (this.controller = new AgentController());
    this.chipItems.clear();
    // Only the composer passes files; saved tasks, panels and the brief never pick up the composer's tray.
    const files = opts.files ?? [];
    if (opts.files) this.draftEpoch++;
    this.set({ running: true, paused: false, status: "running", screen: "chat", ...(opts.files ? { attachments: [] } : {}) });
    if (opts.startUrl) this.openWindow();
    else this.closeWindow(); // a plain chat starts without the card (and without the tab left open before)
    this.push({ role: "user", text: command, files: files.length ? files.map(({ name, size }) => ({ name, size })) : undefined });
    try {
      await this.history.log(runId, "run_start", command).catch(() => undefined); // a full disk must not lock the chat
      if (opts.startUrl) await this.platform.browser.open(opts.startUrl);
      const project = (await this.projects.list()).find((p) => p.id === this.state.settings.activeProjectId);
      const task = project?.instructions ? `${command}\n\n(Project "${project.name}": ${project.instructions})` : command;
      const { url, title } = this.state.page;
      const openTab = url && url !== "about:blank" ? `${title ? `${title} — ` : ""}${url}` : undefined;
      await runAgent(
        { task, files, screenshots: this.state.settings.screenshots, startOnPage: Boolean(opts.startUrl), openTab },
        { driver: this.driver(), router: this.router, ui: this.buildUI(runId), controller, sandbox: this.sandbox, memory: this.memoryPort(), vault: this.vault },
      );
    } finally {
      this.controller = undefined;
      this.set({ running: false, paused: false, status: "idle", prompts: [] });
      await this.platform.browser.setMode(this.state.windowOpen ? "live" : "hidden").catch(() => undefined);
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
  dismissItem = (id: number) => this.set({ items: this.state.items.filter((i) => i.id !== id) });
  /** Opens the system picker (any file type). Throws if the platform cannot read the file; the UI shows the message. */
  async attach() {
    if (this.picking || this.state.running || this.state.attachments.length >= MAX_ATTACHMENTS) return;
    this.picking = true;
    const epoch = this.draftEpoch;
    try {
      const f = await this.platform.files.pick();
      // The draft may have been sent or cleared (New chat) while the picker was open.
      if (!f || epoch !== this.draftEpoch) return;
      this.set({ attachments: [...this.state.attachments, { ...f, name: cleanLabel(f.name) || "file" }] });
    } finally {
      this.picking = false;
    }
  }
  private picking = false;
  private draftEpoch = 0;
  detach = (token: string) => this.set({ attachments: this.state.attachments.filter((f) => f.token !== token) });

  /** Starts an empty chat. Ignored while a run is active (STOP first). History keeps the old run. */
  newChat = () => {
    if (this.state.running) return;
    this.chipItems.clear();
    this.draftEpoch++;
    this.set({ attachments: [] });
    this.clearChat();
    this.go("chat");
  };

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
