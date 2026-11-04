import type { PhoneDevice } from "@krish/core";
import type { PhoneHost } from "./types";

/** The engine's view of the phone, backed by the native KrishPhone plugin. */
export function phoneDevice(host: PhoneHost): PhoneDevice {
  return {
    state: async () => {
      const s = await host.status();
      return { state: s.state, reason: s.reason };
    },
    start: (taskId) => host.start(taskId),
    readScreen: (screenshot) => host.readScreen(screenshot),
    perform: (action) => host.perform(action),
    openApp: (pkg) => host.openApp(pkg),
    confirm: (title, detail) => host.confirm(title, detail),
    pause: (reason) => host.pause(reason),
    stop: (reason) => host.stop(reason),
  };
}
