// Dev-only screenshot harness: the real UI on the browser-only platform with a scripted model. Not part of the product bundle.
import { createRoot } from "react-dom/client";
import { App } from "../src/App";
import { createWebPlatform } from "../src/platform/web";
import { AppStore } from "../src/state/store";
import { StoreContext } from "../src/state/useStore";
import "../src/styles.css";

declare global {
  interface Window { __krish: AppStore; __script: object[]; __filled: [number, string][]; __prompts: string[] }
}

window.__script = [];
window.__filled = [];
window.__prompts = [];
const platform = createWebPlatform();
// Simulated login page for site.test so the vault autofill flow can run; every other URL keeps the demo page.
let url = "";
const open = platform.browser.open;
const observe = platform.browser.observe;
platform.browser.open = async (u) => { url = u; await open(u); };
platform.browser.observe = async () =>
  url.startsWith("https://site.test")
    ? { url, title: "Site login", text: "Sign in to Site", elements: [{ id: 0, tag: "input", type: "text", label: "Username" }, { id: 1, tag: "input", type: "password", label: "Password" }, { id: 2, tag: "button", text: "Log in", submits: true }] }
    : observe();
platform.browser.fill = async (id, v) => void window.__filled.push([id, v]);
platform.fetch = async (url, init) => {
  if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "free-model-1" }, { id: "free-model-2" }] }), { status: 200 });
  if ((window as unknown as { __slow?: boolean }).__slow) await new Promise((r) => setTimeout(r, 30_000)); // lets a screenshot catch the "thinking" state
  window.__prompts.push(JSON.parse(String(init?.body)).messages.map((m: { content: string }) => m.content).join("\n"));
  const next = window.__script.shift() ?? { type: "done", summary: "Done." };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(next) } }] }), { status: 200 });
};
const store = (window.__krish = new AppStore(platform));
void store.init();
createRoot(document.getElementById("root")!).render(
  <StoreContext.Provider value={store}>
    <App />
  </StoreContext.Provider>,
);
