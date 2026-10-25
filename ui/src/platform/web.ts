import { MemoryKeyStore, type PageObservation } from "@krish/core";
import type { BrowserHost, PageEvent, Platform } from "./types";

/** Browser-only dev/demo platform: fake page, no real navigation. Not a product mode. */
export function createWebPlatform(): Platform {
  const listeners = new Set<(e: PageEvent) => void>();
  let url = "https://example.com/";
  const page = (): PageObservation => ({
    url,
    title: "Demo page",
    text: "This is a demo page used in the browser-only dev build.",
    elements: [
      { id: 0, tag: "input", type: "text", label: "Search" },
      { id: 1, tag: "button", text: "Go" },
    ],
  });
  const emit = () => listeners.forEach((l) => l({ url, title: "Demo page", loading: false }));
  const browser: BrowserHost = {
    open: async (u) => void ((url = u), emit()),
    observe: async () => page(),
    read: async () => page().text,
    click: async () => {},
    type: async () => {},
    fill: async () => {},
    upload: async () => {},
    highlight: async () => {},
    setBounds: async () => {},
    setMode: async () => {},
    setDesktopLayout: async () => {},
    snapshot: async () => "",
    stopLoading: async () => {},
    clearSiteData: async () => {},
    onPage: (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
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
      cancelDue: async () => {},
    },
  };
}
