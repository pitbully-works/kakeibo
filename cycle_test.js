/* =========================================================================
   かけいぼ ― 月の区切り（給料日起点）のテスト
   -------------------------------------------------------------------------
   守りたいこと：
     ・起点1日のときは、これまでの暦の月とまったく同じ結果になる（後戻りしない）
     ・どの日も、ちょうどひとつの区切りに入る（すき間も重なりも無い）
     ・呼び名は「始まりの月」。7/20〜8/19 は「7月分」
     ・無い日（2月31日など）は、その月の末日へ寄せる
     ・区切りを変えても、記録そのものは書き換えない
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

const S = (cycleStart) => ({ currency: "JPY", cycleStart: cycleStart });
/* 端末に実際に保存される形（memo と photo のキーは必ず付く）に揃える。
   ここを欠けた形にしておくと、読み込み時の正規化と比べたときに
   「書き換わった」と誤って判定してしまう。 */
const exp = (id, amount, date) => ({ id, type: "expense", amount, cat: "food", date, memo: "", photo: null });
const salary = (id, amount, date) => ({ id, type: "income", amount, cat: "salary", date, memo: "", photo: null });

/* ---------- 1. 起点1日は、これまでどおり ---------- */

test("起点1日の区切りは、暦の月そのもの", () => {
  assert.deepEqual(Core.cycleRange("2026-07", 1), { from: "2026-07-01", to: "2026-07-31", days: 31 });
  assert.deepEqual(Core.cycleRange("2026-02", 1), { from: "2026-02-01", to: "2026-02-28", days: 28 });
  assert.deepEqual(Core.cycleRange("2024-02", 1), { from: "2024-02-01", to: "2024-02-29", days: 29 });
});

test("起点1日なら、どの日も月そのものに入る（monthOf と同じ）", () => {
  for (const d of ["2026-01-01", "2026-02-28", "2026-07-15", "2026-12-31"]) {
    assert.equal(Core.cycleOf(d, 1), Core.monthOf(d));
    assert.equal(Core.cycleOf(d, undefined), Core.monthOf(d), "設定が無い保存データは1日あつかい");
  }
});

test("起点1日なら、区切りの何日目かは その日にちと同じ", () => {
  assert.equal(Core.cycleDayIndex("2026-07-01", "2026-07", 1), 1);
  assert.equal(Core.cycleDayIndex("2026-07-31", "2026-07", 1), 31);
});

/* ---------- 2. 給料日起点の区切り ---------- */

test("起点20日なら、7/20〜8/19 がひと区切り", () => {
  const r = Core.cycleRange("2026-07", 20);
  assert.equal(r.from, "2026-07-20");
  assert.equal(r.to, "2026-08-19");
  assert.equal(r.days, 31);
});

test("呼び名は始まりの月（7/20〜8/19 は 7月分）", () => {
  assert.equal(Core.cycleOf("2026-07-20", 20), "2026-07", "給料日当日は その月から");
  assert.equal(Core.cycleOf("2026-08-05", 20), "2026-07", "翌月5日は まだ7月分");
  assert.equal(Core.cycleOf("2026-08-19", 20), "2026-07", "区切りの最終日");
  assert.equal(Core.cycleOf("2026-08-20", 20), "2026-08", "次の給料日から8月分");
  assert.equal(Core.cycleOf("2026-07-19", 20), "2026-06", "給料日の前日は 前の区切り");
});

test("区切りの中で何日目か（給料日が1日目）", () => {
  assert.equal(Core.cycleDayIndex("2026-07-20", "2026-07", 20), 1);
  assert.equal(Core.cycleDayIndex("2026-08-01", "2026-07", 20), 13);
  assert.equal(Core.cycleDayIndex("2026-08-19", "2026-07", 20), 31);
  assert.equal(Core.cycleDayIndex("2026-08-20", "2026-07", 20), 0, "範囲の外は0");
});

test("どの日も、ちょうどひとつの区切りに入る（すき間も重なりも無い）", () => {
  for (const startDay of [1, 5, 20, 25, 28, 30, 31]) {
    let d = "2024-01-01";                    // うるう年をまたいで1年半ぶん確かめる
    while (d <= "2025-06-30") {
      const ym = Core.cycleOf(d, startDay);
      const r = Core.cycleRange(ym, startDay);
      assert.ok(d >= r.from && d <= r.to, `起点${startDay}：${d} が ${ym}（${r.from}〜${r.to}）の外`);
      assert.ok(Core.cycleDayIndex(d, ym, startDay) >= 1, `起点${startDay}：${d} の日数が数えられない`);
      d = Core.shiftDate(d, 1);
    }
  }
});

test("無い日を起点にしたら、その月の末日に寄せる", () => {
  assert.deepEqual(Core.cycleRange("2026-01", 31), { from: "2026-01-31", to: "2026-02-27", days: 28 });
  assert.deepEqual(Core.cycleRange("2026-02", 31), { from: "2026-02-28", to: "2026-03-30", days: 31 });
  assert.equal(Core.cycleRange("2024-02", 31).from, "2024-02-29", "うるう年は29日");
  assert.equal(Core.cycleStartDay("2026-02", 31), 28);
});

test("起点日は1〜31にそろえる（へんな値でも落ちない）", () => {
  assert.equal(Core.normalizeCycleStart(0), 1);
  assert.equal(Core.normalizeCycleStart(99), 31);
  assert.equal(Core.normalizeCycleStart("20"), 20);
  assert.equal(Core.normalizeCycleStart(null), 1);
  assert.equal(Core.normalizeCycleStart("あ"), 1);
});

test("期間の文字は、起点1日のときだけ出さない", () => {
  assert.equal(Core.cycleLabel("2026-07", 1), "");
  assert.equal(Core.cycleLabel("2026-07", 20), "7/20〜8/19");
});

test("「毎月◯日」は、その区切りの中の日付になる", () => {
  assert.equal(Core.dateInCycle("2026-07", 20, 25), "2026-07-25", "起点より後ろの日はその月");
  assert.equal(Core.dateInCycle("2026-07", 20, 1), "2026-08-01", "起点より前の日は翌月");
  assert.equal(Core.dateInCycle("2026-01", 20, 30), "2026-01-30");
  assert.equal(Core.dateInCycle("2026-01", 1, 31), "2026-01-31");
  assert.equal(Core.dateInCycle("2026-02", 1, 31), "2026-02-28", "無い日は月末へ");
  assert.equal(Core.dateInCycle("2026-01", 31, 28), "2026-02-27", "区切りからはみ出す日は、区切りの端へ寄せる");
});

/* ---------- 3. 集計が区切りに従う ---------- */

test("起点20日なら、翌月5日の支出は「7月分」に入る", () => {
  const txs = [salary("s", 300000, "2026-07-20"), exp("a", 5000, "2026-08-05"), exp("b", 3000, "2026-08-25")];
  const c = Core.computeMonth(S(20), txs, "2026-07");
  assert.equal(c.spendTotal, 5000, "8/25 の分まで入っている");
  assert.equal(c.incomeTotal, 300000);
  assert.equal(c.periodFrom, "2026-07-20");
  assert.equal(c.periodTo, "2026-08-19");
});

test("起点を1日に戻すと、暦の月の集計に戻る", () => {
  const txs = [exp("a", 5000, "2026-08-05"), exp("b", 3000, "2026-08-25")];
  assert.equal(Core.computeMonth(S(1), txs, "2026-08").spendTotal, 8000);
  assert.equal(Core.computeMonth(S(1), txs, "2026-07").spendTotal, 0);
});

test("ペースは、区切りの長さと 区切りの中の経過日数で見る", () => {
  const txs = [salary("s", 300000, "2026-07-20"), exp("a", 6000, "2026-08-01")];
  const p = Core.spendPace(S(20), txs, "2026-07", "2026-08-01");
  assert.equal(p.days, 31, "区切りの長さ");
  assert.equal(p.elapsed, 13, "7/20 から数えて13日目");
  assert.equal(p.isCurrent, true);
  assert.equal(p.spentSoFar, 6000);
  assert.equal(p.periodLabel, "7/20〜8/19");
});

test("過ぎた区切りは、まるごと見る", () => {
  const txs = [exp("a", 6000, "2026-08-01")];
  const p = Core.spendPace(S(20), txs, "2026-07", "2026-09-10");
  assert.equal(p.isCurrent, false);
  assert.equal(p.elapsed, p.days);
});

test("カテゴリ別・曜日別も、同じ区切りで数える", () => {
  const txs = [exp("a", 5000, "2026-08-05")];
  assert.equal(Core.categorySpend(txs, "2026-07", 20).food, 5000);
  assert.deepEqual(Core.categorySpend(txs, "2026-08", 20), {}, "次の区切りには入らない");
  const wk = Core.weekdaySpend(txs, "2026-07", 20);
  assert.equal(wk.reduce((a, r) => a + r.amount, 0), 5000);
});

test("毎月固定の写しは、次の区切りの同じ日にちへ入る", () => {
  const txs = [{ id: "r", type: "expense", amount: 60000, cat: "rent", date: "2026-08-01", recurring: true }];
  const plan = Core.recurringCarryPlan(txs, "2026-08", 20);   // 8/1 は 7月分 → 次は 8月分
  assert.equal(plan.toAdd.length, 1);
  assert.equal(plan.toAdd[0].date, "2026-09-01", "毎月1日のまま、次の区切りへ");
});

test("計算の結果に、何日〜何日かが入る", () => {
  const c = Core.computeMonth(S(20), [salary("s", 300000, "2026-07-20")], "2026-07");
  assert.equal(c.ym, "2026-07");
  assert.equal(c.cycleStart, 20);
  assert.equal(c.periodFrom, "2026-07-20");
  assert.equal(c.periodTo, "2026-08-19");
});

test("給料の催促は、その区切りの給料日を過ぎてから出る", () => {
  /* 給料日は毎月1日。起点20日なので、7月分（7/20〜8/19）の給料日は 8/1 */
  const past = [salary("p", 300000, "2026-06-01"), salary("q", 300000, "2026-07-01")];
  const st = { settings: S(20), tx: past, health: {}, diary: {} };
  const keys = (today) => Core.todayTasks(st, today).map((t) => t.key);
  assert.equal(keys("2026-07-25").includes("salary"), false, "まだ給料日前なのに催促している");
  assert.equal(keys("2026-08-02").includes("salary"), true, "給料日を過ぎても催促しない");
});

/* ---------- 4. 画面 ---------- */

function boot(cycleStart, tx) {
  const app = bootApp({ state: { settings: S(cycleStart), tx: tx || [], health: {}, diary: {} } });
  return app;
}
const screenHtml = (app, view) => { app.run(`view=${JSON.stringify(view)}; render();`); return app.el("app").innerHTML; };

test("せっていに、1か月の始まりの日を選ぶところがある", () => {
  const h = screenHtml(boot(20), "settings");
  assert.match(h, /id="f-cycle"/, "選ぶところが無い");
  assert.match(h, /<option value="20" selected>/, "いまの設定が選ばれていない");
  assert.match(h, /1日（暦の月・これまでどおり）/, "1日が元どおりだと分からない");
  assert.match(h, /7月20日〜8月19日|いまの区切りは/, "どの期間になるかが出ていない");
});

test("保存すると、起点日が設定に入る", () => {
  const app = boot(1);
  screenHtml(app, "settings");
  app.el("f-cycle").value = "25";
  app.run(`saveSettings();`);
  assert.equal(app.run(`state.settings.cycleStart`), 25);
  assert.equal(JSON.parse(app.saved()).settings.cycleStart, 25, "端末にも保存されていない");
});

test("起点日を変えても、記録そのものは書き換えない", () => {
  const tx = [exp("a", 5000, "2026-08-05")];
  const app = boot(1, tx);
  screenHtml(app, "settings");
  app.el("f-cycle").value = "20";
  app.run(`saveSettings();`);
  assert.deepEqual(JSON.parse(app.saved()).tx, tx, "記録が書き換わっている");
});

test("ホームに、いまの区切りが出る（起点1日のときは出さない）", () => {
  assert.match(screenHtml(boot(20), "home"), /今月ののこり \d+日　（\d+\/\d+〜\d+\/\d+）/, "期間が出ていない");
  assert.match(screenHtml(boot(1), "home"), /今月ののこり \d+日</, "のこり日数が出ていない");
  assert.equal(/今月ののこり \d+日　（/.test(screenHtml(boot(1), "home")), false, "起点1日なのに期間が出ている");
});

test("まとめの見出しは、区切りに合わせた月を出す", () => {
  const h = screenHtml(boot(20), "summary");
  assert.match(h, /今月のまとめ（\d+月・\d+\/\d+〜\d+\/\d+）/);
  assert.match(screenHtml(boot(1), "summary"), /今月のまとめ（\d+月）/);
});
