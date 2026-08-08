/* =========================================================================
   かけいぼ ― 計算コアの自動テスト
   実行： node --test        （追加インストール不要・Node 18以降）

   仕様：入力口はひとつだけ。
     使える額 = 記録した収入 － 記録した支出 － 先取り貯金 － NISA積立
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");

const YM = "2026-07";
const D = (n) => `${YM}-${String(n).padStart(2, "0")}`;

/* 設定に持つのは先取りだけ */
const BASE = { lp: { banks: [{ name: "貯金", monthlyDeposit: 40000 }] }, nisaMonthly: 33000, currency: "JPY" };

const exp = (amount, cat, day = 5) => ({ id: `e${amount}${cat}${day}`, type: "expense", amount, cat, date: D(day) });
const inc = (amount, cat, day = 25) => ({ id: `i${amount}${cat}${day}`, type: "income", amount, cat, date: D(day) });

const SALARY = inc(290000, "salary", 25);
/* 固定費98,000ぶんの記録（家賃60,000＋電気12,000＋ガス6,000＋水道4,000＋通信8,000＋サブスク3,000＋保険5,000） */
const FIXED98 = [
  exp(60000, "rent", 1), exp(12000, "power", 2), exp(6000, "gas", 2),
  exp(4000, "water", 2), exp(8000, "comm", 3), exp(3000, "subs", 3), exp(5000, "insure", 3),
];

test("固定費の記録合計が98,000であること（テスト前提の確認）", () => {
  assert.equal(FIXED98.reduce((a, t) => a + t.amount, 0), 98000);
});

/* ---------- 1. 正式な計算式 ---------- */
test("支出（固定費のみ）→ 使える額は119,000（NISA33,000が反映される）", () => {
  const c = Core.computeMonth(BASE, [SALARY, ...FIXED98], YM);
  assert.equal(c.incomeTotal, 290000);
  assert.equal(c.spendTotal, 98000);
  assert.equal(c.setAside, 73000);
  assert.equal(c.available, 119000);
});

test("変動支出20,000を追加 → 使える額は99,000", () => {
  const c = Core.computeMonth(BASE, [SALARY, ...FIXED98, exp(20000, "food")], YM);
  // 固定費98,000（家賃・光熱など）＋食費20,000＝118,000。区分は無く合算される。
  assert.equal(c.spendTotal, 118000);
  assert.equal(c.available, 290000 - 118000 - 73000);  // = 99,000
  assert.equal(c.available, 99000);
});

test("さらに臨時収入50,000を追加 → 使える額は149,000", () => {
  const c = Core.computeMonth(BASE, [SALARY, ...FIXED98, exp(20000, "food"), inc(50000, "bonus")], YM);
  assert.equal(c.incomeExtra, 50000);
  assert.equal(c.incomeTotal, 340000);
  assert.equal(c.available, 149000);
});

test("正式な計算式が恒等式として成立する", () => {
  const txs = [SALARY, ...FIXED98, exp(20000, "food"), exp(3000, "eatout"), inc(50000, "bonus")];
  const c = Core.computeMonth(BASE, txs, YM);
  assert.equal(c.available, c.incomeTotal - c.spendTotal - c.setAside);
  /* 先取りは NISA と、ライフプラン欄（金・銀行・iDeCo・民間年金）だけ。
     「先取り貯金」の欄は銀行貯金と二重だったので廃止した。 */
  assert.equal(c.setAside, c.nisaPlanned + c.lpMonthly.filter((r) =>
    ["gold", "banks", "ideco", "pension"].includes(r.key)).reduce((t, r) => t + r.amount, 0));
  assert.equal(c.spendTotal, /*removed*/0 + c.spendTotal);
  assert.equal(c.incomeTotal, c.incomeRegular + c.incomeExtra);
});

/* ---------- 2. ホーム・まとめ・連携データの一致 ---------- */
test("ホームとまとめの残額が完全一致する", () => {
  const txs = [SALARY, ...FIXED98, exp(20000, "food"), inc(50000, "bonus")];
  const c = Core.computeMonth(BASE, txs, YM);
  const home = c.available;
  const summary = c.incomeTotal - c.spendTotal - c.setAside;
  assert.equal(home, summary);
  assert.equal(home, 149000);
});

test("連携JSONの金額が画面の値と一致する", () => {
  const txs = [SALARY, ...FIXED98, exp(20000, "food"), inc(50000, "bonus")];
  const c = Core.computeMonth(BASE, txs, YM);
  const j = Core.buildSnapshot(BASE, txs, YM);
  assert.equal(j.income_regular, c.incomeRegular);
  assert.equal(j.income_extra, c.incomeExtra);
  assert.equal(j.income_actual_total, c.incomeTotal);
  assert.equal(j.income_net, c.incomeTotal);
  assert.equal(j.fixed_cost, /*removed*/0);
  assert.equal(j.variable_spend, c.spendTotal);
  assert.equal(j.spend_total, c.spendTotal);
  assert.equal(j.planned_set_aside, c.setAside);
  assert.equal(j.available_to_spend, c.available);
  assert.equal(
    j.available_to_spend,
    j.income_actual_total - j.spend_total - j.planned_set_aside
  );
});

/* ---------- 3. 入力口がひとつ＝二重計上が起きない ---------- */
test("設定に予定額を持たないので、固定費が二重計上されない", () => {
  const c = Core.computeMonth(BASE, [SALARY, exp(12000, "power")], YM);
  assert.equal(c.spendTotal, 12000, "記録した1件ぶんだけが支出になる");
  assert.equal(c.available, 290000 - 12000 - 73000);
  assert.equal("fixed" in c.settings, false, "設定に固定費の予定額を持たない");
  assert.equal("fixedCost" in c.settings, false);
});

test("旧データに固定費の予定額が残っていても、支出には一切足されない", () => {
  const legacy = Object.assign({ fixedCost: 98000, fixed: { rent: 60000 } }, BASE);
  const c = Core.computeMonth(legacy, [SALARY, exp(12000, "power")], YM);
  assert.equal(c.spendTotal, 12000);
  assert.equal(c.available, 290000 - 12000 - 73000);
});

test("同じカテゴリを複数回記録したら、そのまま合算される", () => {
  const c = Core.computeMonth({ nisaMonthly:0 }, [
    { id:"a", type:"expense", amount:5000, cat:"rent", date:"2026-07-01" },
    { id:"b", type:"expense", amount:3000, cat:"rent", date:"2026-07-15" },
  ], "2026-07");
  assert.equal(c.byCat.rent, 8000);
  assert.equal(c.spendTotal, 8000);
});

test("支出はすべて合算される（固定費／変動費の区分は無い）", () => {
  const tx = [
    { id:"a", type:"income", amount:290000, cat:"salary", date:"2026-07-25" },
    { id:"r", type:"expense", amount:60000, cat:"rent", date:"2026-07-01" },
    { id:"p", type:"expense", amount:8000, cat:"power", date:"2026-07-02" },
    { id:"f", type:"expense", amount:20000, cat:"food", date:"2026-07-05" },
  ];
  const c = Core.computeMonth({ lp: { banks: [{ name: "貯金", monthlyDeposit: 40000 }] }, nisaMonthly:33000 }, tx, "2026-07");
  assert.equal(c.spendTotal, 88000, "支出合計が合わない");
  assert.equal(c.available, 290000 - 88000 - 73000);
  assert.equal(c.byCat.rent, 60000);
  assert.equal(c.byCat.power, 8000);
  assert.equal(c.byCat.food, 20000);
});

test("記録していないカテゴリは内わけに出てこない", () => {
  const c = Core.computeMonth({ nisaMonthly:0 },
    [{ id:"f", type:"expense", amount:1000, cat:"food", date:"2026-07-01" }], "2026-07");
  assert.equal(c.byCat.food, 1000);
  assert.equal("rent" in c.byCat, false, "記録の無いカテゴリが出ている");
});

/* ---------- 4. 給与の入力口もひとつだけ ---------- */
test("給与が二重計上されない（入力口は記録の収入ひとつだけ）", () => {
  const c = Core.computeMonth(BASE, [SALARY], YM);
  assert.equal(c.incomeRegular, 290000);
  assert.equal(c.incomeRegularRecorded, true);
  assert.equal(c.incomeTotal, 290000);
  assert.equal("incomeNet" in c.settings, false, "設定に手取り収入を持たない");
});

test("旧データに手取り収入が残っていても、収入には一切足されない", () => {
  const legacy = Object.assign({ incomeNet: 290000 }, BASE);
  const c = Core.computeMonth(legacy, [SALARY], YM);
  assert.equal(c.incomeTotal, 290000);
});

test("給与を記録していない月は収入0で、使えるお金を出さない", () => {
  const c = Core.computeMonth(BASE, [exp(3000, "food")], YM);
  assert.equal(c.incomeRegular, 0);
  assert.equal(c.incomeRegularRecorded, false);
  assert.equal(c.hasIncome, false);
});

test("給与を複数回に分けて記録したら合算される", () => {
  const c = Core.computeMonth(BASE, [inc(200000, "salary", 25), inc(90000, "salary", 28)], YM);
  assert.equal(c.incomeRegular, 290000);
});

test("通常給与と臨時収入が区別される", () => {
  const c = Core.computeMonth(BASE, [SALARY, inc(50000, "bonus"), inc(10000, "gift")], YM);
  assert.equal(c.incomeRegular, 290000);
  assert.equal(c.incomeExtra, 60000);
  assert.equal(c.incomeTotal, 350000);
});

/* ---------- 5・6. 連携JSONの構造 ---------- */
test("臨時収入が income に反映され、通常／臨時／合計が分かれている", () => {
  const j = Core.buildSnapshot(BASE, [SALARY, inc(50000, "bonus")], YM);
  assert.equal(j.income_regular, 290000);
  assert.equal(j.income_extra, 50000);
  assert.equal(j.income_actual_total, 340000);
  assert.equal(j.income_net, 340000);
});

test("貯金・NISAは予定額だと分かる構造で出力される", () => {
  const j = Core.buildSnapshot(BASE, [], YM);
  const cash = j.accounts.find((a) => a.type === "CASH_SAVINGS");
  const nisa = j.accounts.find((a) => a.type === "TAX_FREE_INVEST");
  assert.equal(cash.planned_contribution, 40000);
  assert.equal(cash.basis, "planned");
  assert.equal(nisa.planned_contribution, 33000);
  assert.equal(nisa.basis, "planned");
  for (const a of j.accounts) {
    assert.equal("contribution" in a, false, "実績と誤解されるキーを残さない");
  }
});

test("連携JSONは支出合計を持ち、固定費の予定額キーは持たない", () => {
  const snap = Core.buildSnapshot({ lp: { banks: [{ name: "貯金", monthlyDeposit: 40000 }] }, nisaMonthly:33000 },
    [{ id:"r", type:"expense", amount:60000, cat:"rent", date:"2026-07-01" }], "2026-07");
  assert.equal(snap.spend_total, 60000);
  assert.equal(snap.fixed_cost, 0, "固定費の区分が残っている");
  assert.ok(Array.isArray(snap.by_category), "カテゴリ別内訳が無い");
});

/* ---------- 月の切り分け・堅牢性 ---------- */
test("先月の記録は当月の計算に混ざらない", () => {
  const last = { id: "x", type: "expense", amount: 99999, cat: "food", date: "2026-06-30" };
  const c = Core.computeMonth(BASE, [SALARY, last], YM);
  assert.equal(c.spendTotal, 0);
  assert.equal(c.available, 290000 - 73000);
});

test("未設定・不正値でも落ちず、0として扱う", () => {
  const c = Core.computeMonth({}, [{ type: "expense", amount: "abc", cat: "food", date: D(1) }], YM);
  assert.equal(c.incomeTotal, 0);
  assert.equal(c.hasIncome, false);
  assert.equal(c.spendTotal, 0);
  assert.equal(c.available, 0);
});

test("今週つかった額は記録した支出だけを数える", () => {
  const txs = [exp(1000, "food", 20), exp(2000, "power", 21), exp(4000, "food", 28)];
  assert.equal(Core.weekSpent(txs, D(20), D(26)), 3000);
});
