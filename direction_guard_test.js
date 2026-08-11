const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");

test("ライフプランから家計簿へNISAを逆輸入しない",()=>{
  assert.doesNotMatch(html,/readLifePlanBridge/);
  assert.doesNotMatch(html,/applyLifePlanBridge/);
  assert.doesNotMatch(html,/lpbridge=/);
  assert.doesNotMatch(html,/ライフプラン連携/);
});
