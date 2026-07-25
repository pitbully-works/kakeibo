/* =========================================================================
   かけいぼ ― 詳細分析（分析タブ）のテスト
   -------------------------------------------------------------------------
   守りたいこと：
     ・分析の金額は、必ず computeMonth() と同じ値になる（式を二度書かない）
     ・当月・先月・過去の平均を取り違えない
     ・「今日」は引数で渡す（時計を読まないので、いつ実行しても結果が同じ）
     ・分析タブが白画面にならない
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

/* ---------- 共通の材料（固定の月。実行日に左右されない） ---------- */
const S = { savingsTarget: 40000, nisaMonthly: 33000, currency: "JPY" };
const tx = (id, type, amount, cat, date) => ({ id, type, amount, cat, date });

/* 2026-07 … 当月 ／ 2026-06 … 先月 ／ 2026-05 … 先々月 */
const TX = [
  /* 先々月（5月）: 支出 70,000 */
  tx("a1", "expense", 10000, "food", "2026-05-08"),
  tx("a2", "expense", 60000, "rent", "2026-05-01"),
  /* 先月（6月）: 収入 300,000 ／ 支出 80,000 */
  tx("b0", "income", 300000, "salary", "2026-06-25"),
  tx("b1", "expense", 20000, "food", "2026-06-10"),
  tx("b2", "expense", 60000, "rent", "2026-06-01"),
  /* 当月（7月）: 収入 300,000 ／ 支出 100,000 */
  tx("c0", "income", 300000, "salary", "2026-07-25"),
  tx("c1", "expense", 60000, "rent", "2026-07-01"),
  tx("c2", "expense", 30000, "food", "2026-07-03"),
  tx("c3", "expense", 10000, "eatout", "2026-07-04"),
];
const YM = "2026-07";

/* =========================================================================
   1. 月のものさし
   ========================================================================= */
test("月をずらす計算が年をまたいでも合う", () => {
  assert.equal(Core.shiftYm("2026-01", -1), "2025-12");
  assert.equal(Core.shiftYm("2025-12", 1), "2026-01");
  assert.equal(Core.shiftYm("2026-07", -7), "2025-12");
  assert.equal(Core.shiftYm("2026-07", 0), "2026-07");
  assert.equal(Core.shiftYm("2026-03", -15), "2024-12");
});

test("直近nか月は、古い順にならび、最後が当月になる", () => {
  assert.deepEqual(Core.recentMonths("2026-02", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(Core.recentMonths("2026-07", 1), ["2026-07"]);
});

test("月末日を正しく数える（うるう年も）", () => {
  assert.equal(Core.daysInMonth("2024-02"), 29);
  assert.equal(Core.daysInMonth("2026-02"), 28);
  assert.equal(Core.daysInMonth("2026-04"), 30);
  assert.equal(Core.daysInMonth("2026-07"), 31);
});

/* =========================================================================
   2. 推移（金額の出どころは computeMonth ただひとつ）
   ========================================================================= */
test("推移の金額は、各月の computeMonth と完全に一致する", () => {
  const trend = Core.monthlyTrend(S, TX, YM, 6);
  assert.equal(trend.length, 6);
  assert.equal(trend[trend.length - 1].ym, YM);
  for (const m of trend) {
    const c = Core.computeMonth(S, TX, m.ym);
    assert.equal(m.income, c.incomeTotal, m.ym + " の収入がずれている");
    assert.equal(m.spend, c.spendTotal, m.ym + " の支出がずれている");
    assert.equal(m.net, c.incomeTotal - c.spendTotal);
  }
});

test("記録のない月は0で、印もつかない", () => {
  const trend = Core.monthlyTrend(S, TX, YM, 6);
  const jan = trend.filter((m) => m.ym === "2026-02")[0];
  assert.equal(jan.income, 0);
  assert.equal(jan.spend, 0);
  assert.equal(jan.hasRecord, false);
  assert.equal(trend.filter((m) => m.ym === "2026-07")[0].hasRecord, true);
});

/* =========================================================================
   3. カテゴリの比較
   ========================================================================= */
test("カテゴリ集計に、ほかの月や収入は混ざらない", () => {
  const now = Core.categorySpend(TX, YM);
  assert.deepEqual(now, { rent: 60000, food: 30000, eatout: 10000 });
  assert.equal(now.salary, undefined, "収入が支出に混ざっている");
});

test("当月と先月を取り違えない", () => {
  const rows = Core.categoryCompare(TX, YM, 3);
  const food = rows.filter((r) => r.key === "food")[0];
  assert.equal(food.now, 30000, "当月");
  assert.equal(food.prev, 20000, "先月");
  assert.equal(food.diff, 10000, "先月との差");
});

test("平均は「記録のあった月」だけで割る（使いはじめの月に薄まらない）", () => {
  /* 過去3か月のうち、記録があるのは 5月と6月の2か月だけ。
     食費は 10,000 と 20,000 なので平均は 15,000。3で割ると 10,000 になる。 */
  const rows = Core.categoryCompare(TX, YM, 3);
  const food = rows.filter((r) => r.key === "food")[0];
  assert.equal(food.avg, 15000);
});

test("支出にしめる割合と、多い順のならびが合っている", () => {
  const rows = Core.categoryCompare(TX, YM, 3).filter((r) => r.now > 0);
  assert.deepEqual(rows.map((r) => r.key), ["rent", "food", "eatout"]);
  assert.equal(rows[0].share, 60);   // 60,000 / 100,000
  assert.equal(rows[1].share, 30);
  assert.equal(rows[2].share, 10);
});

test("当月に使わなくなった項目も、先月の実績として残る", () => {
  const txs = TX.concat([tx("d1", "expense", 5000, "hobby", "2026-06-15")]);
  const hobby = Core.categoryCompare(txs, YM, 3).filter((r) => r.key === "hobby")[0];
  assert.ok(hobby, "先月だけの項目が消えている");
  assert.equal(hobby.now, 0);
  assert.equal(hobby.prev, 5000);
  assert.equal(hobby.diff, -5000);
});

/* =========================================================================
   4. 曜日ぐせ
   ========================================================================= */
test("曜日別の集計が、その月の支出だけを正しい曜日に入れる", () => {
  const week = Core.weekdaySpend(TX, YM);
  assert.equal(week.length, 7);
  /* 2026-07-01 は水曜、07-03 は金曜、07-04 は土曜 */
  assert.equal(week[3].name, "水");
  assert.equal(week[3].amount, 60000);
  assert.equal(week[5].name, "金");
  assert.equal(week[5].amount, 30000);
  assert.equal(week[6].name, "土");
  assert.equal(week[6].amount, 10000);
  /* 先月・先々月の支出は入らない */
  assert.equal(week.reduce((a, w) => a + w.amount, 0), 100000);
});

test("曜日は端末のタイムゾーンに左右されない（UTCで読む）", () => {
  const d = new Date("2026-07-01T00:00:00Z");
  assert.equal(Core.WEEKDAY_NAMES[d.getUTCDay()], "水");
  assert.equal(Core.weekdaySpend(TX, YM)[d.getUTCDay()].amount, 60000);
});

/* =========================================================================
   5. つかうペース
   ========================================================================= */
test("経過日数・1日あたり・月末の予測が合っている", () => {
  const p = Core.spendPace(S, TX, YM, "2026-07-10");
  assert.equal(p.days, 31);
  assert.equal(p.elapsed, 10);
  assert.equal(p.isCurrent, true);
  assert.equal(p.spendTotal, 100000);
  assert.equal(p.perDay, 10000);                       // 100,000 ÷ 10日
  assert.equal(p.forecast, Math.round(100000 / 10 * 31));
});

test("つかってよい額は、収入から先取り（予定額）を引いた額", () => {
  const p = Core.spendPace(S, TX, YM, "2026-07-10");
  const c = Core.computeMonth(S, TX, YM);
  assert.equal(p.budget, c.incomeTotal - c.setAside);
  assert.equal(p.budget, 300000 - 73000);
  assert.equal(p.over, p.forecast - p.budget);
});

test("収入を記録していない月は、超過の判定をしない", () => {
  const noPay = TX.filter((t) => t.type !== "income");
  const p = Core.spendPace(S, noPay, YM, "2026-07-10");
  assert.equal(p.hasIncome, false);
  assert.equal(p.over, null, "収入が無いのに使いすぎと決めつけている");
});

test("つかった日・つかわなかった日を数える", () => {
  const p = Core.spendPace(S, TX, YM, "2026-07-10");
  assert.equal(p.spendDays, 3);        // 1日・3日・4日
  assert.equal(p.noSpendDays, 7);      // 10日のうち、のこり7日
  assert.equal(p.spendDays + p.noSpendDays, p.elapsed);
});

test("累計は日ごとに積み上がり、最後が当月の支出合計に一致する", () => {
  const p = Core.spendPace(S, TX, YM, "2026-07-10");
  assert.equal(p.daily.length, 10);
  assert.equal(p.daily[0].cum, 60000);
  assert.equal(p.daily[2].cum, 90000);
  assert.equal(p.daily[p.daily.length - 1].cum, p.spendTotal);
});

test("過ぎた月は、月まるごとで見る", () => {
  const p = Core.spendPace(S, TX, "2026-06", "2026-07-10");
  assert.equal(p.isCurrent, false);
  assert.equal(p.elapsed, 30);
  assert.equal(p.daily.length, 30);
  assert.equal(p.spendTotal, 80000);
});

/* =========================================================================
   6. 気づき（ことば）
   ========================================================================= */
function insightsOf(txs, today) {
  return Core.analyzeMonth(S, txs, YM, { today: today }).insights;
}

test("このままだと予算を超えるとき、注意の気づきが出る", () => {
  const list = insightsOf(TX, "2026-07-10");
  const pace = list.filter((i) => i.key === "pace")[0];
  assert.ok(pace, "ペースの気づきが無い");
  assert.equal(pace.level, "warn");
  assert.match(pace.text, /こえそうです/);
});

test("予算に収まりそうなときは、ほめる側の気づきになる", () => {
  const light = [
    tx("p0", "income", 300000, "salary", "2026-07-25"),
    tx("p1", "expense", 20000, "food", "2026-07-02"),
  ];
  const pace = insightsOf(light, "2026-07-20").filter((i) => i.key === "pace")[0];
  assert.equal(pace.level, "good");
  assert.match(pace.text, /のこりそうです/);
});

test("給料が未記録なら、まず記録をうながす", () => {
  const noPay = TX.filter((t) => t.type !== "income");
  const list = insightsOf(noPay, "2026-07-10");
  assert.equal(list[0].key, "no-income");
  assert.equal(list.filter((i) => i.key === "pace").length, 0, "収入が無いのにペースを断定している");
});

test("先月よりふえた項目・へった項目を、それぞれ拾う", () => {
  const txs = TX.concat([tx("e1", "expense", 9000, "hobby", "2026-06-15")]);
  const list = insightsOf(txs, "2026-07-10");
  const up = list.filter((i) => i.key === "up")[0];
  const down = list.filter((i) => i.key === "down")[0];
  assert.match(up.text, /食費/);
  assert.match(up.text, /ふえています/);
  assert.match(down.text, /趣味/);
  assert.match(down.text, /へっています/);
});

test("先月に記録が無い項目を「ふえた」と言わない", () => {
  const first = [
    tx("f0", "income", 300000, "salary", "2026-07-25"),
    tx("f1", "expense", 20000, "food", "2026-07-02"),
  ];
  const list = insightsOf(first, "2026-07-20");
  assert.equal(list.filter((i) => i.key === "up").length, 0);
});

test("気づきは多くても5件まで（読む気が失せない量に）", () => {
  const txs = TX.concat([tx("g1", "expense", 9000, "hobby", "2026-06-15")]);
  const list = insightsOf(txs, "2026-07-10");
  assert.ok(list.length <= 5, "気づきが多すぎる: " + list.length);
  assert.ok(list.length >= 3, "気づきが少なすぎる: " + list.length);
});

/* =========================================================================
   7. まとめ役
   ========================================================================= */
test("analyzeMonth は、画面が必要とするものを一式で返す", () => {
  const a = Core.analyzeMonth(S, TX, YM, { today: "2026-07-10" });
  for (const k of ["ym", "month", "trend", "cats", "week", "pace", "insights"]) {
    assert.ok(k in a, k + " が返っていない");
  }
  assert.equal(a.ym, YM);
  assert.equal(a.month.available, Core.computeMonth(S, TX, YM).available);
  assert.equal(a.week.length, 7);
});

test("「今日」を渡さなくても落ちない（月まるごとで見る）", () => {
  const a = Core.analyzeMonth(S, TX, YM, {});
  assert.equal(a.pace.elapsed, 31);
  assert.ok(Array.isArray(a.insights));
});

test("記録が1件も無くても落ちない", () => {
  const a = Core.analyzeMonth(S, [], YM, { today: "2026-07-10" });
  assert.equal(a.pace.spendTotal, 0);
  assert.deepEqual(a.cats, []);
  assert.equal(a.insights[0].key, "no-income");
});

/* =========================================================================
   8. 画面（白画面を出さない）
   ========================================================================= */
const NOW_YM = new Date().toISOString().slice(0, 7);
const D = (n) => `${NOW_YM}-${String(n).padStart(2, "0")}`;
const LIVE = {
  settings: S,
  tx: [
    tx("h0", "income", 300000, "salary", D(25)),
    tx("h1", "expense", 60000, "rent", D(1)),
    tx("h2", "expense", 30000, "food", D(3)),
  ],
  health: {}, diary: {},
};
const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");

function showAnalysis(state) {
  const app = bootApp({ state: state });
  app.run(`__kakeibo.setView("summary"); __kakeibo.setTab("analysis");`);
  return app.el("app").innerHTML;
}

test("分析タブが描ける（白画面にならない）", () => {
  const html = showAnalysis(LIVE);
  assert.ok(html.length > 200, "中身がほとんど無い");
  assert.match(html, /つかうペース/);
  assert.match(html, /先月とくらべる/);
  assert.match(html, /曜日のくせ/);
});

test("分析タブに出る金額が、コアの計算と一致する", () => {
  const html = showAnalysis(LIVE);
  const c = Core.computeMonth(S, LIVE.tx, NOW_YM);
  assert.ok(html.includes(yen(c.spendTotal)), "支出合計が出ていない");
  assert.ok(html.includes(yen(c.incomeTotal - c.setAside)), "つかってよい額が出ていない");
});

test("タブを戻すと、今月のまとめに帰ってくる", () => {
  const app = bootApp({ state: LIVE });
  app.run(`__kakeibo.setView("summary"); __kakeibo.setTab("analysis");`);
  assert.match(app.el("app").innerHTML, /つかうペース/);
  app.run(`__kakeibo.setTab("month");`);
  const html = app.el("app").innerHTML;
  assert.match(html, /今月のまとめ/);
  assert.equal(/つかうペース/.test(html), false, "まとめに戻っていない");
});

test("記録が空でも分析タブが落ちない", () => {
  const html = showAnalysis({ settings: S, tx: [], health: {}, diary: {} });
  assert.match(html, /まだ支出の記録がありません/);
});

test("分析タブは、記録を書き換えない（見るだけ）", () => {
  const app = bootApp({ state: LIVE });
  const before = app.saved();
  app.run(`__kakeibo.setView("summary"); __kakeibo.setTab("analysis");`);
  assert.equal(app.saved(), before, "見ただけで保存データが変わっている");
});
