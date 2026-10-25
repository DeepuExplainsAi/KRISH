"use strict";
// Real-Electron smoke test (needs a display; on Linux run through xvfb-run, see `npm run smoke`).
// Drives the running app through the same preload bridge the UI uses. Needs network (loads https://example.com).
const { spawn } = require("node:child_process");
const http = require("node:http");

const PORT = 9340 + Math.floor(Math.random() * 50);
const electron = require("electron");
const child = spawn(electron, ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--remote-debugging-port=${PORT}`, __dirname], { stdio: "ignore" });
let crashed = false;
child.on("exit", (code, sig) => { crashed = true; if (code !== 0 && code !== null) console.error(`electron exited ${code} ${sig ?? ""}`); });

const list = () => new Promise((res, rej) => http.get(`http://127.0.0.1:${PORT}/json`, (r) => { let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => res(JSON.parse(b))); }).on("error", rej));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uiTarget() {
  for (let i = 0; i < 60; i++) {
    if (crashed) throw new Error("Electron crashed during startup");
    try { const t = (await list()).find((x) => x.url.startsWith("krish://app/")); if (t) return t; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error("UI never appeared");
}

// Runs inside the UI window. Every check returns "ok" or throws.
const CHECKS = `(async () => {
  const inv = (c, a) => window.krishBridge.invoke(c, a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const refused = async (p, what) => { try { await p; } catch { return; } throw new Error(what + " was not refused"); };
  const results = {};
  const check = async (name, f) => { try { await f(); results[name] = "ok"; } catch (e) { results[name] = String(e.message || e); } };

  // The agent view has not loaded a page yet: toggling layout used to segfault the whole app.
  await check("layout toggle before any page", async () => { await inv("browser:setDesktopLayout", { enabled: true }); await inv("browser:setDesktopLayout", { enabled: false }); });
  await check("http refused", () => refused(inv("browser:open", { url: "http://example.com/" }), "http"));
  await check("file refused", () => refused(inv("browser:open", { url: "file:///etc/passwd" }), "file"));
  await check("unknown channel blocked", () => refused(window.krishBridge.invoke("shell:evil"), "channel"));
  await check("fetch http refused", () => refused(inv("fetch", { url: "http://example.com/" }), "http fetch"));
  await check("fetch DELETE refused", () => refused(inv("fetch", { url: "https://example.com/", init: { method: "DELETE" } }), "DELETE"));
  await inv("browser:open", { url: "https://example.com/" });
  await sleep(3000);
  let obs;
  await check("observe (isolated world)", async () => { obs = JSON.parse(await inv("browser:observe")); if (obs.title !== "Example Domain") throw new Error("title " + obs.title); });
  await check("read", async () => { if (!(await inv("browser:read", {})).includes("documentation")) throw new Error("no text"); });
  await check("stale fingerprint refused", () => refused(inv("browser:click", { elementId: obs.elements[0].id, fp: "wrong" }), "stale fp"));
  await check("layout toggle with page", async () => { await inv("browser:setDesktopLayout", { enabled: true }); await sleep(1500); await inv("browser:setDesktopLayout", { enabled: false }); });
  await check("snapshot", async () => { await inv("browser:setBounds", { x: 0, y: 40, width: 800, height: 500 }); await inv("browser:setMode", { mode: "live" }); const s = await inv("browser:snapshot", { maxWidth: 400, quality: 50 }); if (!s.startsWith("data:image/jpeg")) throw new Error("not a jpeg"); });
  await check("clear site data", () => inv("browser:clearSiteData"));
  return JSON.stringify(results);
})()`;

(async () => {
  let failed = 1;
  try {
    const t = await uiTarget();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    const answer = new Promise((res, rej) => {
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: CHECKS, awaitPromise: true, returnByValue: true } }));
      ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.id !== 1) return;
        if (d.result.exceptionDetails) rej(new Error(JSON.stringify(d.result.exceptionDetails)));
        else res(JSON.parse(d.result.result.value));
      };
      ws.onerror = () => rej(new Error("CDP connection failed"));
    });
    const results = await Promise.race([answer, sleep(90_000).then(() => { throw new Error("smoke timed out"); })]);
    failed = 0;
    for (const [name, r] of Object.entries(results)) { console.log(`${r === "ok" ? "PASS" : "FAIL"}  ${name}${r === "ok" ? "" : ": " + r}`); if (r !== "ok") failed++; }
    if (crashed) { console.error("FAIL  app crashed while running checks"); failed++; }
  } catch (e) {
    console.error("FAIL  " + e.message);
  } finally {
    child.kill();
    process.exit(failed ? 1 : 0);
  }
})();
