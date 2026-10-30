import { unsupportedLocalModel } from "./types";
import { type CodeFound, type KeyStore, type PageObservation, type TabInfo } from "@krish/core";
import type { BrowserHost, DeviceInfo, PageEvent, Platform } from "./types";

interface Bridge {
  invoke(channel: string, arg?: unknown): Promise<unknown>;
  onPage(cb: (e: PageEvent) => void): () => void;
}

/** Electron platform. Everything privileged goes through the allowlisted preload bridge into the main process. */
export function createDesktopPlatform(bridge: Bridge): Platform {
  const inv = <T = void>(channel: string, arg?: unknown) => bridge.invoke(channel, arg) as Promise<T>;

  const keys: KeyStore = {
    get: async (key) => (await inv<string | undefined>("key:get", { key })) ?? undefined,
    set: (key, value) => inv("key:set", { key, value }),
    delete: (key) => inv("key:delete", { key }),
  };

  const browser: BrowserHost = {
    open: (url) => inv("browser:open", { url }),
    observe: async () => JSON.parse(await inv<string>("browser:observe")) as PageObservation,
    read: (elementId) => inv<string>("browser:read", { elementId }),
    click: (elementId, fp) => inv("browser:click", { elementId, fp }),
    type: (elementId, text, submit, fp) => inv("browser:type", { elementId, text, submit, fp }),
    fill: (elementId, value, fp) => inv("browser:fill", { elementId, value, fp }),
    upload: (elementId, token, fp) => inv("browser:upload", { elementId, token, fp }),
    highlight: (elementId) => inv("browser:highlight", { elementId }),
    setBounds: (b) => inv("browser:setBounds", b),
    setMode: (mode) => inv("browser:setMode", { mode }),
    setDesktopLayout: (enabled) => inv("browser:setDesktopLayout", { enabled }),
    snapshot: (maxWidth, quality) => inv<string>("browser:snapshot", { maxWidth, quality }),
    scroll: (direction) => inv("browser:scroll", { direction }),
    stopLoading: () => inv("browser:stopLoading"),
    clearSiteData: () => inv("browser:clearSiteData"),
    onPage: (cb) => bridge.onPage(cb),
    tabs: () => inv<TabInfo[]>("browser:tabs"),
    openTab: (url) => inv<number>("browser:openTab", { url }),
    switchTab: (tabId) => inv("browser:switchTab", { tabId }),
    closeTab: (tabId) => inv("browser:closeTab", { tabId }),
    findCode: async (tabId, from, subject) => JSON.parse(await inv<string>("browser:findCode", { tabId, from, subject })) as CodeFound,
  };

  return {
    kind: "desktop",
    kv: {
      get: async (k) => localStorage.getItem(`krish:${k}`) ?? undefined,
      set: async (k, v) => localStorage.setItem(`krish:${k}`, v),
      delete: async (k) => localStorage.removeItem(`krish:${k}`),
    },
    keys,
    // Provider calls run in the main process (no CORS, no cookies, https only, redirects refused).
    fetch: async (url, init) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
      const r = await inv<{ status: number; statusText: string; headers: Record<string, string>; body: string }>("fetch", {
        url,
        init: { method: init?.method, headers, body: typeof init?.body === "string" ? init.body : undefined },
      });
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
    },
    browser,
    local: unsupportedLocalModel(),
    files: {
      pick: async () => (await inv<{ name: string; size: number; token: string } | null>("files:pick")) ?? undefined,
      read: async (token, maxBytes) => new Uint8Array(await inv<Uint8Array>("files:read", { token, maxBytes })),
      save: (name, bytes) => inv<boolean>("files:save", { name, bytes }),
    },
    linux: {
      run: async (script, files) => {
        const r = await inv<{ output: string; files: Record<string, Uint8Array> }>("shell:run", { script, files });
        return { output: r.output, files: Object.fromEntries(Object.entries(r.files).map(([n, b]) => [n, new Uint8Array(b)])) };
      },
    },
    system: {
      deviceInfo: () => inv<DeviceInfo>("system:deviceInfo"),
      requestNotifications: async () => true,
      scheduleDue: (id, at, title) => inv("system:scheduleDue", { id, at, title }),
      cancelDue: (id) => inv("system:cancelDue", { id }),
      openExternal: (url) => inv("system:openExternal", { url }),
      keepAlive: (on) => inv("system:keepAlive", { on }),
    },
  };
}
