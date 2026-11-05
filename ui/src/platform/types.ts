import type { DeviceScreen, FetchLike, KeyStore, KVStore, PhoneAction, SelectedFile } from "@krish/core";

export interface DeviceInfo {
  lowRam: boolean;
  totalMemMb: number;
}

export type LocalDownloadStatus = "downloading" | "verifying" | "paused" | "cancelled" | "installed" | "error";
export interface LocalProgress {
  modelId: string;
  status: LocalDownloadStatus;
  bytes: number;
  total: number;
  error?: string;
}
export interface LocalDeviceInfo { totalRamMB: number; freeStorageMB: number; metered: boolean }
export interface LocalModelHost {
  supported: boolean;
  deviceInfo(): Promise<LocalDeviceInfo>;
  listInstalled(): Promise<{ installed: string[]; partial: { modelId: string; bytes: number }[]; active?: string }>;
  download(modelId: string): Promise<void>;
  pause(modelId: string): Promise<void>;
  resume(modelId: string): Promise<void>;
  cancel(modelId: string): Promise<void>;
  delete(modelId: string): Promise<void>;
  onProgress(cb: (event: LocalProgress) => void): () => void;
  loadModel(modelId: string): Promise<void>;
  complete(modelId: string, messages: string, schema: string): Promise<string>;
  stop(): Promise<void>;
  unload(): Promise<void>;
}

/** Web and desktop do not expose Android's private model storage. */
export function unsupportedLocalModel(): LocalModelHost {
  const unsupported = async (): Promise<never> => { throw new Error("On-device models are not supported on this platform"); };
  return { supported: false, deviceInfo: unsupported, listInstalled: unsupported, download: unsupported, pause: unsupported,
    resume: unsupported, cancel: unsupported, delete: unsupported, onProgress: () => () => {}, loadModel: unsupported, complete: unsupported, stop: unsupported, unload: unsupported };
}

export interface PhoneStatus {
  state: "idle" | "running" | "paused";
  reason?: string | null;
  taskId?: string | null;
  /** The Accessibility Service is switched on in Android settings and connected. */
  accessibility: boolean;
  allowlist: string[];
}
export interface LaunchableApp { pkg: string; label: string; blocked: boolean; group?: string | null }

/** Phone control (Android only). Every method that touches another app is re-checked natively against the allowlist and hard blocklist. */
export interface PhoneHost {
  supported: boolean;
  status(): Promise<PhoneStatus>;
  launchableApps(): Promise<LaunchableApp[]>;
  setAllowlist(packages: string[]): Promise<{ allowlist: string[]; rejected: string[] }>;
  start(taskId: string): Promise<void>;
  resume(): Promise<void>;
  stop(reason?: string): Promise<void>;
  pause(reason: string): Promise<void>;
  readScreen(screenshot: boolean): Promise<DeviceScreen>;
  perform(action: PhoneAction): Promise<{ ok: boolean; error?: string }>;
  openApp(pkg: string): Promise<void>;
  confirm(title: string, detail: string): Promise<boolean>;
  openAccessibilitySettings(): Promise<void>;
  openBatterySettings(): Promise<void>;
  onState(cb: (s: Pick<PhoneStatus, "state" | "reason" | "taskId">) => void): () => void;
}

export function unsupportedPhone(): PhoneHost {
  const no = async (): Promise<never> => { throw new Error("Phone control needs the Android app"); };
  return { supported: false, status: async () => ({ state: "idle", accessibility: false, allowlist: [] }), launchableApps: async () => [], setAllowlist: no, start: no,
    resume: no, stop: async () => {}, pause: async () => {}, readScreen: no, perform: no, openApp: no, confirm: async () => false, openAccessibilitySettings: no, openBatterySettings: no, onState: () => () => {} };
}

export interface Platform {
  kind: "android" | "desktop" | "web";
  /** Non-secret app data (redacted history, memory, settings). */
  kv: KVStore;
  /** API keys: Android Keystore / OS keychain. */
  keys: KeyStore;
  fetch: FetchLike;
  local: LocalModelHost;
  /** Absent on web and desktop. */
  phone?: PhoneHost;
  files: {
    pick(): Promise<SelectedFile | undefined>;
    read(token: string, maxBytes?: number): Promise<Uint8Array>;
    save(name: string, bytes: Uint8Array, mime?: string): Promise<boolean>;
  };
  system: {
    deviceInfo(): Promise<DeviceInfo>;
    requestNotifications(): Promise<boolean>;
    scheduleDue(id: string, at: number, title: string): Promise<void>;
    cancelDue(id: string): Promise<void>;
    /** While tasks run: keeps the app working with the screen off or another app in front (Android foreground service, desktop power-save blocker). */
    keepAlive?(on: boolean): Promise<void>;
    /** Opens an https page in the user's own browser. */
    openExternal(url: string): Promise<void>;
  };
}
