const test=require("node:test");
const assert=require("node:assert/strict");
const Core=require("./core.js");

function tx(id,amount,cat,date,recurring,memo=""){
  return {id,type:"expense",amount,cat,date,recurring:!!recurring,memo};
}

test("同じカテゴリが先月2件・今月1件なら残り1件だけ繰り越す",()=>{
  const rows=[
    tx("a",5000,"insure","2026-06-05",true,"医療"),
    tx("b",12000,"insure","2026-06-20",true,"生命"),
    tx("c",6000,"insure","2026-07-05",true,"医療"),
  ];
  const p=Core.recurringCarryPlan(rows,"2026-07");
  assert.equal(p.skipped,1);
  assert.equal(p.toAdd.length,1);
  assert.equal(p.toAdd[0].cat,"insure");
  assert.equal(p.total,12000);
});

test("同じカテゴリが先月2件・今月2件なら2件とも入力済み",()=>{
  const rows=[
    tx("a",5000,"insure","2026-06-05",true),
    tx("b",12000,"insure","2026-06-20",true),
    tx("c",6000,"insure","2026-07-05",true),
    tx("d",13000,"insure","2026-07-20",true),
  ];
  const p=Core.recurringCarryPlan(rows,"2026-07");
  assert.equal(p.skipped,2);
  assert.equal(p.toAdd.length,0);
});

test("従来どおり金額が変わっても同カテゴリ1件なら二重追加しない",()=>{
  const rows=[
    tx("a",60000,"rent","2026-06-01",true),
    tx("b",65000,"rent","2026-07-01",true),
  ];
  assert.equal(Core.recurringCarryPlan(rows,"2026-07").toAdd.length,0);
});
