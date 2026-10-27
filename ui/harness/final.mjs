const add = `await __krish.addProvider({name:"Google Gemini",kind:"openai-compat",baseUrl:"https://p.test/v1"},"k"); await __krish.addProvider({name:"Groq",kind:"openai-compat",baseUrl:"https://p.test/v1"},"k");`;
const skip = `await __krish.saveSettings({tourDone:true});`;
export default [
  { name: "01-tour", run: `(async()=>{ await __krish.saveSettings({tourDone:false}); })()`, wait: 600 },
  { name: "02-keys", run: `(async()=>{ ${skip} ${add} __krish.go("providers"); })()`, wait: 1500 },
  { name: "03-chat", run: `(async()=>{ ${skip} __krish.go("chat"); })()`, wait: 600 },
  { name: "04-settings", run: `(async()=>{ __krish.go("settings"); })()`, wait: 600 },
  { name: "05-vault", run: `(async()=>{ __krish.go("vault"); })()`, wait: 600 },
];
