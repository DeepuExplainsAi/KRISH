import { Capacitor } from "@capacitor/core";
import { createCapacitorPlatform } from "./capacitor";
import { createWebPlatform } from "./web";
import type { Platform } from "./types";

declare global {
  interface Window {
    /** Provided by desktop/preload.cjs via contextBridge. */
    krishDesktop?: { createPlatform(): Platform };
  }
}

export function createPlatform(): Platform {
  if (window.krishDesktop) return window.krishDesktop.createPlatform();
  if (Capacitor.isNativePlatform()) return createCapacitorPlatform();
  return createWebPlatform();
}

export type { Platform, BrowserHost, DeviceInfo, Bounds, PageEvent } from "./types";
