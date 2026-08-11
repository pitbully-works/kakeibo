const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
const Core=require("./core.js");

test("古いバックアップに生年月日が無い時は端末の生年月日を残す",()=>{
  assert.match(html,/const restoredBirth = Core\.validateDateString\(restored\.settings\.birth\)[\s\S]*state\.settings\.birth/);
});

test("生年月日を残せば復元したNISA区間110000円が自動計算される",()=>{
  const restored=Core.normalizeBackup({settings:{country:"JP",nisaMonthly:45000,lp:{
    tsumitateSchedule:[{fromAge:57,toAge:65,funds:[{name:"全世界",amount:40000},{name:"S&P500",amount:40000},{name:"たわら8",amount:20000}]}],
    growthSchedule:[{fromAge:57,toAge:65,funds:[{name:"トヨタ",amount:5000},{name:"AI",amount:5000}]}]
  }},tx:[]});
  const profiles=restored.moneyProfiles||Core.normalizeMoneyProfiles(null,restored.settings);
  const s=Core.settingsForCountry(profiles,"JP","1968-11-13");
  assert.equal(Core.nisaPlannedOn(s,"2026-08-11"),110000);
});
