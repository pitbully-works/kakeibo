const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");

test("毎月固定の繰越確認は日英両方を持つ",()=>{
  const start=src.indexOf("function carryRecurring()");
  const block=src.slice(start,start+2600);
  assert.match(block,/const ok=confirm\(L\(/);
  assert.match(block,/Add last month's/);
  assert.match(block,/Total \$\{yen\(plan\.total\)\}/);
});

test("毎月固定の繰越確認を日本語固定に戻さない",()=>{
  const start=src.indexOf("function carryRecurring()");
  const block=src.slice(start,start+2600);
  assert.doesNotMatch(block,/const ok=confirm\(\s*`先月/);
});
