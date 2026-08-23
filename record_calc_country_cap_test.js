const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");
test("記録電卓履歴の50件上限は国ごとで、他国履歴を押し出さない",()=>{
  assert.match(src,/normalizedRecordCalcHistory\.filter\(h=>h\.country===c\)\.slice\(-50\)/);
  assert.match(src,/sameCountry=allRecordCalcHistory\.filter\([\s\S]{0,120}===recCountry\)\.slice\(-50\)/);
  assert.match(src,/otherCountries=allRecordCalcHistory\.filter\([\s\S]{0,120}!==recCountry\)/);
});
