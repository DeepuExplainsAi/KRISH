export default [
  { name: "01-chat", run: `(async()=>{ await __krish.saveSettings({tourDone:true, theme:"auto"}); __krish.go("chat"); await __krish.send("Hi"); })()`, wait: 1500 },
  { name: "02-settings", run: `(async()=>{ __krish.go("settings"); })()`, wait: 500 },
];
