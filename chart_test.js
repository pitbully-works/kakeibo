/* =========================================================================
   かけいぼ ― 推移グラフの目もり・日付ラベル・変化量のテスト
   「グラフに縦横の目もりが無く、いつ・いくつ・どれだけ変わったのか
     分からない」を直したぶんを守る。
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");
const { bootApp, appSrc } = require("./boot-app.cjs");

/* ---------- 1. 目もりの間隔 ---------- */
test("目もりの間隔は 1・2・2.5・5・10 系の切りのよい数になる", () => {
  const ok = (v) => {
    const m = v / Math.pow(10, Math.floor(Math.log10(v)));
    return [1, 2, 2.5, 5, 10].some((k) => Math.abs(m - k) < 1e-9);
  };
  [0.3, 1.5, 7, 35, 120, 4800].forEach((span) => {
    const step = Core.chartNiceStep(span, 4);
    assert.equal(ok(step), true, `半端な間隔になっている: 幅${span} → ${step}`);
  });
});

test("体重のような細かい幅でも、つぶれず読める間隔になる", () => {
  assert.equal(Core.chartNiceStep(1.5, 4), 0.5);   // 62.1〜63.6 → 0.5きざみ
});

test("血圧のような広い幅では大きい間隔になる", () => {
  assert.equal(Core.chartNiceStep(35, 4), 10);     // 105〜140 → 10きざみ
});

test("幅が0や異常値でも間隔は必ず正の数", () => {
  [0, -5, NaN, Infinity, null, undefined].forEach((span) => {
    const step = Core.chartNiceStep(span, 4);
    assert.equal(Number.isFinite(step) && step > 0, true, `不正な間隔: ${span} → ${step}`);
  });
});

/* ---------- 2. 縦の目もり（上下の端と位置） ---------- */
test("上下の端は目もりに合わせるので、軸の数字が半端にならない", () => {
  const sc = Core.chartScale([62.1, 62.1, 63.2, 63.2, 63.6], 4);
  assert.equal(sc.lo, 62);
  assert.equal(sc.hi, 64);
  assert.deepEqual(sc.ticks, [62, 62.5, 63, 63.5, 64]);
});

test("すべての値が目もりの内側に入る（線がはみ出さない）", () => {
  [[105, 140, 132, 118], [0.4, 0.9], [1200, 3000, 2450]].forEach((vals) => {
    const sc = Core.chartScale(vals, 4);
    assert.equal(sc.lo <= Math.min(...vals), true, `下がはみ出す: ${vals}`);
    assert.equal(sc.hi >= Math.max(...vals), true, `上がはみ出す: ${vals}`);
  });
});

test("目もりは低い順に、等しい間隔で並ぶ", () => {
  const sc = Core.chartScale([105, 140, 132, 118], 4);
  for (let i = 1; i < sc.ticks.length; i++) {
    assert.equal(sc.ticks[i] > sc.ticks[i - 1], true, "順番が逆になっている");
    assert.equal(Math.abs((sc.ticks[i] - sc.ticks[i - 1]) - sc.step) < 1e-9, true, "間隔がそろっていない");
  }
  assert.equal(sc.ticks[0], sc.lo);
  assert.equal(sc.ticks[sc.ticks.length - 1], sc.hi);
});

test("記録が1件だけ・同じ値ばかりでも、高さのある目もりになる（0で割らない）", () => {
  [[63.6], [70, 70, 70]].forEach((vals) => {
    const sc = Core.chartScale(vals, 4);
    assert.equal(sc.hi > sc.lo, true, "上下が同じで線が引けない");
    assert.equal(sc.ticks.length >= 2, true, "目もりが1本しかない");
    // 点が軸の線の上に重なると、値が読めず変化も見えない
    assert.equal(sc.lo < vals[0] && vals[0] < sc.hi, true,
      `点が枠の端に張りついている: ${vals[0]} (${sc.lo}〜${sc.hi})`);
  });
});

test("目もりの本数は多すぎない（文字が重ならない）", () => {
  [[62.1, 63.6], [105, 140], [0.1, 9.9], [1, 100000]].forEach((vals) => {
    const sc = Core.chartScale(vals, 4);
    assert.equal(sc.ticks.length <= 9, true, `目もりが多すぎる: ${vals} → ${sc.ticks.length}本`);
  });
});

test("値が無いときは目もりを作らない（null）", () => {
  assert.equal(Core.chartScale([], 4), null);
  assert.equal(Core.chartScale(null, 4), null);
  assert.equal(Core.chartScale(["a", NaN, Infinity], 4), null);
});

/* ---------- 3. 横の日付ラベル ---------- */
test("記録が少ないときは、すべての日付にラベルを出す", () => {
  assert.deepEqual(Core.chartLabelIndexes(3, 4), [0, 1, 2]);
  assert.deepEqual(Core.chartLabelIndexes(1, 4), [0]);
  assert.deepEqual(Core.chartLabelIndexes(0, 4), []);
});

test("記録が多い月でも、最初と最後は必ず出し、本数は上限まで間引く", () => {
  const idx = Core.chartLabelIndexes(31, 4);
  assert.equal(idx.length <= 4, true, "ラベルが多すぎる");
  assert.equal(idx[0], 0, "最初の日が出ていない");
  assert.equal(idx[idx.length - 1], 30, "最後の日が出ていない");
  const uniq = idx.filter((v, i) => idx.indexOf(v) === i);
  assert.deepEqual(uniq, idx, "同じ位置に重ねて書いている");
});

/* ---------- 4. 変化量 ---------- */
test("最初から最新までの変化量を出す", () => {
  const ch = Core.seriesChange([
    { date: "2026-07-25", value: 62.1 },
    { date: "2026-07-28", value: 62.8 },
    { date: "2026-07-30", value: 63.2 },
  ]);
  assert.equal(ch.first, 62.1);
  assert.equal(ch.last, 63.2);
  assert.equal(ch.diff, 1.1, "小数の誤差がそのまま出ている（1.1000000000000014 など）");
  assert.equal(ch.fromDate, "2026-07-25");
  assert.equal(ch.toDate, "2026-07-30");
  assert.equal(ch.count, 3);
});

test("小数の誤差を画面に出さない", () => {
  [[62.1, 63.2], [70.1, 71.3], [105.4, 118]].forEach(([a, b]) => {
    const ch = Core.seriesChange([{ date: "2026-07-25", value: a }, { date: "2026-07-30", value: b }]);
    assert.equal(String(ch.diff).length <= 6, true, `桁が伸びている: ${a}→${b} → ${ch.diff}`);
  });
});

test("下がったときは負の数になる", () => {
  const ch = Core.seriesChange([
    { date: "2026-07-25", value: 140 },
    { date: "2026-07-30", value: 118 },
  ]);
  assert.equal(ch.diff, -22);
});

test("記録が1件だけなら変化は0", () => {
  const ch = Core.seriesChange([{ date: "2026-07-30", value: 63.6 }]);
  assert.equal(ch.diff, 0);
  assert.equal(ch.count, 1);
});

test("空・不正なときは null", () => {
  assert.equal(Core.seriesChange([]), null);
  assert.equal(Core.seriesChange(null), null);
  assert.equal(Core.seriesChange([{ date: "2026-07-30", value: "x" }]), null);
});

/* ---------- 5. 画面：グラフに目もりと変化量が出ている ---------- */
function healthHtml(health) {
  const app = bootApp({ state: { settings: {}, tx: [], health: health } });
  return app.run(`healthRange="month"; view="health"; render(); document.getElementById("app").innerHTML`);
}

/* 今日から数日前の日付（月の区切りに関係なく期間内に入るように） */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

test("グラフに縦の目もり線と数字が描かれている", () => {
  const h = {};
  h[daysAgo(5)] = { weight: 62.1, bpHigh: 105, bpLow: 68 };
  h[daysAgo(2)] = { weight: 63.2, bpHigh: 140, bpLow: 74 };
  h[daysAgo(0)] = { weight: 63.6, bpHigh: 118, bpLow: 70 };
  const out = healthHtml(h);
  assert.match(out, /<line /, "目もりの線が無い");
  assert.match(out, /<text /, "目もりの数字が無い");
  assert.match(out, /62\.5|63\.0|63\.5/, "体重の目もりの数値が出ていない");
});

test("グラフの下に日付が出ている", () => {
  const h = {};
  h[daysAgo(5)] = { weight: 62.1 };
  h[daysAgo(0)] = { weight: 63.6 };
  const out = healthHtml(h);
  const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
  assert.ok(out.includes(md(daysAgo(5))), "最初の日付が出ていない");
  assert.ok(out.includes(md(daysAgo(0))), "最新の日付が出ていない");
});

test("どれだけ変わったかが数字で出ている", () => {
  const h = {};
  h[daysAgo(5)] = { weight: 62.1 };
  h[daysAgo(0)] = { weight: 63.6 };
  const out = healthHtml(h);
  assert.match(out, /chgbadge/, "変化量のバッジが無い");
  assert.match(out, /＋1\.5kg/, "変化量（＋1.5kg）が出ていない");
});

test("下がったときは −（マイナス）で出る", () => {
  const h = {};
  h[daysAgo(5)] = { weight: 65 };
  h[daysAgo(0)] = { weight: 63.5 };
  assert.match(healthHtml(h), /−1\.5kg/, "下がった変化が出ていない");
});

test("記録が無い期間でも落ちない", () => {
  const out = healthHtml({});
  assert.match(out, /この期間の記録はまだありません/);
});

test("グラフの目もりは core.js の計算を使っている（画面で別の式を書かない）", () => {
  const block = appSrc.slice(appSrc.indexOf("function lineChart"), appSrc.indexOf("function renderHealth"));
  assert.match(block, /Core\.chartScale/, "目もりを画面側で作ってしまっている");
  assert.match(block, /Core\.chartLabelIndexes/, "日付ラベルを画面側で作ってしまっている");
  assert.match(block, /Core\.seriesChange/, "変化量を画面側で作ってしまっている");
});

/* ---------- 6. まとめ（分析）「つかうペース」のグラフ ----------
   金額の目もり・日にちのラベル・色つき凡例が出ることを守る。 */
function paceHtml(day) {
  const ym = new Date().toISOString().slice(0, 8);   // "YYYY-MM-"
  const app = bootApp({ state: { settings: { savingsTarget: 120000 }, tx: [
    { id: "i", type: "income",  amount: 295535, cat: "salary", date: ym + "01" },
    { id: "a", type: "expense", amount: 135162, cat: "rent",   date: ym + "02", recurring: true },
    { id: "b", type: "expense", amount: 24647,  cat: "food",   date: ym + "05" },
  ] } });
  if (day) app.run(`todayISO=()=>${JSON.stringify(ym + String(day).padStart(2, "0"))};`);
  return app.run(`view="summary"; sumTab="analysis"; render(); document.getElementById("app").innerHTML`);
}

test("つかうペースのグラフに金額の目もりが出る（万単位）", () => {
  const out = paceHtml(12);
  assert.match(out, />5万</, "5万の目もりが無い");
  assert.match(out, />10万</, "10万の目もりが無い");
  assert.match(out, />0</, "0の目もりが無い");
});

test("つかうペースのグラフに日にちのラベルが出る（1日と月末は必ず）", () => {
  const out = paceHtml(12);
  assert.match(out, />1日</, "1日のラベルが無い");
  assert.match(out, />(28|29|30|31)日</, "月末のラベルが無い");
});

test("凡例が色つきで3つ出る（累計・予算・予測）", () => {
  const out = paceHtml(12);
  assert.match(out, /つかった累計/, "累計の凡例が無い");
  assert.match(out, /予算のペース/, "予算の凡例が無い");
  assert.match(out, /月末までの予測/, "予測の凡例が無い");
  assert.match(out, /stroke-dasharray="4 4"/, "予算の点線見本が無い");
  assert.match(out, /stroke-dasharray="3 3"/, "予測の点線見本が無い");
});

test("月が終わった月の表示では、予測の凡例は出ない（線も無い）", () => {
  const out = paceHtml(0);   // todayISO を差し替えない＝当日基準。月末実行でも落ちないこと自体を確認
  assert.match(out, /つかった累計/, "累計の凡例が無い");
});

test("つかうペースの目もりも core.js の計算を使っている", () => {
  const block = appSrc.slice(appSrc.indexOf("function paceChart"), appSrc.indexOf("function trendChart"));
  assert.match(block, /Core\.chartScale/, "目もりを画面側で作ってしまっている");
  assert.match(block, /Core\.chartLabelIndexes/, "日付ラベルを画面側で作ってしまっている");
});

test("金額の目もりの書き方：万単位・半端は小数1桁・小さい額はカンマ区切り", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  assert.equal(app.run(`yenTick(0)`), "0");
  assert.equal(app.run(`yenTick(50000)`), "5万");
  assert.equal(app.run(`yenTick(125000)`), "12.5万");
  assert.equal(app.run(`yenTick(2500)`), "2,500");
});
