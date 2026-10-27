import { registerPlugin } from "@capacitor/core";
import type { KeyStore, KVStore, PageObservation } from "@krish/core";
import type { Bounds, BrowserHost, DeviceInfo, MyBrowser, PageEvent, Platform } from "./types";

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
}
interface Device {
  addListener(event: string, cb: () => void): Promise<Listener>;
  status(): Promise<{ enabled: boolean }>;
  openSettings(): Promise<void>;
  open(a: { url: string }): Promise<void>;
  observe(): Promise<{ value: string }>;
  read(a: { elementId?: number }): Promise<{ value: string }>;
  click(a: { elementId: number; fp?: string }): Promise<void>;
  type(a: { elementId: number; text: string; submit?: boolean; fp?: string }): Promise<void>;
  fill(a: { elementId: number; value: string; fp?: string }): Promise<void>;
  scroll(a: { direction: string }): Promise<void>;
  say(a: { text: string; action?: string }): Promise<void>;
  hide(): Promise<void>;
  focusApp(): Promise<void>;
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
  const D = registerPlugin<Device>("KrishDevice");
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
  const embedded: BrowserHost = {
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
  };

  // The user's own browser app. Page events come from our own calls (open / observe), so the app's page state stays current.
  const pageListeners = new Set<(e: PageEvent) => void>();
  const emit = (e: PageEvent) => pageListeners.forEach((l) => l(e));
  let last = { url: "", title: "" };
  let opened = ""; // the address bar can be unreadable (focused, or a browser we do not know); the page we opened stands in for it
  const mine: BrowserHost = {
    open: async (url) => {
      opened = url;
      emit({ ...last, url, loading: true });
      try { await D.open({ url }); } finally { emit({ ...last, url, loading: false }); }
    },
    observe: async () => {
      const o = JSON.parse((await D.observe()).value) as PageObservation;
      o.url ||= opened;
      last = { url: o.url, title: o.title };
      emit({ ...last, loading: false });
      return o;
    },
    read: async (elementId) => (await D.read({ elementId })).value,
    click: (elementId, fp) => D.click({ elementId, fp }),
    type: (elementId, text, submit, fp) => D.type({ elementId, text, submit, fp }),
    fill: (elementId, value, fp) => D.fill({ elementId, value, fp }),
    upload: () => Promise.reject(new Error("uploading files is not available in your own browser; use the Krish browser window for this")),
    scroll: (direction) => D.scroll({ direction }),
    highlight: async () => {},
    setBounds: async () => {},
    setMode: async () => {},
    setDesktopLayout: async () => {},
    snapshot: async () => "",
    stopLoading: async () => {},
    clearSiteData: async () => {},
    onPage: (cb) => (pageListeners.add(cb), () => void pageListeners.delete(cb)),
  };
  let mode: "app" | "mine" = "app";
  const pick = () => (mode === "mine" ? mine : embedded);
  const browser: BrowserHost = {
    open: (u) => pick().open(u),
    observe: () => pick().observe(),
    read: (id) => pick().read(id),
    click: (id, fp) => pick().click(id, fp),
    type: (id, t, submit, fp) => pick().type(id, t, submit, fp),
    fill: (id, v, fp) => pick().fill(id, v, fp),
    upload: (id, token, fp) => pick().upload(id, token, fp),
    scroll: (d) => pick().scroll(d),
    highlight: (id) => pick().highlight(id),
    setBounds: (b) => pick().setBounds(b),
    setMode: (m) => pick().setMode(m),
    setDesktopLayout: (e) => embedded.setDesktopLayout(e),
    snapshot: (w, q) => pick().snapshot(w, q),
    stopLoading: () => pick().stopLoading(),
    clearSiteData: () => embedded.clearSiteData(),
    onPage: (cb) => {
      const off = embedded.onPage(cb);
      pageListeners.add(cb);
      return () => (off(), void pageListeners.delete(cb));
    },
    use: (m) => void (mode = m),
  };
  const myBrowser: MyBrowser = {
    status: () => D.status().catch(() => ({ enabled: false })),
    openSettings: () => D.openSettings(),
    say: (text, action) => D.say({ text, action }).catch(() => undefined),
    hide: () => D.hide().catch(() => undefined),
    focusApp: () => D.focusApp().catch(() => undefined),
    onAction: (cb) => {
      const hs = (["stop", "resume"] as const).map((a) => D.addListener(a, () => cb(a)));
      return () => hs.forEach((h) => void h.then((l) => l.remove()));
    },
  };
  return {
    kind: "android",
    kv,
    keys,
    fetch: (input, init) => fetch(input, init), // CapacitorHttp patches fetch -> native HTTP (no CORS limits)
    browser,
    myBrowser,
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
    },
  };
}
