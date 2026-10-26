// Scripted flows: each step runs in the page, then a screenshot is taken. `__script` = what the (fake) model answers, in order.
const go = (s) => ({ name: s, run: `__krish.go("${s}")` });
const sleep = `await new Promise(r=>setTimeout(r,700));`
const setup = `(async()=>{ await __krish.addProvider({name:"OpenRouter",kind:"openai-compat",baseUrl:"https://openrouter.ai/api/v1"},"k"); await __krish.updateProvider({...__krish.getState().providers[0], defaultModel:"free-model-1", allowSensitive:true}); })()`;
const answerFirst = (v) => `(async()=>{ const p=__krish.getState().prompts[0]; if(!p) return "no prompt"; __krish.answer(p.id, ${JSON.stringify(v)}); ${sleep} })()`;
const fresh = (body) => `(async()=>{ __krish.stop?.(); await new Promise(r=>setTimeout(r,300)); __krish.newChat(); ${body} })()`;
const sendBody = (text, ...script) => `__script.push(...${JSON.stringify(script)}); __krish.send(${JSON.stringify(text)}); ${sleep}`;
const mem = `(async()=> (await __krish.memory.list()).map(m=>m.text))()`;
export default [
  { name: "00-setup", run: setup, wait: 200 },
  go("home"), go("menu"),
  // ---- API keys catalog
  { name: "01-providers-all", run: `__krish.go("providers")`, wait: 800 },
  { name: "02-providers-row-open", run: `document.querySelectorAll(".card button.plain")[0].click()` },
  { name: "03-providers-free", run: `[...document.querySelectorAll(".pills button")].find(b=>b.textContent==="Free").click()` },
  { name: "04-providers-custom", run: `[...document.querySelectorAll(".pills button")].find(b=>b.textContent==="Custom").click()` },
  // ---- KrishVault
  { name: "05-vault-create", run: `__krish.go("vault")` },
  { name: "06-vault-filled", run: `(async()=>{ await __krish.vault.create("master-pass"); await __krish.vault.put({site:"site.test",label:"Site",username:"deepu",password:"S3cret-pw",note:"Pet: Moti"}); await __krish.vault.put({site:"instagram.com",username:"deepu.ig",password:"abc12345"}); __krish.go("vault"); })()`, wait: 900 },
  { name: "07-vault-locked", run: `(()=>{ __krish.vault.lock(); })()` },
  // ---- vault autofill from chat: leave-site card -> passphrase card (vault locked) -> "fill saved login?" card -> filled
  { name: "08-autofill-leave-site", run: fresh(sendBody("log me in to site.test", { type: "navigate", url: "https://site.test/login", thought: "Open the login page" }, { type: "done", summary: "Login form filled. Press Log in." })), wait: 600 },
  { name: "09-autofill-passphrase", run: answerFirst(true) },
  { name: "10-autofill-confirm", run: answerFirst("master-pass") },
  { name: "11-autofill-done", run: answerFirst(true) },
  { name: "12-autofill-check", run: `JSON.stringify({ filledValues: __filled.map(f=>f[1]), passwordInAnyPrompt: __prompts.join("\\n").includes("S3cret-pw") })`, wait: 100 },
  // ---- memory by chat: every change shows an exact "Remember this?" / "Forget this?" card first
  { name: "13-memory-save-card", run: fresh(sendBody("yaad rakh: meri behen ka naam Riya hai", { type: "memory_add", text: "Meri behen ka naam Riya hai", thought: "Saving" }, { type: "done", summary: "Yaad kar liya: behen ka naam Riya hai." })), wait: 600 },
  { name: "14-memory-saved", run: answerFirst(true) },
  { name: "15-memory-on-home", run: `__krish.go("home")`, wait: 700 },
  { name: "16-memory-update-card", run: fresh(sendBody("update memory: behen ka naam Riya nahi, Diya hai", { type: "memory_remove", ids: ["m1"], thought: "Old fact" }, { type: "memory_add", text: "Meri behen ka naam Diya hai", thought: "New fact" }, { type: "done", summary: "Memory update ho gayi." })), wait: 700 },
  { name: "17-memory-update-add-card", run: answerFirst(true) },
  { name: "18-memory-updated", run: answerFirst(true) },
  { name: "19-memory-after-update", run: `__krish.go("home")`, wait: 700 },
  { name: "20-memory-forget-card", run: fresh(sendBody("memory se behen wali baat delete kar do", { type: "memory_remove", ids: ["m1"], thought: "Forget" }, { type: "done", summary: "Memory se hata diya." })), wait: 700 },
  { name: "21-memory-forgotten", run: answerFirst(true) },
  { name: "22-memory-empty", run: `__krish.go("home")`, wait: 700 },
  { name: "23-memory-check", run: `(async()=> JSON.stringify(await ${mem}))()`, wait: 100 },
  // ---- declined: nothing changes
  { name: "24-memory-unasked", run: fresh(sendBody("open the docs", { type: "memory_add", text: "User hates tea", thought: "Noting" }, { type: "done", summary: "Done." })), wait: 700 },
  { name: "25-memory-declined", run: answerFirst(false) },
  { name: "26-memory-still-empty", run: `(async()=> JSON.stringify(await ${mem}))()`, wait: 100 },
  // ---- other screens
  { name: "27-home-with-card", run: `(async()=>{ await __krish.platform.browser.open("https://example.com/"); __krish.openWindow(); __krish.go("home"); })()`, wait: 800 },
  go("panels"), go("projects"), go("tasks"), go("history"), go("settings"), go("security"),
  { name: "chat-empty", run: `__krish.newChat()` },
];
