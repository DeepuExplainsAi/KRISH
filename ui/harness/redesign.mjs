// Redesign check shots: plain answer, browser card with a page, empty card. Usage: see shoot.mjs
export default [
  { name: "00-no-provider", run: `(async()=>{ __krish.newChat(); await __krish.send("hi"); })()`, wait: 500 },
  { name: "01-chat-plain", run: `(async()=>{ await __krish.addProvider({name:"Demo AI",kind:"openai-compat",baseUrl:"https://p.test/v1"},"k"); __krish.newChat(); __script.length=0; __script.push({type:"done",summary:"Hi Deepu! I can answer questions or open websites for you. What would you like?"}); await __krish.send("hi"); })()`, wait: 600 },
  { name: "02-card-opening", run: `(async()=>{ __krish.openWindow(); })()`, wait: 600 },
  { name: "03-card-page", run: `(async()=>{ await __krish.platform.browser.open("https://example.com/"); __krish.openWindow(); })()`, wait: 600 },
  { name: "04-home-with-card", run: `__krish.go("home")`, wait: 600 },
  { name: "05-menu", run: `__krish.closeWindow(); __krish.go("menu")`, wait: 600 },
  { name: "06-providers", run: `__krish.go("providers")`, wait: 600 },
];
