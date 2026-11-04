import type { PhoneAction } from "../security/actions";
import type { RawScreen } from "../security/screen";

export type DeviceScreen = RawScreen | { blocked: true; reason: string };
export type DeviceState = { state: "idle" | "running" | "paused"; reason?: string | null };

/** The phone as the engine sees it. Android implements it with the AccessibilityService; tests use a fake. Every method is re-checked natively. */
export interface PhoneDevice {
  state(): Promise<DeviceState>;
  start(taskId: string): Promise<void>;
  /** Raw screen of the foreground app, or `{blocked}` when the native guard refused to read it. */
  readScreen(screenshot: boolean): Promise<DeviceScreen>;
  /** tap / type / scroll / back on the last read screen. */
  perform(action: PhoneAction): Promise<{ ok: boolean; error?: string }>;
  openApp(pkg: string): Promise<void>;
  /** Popup over the current app. Anything but an explicit Allow is false. */
  confirm(title: string, detail: string): Promise<boolean>;
  pause(reason: string): Promise<void>;
  stop(reason: string): Promise<void>;
}
