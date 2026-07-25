/* =========================================================================
   かけいぼ ― 「毎月固定」の印と、選べるカテゴリのテスト
   -------------------------------------------------------------------------
   守りたいこと：
     ・「その他」は選択ボタンに1つだけ。ただし過去の 📦 の記録は消えない
     ・毎月固定は「設定の予定額」ではなく「記録1件ごとの印」（入力口はひとつだけ）
     ・印を付けても、支出合計・のこりの金額は1円も変わらない
     ・毎月固定は日割りしないので、月初に家賃を記録しても予測が暴れない
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

const S = { savingsTarget: 40000, nisaMonthly: 33000, currency: "JPY" };
const YM = "2026-07";
const tx = (id, amount, cat, date, recurring) => {
  const t = { id, type: "expense", amount, cat, date };
  if (recurring) t.recurring = true;
  return t;
};
const SALARY = { id: "s", type: "income", amount: 300000, cat: "salary", date: "2026-07-25" };

/* 家賃と光熱費に印、食費はそのまま */
const TX = [
  SALARY,
  tx("r", 60000, "rent", "2026-07-01", true),
  tx("p", 12000, "power", "2026-07-02", true),
  tx("f", 8000, "food", "2026-07-03"),
  tx("e", 4000, "eatout", "2026-07-05"),
];

/* =========================================================================
   1. 選べるカテゴリ
   ========================================================================= */
test("記録シートで選べる「その他」は1つだけ", () => {
  const others = Core.EXP_PICK_CATS.filter((c) => c.n === "その他");
  assert.equal(others.length, 1, "「その他」が複数ある: " + others.map((c) => c.e).join(" "));
  assert.equal(others[0].k, "other");
  assert.equal(Core.EXP_PICK_CATS.some((c) => c.k === "fixother"), false, "📦 が選べるままになっている");
});

test("📦（旧・その他固定費）は集計用に残っていて、過去の記録が消えない", () => {
  assert.ok(Core.EXP_CATS.some((c) => c.k === "fixother"), "キーごと消すと過去の記録が読めなくなる");
  assert.equal(Core.catOf("expense", "fixother").e, "📦");
  const old = [{ id: "o", type: "expense", amount: 5000, cat: "fixother", date: "2026-07-08" }];
  const c = Core.computeMonth(S, old, YM);
  assert.equal(c.spendTotal, 5000, "過去の記録が集計から外れている");
  assert.equal(c.byCat.fixother, 5000, "内わけから消えている");
});

test("バックアップから読み込んでも 📦 は「その他」に化けない", () => {
  const t = Core.normalizeTransaction({ id: "o", type: "expense", amount: 5000, cat: "fixother", date: "2026-07-08" });
  assert.equal(t.cat, "fixother");
});

test("画面の選択ボタンは、選べるカテゴリだけを並べている", () => {
  const { appSrc } = require("./boot-app.cjs");
  assert.match(appSrc, /EXP_PICK_CATS\.map\(btn\)/, "選択ボタンが全カテゴリのままになっている");
  assert.match(appSrc, /st\.type==="income" \? INC_CATS : EXP_PICK_CATS/, "選べる範囲の判定が変わっている");
});

/* =========================================================================
   2. 毎月固定の印 ― 金額を変えない
   ========================================================================= */
test("印を付けても、支出合計・のこりは1円も変わらない", () => {
  const plain = TX.map((t) => { const c = Object.assign({}, t); delete c.recurring; return c; });
  const a = Core.computeMonth(S, TX, YM);
  const b = Core.computeMonth(S, plain, YM);
  assert.equal(a.spendTotal, b.spendTotal);
  assert.equal(a.available, b.available);
  assert.equal(a.spendTotal, 84000);
});

test("毎月固定と、それ以外に分かれる", () => {
  const c = Core.computeMonth(S, TX, YM);
  assert.equal(c.recurringSpend, 72000);            // 家賃 60,000 + 電気 12,000
  assert.equal(c.spotSpend, 12000);                 // 食費 8,000 + 外食 4,000
  assert.equal(c.recurringSpend + c.spotSpend, c.spendTotal, "合計が合わない");
});

test("印を付けていなければ、すべて「それ以外」になる（これまでと同じ）", () => {
  const plain = TX.map((t) => { const c = Object.assign({}, t); delete c.recurring; return c; });
  const c = Core.computeMonth(S, plain, YM);
  assert.equal(c.recurringSpend, 0);
  assert.equal(c.spotSpend, c.spendTotal);
});

test("収入には印が付かない", () => {
  const wrong = [Object.assign({}, SALARY, { recurring: true })];
  const c = Core.computeMonth(S, wrong, YM);
  assert.equal(c.recurringSpend, 0, "収入が固定費として数えられている");
  assert.equal(Core.isRecurring(wrong[0]), false);
});

test("印は記録1件ごとに持つ（設定には置かない）", () => {
  const s = Core.normalizeSettings({ recurring: 50000, fixedCost: 90000, fixed: { rent: 60000 } });
  assert.equal("recurring" in s, false);
  assert.equal("fixedCost" in s, false);
  assert.equal("fixed" in s, false);
});

/* =========================================================================
   3. バックアップ
   ========================================================================= */
test("印はバックアップで往復しても残る", () => {
  const t = Core.normalizeTransaction({ id: "r", type: "expense", amount: 60000, cat: "rent", date: "2026-07-01", recurring: true });
  assert.equal(t.recurring, true);
});

test("印が無い記録は、キーごと持たない（保存を重くしない）", () => {
  const t = Core.normalizeTransaction({ id: "f", type: "expense", amount: 8000, cat: "food", date: "2026-07-03" });
  assert.equal("recurring" in t, false);
});

test("印に文字列など変な値が来ても、true にはしない", () => {
  for (const bad of ["true", 1, {}, [], "はい"]) {
    const t = Core.normalizeTransaction({ id: "x", type: "expense", amount: 100, cat: "food", date: "2026-07-03", recurring: bad });
    assert.equal("recurring" in t, false, "変な値を印として受け入れている: " + JSON.stringify(bad));
  }
});

/* =========================================================================
   4. 月末の予測 ― 固定は日割りしない
   ========================================================================= */
test("毎月固定は日割りせず、それ以外だけを日割りして予測する", () => {
  const p = Core.spendPace(S, TX, YM, "2026-07-10");
  /* 固定 72,000 はそのまま ＋ それ以外 12,000 ÷ 10日 × 31日 */
  assert.equal(p.recurringSoFar, 72000);
  assert.equal(p.spotSoFar, 12000);
  assert.equal(p.forecast, 72000 + Math.round(12000 / 10 * 31));
});

test("月初に家賃を記録しても、予測が跳ね上がらない", () => {
  /* 2日目。家賃と電気（どちらも毎月固定）だけを記録した状態 */
  const early = [SALARY, tx("r", 60000, "rent", "2026-07-01", true), tx("p", 12000, "power", "2026-07-02", true)];
  const p = Core.spendPace(S, early, YM, "2026-07-02");
  assert.equal(p.spentSoFar, 72000);
  assert.equal(p.forecast, 72000, "固定費を日割りして予測が膨らんでいる");

  /* 印を付けないと、同じ状況で31日ぶんに膨らんでしまう（印の効き目の確認） */
  const plain = early.map((t) => { const c = Object.assign({}, t); delete c.recurring; return c; });
  assert.equal(Core.spendPace(S, plain, YM, "2026-07-02").forecast, Math.round(72000 / 2 * 31));
});

test("印が無ければ、これまでと同じ式のままになる", () => {
  const plain = TX.map((t) => { const c = Object.assign({}, t); delete c.recurring; return c; });
  const p = Core.spendPace(S, plain, YM, "2026-07-10");
  assert.equal(p.recurringSoFar, 0);
  assert.equal(p.forecast, Math.round(p.spentSoFar / p.elapsed * p.days));
});

test("まだ来ていない日付の記録は、ペースに混ぜない", () => {
  /* 10日の時点で、25日づけの記録がある場合 */
  const future = [SALARY, tx("f1", 8000, "food", "2026-07-03"), tx("f2", 90000, "hobby", "2026-07-25")];
  const p = Core.spendPace(S, future, YM, "2026-07-10");
  assert.equal(p.spendTotal, 98000, "当月の合計は、先の日付も含めたまま");
  assert.equal(p.spentSoFar, 8000, "先の日付ぶんまで「もう使った」ことにしている");
  assert.equal(p.forecast, Math.round(8000 / 10 * 31));
});

test("毎月かかるお金が、気づきに出る", () => {
  const a = Core.analyzeMonth(S, TX, YM, { today: "2026-07-10" });
  const rec = a.insights.filter((i) => i.key === "recurring")[0];
  assert.ok(rec, "毎月固定の気づきが無い");
  assert.match(rec.text, /毎月かかるお金/);
});

/* =========================================================================
   5. 連携JSON（ライフプランへ渡す）
   ========================================================================= */
test("連携JSONの fixed_cost / variable_spend が、印のとおりに埋まる", () => {
  const j = Core.buildSnapshot(S, TX, YM);
  assert.equal(j.fixed_cost, 72000);
  assert.equal(j.variable_spend, 12000);
  assert.equal(j.spend_total, 84000);
  assert.equal(j.fixed_cost + j.variable_spend, j.spend_total, "合計が合わない");
});

test("連携JSONに、毎月固定の項目別が入る", () => {
  const items = Core.buildSnapshot(S, TX, YM).fixed_cost_items;
  assert.ok(Array.isArray(items));
  const keys = items.map((i) => i.key).sort();
  assert.deepEqual(keys, ["power", "rent"]);
  assert.equal(items.filter((i) => i.key === "rent")[0].amount, 60000);
  assert.equal(items.filter((i) => i.key === "rent")[0].name, "住居");
});

test("印がひとつも無ければ、fixed_cost は0のまま（これまでと同じ）", () => {
  const plain = TX.map((t) => { const c = Object.assign({}, t); delete c.recurring; return c; });
  const j = Core.buildSnapshot(S, plain, YM);
  assert.equal(j.fixed_cost, 0);
  assert.deepEqual(j.fixed_cost_items, []);
  assert.equal(j.variable_spend, j.spend_total);
});

/* =========================================================================
   6. 画面
   ========================================================================= */
const NOW_YM = new Date().toISOString().slice(0, 7);
const D = (n) => `${NOW_YM}-${String(n).padStart(2, "0")}`;

function sheetHtml(app) { return app.el("sheet").innerHTML; }

test("記録シートに「毎月固定」のスイッチがある（支出のとき）", () => {
  const app = bootApp({});
  app.run(`openRecord(null);`);
  const html = sheetHtml(app);
  assert.match(html, /毎月固定/);
  assert.match(html, /data-act="toggle-recurring"/);
  assert.match(html, /オフ/, "はじめはオフで出るはず");
});

test("スイッチを押すとオンになり、もう一度押すとオフに戻る", () => {
  const app = bootApp({});
  app.run(`openRecord(null);`);
  app.run(`handleAct("toggle-recurring");`);
  assert.equal(app.run(`sheetState.recurring`), true);
  assert.match(sheetHtml(app), /オン/);
  app.run(`handleAct("toggle-recurring");`);
  assert.equal(app.run(`sheetState.recurring`), false);
});

test("収入に切り替えると、スイッチは出ない", () => {
  const app = bootApp({});
  app.run(`openRecord(null); sheetState.type="income"; renderSheet();`);
  assert.equal(/data-act="toggle-recurring"/.test(sheetHtml(app)), false);
});

test("オンのまま記録すると、印が保存される", async () => {
  const app = bootApp({});
  app.run(`openRecord(null);`);
  app.run(`handleAct("toggle-recurring");`);
  app.run(`
    document.getElementById("s-amt").value="60000";
    document.getElementById("s-date").value=${JSON.stringify(D(1))};
    sheetState.cat="rent";
  `);
  await app.run(`saveTx()`);
  const saved = JSON.parse(app.saved());
  assert.equal(saved.tx.length, 1);
  assert.equal(saved.tx[0].recurring, true);
});

test("オフのまま記録すると、印のキーごと持たない", async () => {
  const app = bootApp({});
  await app.record(3000);
  const saved = JSON.parse(app.saved());
  assert.equal("recurring" in saved.tx[0], false);
});

test("収入に切り替えて記録すると、印は落ちる", async () => {
  const app = bootApp({});
  app.run(`openRecord(null);`);
  app.run(`handleAct("toggle-recurring");`);
  app.run(`
    sheetState.type="income"; sheetState.cat="salary";
    document.getElementById("s-amt").value="300000";
    document.getElementById("s-date").value=${JSON.stringify(D(25))};
  `);
  await app.run(`saveTx()`);
  const saved = JSON.parse(app.saved());
  assert.equal("recurring" in saved.tx[0], false, "収入に固定費の印が付いている");
});

test("記録をなおすとき、印の状態がそのまま出る", () => {
  const state = {
    settings: S,
    tx: [{ id: "r1", type: "expense", amount: 60000, cat: "rent", date: D(1), memo: "", recurring: true }],
    health: {}, diary: {},
  };
  const app = bootApp({ state });
  app.run(`openRecord("r1");`);
  assert.equal(app.run(`sheetState.recurring`), true);
  assert.match(sheetHtml(app), /オン/);
});

test("印を外して更新すると、記録からも消える", async () => {
  const state = {
    settings: S,
    tx: [{ id: "r1", type: "expense", amount: 60000, cat: "rent", date: D(1), memo: "", recurring: true }],
    health: {}, diary: {},
  };
  const app = bootApp({ state });
  app.run(`openRecord("r1"); handleAct("toggle-recurring");`);
  app.run(`
    document.getElementById("s-amt").value="60000";
    document.getElementById("s-date").value=${JSON.stringify(D(1))};
  `);
  await app.run(`saveTx()`);
  const saved = JSON.parse(app.saved());
  assert.equal("recurring" in saved.tx[0], false);
  assert.equal(saved.tx[0].amount, 60000, "金額まで変わっている");
});

test("まとめ画面に、毎月固定とそれ以外の内わけが出る", () => {
  const state = {
    settings: S,
    tx: [
      { id: "i", type: "income", amount: 300000, cat: "salary", date: D(25) },
      { id: "r", type: "expense", amount: 60000, cat: "rent", date: D(1), recurring: true },
      { id: "f", type: "expense", amount: 8000, cat: "food", date: D(3) },
    ],
    health: {}, diary: {},
  };
  const app = bootApp({ state });
  app.run(`__kakeibo.setView("summary");`);
  const html = app.el("app").innerHTML;
  assert.match(html, /毎月固定/);
  assert.ok(html.includes("¥60,000"), "毎月固定の合計が出ていない");
  assert.ok(html.includes("¥8,000"), "それ以外の合計が出ていない");
});

/* ---------- 連携JSONの版数 ---------- */
test("スナップショットの版数が 2.2 になっている（fixed_cost の意味が変わったため）", () => {
  const snap = Core.buildSnapshot(S, TX, YM);
  assert.equal(snap.schema_version, "2.2");
  assert.equal(snap.fixed_cost + snap.variable_spend, snap.spend_total, "内わけの合計が全体と合わない");
});
