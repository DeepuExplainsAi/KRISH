"use strict";
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, safeStorage, session, Notification, protocol, net } = require("electron");
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
const PAGE_SCRIPT = fs.readFileSync(path.join(__dirname, "..", "core", "page-script", "krish-page.js"), "utf8");
const AGENT_PARTITION = "persist:krish-agent";
const DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
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
let view;
let desktopLayout = false;
let bounds = { x: 0, y: 0, width: 1, height: 1 };
const tokens = new lib.FileTokens(() => crypto.randomUUID());
let secrets;
const timers = new Map();

function hardenAgentSession() {
  const ses = session.fromPartition(AGENT_PARTITION);
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false)); // no camera/mic/location/notifications/clipboard
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  return ses;
}

function createView() {
  view = new WebContentsView({
    webPreferences: { partition: AGENT_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false },
  });
  const wc = view.webContents;
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  const blockNonHttps = (e, url) => { if (!lib.isHttps(url)) e.preventDefault(); };
  wc.on("will-navigate", blockNonHttps);
  wc.on("will-redirect", blockNonHttps);
  wc.on("will-attach-webview", (e) => e.preventDefault());
  const emit = (loading) => win?.webContents.send("page", { url: wc.getURL(), title: wc.getTitle(), loading });
  wc.on("did-start-loading", () => emit(true));
  wc.on("did-stop-loading", () => emit(false));
  wc.on("page-title-updated", () => emit(false));
  win.contentView.addChildView(view);
  view.setVisible(false);
  applyBounds();
}

function applyBounds() {
  if (!view) return;
  view.setBounds(bounds);
  const wc = view.webContents;
  if (desktopLayout) {
    wc.setUserAgent(DESKTOP_UA);
    const scale = Math.min(bounds.width / 1280, bounds.height / 800);
    wc.enableDeviceEmulation({ screenPosition: "desktop", screenSize: { width: 1280, height: 800 }, viewPosition: { x: 0, y: 0 }, viewSize: { width: 1280, height: 800 }, deviceScaleFactor: 0, scale });
  } else {
    wc.disableDeviceEmulation();
  }
}

async function call(expression) {
  const raw = await view.webContents.executeJavaScript(lib.wrapCall(PAGE_SCRIPT, expression), true);
  return lib.parseCallResult(raw);
}

/** Answers a file input with a user-picked file via the in-process debugger (no debugging port is opened). */
async function uploadFile(elementId, filePath) {
  const dbg = view.webContents.debugger;
  dbg.attach("1.3");
  try {
    const { result } = await dbg.sendCommand("Runtime.evaluate", { expression: `window.__krishState && window.__krishState.els[${Number(elementId)}]` });
    if (!result.objectId) throw new Error("element is gone; observe again");
    await dbg.sendCommand("DOM.setFileInputFiles", { files: [filePath], objectId: result.objectId });
  } finally {
    dbg.detach();
  }
}

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
    const res = await fetch(url, { ...v, redirect: "error", credentials: "omit", signal: AbortSignal.timeout(60000) });
    return { status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers), body: await res.text() };
  });
  handle("key:get", ({ key }) => secrets.get(String(key)));
  handle("key:set", ({ key, value }) => secrets.set(String(key), String(value)));
  handle("key:delete", ({ key }) => secrets.delete(String(key)));

  handle("browser:open", async ({ url }) => { if (!lib.isHttps(url)) throw new Error("only https URLs are allowed"); await view.webContents.loadURL(url); });
  handle("browser:observe", () => call(lib.expr.observe()));
  handle("browser:read", ({ elementId }) => call(lib.expr.read(elementId)));
  handle("browser:click", ({ elementId }) => call(lib.expr.click(elementId)).then(() => undefined));
  handle("browser:type", ({ elementId, text, submit }) => call(lib.expr.type(elementId, text, submit)).then(() => undefined));
  handle("browser:fill", ({ elementId, value }) => call(lib.expr.fill(elementId, value)).then(() => undefined));
  handle("browser:highlight", ({ elementId }) => call(lib.expr.highlight(elementId)).then(() => undefined));
  handle("browser:upload", ({ elementId, token }) => uploadFile(elementId, tokens.get(token)));
  handle("browser:setBounds", (b) => { bounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(1, Math.round(b.width)), height: Math.max(1, Math.round(b.height)) }; applyBounds(); });
  handle("browser:setMode", ({ mode }) => view.setVisible(mode === "live"));
  handle("browser:setDesktopLayout", ({ enabled }) => { desktopLayout = Boolean(enabled); applyBounds(); if (view.webContents.getURL()) view.webContents.reload(); });
  handle("browser:snapshot", async ({ maxWidth, quality }) => {
    const img = await view.webContents.capturePage();
    const size = img.getSize();
    const scaled = size.width > maxWidth ? img.resize({ width: maxWidth }) : img;
    return `data:image/jpeg;base64,${scaled.toJPEG(quality).toString("base64")}`;
  });
  handle("browser:stopLoading", () => view.webContents.stop());
  handle("browser:clearSiteData", async () => {
    const ses = session.fromPartition(AGENT_PARTITION);
    await ses.clearStorageData();
    await ses.clearCache();
    tokens.clear();
  });

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
  handle("system:cancelDue", ({ id }) => { clearTimeout(timers.get(id)); timers.delete(id); });

  handle("shell:available", () => dockerPresent());
  handle("shell:run", ({ script, files }) => runDocker(script, files));
}

app.whenReady().then(() => {
  secrets = lib.createSecretStore({ dir: app.getPath("userData"), safeStorage, fs });
  serveUi();
  hardenAgentSession();
  win = new BrowserWindow({
    width: 1100, height: 760,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(`${UI_ORIGIN}/`)) e.preventDefault(); });
  registerIpc();
  createView();
  win.loadURL(UI_INDEX_URL);
});

app.on("window-all-closed", () => app.quit());
