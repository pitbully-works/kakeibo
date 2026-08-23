const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");

test("レシート撮影をキャンセルしても記録シートへ戻す",()=>{
  const p=src.indexOf('$("camInput").addEventListener("change"');
  const b=src.slice(p,p+700);
  assert.match(b,/else\s*\{/);
  assert.match(b,/ensureSheetForPhoto\(\)/);
  assert.match(b,/showSheet\(true\)/);
});
test("撮影キャンセル時は入力内容を消さない案内を出す",()=>{
  const p=src.indexOf('$("camInput").addEventListener("change"');
  const b=src.slice(p,p+700);
  assert.match(b,/撮影をキャンセルしました。入力内容はそのままです/);
  assert.match(b,/Photo capture cancelled\. Your entries are unchanged/);
});
