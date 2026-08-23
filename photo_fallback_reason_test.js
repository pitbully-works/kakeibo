const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");
test("写真を外して再保存するのは容量不足のときだけ",()=>{
  const a=src.indexOf("async function saveTx()");
  const b=src.indexOf("function deleteTxWithLinkedHistory",a);
  const fn=src.slice(a,b);
  assert.match(fn,/if\(photo && isQuotaError\(lastSaveError\)\)/);
  assert.ok(fn.indexOf("if(photo && isQuotaError(lastSaveError))") < fn.indexOf("写真は容量オーバーで保存できません"));
});
