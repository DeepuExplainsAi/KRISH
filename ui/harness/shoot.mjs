// Usage: node ui/harness/shoot.mjs <outDir> <shots.mjs>   (needs: Chrome, the harness build served on :8089)
// A shots file default-exports { name, setup?, steps: [{ name, run: "js expression", wait?: ms }] } entries.
// Drives Chrome over CDP with Node's global WebSocket. Phone = 467x922 @2x touch, PC = 1280x800.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const [out, shotsFile] = process.argv.slice(2);
const shots = (await import(new URL(shotsFile, `file://${process.cwd()}/`))).default;
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? "/opt/agent-browser/chrome/chrome";
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--js-flags=--jitless", "--remote-debugging-port=9333", "--user-data-dir=/tmp/krish-chrome", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch("http://127.0.0.1:9333/json")).json(); if (targets.length) break; } catch {} await sleep(500); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };

const DEVICES = { phone: { width: 467, height: 922, deviceScaleFactor: 2, mobile: true }, pc: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false } };
const log = [];
for (const [dev, metrics] of Object.entries(DEVICES)) {
  for (const theme of (process.env.THEMES ?? "light,dark").split(",")) {
    await cdp("Emulation.setDeviceMetricsOverride", metrics);
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    await cdp("Page.enable");
    await cdp("Page.navigate", { url: "http://127.0.0.1:8089/harness.html" });
    await sleep(2500);
    await ev("localStorage.clear()");
    await cdp("Page.navigate", { url: "http://127.0.0.1:8089/harness.html" });
    await sleep(2500);
    await ev(`__krish.saveSettings({ theme: "system" })`);
    for (const step of shots) {
      try {
        const value = await ev(step.run);
        await sleep(step.wait ?? 500);
        const r = await cdp("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${out}/${dev}-${theme}-${step.name}.png`, Buffer.from(r.result.data, "base64"));
        log.push(`ok  ${dev}-${theme}-${step.name}${typeof value === "string" ? "  => " + value : ""}`);
      } catch (e) { log.push(`ERR ${dev}-${theme}-${step.name}: ${e.message}`); }
    }
  }
}
console.log(log.join("\n"));
ws.close(); chrome.kill();
