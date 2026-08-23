const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"), path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");

test("レシート画面の案内文4か所は日英を持つ",()=>{
  assert.match(src,/ocrNote=L\("枠を合計に合わせて、読み取りボタンを押してください","Move the box over the total, then tap Read"\)/);
  assert.match(src,/ocrNote=L\("金額を入れました。内容を確かめて「記録する」を押してください","Amount entered\. Check the details, then tap Record"\)/);
  assert.match(src,/ocrNote=L\("金額を入れてください","Enter the amount"\)/);
  assert.match(src,/ocrNote:L\("カメラから戻りました。もう一度「レシートを撮る」を押してください","Returned from the camera\. Tap Take receipt photo again"\)/);
});

test("ocrNoteへ日本語を直接代入しない",()=>{
  assert.doesNotMatch(src,/ocrNote\s*[=:]\s*["`][^"`]*(?:金額|枠|カメラ|レシート)[^"`]*["`]/);
});
