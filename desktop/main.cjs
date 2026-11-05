"use strict";
const { app, BrowserWindow, ipcMain, dialog, safeStorage, Notification, protocol, net, shell, powerSaveBlocker } = require("electron");
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const lib = require("./lib.cjs");

const UI_DIR = path.join(__dirname, "..", "ui", "dist");
const UI_ORIGIN = "krish://app";
const UI_INDEX_URL = `${UI_ORIGIN}/index.html`;
const DOCKER_IMAGE = "alpine:3"; // must already be present locally; this app never pulls images

// The UI is served from a privileged custom scheme so module Workers, fetch and storage behave like https.
protocol.registerSchemesAsPrivileged([{ scheme: "krish", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function serveUi() {
  protocol.handle("krish", (req) => {
    const u = new URL(req.url);
    if (u.host !== "app") return new Response("not found", { status: 404 });
    const rel = decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname);
    const file = path.resolve(UI_DIR, "." + rel);
    if (file !== UI_DIR && !file.startsWith(UI_DIR + path.sep)) return new Response("forbidden", { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
}

let win;
const tokens = new lib.FileTokens(() => crypto.randomUUID());
let secrets;
const timers = new Map();

const dockerPresent = () =>
  new Promise((resolve) => execFile("docker", ["image", "inspect", DOCKER_IMAGE], { timeout: 5000 }, (err) => resolve(!err)));

function runDocker(script, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "krish-"));
  for (const [name, bytes] of Object.entries(files || {})) {
    const p = path.resolve(dir, name);
    if (!p.startsWith(dir + path.sep)) throw new Error("unsafe path");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(bytes));
  }
  fs.chmodSync(dir, 0o777);
  const args = [...lib.dockerArgs({ image: DOCKER_IMAGE, workDir: dir, name: `krish-${crypto.randomUUID()}` }), String(script)];
  return new Promise((resolve, reject) => {
    execFile("docker", args, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      try {
        const out = {};
        const walk = (d, rel = "") => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(path.join(d, e.name), r);
            else if (e.isFile() && fs.statSync(path.join(d, e.name)).size <= 20 * 1024 * 1024) out[r] = new Uint8Array(fs.readFileSync(path.join(d, e.name)));
          }
        };
        walk(dir);
        fs.rmSync(dir, { recursive: true, force: true });
        if (err && !stdout && !stderr) return reject(new Error(err.killed ? "container task timed out" : err.message));
        resolve({ output: `${stdout}${stderr}`.slice(0, 20000), files: out });
      } catch (e) {
        reject(e);
      }
    });
  });
}

function registerIpc() {
  const trusted = (e) => e.senderFrame && e.senderFrame.url.startsWith(`${UI_ORIGIN}/`);
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (e, arg) => {
      if (!trusted(e)) throw new Error("untrusted sender");
      return fn(arg ?? {});
    });

  handle("fetch", async ({ url, init }) => {
    const v = lib.validateFetch(url, init);
    // net.fetch: the Chromium network stack, so system proxies and certificates apply and no WebAssembly is needed.
    const res = await net.fetch(url, { ...v, redirect: "error", credentials: "omit", bypassCustomProtocolHandlers: true, signal: AbortSignal.timeout(60000) });
    return { status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers), body: await res.text() };
  });
  handle("key:get", ({ key }) => secrets.get(String(key)));
  handle("key:set", ({ key, value }) => secrets.set(String(key), String(value)));
  handle("key:delete", ({ key }) => secrets.delete(String(key)));

  handle("files:pick", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    return { name: path.basename(p), size: fs.statSync(p).size, token: tokens.put(p) };
  });
  handle("files:read", ({ token, maxBytes }) => {
    const p = tokens.get(token);
    const max = maxBytes || 50 * 1024 * 1024;
    if (fs.statSync(p).size > max) throw new Error(`file larger than ${max} bytes`);
    return new Uint8Array(fs.readFileSync(p));
  });
  handle("files:save", async ({ name, bytes }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.basename(String(name)) });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, Buffer.from(bytes));
    return true;
  });

  handle("system:deviceInfo", async () => ({
    lowRam: os.totalmem() < 3 * 1024 ** 3,
    totalMemMb: Math.round(os.totalmem() / 1024 ** 2),
    linuxSandbox: await dockerPresent(), // desktop: container tier available only if Docker and the image already exist
    dockerAvailable: await dockerPresent(),
  }));
  // Desktop schedules fire only while the app is open (no background service). Notifications need no extra permission.
  handle("system:scheduleDue", ({ id, at, title }) => {
    clearTimeout(timers.get(id));
    const delay = Math.min(Math.max(0, at - Date.now()), 2 ** 31 - 1);
    timers.set(id, setTimeout(() => { if (Notification.isSupported()) new Notification({ title: String(title || "Something is due"), body: "Open Krish to review" }).show(); }, delay));
  });
  handle("system:openExternal", ({ url }) => { if (!lib.isHttps(url)) throw new Error("only https URLs are allowed"); return shell.openExternal(url); });
  // While tasks run the computer may dim the screen but must not sleep, or the queue stops. The window itself keeps working when minimised.
  let blocker;
  handle("system:keepAlive", ({ on }) => {
    if (on && blocker === undefined) blocker = powerSaveBlocker.start("prevent-app-suspension");
    if (!on && blocker !== undefined) { powerSaveBlocker.stop(blocker); blocker = undefined; }
  });
  handle("system:cancelDue", ({ id }) => { clearTimeout(timers.get(id)); timers.delete(id); });

  handle("shell:available", () => dockerPresent());
  handle("shell:run", ({ script, files }) => runDocker(script, files));
}

app.whenReady().then(() => {
  secrets = lib.createSecretStore({ dir: app.getPath("userData"), safeStorage, fs });
  serveUi();
  win = new BrowserWindow({
    width: 1100, height: 760,
    webPreferences: { backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(`${UI_ORIGIN}/`)) e.preventDefault(); });
  registerIpc();
  win.loadURL(UI_INDEX_URL);
});

app.on("window-all-closed", () => app.quit());
