export default [
  { name: "01-providers-tick", run: `(async()=>{ await __krish.addProvider({name:"Demo AI",kind:"openai-compat",baseUrl:"https://p.test/v1"},"k"); __krish.go("providers"); })()`, wait: 1500 },
  { name: "02-error-short", run: `(async()=>{ const p=__krish.getState().providers[0]; await __krish.updateProvider({...p, health:{ok:false,at:1,note:"free limit used up, try again later"}}); __krish.newChat(); __krish.go("chat"); __krish.push({role:"agent",text:"No AI provider could answer. Google Gemini: free limit used up, try again later · OpenRouter: free limit used up, try again later · OpenCode Zen: needs paid credit",failed:true}); __krish.set({}); })()`, wait: 600 },
];
