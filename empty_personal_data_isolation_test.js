const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const src=fs.readFileSync("index.html","utf8");
test("空の個人記録は国ごとに独立した入れ物を返す",()=>{
 const p=src.indexOf("function emptyPersonalData()");
 const e=src.indexOf("function normalizePersonalData",p);
 const code=src.slice(p,e);
 const box={}; vm.createContext(box); vm.runInContext(code,box);
 const a=box.emptyPersonalData(), b=box.emptyPersonalData();
 a.health.x=1; a.diary.x=1; a.plans.x=[]; a.pulse.push(1);
 assert.equal(b.health.x,undefined);
 assert.equal(b.diary.x,undefined);
 assert.equal(b.plans.x,undefined);
 assert.equal(b.pulse.length,0);
});
