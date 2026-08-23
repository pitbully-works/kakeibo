const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");

test("記録電卓履歴は表示対象の国で絞る",()=>{
  const start=src.indexOf("function recordCalcHistoryHtml()");
  const block=src.slice(start,start+1800);
  assert.match(block,/let historyCountry=curCountry\(\)/);
  assert.match(block,/sheetState && sheetState\.mode==="edit"/);
  assert.match(block,/historyCountry=txCountryOf\(tx\)/);
  assert.match(block,/filter\(h=>Core\.normalizeCountry\(h&&h\.country\)===historyCountry\)/);
});

test("編集時は現在国ではなく記録自身の国を使う",()=>{
  const start=src.indexOf("function recordCalcHistoryHtml()");
  const block=src.slice(start,start+1800);
  const edit=block.indexOf('sheetState && sheetState.mode==="edit"');
  const own=block.indexOf("historyCountry=txCountryOf(tx)");
  const filter=block.indexOf(".filter(");
  assert.ok(edit>=0 && own>edit && filter>own);
});

test("編集で追加する計算履歴の国は記録本体の国に合わせる",()=>{
  const start=src.indexOf("async function saveTx()");
  const block=src.slice(start,start+4200);
  const rec=block.indexOf("const recCountry = editIdx>=0 ? txCountryOf(state.tx[editIdx]) : curCountry();");
  const hist=block.indexOf("calcHistCandidate.country=recCountry;");
  const append=block.indexOf("state.recordCalcHistory=");
  assert.ok(rec>=0 && hist>rec && append>hist);
});
