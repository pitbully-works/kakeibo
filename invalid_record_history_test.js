const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");

test("記録の検証に失敗したとき電卓履歴を追加しない",()=>{
  const a=src.indexOf("async function saveTx()");
  const b=src.indexOf("function deleteTxWithLinkedHistory",a);
  const fn=src.slice(a,b);

  const validate=fn.indexOf("const safe=Core.normalizeTransaction(rec)");
  const reject=fn.indexOf("if(!safe)");
  const historyIf=fn.indexOf("if(calcHistCandidate){");
  const historyWrite=fn.indexOf("state.recordCalcHistory=otherCountries.concat(sameCountry)");

  assert.ok(validate>=0 && reject>validate,"記録検証処理が見つからない");
  assert.ok(historyIf>reject,"履歴追加ブロックは検証失敗判定の後でなければならない");
  assert.ok(historyWrite>historyIf,"履歴保存処理が見つからない");

  /* if(false && calcHistCandidate) のように履歴追加そのものを殺しても
     位置関係だけでは検出できないため、条件が有効な形で残っていることも守る。 */
  assert.doesNotMatch(fn,/if\s*\(\s*false\s*&&\s*calcHistCandidate\s*\)/);
  assert.match(fn,/if\s*\(\s*calcHistCandidate\s*\)\s*\{/);
});
