const test = require("node:test");
const assert = require("node:assert/strict");
const { bootApp } = require("./boot-app.cjs");
const Core = require("./core.js");

function restoreConfirm(country){
  const state={settings:{country},moneyProfiles:{[country]:{country}},tx:[]};
  const app=bootApp({state});
  app.run(`
    let __confirmText="";
    confirm=(s)=>{ __confirmText=String(s); return false; };
    FileReader=function(){
      const self=this;
      this.readAsText=function(f){ self.result=f.__text; if(self.onload) self.onload(); };
    };
  `);
  const backup=JSON.stringify(Core.buildBackup({settings:{country},tx:[]}));
  app.run(`onBackupPicked({__text:${JSON.stringify(backup)}})`);
  return app.run(`__confirmText`);
}

test("USのバックアップ復元確認は英語だけで表示する",()=>{
  const s=restoreConfirm("US");
  assert.match(s,/This will overwrite the current data/);
  assert.match(s,/Records to restore:/);
  assert.doesNotMatch(s,/現在|復元する記録|続けますか/);
});

test("JPのバックアップ復元確認はこれまでどおり日本語で表示する",()=>{
  const s=restoreConfirm("JP");
  assert.match(s,/現在のデータを上書きします/);
  assert.match(s,/復元する記録：/);
});
