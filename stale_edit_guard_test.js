const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");

test("編集対象が消えていたら更新処理を続けない",()=>{
  const a=src.indexOf("async function saveTx()");
  const b=src.indexOf("function deleteTxWithLinkedHistory",a);
  const fn=src.slice(a,b);
  const find=fn.indexOf('const editIdx = st.mode==="edit"');
  const guard=fn.indexOf('if(st.mode==="edit" && editIdx<0)');
  const hist=fn.indexOf("state.recordCalcHistory=otherCountries.concat(sameCountry)");
  const write=fn.indexOf("state.tx[idx]=rec");
  assert.ok(find>=0 && guard>find);
  assert.ok(hist>guard && write>guard,"存在しない編集対象へ履歴や記録を書いてはいけない");
  assert.match(fn,/元の記録が見つかりません/);
  assert.match(fn,/The original record could not be found/);
});
