import { MemoryKeyStore, type PageObservation } from "@krish/core";
import { MAX_TABS, type BrowserHost, type PageEvent, type Platform } from "./types";

/** Browser-only dev/demo platform: fake page, no real navigation. Not a product mode. */
export function createWebPlatform(): Platform {
  const listeners = new Set<(e: PageEvent) => void>();
  let url = "https://example.com/";
  // Fake tabs: each keeps its own url; the demo page is the same in all of them.
  let tabs = [{ id: 1, url }];
  let active = 1;
  let nextId = 2;
  const page = (): PageObservation => ({
    url,
    title: "Demo page",
    text: "This is a demo page used in the browser-only dev build.",
    elements: [
      { id: 0, tag: "input", type: "text", label: "Search" },
      { id: 1, tag: "button", text: "Go" },
    ],
  });
  const emit = () => listeners.forEach((l) => l({ url, title: "Demo page", loading: false, tabId: active }));
  const show = (id: number) => { active = id; url = tabs.find((t) => t.id === id)!.url; emit(); };
  const browser: BrowserHost = {
    open: async (u) => void ((url = u), (tabs = tabs.map((t) => (t.id === active ? { ...t, url: u } : t))), emit()),
    observe: async () => page(),
    read: async () => page().text,
    click: async () => {},
    type: async () => {},
    fill: async () => {},
    upload: async () => {},
    scroll: async () => {},
    highlight: async () => {},
    setBounds: async () => {},
    setMode: async () => {},
    setDesktopLayout: async () => {},
    snapshot: async () => "",
    stopLoading: async () => {},
    clearSiteData: async () => {},
    onPage: (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    tabs: async () => tabs.map((t) => ({ id: t.id, title: "Demo page", url: t.url, active: t.id === active })),
    openTab: async (u) => {
      if (tabs.length >= MAX_TABS) throw new Error(`at most ${MAX_TABS} tabs`);
      const id = nextId++;
      tabs = [...tabs, { id, url: u }];
      show(id);
      return id;
    },
    switchTab: async (id) => {
      if (!tabs.some((t) => t.id === id)) throw new Error(`no tab ${id}`);
      show(id);
    },
    closeTab: async (id) => {
      if (!tabs.some((t) => t.id === id)) throw new Error(`no tab ${id}`);
      if (tabs.length === 1) throw new Error("the last tab cannot be closed");
      tabs = tabs.filter((t) => t.id !== id);
      if (active === id) show(tabs[tabs.length - 1]!.id);
    },
    findCode: async () => ({}),
  };
  return {
    kind: "web",
    kv: {
      get: async (k) => localStorage.getItem(`krish:${k}`) ?? undefined,
      set: async (k, v) => localStorage.setItem(`krish:${k}`, v),
      delete: async (k) => localStorage.removeItem(`krish:${k}`),
    },
    keys: new MemoryKeyStore(), // dev only: keys vanish on reload
    fetch: (i, init) => fetch(i, init),
    browser,
    files: { pick: async () => undefined, read: async () => new Uint8Array(), save: async () => false },
    system: {
      deviceInfo: async () => ({ lowRam: false, totalMemMb: 0, linuxSandbox: false }),
      requestNotifications: async () => false,
      scheduleDue: async () => {},
      openExternal: async (url) => void window.open(url, "_blank", "noopener,noreferrer"),
      cancelDue: async () => {},
    },
  };
}
