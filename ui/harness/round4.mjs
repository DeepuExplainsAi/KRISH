const skip = `await __krish.saveSettings({tourDone:true, theme:"light"});`;
const needLogin = `(async()=>{ ${skip} __krish.go("chat"); __krish.buildUI("r").askLogin({site:"arena.ai", google:true, save:"new"}, new AbortController().signal); })()`;
export default [
  { name: "02-window", run: `(async()=>{ ${skip} __krish.go("chat"); __krish.openWindow(); })()`, wait: 800 },
  { name: "03-keys-with-window", run: `(async()=>{ ${skip} __krish.openWindow(); __krish.go("providers"); })()`, wait: 1200 },
  { name: "04-login", run: needLogin, wait: 800 },
];
