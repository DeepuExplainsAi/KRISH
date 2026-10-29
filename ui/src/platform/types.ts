import type { CodeFound, FetchLike, KeyStore, KVStore, PageObservation, SelectedFile, TabInfo } from "@krish/core";

export interface PageEvent {
  url: string;
  title: string;
  loading: boolean;
  /** The tab this event is about. Hosts send page events for the active tab only. */
  tabId?: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius of the native view in CSS px (matches the card around it). */
  radius?: number;
}

/** Most tabs a host keeps open (Android map of AgentWebViews, Electron map of WebContentsViews). */
export const MAX_TABS = 4;

/** The agent's embedded browser. Implemented natively on each platform. Every page method works on the ACTIVE tab. */
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
  /** Open tabs, oldest first, with the active one marked. The first tab exists as soon as the browser does. */
  tabs(): Promise<TabInfo[]>;
  /** New tab (max MAX_TABS), made active, loading `url`. Resolves with its id. */
  openTab(url: string): Promise<number>;
  switchTab(tabId: number): Promise<void>;
  /** Closing the active tab makes the newest remaining tab active; the last tab cannot be closed. */
  closeTab(tabId: number): Promise<void>;
  /** Runs the page script's `findCode` in that tab. The result stays in the app (see the agent loop): never logged, never sent to a model. */
  findCode(tabId: number, from?: string, subject?: string): Promise<CodeFound>;
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
