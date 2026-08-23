const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");

test("OCRで金額確定時に電卓状態も同額へ同期する",()=>{
  const p=src.indexOf("st.amount=Core.minorToMajorText(ranked[0].amount, sheetDec());");
  const block=src.slice(p,p+500);
  assert.ok(p>=0);
  assert.match(block,/st\.calc=Core\.calcFrom\(st\.amount, sheetCalcDec\(\)\)/);
});
test("OCR候補タップ時も電卓状態を同額へ同期する",()=>{
  const p=src.indexOf("sheetState.amount=Core.minorToMajorText(pick.dataset.pick, sheetDec());");
  const block=src.slice(p,p+400);
  assert.ok(p>=0);
  assert.match(block,/sheetState\.calc=Core\.calcFrom\(sheetState\.amount, sheetCalcDec\(\)\)/);
});
test("レシート撮影画面に読み取り精度の説明がある",()=>{
  assert.match(src,/読み取り精度は、暗さ・影・傾き・ピンぼけ・文字の小ささで下がります/);
  assert.match(src,/Reading accuracy drops with low light/);
});
