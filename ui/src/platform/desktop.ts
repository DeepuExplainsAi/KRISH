import { unsupportedLocalModel } from "./types";
import type { KeyStore } from "@krish/core";
import type { DeviceInfo, Platform } from "./types";

interface Bridge {
  invoke(channel: string, arg?: unknown): Promise<unknown>;
}

/** Electron platform. Everything privileged goes through the allowlisted preload bridge into the main process. */
export function createDesktopPlatform(bridge: Bridge): Platform {
  const inv = <T = void>(channel: string, arg?: unknown) => bridge.invoke(channel, arg) as Promise<T>;

  const keys: KeyStore = {
    get: async (key) => (await inv<string | undefined>("key:get", { key })) ?? undefined,
    set: (key, value) => inv("key:set", { key, value }),
    delete: (key) => inv("key:delete", { key }),
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
    local: unsupportedLocalModel(),
    files: {
      pick: async () => (await inv<{ name: string; size: number; token: string } | null>("files:pick")) ?? undefined,
      read: async (token, maxBytes) => new Uint8Array(await inv<Uint8Array>("files:read", { token, maxBytes })),
      save: (name, bytes) => inv<boolean>("files:save", { name, bytes }),
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
