import { unsupportedLocalModel } from "./types";
import { MemoryKeyStore } from "@krish/core";
import type { Platform } from "./types";

/** Browser-only dev/demo platform: no phone, no native features. Not a product mode. */
export function createWebPlatform(): Platform {
  return {
    kind: "web",
    kv: {
      get: async (k) => localStorage.getItem(`krish:${k}`) ?? undefined,
      set: async (k, v) => localStorage.setItem(`krish:${k}`, v),
      delete: async (k) => localStorage.removeItem(`krish:${k}`),
    },
    keys: new MemoryKeyStore(), // dev only: keys vanish on reload
    fetch: (i, init) => fetch(i, init),
    local: unsupportedLocalModel(),
    files: { pick: async () => undefined, read: async () => new Uint8Array(), save: async () => false },
    system: {
      deviceInfo: async () => ({ lowRam: false, totalMemMb: 0 }),
      requestNotifications: async () => false,
      scheduleDue: async () => {},
      openExternal: async (url) => void window.open(url, "_blank", "noopener,noreferrer"),
      cancelDue: async () => {},
    },
  };
}
