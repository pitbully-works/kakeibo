const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");

test("カメラ前の退避に電卓の計算途中も含める",()=>{
  const b=src.slice(src.indexOf("function savePending()"),src.indexOf("function loadPending()"));
  assert.match(b,/calc:st\.calc\|\|null/);
});
test("写真受取でシートを作り直しても電卓状態を復元する",()=>{
  const p=src.indexOf("function ensureSheetForPhoto()"); const b=src.slice(p,p+1200);
  assert.match(b,/calc:p\.calc\|\|Core\.calcFrom\(p\.amount\|\|"", Math\.max\(decOf\(pendingCountry\),2\)\)/);
});
test("ページ再読み込み後のカメラ復帰でも電卓状態を復元する",()=>{
  const p=src.indexOf("(function restorePending()"); const b=src.slice(p,p+1200);
  assert.match(b,/calc:p\.calc\|\|Core\.calcFrom\(p\.amount\|\|"", Math\.max\(decOf\(pendingCountry\),2\)\)/);
});
test("一時保存は書いた内容そのものが読めた時だけ成功とする",()=>{
  const b=src.slice(src.indexOf("function savePending()"),src.indexOf("function loadPending()"));
  assert.match(b,/const encoded=JSON\.stringify\(light\)/);
  assert.match(b,/sessionStorage\.getItem\(PENDING_KEY\)===encoded/);
});
