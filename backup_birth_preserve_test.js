const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
const Core=require("./core.js");

test("古いバックアップに生年月日が無い時は復元対象と同じ国の端末生年月日を残す",()=>{
  assert.match(html,/const restoreCountry = Core\.normalizeCountry\(restored\.settings\.country\)/);
  assert.match(html,/const currentCountrySettings = Core\.settingsForCountry\(currentProfiles, restoreCountry\)/);
  assert.match(html,/state\.moneyProfiles\[restoreCountry\] = Core\.normalizeSettings\([\s\S]*birth: restoredBirth[\s\S]*state\.settings = Core\.settingsForCountry\(state\.moneyProfiles, restoreCountry\)/);
});

test("復元側に生年月日があれば端末側より復元データを優先する",()=>{
  const restoredProfiles=Core.normalizeMoneyProfiles({JP:{country:"JP",birth:"1970-01-02"}}, {country:"JP"});
  const restoredCountrySettings=Core.settingsForCountry(restoredProfiles,"JP");
  const currentProfiles=Core.normalizeMoneyProfiles({JP:{country:"JP",birth:"1968-11-13"}}, {country:"JP"});
  const currentCountrySettings=Core.settingsForCountry(currentProfiles,"JP");
  const restoredBirth=Core.validateDateString(restoredCountrySettings.birth)
    ? restoredCountrySettings.birth
    : (Core.validateDateString(currentCountrySettings.birth) ? currentCountrySettings.birth : "");
  assert.equal(restoredBirth,"1970-01-02");
});

test("復元対象国に生年月日が無ければ同じ国の端末生年月日だけを保持する",()=>{
  const restoredProfiles=Core.normalizeMoneyProfiles({US:{country:"US",birth:""}}, {country:"US"});
  const restoredCountrySettings=Core.settingsForCountry(restoredProfiles,"US");
  const currentProfiles=Core.normalizeMoneyProfiles({JP:{country:"JP",birth:"1968-11-13"},US:{country:"US",birth:"1975-05-06"}}, null);
  const currentCountrySettings=Core.settingsForCountry(currentProfiles,"US");
  const restoredBirth=Core.validateDateString(restoredCountrySettings.birth)
    ? restoredCountrySettings.birth
    : (Core.validateDateString(currentCountrySettings.birth) ? currentCountrySettings.birth : "");
  assert.equal(restoredBirth,"1975-05-06");
  assert.notEqual(restoredBirth,"1968-11-13");
});

test("生年月日を残せば復元したNISA区間110000円が自動計算される",()=>{
  const restored=Core.normalizeBackup({settings:{country:"JP",nisaMonthly:45000,lp:{
    tsumitateSchedule:[{fromAge:57,toAge:65,funds:[{name:"全世界",amount:40000},{name:"S&P500",amount:40000},{name:"たわら8",amount:20000}]}],
    growthSchedule:[{fromAge:57,toAge:65,funds:[{name:"トヨタ",amount:5000},{name:"AI",amount:5000}]}]
  }},tx:[]});
  const profiles=restored.moneyProfiles||Core.normalizeMoneyProfiles(null,restored.settings);
  profiles.JP=Core.normalizeSettings(Object.assign({},Core.settingsForCountry(profiles,"JP"),{birth:"1968-11-13"}));
  const s=Core.settingsForCountry(profiles,"JP");
  assert.equal(Core.nisaPlannedOn(s,"2026-08-11"),110000);
});
