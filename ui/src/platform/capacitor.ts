import { registerPlugin } from "@capacitor/core";
import type { DeviceScreen, KeyStore, KVStore, PhoneAction } from "@krish/core";
import type { DeviceInfo, LaunchableApp, PhoneHost, PhoneStatus, Platform, LocalDeviceInfo, LocalProgress } from "./types";

type Listener = { remove(): Promise<void> };
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
  const F = registerPlugin<Files>("KrishFiles");
  const S = registerPlugin<Secure>("KrishSecure");
  const Sys = registerPlugin<System>("KrishSystem");
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
  return {
    kind: "android",
    kv,
    keys,
    fetch: (input, init) => fetch(input, init), // CapacitorHttp patches fetch -> native HTTP (no CORS limits)
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
