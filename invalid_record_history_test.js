const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");
test("記録の検証に失敗したとき電卓履歴を追加しない",()=>{
 const a=src.indexOf("async function saveTx()");
 const b=src.indexOf("function deleteTxWithLinkedHistory",a);
 const fn=src.slice(a,b);
 const reject=fn.indexOf("if(!safe)");
 const history=fn.indexOf("state.recordCalcHistory=otherCountries.concat(sameCountry)");
 assert.ok(reject>=0 && history>reject);
});
