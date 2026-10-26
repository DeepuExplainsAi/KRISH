const prov = `await __krish.addProvider({name:"Demo AI",kind:"openai-compat",baseUrl:"https://p.test/v1"},"k");`;
export default [
  { name: "01-welcome", run: `(async()=>{ ${prov} __krish.go("chat"); })()`, wait: 900 },
  { name: "02-thinking", run: `(async()=>{ window.__slow=true; __krish.send("hello there"); })()`, wait: 700 },
  { name: "03-models", run: `(async()=>{ await __krish.updateProvider({...__krish.getState().providers[0], models:{fetchedAt:1,items:[{id:"embed-3"},{id:"big-paid-pro-5"},{id:"gemma-4-31b-it:free",free:true},{id:"nemotron-3-super-120b-a12b:free",free:true},{id:"paid-mini-1"}]}}); __krish.go("providers"); })()`, wait: 700 },
  { name: "04-failure", run: `(async()=>{ __krish.newChat(); __krish.go("chat"); __krish.push({role:"agent",failed:true,text:"No AI provider could answer. Google Gemini: free limit used up, try again later · OpenRouter: model no longer available"}); })()`, wait: 700 },
];
