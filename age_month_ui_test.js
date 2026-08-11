const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");

test("年齢入力は歳とヶ月の2欄に統一する",()=>{
  assert.match(html,/function ageInputHtml/);
  assert.match(html,/id="\$\{id\}-month"/);
  assert.match(html,/ヶ月/);
  assert.match(html,/ageValueFromFields/);
});
test("NISA・iDeCo・保険・民間年金・一括投資が歳月入力を使う",()=>{
  for(const id of ["lp-ts","lp-gs","lp-lm-age","lp-id-start","lp-id-end","lp-id-pstart","lp-in-from","lp-in-to","lp-in-cov","lp-p-cf","lp-p-ct","lp-p-pf","lp-p-pt"]){
    assert.match(html,new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  }
  assert.match(html,/ageInputHtml\(`lp-in-from-/);
  assert.match(html,/ageInputHtml\(`lp-p-cf-/);
});
test("内部保存は月数を12で割った従来互換の年齢値に戻す",()=>{
  assert.match(html,/return \(y\*12\+m\)\/12;/);
});
