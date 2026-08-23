const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");

function loadBlock(){
  const p=src.indexOf("function load(){");
  assert.ok(p>=0,"load が見つからない");
  const e=src.indexOf("function syncMoneyProfile",p);
  assert.ok(e>p,"load の終端が見つからない");
  return src.slice(p,e);
}

test("旧保存でpersonalProfilesが空オブジェクトでもtop-level個人記録をJPへ救出する",()=>{
  const b=loadBlock();
  assert.match(b,/const hasPersonalProfile=Core\.SUPPORTED_COUNTRIES\.some\(c=>Object\.prototype\.hasOwnProperty\.call\(personalProfiles,c\)\)/);
  assert.match(b,/if\(!hasPersonalProfile\) personalProfiles\.JP=normalizePersonalData\(\{health:s\.health,diary:s\.diary,plans:s\.plans,pulse:s\.pulse\}\)/);
});

test("壊れたpersonalProfiles配列でも旧top-level個人記録を救出できる判定になっている",()=>{
  const b=loadBlock();
  assert.doesNotMatch(b,/if\(!s\.personalProfiles \|\| typeof s\.personalProfiles!=="object"\)/);
  assert.match(b,/let personalProfiles=normalizePersonalProfiles\(s\.personalProfiles\)/);
});

test("既存の国別personalProfilesがある場合はtop-levelで上書きしない",()=>{
  const b=loadBlock();
  const check=b.indexOf("const hasPersonalProfile=");
  const rescue=b.indexOf("if(!hasPersonalProfile) personalProfiles.JP=");
  assert.ok(check>=0 && rescue>check,"既存プロファイル確認後にだけ救出する必要がある");
});
