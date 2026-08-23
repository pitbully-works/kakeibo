const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");

test("関数電卓履歴は現在国だけを表示する",()=>{
  assert.match(src,/sciState\.history=\(state\.calcHistory\|\|\[\]\)[\s\S]{0,180}\.filter\(h=>Core\.normalizeCountry\(h&&h\.country\)===c\)/);
});
test("関数電卓履歴の保存は他国を残し現在国をタグ付けする",()=>{
  assert.match(src,/const other=\(state\.calcHistory\|\|\[\]\)\.filter\(h=>Core\.normalizeCountry\(h&&h\.country\)!==c\)/);
  assert.match(src,/country:c/);
});
test("関数電卓履歴の削除は現在国だけを消す",()=>{
  assert.match(src,/state\.calcHistory=\(state\.calcHistory\|\|\[\]\)\.filter\(h=>Core\.normalizeCountry\(h&&h\.country\)!==c\)/);
});
test("旧関数電卓履歴はJPとして引き継ぐ",()=>{
  assert.match(src,/country:h\.country\?Core\.normalizeCountry\(h\.country\):"JP"/);
});
