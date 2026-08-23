const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");

test("カメラ前の一時保存は成功可否を返す",()=>{
  const b=src.slice(src.indexOf("function savePending()"),src.indexOf("function loadPending()"));
  assert.match(b,/return sessionStorage\.getItem\(PENDING_KEY\)!==null/);
  assert.match(b,/catch\(e\)\{ return false; \}/);
});
test("一時保存に失敗したらカメラを開かない",()=>{
  const p=src.indexOf('if(a==="shot-total")'); const b=src.slice(p,p+650);
  assert.match(b,/if\(!savePending\(\)\)/);
  assert.match(b,/レシート撮影を開始できません/);
  assert.ok(b.indexOf('if(!savePending())') < b.indexOf('$("camInput").click()'));
});
test("壊れた一時保存は破棄して復元に使わない",()=>{
  const p=src.indexOf("function loadPending()"); const b=src.slice(p,p+650);
  assert.match(b,/typeof p!=="object"/);
  assert.match(b,/catch\(e\)\{ clearPending\(\); return null; \}/);
});
