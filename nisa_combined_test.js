const test=require("node:test");
const assert=require("node:assert/strict");
const Core=require("./core.js");

test("NISAの毎月額はつみたて＋成長投資枠の積立を合計する",()=>{
  const s={birth:"1968-11-13",lp:{
    tsumitateSchedule:[{fromAge:57.75,toAge:65,monthlyYen:100000}],
    growthSchedule:[{fromAge:57.5,toAge:65,monthlyYen:10000}]
  }};
  assert.equal(Core.nisaPlannedOn(s,"2026-08-14"),110000);
});

test("将来案内も、その日から有効なつみたて＋成長投資枠の合計を出す",()=>{
  const s={birth:"1968-11-13",lp:{
    tsumitateSchedule:[{fromAge:57.75,toAge:65,monthlyYen:100000}],
    growthSchedule:[{fromAge:57.5,toAge:65,monthlyYen:10000}]
  }};
  const next=Core.nisaUpcoming(s,"2026-08-11");
  assert.equal(next.fromAge,57.75);
  assert.equal(next.monthly,110000);
});
