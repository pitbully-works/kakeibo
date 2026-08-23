const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");

test("カメラ起動前の退避に毎月固定ON/OFFを含める",()=>{
  const p=src.indexOf("function savePending()");
  const b=src.slice(p,p+800);
  assert.match(b,/recurring:st\.type==="expense" && st\.recurring===true/);
});
test("写真受取でシートを作り直しても毎月固定を復元する",()=>{
  const p=src.indexOf("function ensureSheetForPhoto()");
  const b=src.slice(p,p+1100);
  assert.match(b,/recurring:p\.type==="expense" && p\.recurring===true/);
});
test("ページ再読み込み後のカメラ復帰でも毎月固定を復元する",()=>{
  const p=src.indexOf("(function restorePending()");
  const b=src.slice(p,p+1100);
  assert.match(b,/recurring:p\.type==="expense" && p\.recurring===true/);
});
