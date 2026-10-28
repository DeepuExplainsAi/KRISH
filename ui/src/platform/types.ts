import type { FetchLike, KeyStore, KVStore, PageObservation, SelectedFile } from "@krish/core";

export interface PageEvent {
  url: string;
  title: string;
  loading: boolean;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius of the native view in CSS px (matches the card around it). */
  radius?: number;
}

/** The agent's embedded browser. Implemented natively on each platform. */
export interface BrowserHost {
  open(url: string): Promise<void>;
  observe(): Promise<PageObservation>;
  read(elementId?: number): Promise<string>;
  /** `fp` is the element fingerprint from the observation the user/gate approved; the host refuses if the live node differs. */
  click(elementId: number, fp?: string): Promise<void>;
  type(elementId: number, text: string, submit?: boolean, fp?: string): Promise<void>;
  /** Fills a field natively. Used for paste and secure input; nothing is returned. */
  fill(elementId: number, value: string, fp?: string): Promise<void>;
  upload(elementId: number, fileToken: string, fp?: string): Promise<void>;
  scroll(direction: "down" | "up"): Promise<void>;
  highlight(elementId?: number): Promise<void>;
  setBounds(b: Bounds): Promise<void>;
  setMode(mode: "live" | "hidden"): Promise<void>;
  setDesktopLayout(enabled: boolean): Promise<void>;
  snapshot(maxWidth: number, quality: number): Promise<string>;
  stopLoading(): Promise<void>;
  clearSiteData(): Promise<void>;
  onPage(cb: (e: PageEvent) => void): () => void;
}

export interface DeviceInfo {
  lowRam: boolean;
  totalMemMb: number;
  /** True only in the Android "full" flavor / desktop. */
  linuxSandbox: boolean;
  dockerAvailable?: boolean;
}

export interface Platform {
  kind: "android" | "desktop" | "web";
  /** Non-secret app data (redacted history, memory, settings). */
  kv: KVStore;
  /** API keys: Android Keystore / OS keychain. */
  keys: KeyStore;
  fetch: FetchLike;
  browser: BrowserHost;
  files: {
    pick(): Promise<SelectedFile | undefined>;
    read(token: string, maxBytes?: number): Promise<Uint8Array>;
    save(name: string, bytes: Uint8Array, mime?: string): Promise<boolean>;
  };
  /** Tier 1 (Android full flavor: proot+Alpine) or the desktop Docker tier. Absent when unavailable. */
  linux?: {
    run(script: string, files: Record<string, Uint8Array>): Promise<{ output: string; files: Record<string, Uint8Array> }>;
  };
  system: {
    deviceInfo(): Promise<DeviceInfo>;
    requestNotifications(): Promise<boolean>;
    scheduleDue(id: string, at: number, title: string): Promise<void>;
    cancelDue(id: string): Promise<void>;
    /** While tasks run: keeps the app working with the screen off or another app in front (Android foreground service, desktop power-save blocker). */
    keepAlive?(on: boolean): Promise<void>;
    /** Opens an https page in the user's own browser (never in the agent's browser, which must not see the user's logins). */
    openExternal(url: string): Promise<void>;
  };
}
