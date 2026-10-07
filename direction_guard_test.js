const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");

test("ライフプランから家計簿へNISAを逆輸入しない",()=>{
  assert.doesNotMatch(html,/readLifePlanBridge/);
  assert.doesNotMatch(html,/applyLifePlanBridge/);
  assert.doesNotMatch(html,/lpbridge=/);
  // 紹介文やリンクの存在ではなく、入力を取り込む経路を禁止する。
  assert.doesNotMatch(html,/location\.hash[\s\S]{0,100}lpbridge/);
});
