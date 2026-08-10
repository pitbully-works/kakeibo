"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

function jpLegacy(){
  return {
    country:"JP", currency:"JPY", birth:"1968-11-13", cycleStart:20,
    goalName:"車", goalTarget:3000000, goalCurrent:1000000,
    lp:{
      banks:[{name:"銀行",balance:20000}],
      loans:[{name:"借入",balance:500000,monthlyPayment:70000}],
      insurancePolicies:[{name:"保険",monthlyPremium:18672}],
      privatePensionPlans:[{name:"年金",monthlyPremium:15000}],
      ideco:{monthlyYen:23000},
      gold:{monthlyYen:10000,currentGrams:1,pricePerGram:10000},
      tsumitateSchedule:[{fromAge:0,toAge:120,funds:[{name:"NISA",monthlyYen:110500}]}]
    }
  };
}

test("旧データのお金設定はJPプロファイルへ退避され、USへ複製されない", () => {
  const p=Core.normalizeMoneyProfiles(null,jpLegacy());
  assert.equal(p.JP.goalTarget,3000000);
  assert.equal(p.JP.lp.banks[0].balance,20000);
  assert.equal(p.US,undefined);
  const us=Core.settingsForCountry(p,"US","1968-11-13");
  assert.equal(us.country,"US");
  assert.equal(us.currency,"USD");
  assert.equal(us.goalTarget,0);
  assert.equal(us.lp,undefined);
  assert.equal(us.birth,"1968-11-13");
});

test("JPとUSのお金設定は別々に保持できる", () => {
  const p=Core.normalizeMoneyProfiles(null,jpLegacy());
  p.US=Core.normalizeSettings({country:"US",goalTarget:5000,lp:{banks:[{name:"US bank",balance:1200}]}});
  const jp=Core.settingsForCountry(p,"JP","1968-11-13");
  const us=Core.settingsForCountry(p,"US","1968-11-13");
  assert.equal(jp.goalTarget,3000000);
  assert.equal(jp.lp.banks[0].balance,20000);
  assert.equal(us.goalTarget,5000);
  assert.equal(us.lp.banks[0].balance,1200);
});

test("実際の画面切替でも、初回USはJPの金額を引き継がない", () => {
  const app=bootApp({state:{settings:jpLegacy(),tx:[],health:{"2026-08-10":{weight:62.5}},diary:{"2026-08-10":{text:"x"}},plans:{},pulse:[]}});
  app.run('view="settings"; render(); document.getElementById("f-country").value="US"; onCountryPicked(document.getElementById("f-country"));');
  const st=JSON.parse(app.saved());
  assert.equal(st.settings.country,"US");
  assert.equal(st.settings.currency,"USD");
  assert.equal(st.settings.goalTarget,0);
  assert.equal(st.settings.lp,undefined);
  assert.equal(st.moneyProfiles.JP.goalTarget,3000000);
  assert.equal(st.moneyProfiles.JP.lp.banks[0].balance,20000);
  assert.equal(st.settings.birth,"1968-11-13");
  assert.equal(st.health["2026-08-10"].weight,62.5);
});

test("JP→US→JPでJPのお金設定が完全に戻る", () => {
  const app=bootApp({state:{settings:jpLegacy(),tx:[]}});
  app.run('view="settings"; render(); document.getElementById("f-country").value="US"; onCountryPicked(document.getElementById("f-country"));');
  app.run('view="settings"; render(); document.getElementById("f-country").value="JP"; onCountryPicked(document.getElementById("f-country"));');
  const st=JSON.parse(app.saved());
  assert.equal(st.settings.country,"JP");
  assert.equal(st.settings.goalTarget,3000000);
  assert.equal(st.settings.lp.banks[0].balance,20000);
  assert.equal(st.settings.lp.loans[0].monthlyPayment,70000);
});

test("USで入力した金額は、JPを往復してもUSだけに残る", () => {
  const app=bootApp({state:{settings:jpLegacy(),tx:[]}});
  app.run('view="settings"; render(); document.getElementById("f-country").value="US"; onCountryPicked(document.getElementById("f-country"));');
  app.run('state.settings=Core.normalizeSettings(Object.assign({},state.settings,{goalTarget:5000,lp:{banks:[{name:"US bank",balance:1200}]}})); save();');
  app.run('view="settings"; render(); document.getElementById("f-country").value="JP"; onCountryPicked(document.getElementById("f-country"));');
  assert.equal(app.run('state.settings.goalTarget'),3000000);
  app.run('view="settings"; render(); document.getElementById("f-country").value="US"; onCountryPicked(document.getElementById("f-country"));');
  assert.equal(app.run('state.settings.goalTarget'),5000);
  assert.equal(app.run('state.settings.lp.banks[0].balance'),1200);
});

test("USで保存したお金設定は、USのまま再起動しても残る", () => {
  const app=bootApp({state:{settings:jpLegacy(),tx:[]}});
  app.run('view="settings"; render(); document.getElementById("f-country").value="US"; onCountryPicked(document.getElementById("f-country"));');
  app.run('state.settings=Core.normalizeSettings(Object.assign({},state.settings,{goalTarget:7500,lp:{banks:[{name:"US bank",balance:2400}]}})); save();');
  const saved=JSON.parse(app.saved());
  const again=bootApp({state:saved});
  assert.equal(again.run('state.settings.country'),"US");
  assert.equal(again.run('state.settings.goalTarget'),7500);
  assert.equal(again.run('state.settings.lp.banks[0].balance'),2400);
});

test("生年月日は国を切り替えても本人共通のまま", () => {
  const p={
    JP:Core.normalizeSettings({country:"JP",birth:"1960-01-01",goalTarget:100}),
    US:Core.normalizeSettings({country:"US",birth:"1970-02-02",goalTarget:200})
  };
  assert.equal(Core.settingsForCountry(p,"JP","1968-11-13").birth,"1968-11-13");
  assert.equal(Core.settingsForCountry(p,"US","1968-11-13").birth,"1968-11-13");
});

test("バックアップ→復元でもJP/US両プロファイルを保持する", () => {
  const profiles=Core.normalizeMoneyProfiles(null,jpLegacy());
  profiles.US=Core.normalizeSettings({country:"US",goalTarget:5000,lp:{banks:[{name:"US",balance:1200}]}});
  const state={settings:Core.settingsForCountry(profiles,"US","1968-11-13"),moneyProfiles:profiles,tx:[],health:{},diary:{},plans:{},pulse:[]};
  const b=Core.buildBackup(state);
  const r=Core.normalizeBackup(b);
  assert.equal(r.moneyProfiles.JP.goalTarget,3000000);
  assert.equal(r.moneyProfiles.US.goalTarget,5000);
  assert.equal(r.moneyProfiles.US.lp.banks[0].balance,1200);
});

test("USのライフプラン連携にはUSプロファイルの金額だけを使う", () => {
  const profiles=Core.normalizeMoneyProfiles(null,jpLegacy());
  /* 内部は最小単位（セント）。$1,200.00 は 120000。
     ライフプランへ渡すときは主単位へ戻すので、向こうへは 1200 が届く。 */
  profiles.US=Core.normalizeSettings({country:"US",lp:{banks:[{name:"US",balance:120000}]}});
  const us=Core.settingsForCountry(profiles,"US","1968-11-13");
  const out=Core.buildLifePlanInputs(us,"2026-08-10");
  assert.equal(out.countryCode,"US");
  assert.equal(out.baseCurrency,"USD");
  assert.equal(out.inputs.banks[0].balance,1200,"主単位へ戻して渡していない");
  assert.equal(out.amount_unit,"major","単位を明示していない");
  assert.equal(out.minor_unit_scale,100);
});
