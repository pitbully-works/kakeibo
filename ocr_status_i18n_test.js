const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync(require("node:path").join(__dirname,"index.html"),"utf8");

test("OCR開始時の画像調整メッセージも英語を持つ",()=>{
  const start=src.indexOf("async function readCrop()");
  const block=src.slice(start,start+9000);
  assert.match(block,/setStatus\(L\("画像を調整しています…","Adjusting the image…"\)\)/);
});

test("OCR処理のsetStatusに日本語固定文字列を残さない",()=>{
  const start=src.indexOf("async function readCrop()");
  const block=src.slice(start,start+9000);
  assert.doesNotMatch(block,/setStatus\(["`][^"`]*(?:画像|金額|確認|読)[^"`]*["`]\)/);
});
