const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");

test("レシート写真がある時は写真だけ外すボタンを表示する",()=>{
  const p=src.indexOf('const photoHtml = st.photo');
  const block=src.slice(p,p+2200);
  assert.match(block,/data-act="rm-photo"/);
  assert.match(block,/写真だけ外す/);
  assert.match(block,/Remove photo/);
});

test("写真だけ外す操作は記録金額を消さず写真関連だけを初期化する",()=>{
  const p=src.indexOf('if(a==="rm-photo")');
  const block=src.slice(p,p+500);
  assert.match(block,/readSheetInputs\(\)/);
  assert.match(block,/releaseOcrImage\(sheetState\)/);
  assert.match(block,/sheetState\.photo=null/);
  assert.match(block,/sheetState\.ocrChoices=null/);
  assert.doesNotMatch(block,/sheetState\.amount\s*=/);
});
