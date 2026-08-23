const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");

function seqId(){
  let n=0;
  return () => "new-" + (++n);
}

test("同じ種類の重複IDは最初だけ残し、2件目を別IDへ振り直す", () => {
  const a = Core.lpEnsureIds({
    banks:[
      {id:"same", name:"A", balance:100},
      {id:"same", name:"B", balance:200},
      {id:"other", name:"C", balance:300},
    ]
  }, seqId());
  assert.equal(a.banks[0].id, "same");
  assert.equal(a.banks[1].id, "new-1");
  assert.equal(a.banks[2].id, "other");
  assert.equal(new Set(a.banks.map(x=>x.id)).size, 3);
});

test("ID生成器が既存IDと衝突しても一意になるまで作り直す", () => {
  let n=0;
  const gen=()=> (++n===1 ? "same" : "fresh");
  const a = Core.lpEnsureIds({
    loans:[
      {id:"same", name:"車"},
      {name:"住宅"}
    ]
  }, gen);
  assert.equal(a.loans[0].id, "same");
  assert.equal(a.loans[1].id, "fresh");
});

test("種類が違えば同じIDでも別配列なのでそのまま保つ", () => {
  const a = Core.lpEnsureIds({
    banks:[{id:"same", name:"銀行"}],
    loans:[{id:"same", name:"借入"}]
  }, seqId());
  assert.equal(a.banks[0].id, "same");
  assert.equal(a.loans[0].id, "same");
});
