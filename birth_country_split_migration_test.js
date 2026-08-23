"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Core=require("./core.js");
const {bootApp}=require("./boot-app.cjs");

function profile(country,birth,goalTarget){
  return Core.normalizeSettings({country,birth,goalTarget});
}

test("v3→v4で現在国の生年月日は保持し、他国へ複製された同一生年月日だけ消す",()=>{
  const app=bootApp({state:{
    countryStorageSplitVersion:3,
    settings:profile("US","1968-11-13",5000),
    moneyProfiles:{
      JP:profile("JP","1968-11-13",3000000),
      US:profile("US","1968-11-13",5000),
      GB:profile("GB","1975-04-20",7000)
    },tx:[],health:{},diary:{},plans:{},pulse:[]
  }});
  assert.equal(app.run("state.countryStorageSplitVersion"),4);
  assert.equal(app.run("state.settings.country"),"US");
  assert.equal(app.run("state.settings.birth"),"1968-11-13","現在開いている国の生年月日を消してはいけない");
  assert.equal(app.run("state.moneyProfiles.US.birth"),"1968-11-13");
  assert.equal(app.run("state.moneyProfiles.JP.birth"),"","旧共有で複製された同じ生年月日は他国から除く");
  assert.equal(app.run("state.moneyProfiles.GB.birth"),"1975-04-20","別に入力された生年月日は保持する");
  assert.equal(app.run("state.moneyProfiles.JP.goalTarget"),3000000,"生年月日分離で他の国別金額を壊さない");
  assert.equal(app.run("state.moneyProfiles.GB.goalTarget"),7000,"別国の金額も保持する");
});

test("v3→v4で現在国に生年月日が無い場合、他国の生年月日は勝手に消さない",()=>{
  const app=bootApp({state:{
    countryStorageSplitVersion:3,
    settings:profile("CA","",9000),
    moneyProfiles:{JP:profile("JP","1960-01-01",100),CA:profile("CA","",9000)},
    tx:[],health:{},diary:{},plans:{},pulse:[]
  }});
  assert.equal(app.run("state.countryStorageSplitVersion"),4);
  assert.equal(app.run("state.settings.birth"),"");
  assert.equal(app.run("state.moneyProfiles.JP.birth"),"1960-01-01");
});

test("v4処理済み端末は既存の国別生年月日を変更しない",()=>{
  const app=bootApp({state:{
    countryStorageSplitVersion:4,
    settings:profile("JP","1960-01-01",100),
    moneyProfiles:{JP:profile("JP","1960-01-01",100),US:profile("US","1960-01-01",200)},
    tx:[],health:{},diary:{},plans:{},pulse:[]
  }});
  assert.equal(app.run("state.moneyProfiles.JP.birth"),"1960-01-01");
  assert.equal(app.run("state.moneyProfiles.US.birth"),"1960-01-01","v4以降にユーザーが同じ日付を入力した可能性まで消してはいけない");
});


test("v4処理済み端末はJPと海外の金額構成が同じでも再移行して消さない",()=>{
  const app=bootApp({state:{
    countryStorageSplitVersion:4,
    settings:profile("JP","1960-01-01",100),
    moneyProfiles:{JP:profile("JP","1960-01-01",100),US:profile("US","1970-02-02",100)},
    tx:[],health:{},diary:{},plans:{},pulse:[]
  }});
  assert.equal(app.run("state.moneyProfiles.US.goalTarget"),100,"v4済みの海外データを旧移行判定で消してはいけない");
  assert.equal(app.run("state.moneyProfiles.US.birth"),"1970-02-02");
});

test("v3→v4で現在国以外の4カ国すべてから旧共有生年月日を除去する",()=>{
  const app=bootApp({state:{
    countryStorageSplitVersion:3,
    settings:profile("GB","1980-06-15",7000),
    moneyProfiles:{
      JP:profile("JP","1980-06-15",100),
      US:profile("US","1980-06-15",200),
      GB:profile("GB","1980-06-15",7000),
      CA:profile("CA","1980-06-15",300),
      AU:profile("AU","1980-06-15",400)
    },tx:[],health:{},diary:{},plans:{},pulse:[]
  }});
  assert.equal(app.run("state.moneyProfiles.GB.birth"),"1980-06-15","現在国GBは保持する");
  for(const c of ["JP","US","CA","AU"]){
    assert.equal(app.run(`state.moneyProfiles.${c}.birth`),"",`${c}の旧共有生年月日は除去する`);
  }
  assert.equal(app.run("state.moneyProfiles.AU.goalTarget"),400,"生年月日以外のAUデータは保持する");
});
