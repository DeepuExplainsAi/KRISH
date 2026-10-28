const skip = `__krish.saveSettings({tourDone:true, theme:"light"})`;
export default [
  { name: "01-vault-empty", run: `(async()=>{ await ${skip}; __krish.go("vault"); })()`, wait: 700 },
  { name: "02-vault-filled", run: `(async()=>{ await __krish.vault.put({site:"site.test",username:"deepu",password:"S3cret-pw",note:"Pet: Moti"}); await __krish.vault.put({site:"*",username:"main@x.com",password:"abc12345"}); })()`, wait: 700 },
  { name: "03-settings", run: `__krish.go("settings")`, wait: 500 },
  { name: "04-login", run: `(async()=>{ __krish.go("chat"); window.__script.push({type:"navigate",url:"https://site.test/login"},{type:"wait",ms:900},{type:"done",summary:"ok"}); await __krish.send("site.test pe login karo"); return JSON.stringify({filled:window.__filled.map(f=>f[1]), cards:__krish.getState().prompts.length}); })()`, wait: 600 },
];
