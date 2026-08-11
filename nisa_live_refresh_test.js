const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");

test("NISA入力後に同じ画面の今月額を即時再計算する",()=>{
  assert.match(html,/data-live="nisa-head"/);
  assert.match(html,/function nisaHeadHtml/);
  assert.match(html,/if\(nh\) nh\.innerHTML=nisaHeadHtml\(state\.settings\);/);
  assert.match(html,/if\(view==="lp"\)\{ lpSave\(lpReadCurrent\(\)\); lpRefreshTotals\(\); \}/);
});
