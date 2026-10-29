"use strict";
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, safeStorage, session, Notification, protocol, net, shell, powerSaveBlocker } = require("electron");
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
/** The ACTIVE tab's view. Every page call goes to it; `views` holds all tabs (max MAX_TABS). */
let view;
const MAX_TABS = 4;
const views = new Map();
let activeId = 0;
let nextTabId = 1;
let desktopLayout = false;
/** The agent view is shown to the user. A hidden view may drop real input events, so only a shown one gets real clicks. */
let live = false;
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

/** A new agent tab (same hardened session and rules as the first one). Not shown until it is made active. */
function createTab() {
  const id = nextTabId++;
  const v = new WebContentsView({
    webPreferences: { partition: AGENT_PARTITION, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false },
  });
  const wc = v.webContents;
  // A link or script that wants a new tab opens in this one: new tabs are opened by the agent only (open_tab), and a silently refused popup looks like a dead click.
  wc.setWindowOpenHandler(({ url, postBody }) => {
    if (lib.isHttps(url) && !postBody) wc.loadURL(url); // a popup form submission (POST) cannot be replayed as a plain load, so it stays refused
    return { action: "deny" };
  });
  const blockNonHttps = (e, url) => { if (!lib.isHttps(url)) e.preventDefault(); };
  wc.on("will-navigate", blockNonHttps);
  wc.on("will-redirect", blockNonHttps);
  wc.on("will-attach-webview", (e) => e.preventDefault());
  // Only the active tab reports page events (the UI shows one page at a time); the tab id lets the UI update that tab's chip.
  const emit = (loading) => { if (activeId === id) win?.webContents.send("page", { url: wc.getURL(), title: wc.getTitle(), loading, tabId: id }); };
  wc.on("did-start-loading", () => emit(true));
  wc.on("did-stop-loading", () => emit(false));
  wc.on("page-title-updated", () => emit(false));
  wc.on("did-finish-load", () => applyEmulation(v));
  win.contentView.addChildView(v);
  v.setVisible(false);
  v.setBounds(bounds);
  views.set(id, v);
  return id;
}

/** Makes a tab the active one: only it is visible (while the card is live) and it gets every page call. */
function activate(id) {
  const v = views.get(id);
  if (!v) throw new Error(`no tab ${id}`);
  for (const [other, ov] of views) if (other !== id) ov.setVisible(false);
  activeId = id;
  view = v;
  v.setVisible(live);
  applyEmulation(v);
  const wc = v.webContents;
  win?.webContents.send("page", { url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), tabId: id });
}

function tabList() {
  return [...views].map(([id, v]) => ({ id, title: v.webContents.getTitle(), url: v.webContents.getURL(), active: id === activeId }));
}

function createView() {
  activate(createTab());
}

function applyBounds() {
  for (const v of views.values()) {
    v.setBounds(bounds);
    applyEmulation(v);
  }
}

/**
 * Device emulation needs a live render widget. On a view that has not loaded a page yet, Electron 45 crashes the whole
 * app (segfault), so it is applied only once a page exists and again after every load.
 */
function applyEmulation(v = view) {
  const wc = v?.webContents;
  if (!wc || wc.isDestroyed() || !wc.getURL()) return;
  if (desktopLayout) {
    wc.setUserAgent(DESKTOP_UA);
    // The page is laid out as wide as a PC window and as tall as the card needs at that width, then scaled to fill the card: nothing is cut off at the bottom.
    const scale = Math.min(1, bounds.width / lib.layoutWidth(bounds.width));
    const size = { width: Math.round(bounds.width / scale), height: Math.round(bounds.height / scale) };
    wc.enableDeviceEmulation({ screenPosition: "desktop", screenSize: size, viewPosition: { x: 0, y: 0 }, viewSize: size, deviceScaleFactor: 0, scale });
  } else {
    wc.disableDeviceEmulation();
  }
}

// All automation runs in an ISOLATED WORLD: it shares the DOM with the page but not its JavaScript globals, prototypes or
// setters, so a hostile page cannot hook our code, read our state or spoof the registry.
const WORLD = 1004;
async function call(expression, wc = view.webContents) {
  const raw = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: lib.wrapCall(PAGE_SCRIPT, expression) }]);
  if (typeof raw !== "string") throw new Error("page did not answer");
  return lib.parseCallResult(raw);
}

/**
 * Answers a file input with a user-picked file. The element is resolved by id AND fingerprint in the isolated world
 * (page-script registry lives there, not in the page), checked to be a file input, then handed to the in-process debugger.
 */
async function uploadFile(elementId, fp, filePath) {
  // Unguessable per-call marker: a page cannot pre-mark a decoy input to win the selector below.
  const nonce = crypto.randomBytes(16).toString("hex");
  await call(`(function(){var e=K.element(${Number(elementId)},${typeof fp === "string" ? JSON.stringify(fp) : "null"});if(!(e.tagName==="INPUT"&&e.type==="file"))throw new Error("not a file input");e.setAttribute("data-krish-upload",${JSON.stringify(nonce)});return "ok";})()`);
  const dbg = view.webContents.debugger;
  dbg.attach("1.3");
  try {
    const { root } = await dbg.sendCommand("DOM.getDocument", { depth: 0 });
    const { nodeId } = await dbg.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: `input[type="file"][data-krish-upload="${nonce}"]` });
    if (!nodeId) throw new Error("element is gone; observe again");
    await dbg.sendCommand("DOM.setFileInputFiles", { files: [filePath], nodeId });
  } finally {
    dbg.detach();
    await call(`(function(){var n=document.querySelectorAll('[data-krish-upload=${JSON.stringify(nonce)}]');for(var i=0;i<n.length;i++)n[i].removeAttribute('data-krish-upload');return "ok";})()`).catch(() => undefined);
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

/** capturePage fails with UnknownVizError for a moment after a reload or a layout change; a short retry covers it. */
async function capture() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await view.webContents.capturePage();
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
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

  handle("browser:open", async ({ url }) => { if (!lib.isHttps(url)) throw new Error("only https URLs are allowed"); await view.webContents.loadURL(url); });
  handle("browser:observe", () => call(lib.expr.observe()));
  handle("browser:read", ({ elementId }) => call(lib.expr.read(elementId)));
  // A real mouse click on the element (sites that ignore script clicks react to it). If the view is hidden, the page is scaled, or the element cannot
  // give a position (covered, off-page), the script click is used.
  handle("browser:click", async ({ elementId, fp }) => {
    let at;
    try {
      if (live) at = lib.tapPoint(await call(lib.expr.rect(elementId, fp)), view.getBounds().width);
    } catch {
      at = undefined;
    }
    if (!at) return call(lib.expr.click(elementId, fp)).then(() => undefined);
    const wc = view.webContents;
    wc.focus();
    wc.sendInputEvent({ type: "mouseMove", ...at });
    wc.sendInputEvent({ type: "mouseDown", ...at, button: "left", clickCount: 1 });
    await new Promise((r) => setTimeout(r, 40));
    wc.sendInputEvent({ type: "mouseUp", ...at, button: "left", clickCount: 1 });
  });
  handle("browser:type", ({ elementId, text, submit, fp }) => call(lib.expr.type(elementId, text, submit, fp)).then(() => undefined));
  handle("browser:fill", ({ elementId, value, fp }) =>
    // Page-originated error text is never returned from a fill: it could echo the value.
    call(lib.expr.fill(elementId, value, fp)).then(() => undefined, () => { throw new Error("could not fill the field"); }));
  handle("browser:scroll", ({ direction }) => call(lib.expr.scroll(direction)).then(() => undefined));
  handle("browser:highlight", ({ elementId }) => call(lib.expr.highlight(elementId)).then(() => undefined));
  handle("browser:upload", ({ elementId, fp, token }) => uploadFile(elementId, fp, tokens.get(token)));
  handle("browser:setBounds", (b) => { bounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(1, Math.round(b.width)), height: Math.max(1, Math.round(b.height)) }; applyBounds(); for (const v of views.values()) v.setBorderRadius?.(Math.round(b.radius ?? 0)); });
  handle("browser:setMode", ({ mode }) => { live = mode === "live"; view.setVisible(live); });
  handle("browser:setDesktopLayout", ({ enabled }) => { desktopLayout = Boolean(enabled); applyBounds(); for (const v of views.values()) if (v.webContents.getURL()) v.webContents.reload(); });
  // Tabs (round 10): at most MAX_TABS views; the last one cannot be closed.
  handle("browser:tabs", () => tabList());
  handle("browser:openTab", async ({ url }) => {
    if (!lib.isHttps(url)) throw new Error("only https URLs are allowed");
    if (views.size >= MAX_TABS) throw new Error(`at most ${MAX_TABS} tabs`);
    const id = createTab();
    activate(id);
    view.webContents.loadURL(url).catch(() => undefined); // load events tell the UI when it is done; a failed load leaves an empty tab
    return id;
  });
  handle("browser:switchTab", ({ tabId }) => activate(lib.tabId(tabId)));
  handle("browser:closeTab", ({ tabId }) => {
    const id = lib.tabId(tabId);
    const v = views.get(id);
    if (!v) throw new Error(`no tab ${id}`);
    if (views.size === 1) throw new Error("the last tab cannot be closed");
    views.delete(id);
    win.contentView.removeChildView(v);
    v.webContents.close();
    if (activeId === id) activate([...views.keys()].pop());
  });
  // The code or link found in an inbox tab goes back to the UI process only (the agent loop keeps it from every model).
  handle("browser:findCode", ({ tabId, from, subject }) => {
    const v = views.get(lib.tabId(tabId));
    if (!v) throw new Error(`no tab ${tabId}`);
    return call(lib.expr.findCode(from, subject), v.webContents);
  });
  handle("browser:snapshot", async ({ maxWidth, quality }) => {
    const img = await capture();
    const size = img.getSize();
    const scaled = size.width > maxWidth ? img.resize({ width: maxWidth }) : img;
    return `data:image/jpeg;base64,${scaled.toJPEG(quality).toString("base64")}`;
  });
  handle("browser:stopLoading", () => { for (const v of views.values()) v.webContents.stop(); });
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
  hardenAgentSession();
  win = new BrowserWindow({
    width: 1100, height: 760,
    webPreferences: { backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(`${UI_ORIGIN}/`)) e.preventDefault(); });
  registerIpc();
  createView();
  win.loadURL(UI_INDEX_URL);
});

app.on("window-all-closed", () => app.quit());
