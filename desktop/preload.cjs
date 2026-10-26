"use strict";
// The only bridge into the app UI. The agent's browser view has NO preload and cannot reach this.
const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = new Set([
  "fetch", "key:get", "key:set", "key:delete",
  "browser:open", "browser:observe", "browser:read", "browser:click", "browser:type", "browser:fill", "browser:upload",
  "browser:highlight", "browser:setBounds", "browser:setMode", "browser:setDesktopLayout", "browser:snapshot",
  "browser:stopLoading", "browser:clearSiteData",
  "files:pick", "files:read", "files:save",
  "system:deviceInfo", "system:scheduleDue", "system:cancelDue", "system:openExternal",
  "shell:available", "shell:run",
]);

contextBridge.exposeInMainWorld("krishBridge", {
  invoke: (channel, arg) => {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error("blocked channel"));
    return ipcRenderer.invoke(channel, arg);
  },
  onPage: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on("page", h);
    return () => ipcRenderer.removeListener("page", h);
  },
});
