import { Capacitor } from "@capacitor/core";
import { createCapacitorPlatform } from "./capacitor";
import { createDesktopPlatform } from "./desktop";
import { createWebPlatform } from "./web";
import type { Platform } from "./types";

declare global {
  interface Window {
    /** Provided by desktop/preload.cjs via contextBridge. */
    krishBridge?: Parameters<typeof createDesktopPlatform>[0];
  }
}

export function createPlatform(): Platform {
  if (window.krishBridge) return createDesktopPlatform(window.krishBridge);
  if (Capacitor.isNativePlatform()) return createCapacitorPlatform();
  return createWebPlatform();
}

export type { Platform, BrowserHost, DeviceInfo, Bounds, PageEvent } from "./types";
