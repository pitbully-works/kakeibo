/* =========================================================================
   かけいぼ ― 計算コアの自動テスト
   実行： node --test        （追加インストール不要・Node 18以降）
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");

const YM = "2026-07";
const D = (n) => `${YM}-${String(n).padStart(2, "0")}`;

/* 監査で指定された基準ケース：
   手取り290,000（記録した通常給与）／固定費98,000／貯金40,000／NISA33,000 */
const BASE = {
  fixed: { rent: 60000, power: 12000, gas: 6000, water: 4000, comm: 8000, subs: 3000, insure: 5000, fixother: 0 },
  savingsTarget: 40000,
  nisaMonthly: 33000,
  currency: "JPY",
};
const fixedSum = Object.values(BASE.fixed).reduce((a, b) => a + b, 0);

const exp = (amount, cat, day = 5) => ({ id: `e${amount}${cat}${day}`, type: "expense", amount, cat, date: D(day) });
const inc = (amount, cat, day = 25) => ({ id: `i${amount}${cat}${day}`, type: "income", amount, cat, date: D(day) });
/* 給与は「記録」だけが入力口。基準ケースの給与記録。 */
const SALARY = inc(290000, "salary", 25);

/* ---------- 前提：固定費の合計が監査条件どおり ---------- */
test("設定の固定費合計が98,000であること（テスト前提の確認）", () => {
  assert.equal(fixedSum, 98000);
});

/* ---------- 1. 正式な計算式（NISAを必ず差し引く） ---------- */
test("支出0 → 使える額は119,000（NISA33,000が反映される）", () => {
  const c = Core.computeMonth(BASE, [SALARY], YM);
  assert.equal(c.incomeTotal, 290000);
  assert.equal(c.fixedTotal, 98000);
  assert.equal(c.setAside, 73000);
  assert.equal(c.variableSpend, 0);
  assert.equal(c.available, 119000);
});

test("変動支出20,000 → 使える額は99,000", () => {
  const c = Core.computeMonth(BASE, [SALARY, exp(20000, "food")], YM);
  assert.equal(c.variableSpend, 20000);
  assert.equal(c.available, 99000);
});

test("支出20,000のまま臨時収入50,000を追加 → 使える額は149,000", () => {
  const c = Core.computeMonth(BASE, [SALARY, exp(20000, "food"), inc(50000, "bonus")], YM);
  assert.equal(c.incomeExtra, 50000);
  assert.equal(c.incomeTotal, 340000);
  assert.equal(c.variableSpend, 20000);
  assert.equal(c.available, 149000);
});

test("正式な計算式そのものが恒等式として成立する", () => {
  const txs = [SALARY, exp(20000, "food"), exp(3000, "eatout"), inc(50000, "bonus"), exp(11500, "power")];
  const c = Core.computeMonth(BASE, txs, YM);
  const formula =
    c.incomeRegular + c.incomeExtra - c.fixedTotal - c.savingsPlanned - c.nisaPlanned - c.variableSpend;
  assert.equal(c.available, formula);
});

/* ---------- 2. ホーム・まとめ・連携データの定義が一致 ---------- */
test("ホームとまとめの残額が完全一致する（同じcomputeMonthを読む）", () => {
  const txs = [SALARY, exp(20000, "food"), inc(50000, "bonus"), exp(9800, "power")];
  const c = Core.computeMonth(BASE, txs, YM);

  // ホームの主役
  const home = c.available;
  // まとめの「のこり」＝ 収入 － 支出 － 先取り
  const summary = c.incomeTotal - c.spendTotal - c.setAside;

  assert.equal(home, summary);
  assert.equal(c.spendTotal, c.fixedTotal + c.variableSpend);
});

test("連携JSONの金額が画面の値と一致する", () => {
  const txs = [exp(20000, "food"), inc(50000, "bonus"), exp(9800, "power"), inc(280000, "salary")];
  const c = Core.computeMonth(BASE, txs, YM);
  const j = Core.buildSnapshot(BASE, txs, YM);

  assert.equal(j.income_regular, c.incomeRegular);
  assert.equal(j.income_extra, c.incomeExtra);
  assert.equal(j.income_actual_total, c.incomeTotal);
  assert.equal(j.income_net, c.incomeTotal);
  assert.equal(j.fixed_cost, c.fixedTotal);
  assert.equal(j.fixed_cost_planned, c.fixedPlanned);
  assert.equal(j.fixed_cost_actual, c.fixedActual);
  assert.equal(j.variable_spend, c.variableSpend);
  assert.equal(j.spend_total, c.spendTotal);
  assert.equal(j.planned_set_aside, c.setAside);
  assert.equal(j.available_to_spend, c.available);
  // JSON内部でも恒等式が成立する
  assert.equal(
    j.available_to_spend,
    j.income_actual_total - j.fixed_cost - j.planned_set_aside - j.variable_spend
  );
});

/* ---------- 3. 固定費の二重計上を防ぐ ---------- */
test("固定費を手動記録しても二重計上されない（予定額を実績で置き換える）", () => {
  const before = Core.computeMonth(BASE, [SALARY], YM);
  // 電気の予定は12,000。実績12,000を記録しても合計は変わらない
  const same = Core.computeMonth(BASE, [SALARY, exp(12000, "power")], YM);
  assert.equal(same.fixedTotal, before.fixedTotal);
  assert.equal(same.available, before.available);
  assert.equal(same.variableSpend, 0, "固定費カテゴリは変動支出に混ぜない");
});

test("固定費の実績が予定と違えば、実績のぶんだけ差が出る", () => {
  const c = Core.computeMonth(BASE, [SALARY, exp(15000, "power")], YM); // 予定12,000 → 実績15,000
  assert.equal(c.fixedTotal, 98000 + 3000);
  assert.equal(c.available, 119000 - 3000);
  const power = c.fixedDetail.find((d) => d.key === "power");
  assert.equal(power.planned, 12000);
  assert.equal(power.actual, 15000);
  assert.equal(power.basis, "actual");
});

test("同じ固定費項目を複数回記録したら合算して1つの実績になる", () => {
  const c = Core.computeMonth(BASE, [SALARY, exp(7000, "water", 3), exp(1000, "water", 20)], YM);
  const water = c.fixedDetail.find((d) => d.key === "water");
  assert.equal(water.actual, 8000);
  assert.equal(water.amount, 8000);
  assert.equal(c.fixedTotal, 98000 - 4000 + 8000);
});

test("固定費を記録していない項目は予定額のまま扱われる", () => {
  const c = Core.computeMonth(BASE, [SALARY, exp(15000, "power")], YM);
  const rent = c.fixedDetail.find((d) => d.key === "rent");
  assert.equal(rent.basis, "planned");
  assert.equal(rent.amount, 60000);
});

/* ---------- 4. 給与の入力口はひとつだけ ---------- */
test("給与が二重計上されない（入力口は記録の収入ひとつだけ）", () => {
  const c = Core.computeMonth(BASE, [SALARY], YM);
  assert.equal(c.incomeRegular, 290000);
  assert.equal(c.incomeRegularRecorded, true);
  assert.equal(c.incomeTotal, 290000);
  assert.equal(c.available, 119000);
  assert.equal("incomeNet" in c.settings, false, "設定側に手取り収入を持たない");
});

test("設定に手取り収入が残っていても、収入には一切足されない", () => {
  const legacy = Object.assign({ incomeNet: 290000 }, BASE);
  const c = Core.computeMonth(legacy, [SALARY], YM);
  assert.equal(c.incomeTotal, 290000, "設定額と記録が足し算されない");
  assert.equal(c.available, 119000);
});

test("給与を記録していない月は収入0で、使えるお金を出さない", () => {
  const c = Core.computeMonth(BASE, [exp(3000, "food")], YM);
  assert.equal(c.incomeRegular, 0);
  assert.equal(c.incomeRegularRecorded, false);
  assert.equal(c.hasIncome, false, "収入未記録のうちはホームに使えるお金を出さない");
});

test("給与を複数回に分けて記録したら合算される", () => {
  const c = Core.computeMonth(BASE, [inc(200000, "salary", 25), inc(90000, "salary", 28)], YM);
  assert.equal(c.incomeRegular, 290000);
  assert.equal(c.available, 119000);
});

test("通常給与と臨時収入が区別される", () => {
  const c = Core.computeMonth(BASE, [SALARY, inc(50000, "bonus"), inc(10000, "gift")], YM);
  assert.equal(c.incomeRegular, 290000);
  assert.equal(c.incomeExtra, 60000);
  assert.equal(c.incomeTotal, 350000);
  assert.equal(c.available, 119000 + 60000);
});

/* ---------- 5・6. 連携JSONの構造 ---------- */
test("臨時収入が income に反映され、通常／臨時／合計が分かれている", () => {
  const j = Core.buildSnapshot(BASE, [SALARY, inc(50000, "bonus")], YM);
  assert.equal(j.income_regular, 290000);
  assert.equal(j.income_extra, 50000);
  assert.equal(j.income_actual_total, 340000);
  assert.equal(j.income_net, 340000, "旧キーも実収入合計を指す");
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
  assert.equal(j.schema_version, "2.1");
});

test("固定費は予定・実績・採用値が項目別に出力される", () => {
  const j = Core.buildSnapshot(BASE, [SALARY, exp(15000, "power")], YM);
  const power = j.fixed_cost_items.find((i) => i.key === "power");
  assert.equal(power.planned, 12000);
  assert.equal(power.actual, 15000);
  assert.equal(power.applied, 15000);
  assert.equal(power.basis, "actual");
});

/* ---------- 月の切り分け・堅牢性 ---------- */
test("先月の記録は当月の計算に混ざらない", () => {
  const last = { id: "x", type: "expense", amount: 99999, cat: "food", date: "2026-06-30" };
  const c = Core.computeMonth(BASE, [SALARY, last], YM);
  assert.equal(c.variableSpend, 0);
  assert.equal(c.available, 119000);
});

test("旧データ（固定費が1つの合計欄）は、その他固定費へ移行される", () => {
  const old = { incomeNet: 290000, fixedCost: 98000, savingsTarget: 40000, nisaMonthly: 33000 };
  const c = Core.computeMonth(old, [SALARY], YM);
  assert.equal(c.fixedTotal, 98000);
  assert.equal(c.available, 119000);
  assert.equal(c.fixedDetail.find((d) => d.key === "fixother").planned, 98000);
});

test("未設定・不正値でも落ちず、0として扱う", () => {
  const c = Core.computeMonth({}, [{ type: "expense", amount: "abc", cat: "food", date: D(1) }], YM);
  assert.equal(c.incomeTotal, 0);
  assert.equal(c.hasIncome, false);
  assert.equal(c.variableSpend, 0);
  assert.equal(c.available, 0);
});

test("今週つかった額は記録した支出だけを数える", () => {
  const txs = [exp(1000, "food", 20), exp(2000, "power", 21), exp(4000, "food", 28)];
  assert.equal(Core.weekSpent(txs, D(20), D(26)), 3000);
});
