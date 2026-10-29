"use strict";
// Pure helpers for the Electron main process. No Electron imports, so they are unit-tested in plain Node.
const path = require("node:path");

const isHttps = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && !x.username && !x.password;
  } catch {
    return false;
  }
};

/** Width (CSS px) a page is laid out at in PC layout: 1024 in a narrow card, 1280 in a wide one. Same rule as AgentWebView.layoutWidth. */
const layoutWidth = (cardWidth) => (cardWidth < 700 ? 1024 : 1280);

/** Same wrapper as AgentWebView.kt: the page script is evaluated fresh into a local `K` on every call. */
const wrapCall = (pageScript, expr) =>
  `(function(){try{var K=${pageScript}\n;return JSON.stringify({ok:true,v:${expr}});}catch(e){return JSON.stringify({ok:false,e:String(e&&e.message||e)});}})()`;

const parseCallResult = (raw) => {
  const o = JSON.parse(raw);
  if (!o.ok) throw new Error(o.e || "page error");
  return o.v === undefined || o.v === null ? "" : typeof o.v === "string" ? o.v : JSON.stringify(o.v);
};

const quote = (s) => JSON.stringify(String(s));
const fpArg = (fp) => (typeof fp === "string" ? quote(fp) : "null");
const int = (n) => {
  if (!Number.isInteger(n) || n < 0) throw new Error("bad element id");
  return n;
};

/** Page-API expressions. Values are JSON-quoted, ids must be integers. */
const expr = {
  observe: () => "K.observe()",
  read: (id) => `K.read(${id == null ? "null" : int(id)})`,
  click: (id, fp) => `K.click(${int(id)},${fpArg(fp)})`,
  rect: (id, fp) => `K.rect(${int(id)},${fpArg(fp)})`,
  type: (id, text, submit, fp) => `K.type(${int(id)},${quote(text)},${Boolean(submit)},${fpArg(fp)})`,
  fill: (id, value, fp) => `K.fill(${int(id)},${quote(value)},${fpArg(fp)})`,
  scroll: (dir) => `K.scroll(${quote(dir === "up" ? "up" : "down")})`,
  highlight: (id) => `K.highlight(${id == null ? "null" : int(id)})`,
  findCode: (from, subject) => `K.findCode(${quote(String(from ?? "").slice(0, 120))},${quote(String(subject ?? "").slice(0, 120))})`,
};

/** A tab id from the UI: a small positive integer. */
const tabId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 1e6) throw new Error("bad tab id");
  return n;
};

/**
 * Where a real mouse click lands in the view, from the page script's `rect` answer (CSS px of the page and its inner width).
 * Only for a page shown 1:1. When the page is laid out wider than the card and scaled down (PC layout) the mapping through Electron's
 * device emulation is not verified, so it returns undefined and the caller uses the script click instead of risking a click in the wrong place.
 */
const tapPoint = (rect, viewWidth) => {
  const r = typeof rect === "string" ? JSON.parse(rect) : rect;
  if (!(r.innerWidth > 0) || Math.abs(viewWidth / r.innerWidth - 1) > 0.02) return undefined;
  return { x: Math.round(r.x), y: Math.round(r.y) };
};

const FETCH_METHODS = new Set(["GET", "POST"]);
const MAX_BODY = 20 * 1024 * 1024;

/** Validates a renderer-requested provider call. Returns normalized init or throws. */
function validateFetch(url, init = {}) {
  if (!isHttps(url)) throw new Error("only https URLs are allowed");
  const method = (init.method || "GET").toUpperCase();
  if (!FETCH_METHODS.has(method)) throw new Error("method not allowed");
  if (init.body != null && (typeof init.body !== "string" || init.body.length > MAX_BODY)) throw new Error("bad body");
  const headers = {};
  for (const [k, v] of Object.entries(init.headers || {})) {
    if (typeof v === "string" && /^[A-Za-z0-9-]+$/.test(k)) headers[k] = v;
  }
  return { method, headers, body: init.body ?? undefined };
}

class FileTokens {
  constructor(randomId) {
    this.map = new Map();
    this.randomId = randomId;
  }
  put(filePath) {
    const t = this.randomId();
    this.map.set(t, filePath);
    return t;
  }
  get(token) {
    const p = this.map.get(token);
    if (!p) throw new Error("unknown file token");
    return p;
  }
  clear() {
    this.map.clear();
  }
}

/**
 * Secret store backed by the OS keychain through Electron safeStorage (Keychain / DPAPI / libsecret).
 * If the OS cannot encrypt, writes are refused: secrets are never stored in plaintext.
 */
function createSecretStore({ dir, safeStorage, fs, platform = process.platform }) {
  // On Linux, Electron can report encryption "available" while using a fixed, built-in password (basic_text). That is not a keychain.
  const usable = () => {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (platform !== "linux") return true;
    const backend = typeof safeStorage.getSelectedStorageBackend === "function" ? safeStorage.getSelectedStorageBackend() : "unknown";
    return backend !== "basic_text" && backend !== "unknown";
  };
  const file = path.join(dir, "secrets.json");
  const load = () => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  };
  const save = (o) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(o), { mode: 0o600 });
  };
  return {
    get(key) {
      const v = load()[key];
      return v ? safeStorage.decryptString(Buffer.from(v, "base64")) : undefined;
    },
    set(key, value) {
      if (!usable()) throw new Error("OS keychain unavailable (on Linux install gnome-keyring or KWallet); refusing to store the key");
      const o = load();
      o[key] = safeStorage.encryptString(value).toString("base64");
      save(o);
    },
    delete(key) {
      const o = load();
      delete o[key];
      save(o);
    },
  };
}

/** docker run arguments for the optional container tier. Offline, unprivileged, never pulls images. */
function dockerArgs({ image, workDir, name }) {
  return [
    "run", "--rm", "--pull", "never", "--name", name,
    "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--pids-limit", "128", "--memory", "256m", "--cpus", "1", "--user", "65534:65534",
    "--tmpfs", "/tmp:rw,size=64m", "-v", `${workDir}:/work:rw`, "-w", "/work", image, "sh", "-c",
  ];
}

module.exports = { isHttps, layoutWidth, tapPoint, wrapCall, parseCallResult, expr, tabId, validateFetch, FileTokens, createSecretStore, dockerArgs };
