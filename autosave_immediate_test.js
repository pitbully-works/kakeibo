const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {bootApp}=require("./boot-app.cjs");
const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");

test("入力イベントは350ms待たずその場でautoSaveする",()=>{
  assert.match(html,/document\.addEventListener\("input"[\s\S]*autoSave\(el\.id\);/);
  assert.doesNotMatch(html,/setTimeout\(\(\)=>autoSave/);
});

test("NISAを入力した直後にstateと端末保存へ反映される",()=>{
  const app=bootApp({state:{settings:{birth:"1968-11-13",cycleStart:20,lp:{
    tsumitateSchedule:[{fromAge:57,toAge:65,funds:[{name:"全世界",amount:10000}]}],
    growthSchedule:[]
  }},tx:[]}});
  app.run('view="lp"; lpKind="nisa"; render();');
  app.run('document.getElementById("lp-ts-from-0").value="57"; document.getElementById("lp-ts-to-0").value="65"; document.getElementById("lp-ts-fn-0-0").value="全世界"; document.getElementById("lp-ts-fa-0-0").value="12345"; autoSave("lp-ts-fa-0-0");');
  assert.equal(app.run('state.settings.lp.tsumitateSchedule[0].monthlyYen'),12345);
  assert.equal(app.run('Core.nisaPlannedOn(state.settings,"2026-08-11")'),12345);
  assert.match(app.run('localStorage.getItem("kakeibo:v1:state")'),/12345/);
});

test("保険を入力した直後にstateと端末保存へ反映される",()=>{
  const app=bootApp({state:{settings:{birth:"1968-11-13",lp:{
    insurancePolicies:[{name:"保険",monthlyPremium:1000,premiumFromAge:40,premiumToAge:65}]
  }},tx:[]}});
  app.run('view="lp"; lpKind="insurance"; render();');
  app.run('document.getElementById("lp-in-name-0").value="保険"; document.getElementById("lp-in-prem-0").value="7777"; document.getElementById("lp-in-from-0").value="40"; document.getElementById("lp-in-to-0").value="65"; autoSave("lp-in-prem-0");');
  assert.equal(app.run('state.settings.lp.insurancePolicies[0].monthlyPremium'),7777);
  assert.match(app.run('localStorage.getItem("kakeibo:v1:state")'),/7777/);
});
