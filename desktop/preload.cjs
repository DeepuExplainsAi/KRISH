"use strict";
// The only bridge into the app UI. There is no embedded agent browser any more.
const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = new Set([
  "fetch", "key:get", "key:set", "key:delete",
  "files:pick", "files:read", "files:save",
  "system:deviceInfo", "system:scheduleDue", "system:cancelDue", "system:openExternal", "system:keepAlive",
  "shell:available", "shell:run",
]);

contextBridge.exposeInMainWorld("krishBridge", {
  invoke: (channel, arg) => {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error("blocked channel"));
    return ipcRenderer.invoke(channel, arg);
  }
});
