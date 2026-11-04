import { registerPlugin } from "@capacitor/core";
import type { DeviceScreen, PhoneAction, CodeFound, KeyStore, KVStore, PageObservation, TabInfo } from "@krish/core";
import type { Bounds, BrowserHost, DeviceInfo, LaunchableApp, PageEvent, PhoneHost, PhoneStatus, Platform, LocalDeviceInfo, LocalProgress } from "./types";

type Listener = { remove(): Promise<void> };
interface Browser {
  addListener(event: string, cb: (e: PageEvent) => void): Promise<Listener>;
  open(a: { url: string }): Promise<void>;
  observe(): Promise<{ value: string }>;
  read(a: { elementId?: number }): Promise<{ value: string }>;
  click(a: { elementId: number; fp?: string }): Promise<void>;
  type(a: { elementId: number; text: string; submit?: boolean; fp?: string }): Promise<void>;
  fill(a: { elementId: number; value: string; fp?: string }): Promise<void>;
  upload(a: { elementId: number; token: string; fp?: string }): Promise<void>;
  scroll(a: { direction: string }): Promise<void>;
  highlight(a: { elementId?: number }): Promise<void>;
  setBounds(a: Bounds): Promise<void>;
  setMode(a: { mode: string }): Promise<void>;
  setDesktopLayout(a: { enabled: boolean }): Promise<void>;
  snapshot(a: { maxWidth: number; quality: number }): Promise<{ value: string }>;
  stopLoading(): Promise<void>;
  clearSiteData(): Promise<void>;
  tabs(): Promise<{ value: string }>;
  openTab(a: { url: string }): Promise<{ tabId: number }>;
  switchTab(a: { tabId: number }): Promise<void>;
  closeTab(a: { tabId: number }): Promise<void>;
  findCode(a: { tabId: number; from?: string; subject?: string }): Promise<{ value: string }>;
}
interface Phone {
  status(): Promise<PhoneStatus>;
  launchableApps(): Promise<{ apps: LaunchableApp[] }>;
  setAllowlist(a: { packages: string[] }): Promise<{ allowlist: string[]; rejected: string[] }>;
  start(a: { taskId: string }): Promise<unknown>;
  resume(): Promise<unknown>;
  stop(a: { reason?: string }): Promise<unknown>;
  pause(a: { reason: string }): Promise<unknown>;
  readScreen(a: { screenshot: boolean }): Promise<DeviceScreen>;
  perform(a: PhoneAction): Promise<{ ok: boolean; error?: string }>;
  openApp(a: { package: string }): Promise<void>;
  confirm(a: { title: string; detail: string }): Promise<{ allowed: boolean }>;
  openAccessibilitySettings(): Promise<void>;
  openBatterySettings(): Promise<void>;
  addListener(event: "phoneState", cb: (e: Pick<PhoneStatus, "state" | "reason" | "taskId">) => void): Promise<Listener>;
}
interface Local {
  deviceInfo(): Promise<LocalDeviceInfo>;
  listInstalled(): Promise<{ installed: string[]; partial: { modelId: string; bytes: number }[]; active?: string }>;
  download(a: { modelId: string }): Promise<void>;
  resume(a: { modelId: string }): Promise<void>;
  pause(a: { modelId: string }): Promise<void>;
  cancel(a: { modelId: string }): Promise<void>;
  delete(a: { modelId: string }): Promise<void>;
  addListener(event: "progress", cb: (event: LocalProgress) => void): Promise<Listener>;
}
interface Inference {
  loadModel(a: { modelId: string }): Promise<void>;
  complete(a: { modelId: string; messages: string; schema: string }): Promise<{ text: string }>;
  stop(): Promise<void>;
  unload(): Promise<void>;
}
interface Files {
  pickFile(): Promise<{ name?: string; size?: number; token?: string }>;
  readFile(a: { token: string; maxBytes?: number }): Promise<{ base64: string }>;
  saveFile(a: { name: string; base64: string; mime?: string }): Promise<{ saved: boolean }>;
}
interface Secure {
  get(a: { key: string }): Promise<{ value?: string }>;
  set(a: { key: string; value: string }): Promise<void>;
  delete(a: { key: string }): Promise<void>;
}
interface Linux {
  run(a: { script: string; files: Record<string, string> }): Promise<{ output: string; files: Record<string, string> }>;
}
interface System {
  openExternal(o: { url: string }): Promise<void>;
  deviceInfo(): Promise<DeviceInfo>;
  requestNotifications(): Promise<{ granted: boolean }>;
  scheduleDue(a: { id: string; at: number; title: string }): Promise<void>;
  cancelDue(a: { id: string }): Promise<void>;
  keepAlive(a: { on: boolean }): Promise<void>;
}

export const toBase64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function createCapacitorPlatform(): Platform {
  const B = registerPlugin<Browser>("KrishBrowser");
  const F = registerPlugin<Files>("KrishFiles");
  const S = registerPlugin<Secure>("KrishSecure");
  const Sys = registerPlugin<System>("KrishSystem");
  const L = registerPlugin<Linux>("KrishLinux");
  const Local = registerPlugin<Local>("KrishLocal");
  const Inference = registerPlugin<Inference>("KrishInference");
  const P = registerPlugin<Phone>("KrishPhone");

  const kv: KVStore = {
    get: async (k) => localStorage.getItem(`krish:${k}`) ?? undefined,
    set: async (k, v) => localStorage.setItem(`krish:${k}`, v),
    delete: async (k) => localStorage.removeItem(`krish:${k}`),
  };
  const keys: KeyStore = {
    get: async (id) => (await S.get({ key: id })).value,
    set: async (id, key) => S.set({ key: id, value: key }),
    delete: async (id) => S.delete({ key: id }),
  };
  const browser: BrowserHost = {
    open: (url) => B.open({ url }),
    observe: async () => JSON.parse((await B.observe()).value) as PageObservation,
    read: async (elementId) => (await B.read({ elementId })).value,
    click: (elementId, fp) => B.click({ elementId, fp }),
    type: (elementId, text, submit, fp) => B.type({ elementId, text, submit, fp }),
    fill: (elementId, value, fp) => B.fill({ elementId, value, fp }),
    upload: (elementId, token, fp) => B.upload({ elementId, token, fp }),
    scroll: (direction) => B.scroll({ direction }),
    highlight: (elementId) => B.highlight({ elementId }),
    setBounds: (b) => B.setBounds(b),
    setMode: (mode) => B.setMode({ mode }),
    setDesktopLayout: (enabled) => B.setDesktopLayout({ enabled }),
    snapshot: async (maxWidth, quality) => (await B.snapshot({ maxWidth, quality })).value,
    stopLoading: () => B.stopLoading(),
    clearSiteData: () => B.clearSiteData(),
    onPage: (cb) => {
      const h = B.addListener("page", cb);
      return () => void h.then((l) => l.remove());
    },
    tabs: async () => JSON.parse((await B.tabs()).value) as TabInfo[],
    openTab: async (url) => (await B.openTab({ url })).tabId,
    switchTab: (tabId) => B.switchTab({ tabId }),
    closeTab: (tabId) => B.closeTab({ tabId }),
    findCode: async (tabId, from, subject) => JSON.parse((await B.findCode({ tabId, from, subject })).value) as CodeFound,
  };

  return {
    kind: "android",
    kv,
    keys,
    fetch: (input, init) => fetch(input, init), // CapacitorHttp patches fetch -> native HTTP (no CORS limits)
    browser,
    local: {
      supported: true,
      deviceInfo: () => Local.deviceInfo(),
      listInstalled: () => Local.listInstalled(),
      download: (modelId) => Local.download({ modelId }), resume: (modelId) => Local.resume({ modelId }),
      pause: (modelId) => Local.pause({ modelId }), cancel: (modelId) => Local.cancel({ modelId }),
      delete: (modelId) => Local.delete({ modelId }),
      loadModel: (modelId) => Inference.loadModel({ modelId }),
      complete: async (modelId, messages, schema) => (await Inference.complete({ modelId, messages, schema })).text,
      stop: () => Inference.stop(), unload: () => Inference.unload(),
      onProgress: (cb) => { const h = Local.addListener("progress", cb); return () => void h.then((listener) => listener.remove()); },
    },
    phone: {
      supported: true,
      status: () => P.status(),
      launchableApps: async () => (await P.launchableApps()).apps,
      setAllowlist: (packages) => P.setAllowlist({ packages }),
      start: async (taskId) => void (await P.start({ taskId })),
      resume: async () => void (await P.resume()),
      stop: async (reason) => void (await P.stop({ reason })),
      pause: async (reason) => void (await P.pause({ reason })),
      readScreen: (screenshot) => P.readScreen({ screenshot }),
      perform: (action) => P.perform(action),
      openApp: (pkg) => P.openApp({ package: pkg }),
      confirm: async (title, detail) => (await P.confirm({ title, detail })).allowed,
      openAccessibilitySettings: () => P.openAccessibilitySettings(),
      openBatterySettings: () => P.openBatterySettings(),
      onState: (cb) => { const h = P.addListener("phoneState", cb); return () => void h.then((l) => l.remove()); },
    } satisfies PhoneHost,
    files: {
      pick: async () => {
        const r = await F.pickFile();
        return r?.token ? { name: r.name ?? "file", size: r.size ?? 0, token: r.token } : undefined; // cancelled picker resolves with no data
      },
      read: async (token, maxBytes) => fromBase64((await F.readFile({ token, maxBytes })).base64),
      save: async (name, bytes, mime) => (await F.saveFile({ name, mime, base64: toBase64(bytes) })).saved,
    },
    linux: {
      run: async (script, files) => {
        const enc = Object.fromEntries(Object.entries(files).map(([n, b]) => [n, toBase64(b)]));
        const r = await L.run({ script, files: enc });
        return { output: r.output, files: Object.fromEntries(Object.entries(r.files).map(([n, b]) => [n, fromBase64(b)])) };
      },
    },
    system: {
      deviceInfo: () => Sys.deviceInfo(),
      requestNotifications: async () => (await Sys.requestNotifications()).granted,
      scheduleDue: (id, at, title) => Sys.scheduleDue({ id, at, title }),
      openExternal: (url) => Sys.openExternal({ url }),
      cancelDue: (id) => Sys.cancelDue({ id }),
      keepAlive: (on) => Sys.keepAlive({ on }),
    },
  };
}
