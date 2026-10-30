import {
  AgentController, DEFAULTS, redactChat, autoFetchOnce, cleanLabel, friendlyReason, DEFAULT_BRIEF, History, Memory, newId, Panels, ProviderRouter, Projects, refreshModels, probeModels, withAutoModels,
  runAgent, Scheduler, nextRun, nextBriefAt, briefCommand, Vault,
  type AgentEvent, type AgentUI, type BriefSettings, type ChipState, type PageDriver, type ProviderConfig,
  type LoginAnswer, type LoginRequest, type MemoryPort, type SecureKind, type SelectedFile, type TabInfo, type Sandbox, setLocalEngine, type ModelInfo,
  BUILTIN_PROVIDERS, rankModels, LOCAL_MODEL_CATALOG, recommendedLocalModel,
} from "@krish/core";
import type { Platform } from "../platform";
import type { LocalDeviceInfo, LocalProgress } from "../platform/types";
import { Tier0Sandbox } from "../sandbox/tier0";
import { createWebGpuEngine, webgpuAvailable } from "../local/webgpu";
import type { LangPref } from "../i18n";
import type { ThemePref } from "../theme";

export const MAX_ATTACHMENTS = 10;

/** Bump when a default changes and old saved values must be migrated (see `migrateSettings`). */
export const SETTINGS_VERSION = 5;

export interface Settings {
  version: number;
  /** UI language. "auto" follows the device. The agent answers in the language the user writes, independent of this. */
  language: LangPref;
  /** "auto" follows the local time of day, "system" the device light/dark setting. */
  theme: ThemePref;
  liteMode: boolean;
  /** Open the browser card when the agent loads a site (plain answers never open it). Off: open it by tapping a step. */
  autoOpenWindow: boolean;
  screenshots: boolean;
  desktopLayout: boolean;
  brief: BriefSettings;
  linuxSandbox: boolean;
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
  activeProjectId?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  language: "auto",
  theme: "auto",
  liteMode: false,
  autoOpenWindow: true,
  screenshots: false,
  desktopLayout: true, // sites open as on a PC: a big, readable window on the phone
  brief: DEFAULT_BRIEF,
  linuxSandbox: false,
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
  const rest: Record<string, unknown> = { ...saved, version: SETTINGS_VERSION, theme, ...(v < 4 && { desktopLayout: true }) };
  for (const gone of ["aiSeesLogin", "confirmFill"]) delete rest[gone]; // the confirmation and sign-in-page switches no longer exist
  return rest as Partial<Settings>;
}

export type Screen = "home" | "chat" | "menu" | "vault" | "panels" | "projects" | "tasks" | "history" | "providers" | "settings" | "security";

export type Prompt =
  | { id: number; type: "ask"; question: string; resolve: (v: string | undefined) => void }
  | { id: number; type: "secure"; kind: SecureKind; title: string; site: string; field: string; resolve: (v: string | undefined) => void }
  | { id: number; type: "login"; req: LoginRequest; resolve: (v: LoginAnswer | undefined) => void }
  | { id: number; type: "captcha"; reason: string; resolve: () => void };

export interface QueuedTask {
  id: number;
  command: string;
  files: SelectedFile[];
  startUrl?: string;
}

export interface ChatItem {
  id: number;
  role: "user" | "agent";
  text?: string;
  /** Files attached to a user message (name and size only). */
  files?: { name: string; size: number }[];
  chip?: { label: string; state: ChipState };
  /** The run ended in an error: shown as an error note, not as an answer. */
  failed?: boolean;
  /** What the agent said it will do, before it started (styled apart from answers, not sent back to the model). */
  plan?: boolean;
  /** Which provider and model produced this answer (shown small under it). */
}

export interface State {
  ready: boolean;
  screen: Screen;
  settings: Settings;
  providers: ProviderConfig[];
  /** The built-in free services with their live model lists (OpenCode Zen first). Not the user's keys. */
  freeProviders: ProviderConfig[];
  items: ChatItem[];
  /** Files picked for the next message. They go to the agent with it; the model sees names and sizes only. */
  attachments: SelectedFile[];
  prompts: Prompt[];
  running: boolean;
  /** Messages sent while a task runs. They run one after another in the background, each as its own task. */
  queue: QueuedTask[];
  /** The browser card is shown (in the layout, never floating). */
  /** Provider ids whose connection is being tested right now. */
  checking: string[];
  windowOpen: boolean;
  /** The card fills the screen. */
  windowExpanded: boolean;
  page: { url: string; title: string; loading: boolean };
  /** The agent's open tabs (chips on the browser card when there is more than one). */
  tabs: TabInfo[];
  status: "idle" | "running" | "action_required";
  deviceLowRam: boolean;
  /** Android reports actual physical RAM in MiB, or zero when unavailable. */
  deviceTotalRamMB: number;
  linuxAvailable: boolean;
  notice?: string;
  localModels: ModelInfo[];
  localStatus: string;
  nativeDevice?: LocalDeviceInfo;
  nativeInstalled: string[];
  nativeProgress: Record<string, LocalProgress>;
  nativeError?: string;
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
const FREE_KEY = "freeProviders";
const THREAD_KEY = "thread";
/** Chat messages kept on the device and the number of recent ones the agent is shown. */
const THREAD_KEEP = 60;
const CHAT_FOR_AGENT = 12;
/** Model lists are fetched again this often while the app is open (and at every start), so new and retired models show up by themselves. */
const LIST_REFRESH_MS = 6 * 36e5;

export class AppStore {
  state: State = {
    ready: false, screen: "home", settings: DEFAULT_SETTINGS, providers: [], freeProviders: BUILTIN_PROVIDERS, items: [], attachments: [], prompts: [],
    running: false, queue: [], checking: [], windowOpen: false, windowExpanded: false,
    page: { url: "", title: "", loading: false }, tabs: [], status: "idle", deviceLowRam: false, deviceTotalRamMB: 0, linuxAvailable: false,
    localModels: [], localStatus: "", nativeInstalled: [], nativeProgress: {},
  };
  private listeners = new Set<() => void>();
  private controller?: AgentController;
  private seq = 0;
  private unPage?: () => void;
  private unLocal?: () => void;
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
  /** KrishVault: saved logins, kept for good in the platform key store (Android Keystore / OS keychain). */
  readonly vault: Vault;

  constructor(readonly platform: Platform, private readonly opts: { providerWaits?: number[]; sleep?: (ms: number) => Promise<void> } = {}) {
    this.vault = new Vault(platform.keys);
    this.vault.onChange(() => this.set({}));
    this.memory = new Memory(platform.kv);
    this.history = new History(platform.kv);
    this.projects = new Projects(platform.kv);
    this.panels = new Panels(platform.kv);
    this.scheduler = new Scheduler(platform.kv);
    this.router = new ProviderRouter({
      keys: platform.keys, kv: platform.kv, fetch: platform.fetch,
      providers: () => this.routerProviders(), sleep: opts.sleep,
      onResult: (id, ok, note) => this.recordHealth(id, ok, note),
    });
  }

  /** The on-device model goes first when enabled; then the user's own providers in the order the user set; the built-in free services are the last resort. */
  private routerProviders(): ProviderConfig[] {
    const { localModel, localModelConsent, localModelId } = this.state.settings;
    const mine = this.state.providers;
    const free = this.state.settings.freeFallback ? this.state.freeProviders : [];
    const all = [...mine, ...free];
    if (!localModel || !localModelConsent || !localModelId || !webgpuAvailable()) return all;
    const local: ProviderConfig = {
      id: "local", name: "On-device", kind: "webgpu-local", baseUrl: "local:", enabled: true, defaultModel: localModelId,
    };
    return [local, ...all];
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

  /** The conversation survives a restart: only finished messages (no step pills, no errors) are kept, newest last. */
  private saveThread() {
    const keep = this.state.items.filter((i) => i.text && !i.failed).slice(-THREAD_KEEP).map((i) => ({ ...i, text: redactChat(i.text!) }));
    void this.platform.kv.set(THREAD_KEY, JSON.stringify(keep)).catch(() => undefined);
  }

  /** What the agent is shown of this conversation: the recent messages of both sides, without plans, errors or step pills. */
  private chatForAgent() {
    return this.state.items
      .filter((i): i is ChatItem & { text: string } => Boolean(i.text) && !i.failed && !i.plan)
      .slice(-CHAT_FOR_AGENT)
      .map((i) => ({ role: i.role, text: i.text }));
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
    // Tier 1 is disabled on low-RAM devices regardless of the saved flag.
    if (info.lowRam) settings.linuxSandbox = false;
    // The native view reports every load step; only a real change re-renders the app.
    this.unPage = this.platform.browser.onPage((e) => {
      const old = this.state.page;
      const page = { url: e.url, title: e.title, loading: e.loading };
      if (old.url !== page.url || old.title !== page.title || old.loading !== page.loading) this.set({ page });
      // The chip of the active tab follows its page; the list itself is re-read when tabs open, close or switch.
      if (e.tabId !== undefined && this.state.tabs.some((t) => t.id === e.tabId && (t.url !== e.url || t.title !== e.title))) {
        this.set({ tabs: this.state.tabs.map((t) => (t.id === e.tabId ? { ...t, url: e.url, title: e.title } : t)) });
      }
    });
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
      linuxAvailable: info.linuxSandbox && !info.lowRam,
    });
    void this.platform.browser.setDesktopLayout(settings.desktopLayout).catch(() => undefined); // the saved choice reaches the native view at start, not only when changed
    await this.initNativeModels();
    await this.vault.load();
    void this.checkUntested();
    void this.syncLists();
    this.listTimer = setInterval(() => void this.syncLists(), LIST_REFRESH_MS);
    await this.applyLocalModel();
    await this.rearmSchedules();
  }

  private listTimer?: ReturnType<typeof setInterval>;

  dispose() {
    clearInterval(this.listTimer);
    this.unPage?.();
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
    if (patch.desktopLayout !== undefined) await this.platform.browser.setDesktopLayout(patch.desktopLayout);
    if (patch.brief) await this.rearmSchedules();
    if (patch.localModel !== undefined || patch.localModelConsent !== undefined) await this.applyLocalModel();
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
    const stale = (x: ProviderConfig) => !x.health || !x.health.ok || Date.now() - x.health.at > 864e5;
    for (const p of this.state.providers.filter((x) => x.enabled && stale(x))) await this.testProvider(p.id).catch(() => undefined);
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
    const mine = this.state.providers; // a provider added while the free lists load is checked by its own add flow
    await this.syncFree();
    const old = (x: ProviderConfig) => Date.now() - (x.models?.fetchedAt ?? 0) >= LIST_REFRESH_MS;
    for (const p of mine.filter((x) => x.enabled && old(x))) {
      if (await this.platform.keys.get(p.id)) await this.refreshProviderModels(p.id).catch(() => undefined);
    }
  }

  private async syncFree() {
    const next: ProviderConfig[] = [];
    for (const p of this.state.freeProviders) {
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

  async clearAllSiteData() {
    await this.platform.browser.clearSiteData();
    this.notify("Site data cleared");
  }

  // ---- live window ----
  openWindow = () => this.set({ windowOpen: true });
  closeWindow = () => this.set({ windowOpen: false, windowExpanded: false });
  toggleWindowExpanded = () => this.set({ windowExpanded: !this.state.windowExpanded });

  // ---- prompts ----
  /** Only a step the user must do themselves (a login, a code, a CAPTCHA) is "action required". A question is part of the conversation. */
  private prompt<T extends Prompt["type"]>(build: (id: number) => Extract<Prompt, { type: T }>) {
    const p = build(++this.seq);
    const critical = p.type === "captcha" || p.type === "secure" || p.type === "login";
    this.set({ prompts: [...this.state.prompts, p], ...(critical ? { status: "action_required" as const } : {}) });
    return p.id;
  }
  private settle(id: number) {
    const prompts = this.state.prompts.filter((p) => p.id !== id);
    const critical = prompts.some((p) => p.type === "captcha" || p.type === "secure" || p.type === "login");
    this.set({ prompts, status: critical ? "action_required" : this.state.running ? "running" : "idle" });
  }
  answer(id: number, value: unknown) {
    const p = this.state.prompts.find((x) => x.id === id);
    if (!p) return;
    this.settle(id);
    (p.resolve as (v: unknown) => void)(value);
  }

  buildUI(runId: string): AgentUI {
    const wait = <V>(add: (resolve: (v: V) => void, signal: AbortSignal) => number, signal: AbortSignal, fallback: V) =>
      new Promise<V>((resolve) => {
        const id = add(resolve, signal);
        signal.addEventListener("abort", () => (this.settle(id), resolve(fallback)), { once: true });
      });
    return {
      ask: (question, signal) =>
        wait<string | undefined>((resolve) => this.prompt((id) => ({ id, type: "ask", question, resolve })), signal, undefined),
      askSecure: ({ kind, title, site, field }, signal) =>
        wait<string | undefined>((resolve) => this.prompt((id) => ({ id, type: "secure", kind, title, site, field, resolve })), signal, undefined),
      askLogin: (req, signal) =>
        wait<LoginAnswer | undefined>((resolve) => this.prompt((id) => ({ id, type: "login", req, resolve })), signal, undefined),
      solveCaptcha: (reason, signal) => {
        this.openWindow();
        void this.platform.browser.setMode("live");
        return wait<void>((resolve) => this.prompt((id) => ({ id, type: "captcha", reason, resolve })), signal, undefined);
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
    } else if (e.type === "plan") {
      this.push({ role: "agent", text: e.text, plan: true });
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
      this.push({ role: "agent", text: e.summary, ...(bad ? { failed: true } : {}) });
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

  /** Re-reads the open tabs for the chips on the browser card. */
  private async refreshTabs() {
    const tabs = await this.platform.browser.tabs().catch(() => this.state.tabs);
    this.set({ tabs });
    return tabs;
  }

  /** The user tapped a tab chip: that tab is shown (and becomes the agent's active tab, which the next step reads). */
  switchTab = async (tabId: number) => {
    await this.platform.browser.switchTab(tabId).catch(() => undefined);
    await this.refreshTabs();
  };

  /** Like openAndWait, for a new tab: it becomes the active tab, so its page events are the ones reported. */
  private async openTabAndWait(url: string): Promise<number> {
    let id = 0;
    let started = false;
    let finish: () => void = () => {};
    const done = new Promise<void>((r) => (finish = r));
    const off = this.platform.browser.onPage((p) => {
      if (p.loading) started = true;
      else if (started) finish();
    });
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    try {
      id = await this.platform.browser.openTab(url);
      await Promise.race([done, wait(1500)]);
      if (started) await Promise.race([done, wait(20_000)]);
    } finally {
      off();
    }
    await this.refreshTabs();
    return id;
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
      scroll: (d) => b.scroll(d),
      highlight: (id) => b.highlight(id),
      tabs: () => this.refreshTabs(),
      openTab: (url) => this.openTabAndWait(url),
      switchTab: async (id) => { await b.switchTab(id); await this.refreshTabs(); },
      closeTab: async (id) => { await b.closeTab(id); await this.refreshTabs(); },
      // The code or link goes from the native page straight to the agent loop; the store keeps no copy and logs nothing.
      readCode: (id, hint) => b.findCode(id, hint?.from, hint?.subject),
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

  /**
   * `command` must be text the user typed in this app (or their own saved task/panel).
   * While a task runs, a new message joins the queue (it does not interrupt): the queue runs in the background, one task after the other,
   * and the returned promise then ends at once. Otherwise it resolves when this task and everything queued behind it are done.
   */
  async send(command: string, opts: { startUrl?: string; files?: SelectedFile[] } = {}) {
    if (!command.trim()) return;
    // Only the composer passes files; saved tasks, panels and the brief never pick up the composer's tray. The tray is emptied here, at submission, and nowhere else.
    if (opts.files) this.draftEpoch++;
    const taken = opts.files ? { attachments: [] } : {};
    if (this.state.running) {
      this.set({ queue: [...this.state.queue, { id: ++this.seq, command, files: opts.files ?? [], startUrl: opts.startUrl }], ...taken });
      return;
    }
    this.set({ running: true, status: "running", ...taken }); // `running` covers the whole queue, so nothing (New chat, a second run) can slip in between two tasks
    void this.platform.system.keepAlive?.(true).catch(() => undefined);
    try {
      let task: Omit<QueuedTask, "id"> | undefined = { command, files: opts.files ?? [], startUrl: opts.startUrl };
      while (task) {
        // One task that breaks must not drop the ones behind it.
        await this.runTask(task.command, { startUrl: task.startUrl, files: task.files }).catch((e: unknown) =>
          this.push({ role: "agent", text: e instanceof Error ? e.message : String(e), failed: true }));
        task = this.state.queue[0];
        if (task) this.set({ queue: this.state.queue.slice(1) });
      }
    } finally {
      this.set({ running: false, status: "idle", queue: [] });
      void this.platform.system.keepAlive?.(false).catch(() => undefined);
    }
  }

  dequeue = (id: number) => this.set({ queue: this.state.queue.filter((q) => q.id !== id) });

  /** One line about the user's screen, so the AI knows what they see (phone or PC, size of the card, page layout). */
  private deviceLine() {
    const g = globalThis as { innerWidth?: number; innerHeight?: number };
    const w = Math.round(g.innerWidth ?? 0);
    const h = Math.round(g.innerHeight ?? 0);
    const kind = this.platform.kind === "android" ? "an Android phone app" : this.platform.kind === "desktop" ? "a desktop app (Windows or Linux)" : "a web page";
    const screen = w && h ? `, app screen ${w}x${h} CSS px (${w < WIDE ? "narrow: one column, the browser card sits above the message box" : "wide: the browser card is a column beside the chat"})` : "";
    const page = this.state.settings.desktopLayout ? "Pages are laid out as on a PC (1024-1280 px wide) and scaled down into the card, so they look small but complete." : "Pages use the mobile layout of each site.";
    return `The user is on ${kind}${screen}; they watch the browser card and can tap it. ${page} They may queue several tasks and leave: nobody answers questions while the queue runs, so decide small things yourself.`;
  }

  private async runTask(command: string, opts: { startUrl?: string; files?: SelectedFile[] }) {
    const runId = newId();
    const controller = (this.controller = new AgentController());
    this.chipItems.clear();
    const files = opts.files ?? [];
    this.set({ status: "running", screen: "chat" });
    if (opts.startUrl) this.openWindow();
    else this.closeWindow(); // a plain chat starts without the card (and without the tab left open before)
    const chat = this.chatForAgent();
    this.push({ role: "user", text: command, files: files.length ? files.map(({ name, size }) => ({ name, size })) : undefined });
    try {
      await this.history.log(runId, "run_start", command).catch(() => undefined); // a full disk must not lock the chat
      if (opts.startUrl) await this.platform.browser.open(opts.startUrl);
      const project = (await this.projects.list()).find((p) => p.id === this.state.settings.activeProjectId);
      const task = project?.instructions ? `${command}\n\n(Project "${project.name}": ${project.instructions})` : command;
      const { url, title } = this.state.page;
      const openTab = url && url !== "about:blank" ? `${title ? `${title} — ` : ""}${url}` : undefined;
      await runAgent(
        { task, files, screenshots: this.state.settings.screenshots, startOnPage: Boolean(opts.startUrl), openTab, chat, device: this.deviceLine(), providerWaits: this.opts.providerWaits },
        { driver: this.driver(), router: this.router, ui: this.buildUI(runId), controller, sandbox: this.sandbox, memory: this.memoryPort(), vault: this.vault },
      );
    } finally {
      this.controller = undefined;
      this.set({ prompts: [], status: this.state.queue.length ? "running" : "idle" });
      await this.platform.browser.setMode(this.state.windowOpen ? "live" : "hidden").catch(() => undefined);
    }
  }

  /** STOP ends the running task and drops everything still queued behind it. */
  stop = () => {
    this.set({ queue: [] });
    this.controller?.stop();
  };
  clearChat = () => this.set({ items: [] });
  dismissItem = (id: number) => this.set({ items: this.state.items.filter((i) => i.id !== id) });
  /** Opens the system picker (any file type). Throws if the platform cannot read the file; the UI shows the message. */
  async attach() {
    if (this.picking || this.state.attachments.length >= MAX_ATTACHMENTS) return;
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
