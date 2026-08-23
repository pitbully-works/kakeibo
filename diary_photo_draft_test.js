const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");

test("日記写真を選んだだけではstate.diary本文を直接変更しない",()=>{
  const start=src.indexOf('$("diaryPhotoInput").addEventListener("change"');
  const block=src.slice(start,start+1200);
  assert.ok(start>=0,"日記写真のchange処理が無い");
  assert.doesNotMatch(block,/cur\.text\s*=\s*keepText/);
  assert.doesNotMatch(block,/state\.diary\[[^\]]+\]\.text\s*=/);
});

test("写真選択後も入力中本文は画面へ戻す",()=>{
  const start=src.indexOf('$("diaryPhotoInput").addEventListener("change"');
  const block=src.slice(start,start+1200);
  assert.match(block,/const keepText=tEl\?tEl\.value:""/);
  assert.match(block,/if\(t2\) t2\.value=keepText/);
});
