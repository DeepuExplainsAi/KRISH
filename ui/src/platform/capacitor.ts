import { registerPlugin } from "@capacitor/core";
import type { KeyStore, KVStore, PageObservation } from "@krish/core";
import type { Bounds, BrowserHost, DeviceInfo, PageEvent, Platform } from "./types";

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
  highlight(a: { elementId?: number }): Promise<void>;
  setBounds(a: Bounds): Promise<void>;
  setMode(a: { mode: string }): Promise<void>;
  setDesktopLayout(a: { enabled: boolean }): Promise<void>;
  snapshot(a: { maxWidth: number; quality: number }): Promise<{ value: string }>;
  stopLoading(): Promise<void>;
  clearSiteData(): Promise<void>;
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
  };
  return {
    kind: "android",
    kv,
    keys,
    fetch: (input, init) => fetch(input, init), // CapacitorHttp patches fetch -> native HTTP (no CORS limits)
    browser,
    files: {
      pick: async () => {
        const r = await F.pickFile();
        return r.token ? { name: r.name ?? "file", size: r.size ?? 0, token: r.token } : undefined;
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
    },
  };
}
