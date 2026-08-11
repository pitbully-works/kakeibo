const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");

test("未保存入力を画面移動前にflushする",()=>{
  assert.match(html,/const nav=.*flushAutoSave\(\)/s);
  assert.match(html,/const go=.*flushAutoSave\(\)/s);
  assert.match(html,/if\(a==="lp-tab"\).*flushAutoSave\(\)/s);
  assert.match(html,/if\(a==="lp-back"\).*flushAutoSave\(\)/s);
});
test("PWAを閉じる時にもflushする",()=>{
  assert.match(html,/visibilitychange[\s\S]*document\.hidden[\s\S]*flushAutoSave\(\)/);
  assert.match(html,/pagehide[\s\S]*flushAutoSave\(\)/);
});
test("350ms待機中の入力IDを保持する",()=>{
  assert.match(html,/pendingAutoSaveId=id/);
  assert.match(html,/function flushAutoSave\(\)/);
});
