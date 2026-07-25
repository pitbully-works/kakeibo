/* =========================================================================
   かけいぼ ― カレンダーのテスト
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const appSrc = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].pop()[1];

const STATE = () => ({
  settings: { savingsTarget: 40000, nisaMonthly: 33000 },
  tx: [
    { id: "e1", type: "expense", amount: 1200, cat: "food", date: "2026-07-25", memo: "スーパー" },
    { id: "e2", type: "expense", amount: 800, cat: "eatout", date: "2026-07-25" },
    { id: "i1", type: "income", amount: 290000, cat: "salary", date: "2026-07-25" },
    { id: "e3", type: "expense", amount: 500, cat: "daily", date: "2026-07-10" },
  ],
  diary: { "2026-07-25": { text: "いい一日", photo: "data:image/png;base64,AA" }, "2026-07-20": { text: "べつの日" } },
  health: { "2026-07-25": { weight: 62.5, bpHigh: 120, bpLow: 78 } },
});

/* ---------- dayDetail ---------- */
test("その日の支出・収入・日記・健康をまとめて返す", () => {
  const d = Core.dayDetail(STATE(), "2026-07-25");
  assert.equal(d.expense.length, 2);
  assert.equal(d.income.length, 1);
  assert.equal(d.expenseTotal, 2000);
  assert.equal(d.incomeTotal, 290000);
  assert.equal(d.diary.text, "いい一日");
  assert.equal(d.diary.photo, "data:image/png;base64,AA");
  assert.equal(d.health.weight, 62.5);
  assert.equal(d.hasAny, true);
});

test("記録の無い日は hasAny が false", () => {
  const d = Core.dayDetail(STATE(), "2026-07-01");
  assert.equal(d.hasAny, false);
  assert.equal(d.expense.length, 0);
  assert.equal(d.diary, null);
  assert.equal(d.health, null);
});

test("旧形式（文字列）の日記も dayDetail で読める", () => {
  const st = { tx: [], diary: { "2026-07-25": "古い形式" }, health: {} };
  const d = Core.dayDetail(st, "2026-07-25");
  assert.equal(d.diary.text, "古い形式");
});

test("支出だけの日・収入だけの日も正しく集計", () => {
  const d = Core.dayDetail(STATE(), "2026-07-10");
  assert.equal(d.expenseTotal, 500);
  assert.equal(d.incomeTotal, 0);
});

/* ---------- monthMarks ---------- */
test("その月の記録がある日に印がつく", () => {
  const m = Core.monthMarks(STATE(), "2026-07");
  assert.equal(m["2026-07-25"].expense, true);
  assert.equal(m["2026-07-25"].income, true);
  assert.equal(m["2026-07-25"].diary, true);
  assert.equal(m["2026-07-25"].health, true);
  assert.equal(m["2026-07-10"].expense, true);
  assert.equal(m["2026-07-20"].diary, true);
});

test("別の月の記録には印がつかない", () => {
  const m = Core.monthMarks(STATE(), "2026-06");
  assert.deepEqual(Object.keys(m), []);
});

/* ---------- 画面 ---------- */
test("下部メニューにカレンダーが追加されている", () => {
  assert.match(html, /data-nav="calendar"/, "カレンダーメニューが無い");
  assert.match(appSrc, /view==="calendar"/, "ルーティングが無い");
});

test("カレンダーに月グリッドと曜日がある", () => {
  const app = bootApp({ state: STATE() });
  app.run(`calYM="2026-07"; view="calendar"; render();`);
  const out = app.el("app").innerHTML;
  assert.ok(out.includes("2026年 7月"), "年月が出ていない");
  assert.ok(out.includes("cal-grid"), "グリッドが無い");
  assert.ok(out.includes("日") && out.includes("土"), "曜日が無い");
});

test("前月・次月に移動できる", () => {
  const app = bootApp({ state: STATE() });
  app.run(`calYM="2026-07"; view="calendar"; render(); calShift(-1);`);
  assert.equal(app.run(`calYM`), "2026-06", "前月へ移動できない");
  app.run(`calShift(2);`);
  assert.equal(app.run(`calYM`), "2026-08", "次月へ移動できない");
});

test("年をまたぐ移動（12月→1月）", () => {
  const app = bootApp({ state: STATE() });
  app.run(`calYM="2026-12"; view="calendar"; render(); calShift(1);`);
  assert.equal(app.run(`calYM`), "2027-01");
  app.run(`calShift(-1);`);
  assert.equal(app.run(`calYM`), "2026-12");
});

test("日をタップすると、その日の記録が表示される", () => {
  const app = bootApp({ state: STATE() });
  app.run(`calYM="2026-07"; calSelected="2026-07-25"; view="calendar"; render();`);
  const out = app.el("app").innerHTML;
  assert.ok(out.includes("スーパー"), "支出が出ていない");
  assert.ok(out.includes("いい一日"), "日記が出ていない");
  assert.ok(out.includes("体重 62.5kg"), "健康が出ていない");
  assert.ok(out.includes("収入 ¥290,000"), "収入合計が出ていない");
});

test("記録の無い日を選ぶと「記録はありません」", () => {
  const app = bootApp({ state: STATE() });
  app.run(`calYM="2026-07"; calSelected="2026-07-05"; view="calendar"; render();`);
  const out = app.el("app").innerHTML;
  assert.ok(out.includes("この日の記録はありません"));
});

test("日記の本文にHTMLが入っても、生タグにならない", () => {
  const st = STATE(); st.diary["2026-07-25"] = { text: "<img src=x onerror=alert(1)>" };
  const app = bootApp({ state: st });
  app.run(`calYM="2026-07"; calSelected="2026-07-25"; view="calendar"; render();`);
  const out = app.el("app").innerHTML;
  assert.equal(out.includes("<img src=x onerror"), false, "生のHTMLが出力されている");
});

test("支出項目をタップすると記録編集シートが開く", () => {
  assert.match(appSrc, /data-act="cal-edit-tx"/, "支出編集の導線が無い");
  const block = appSrc.slice(appSrc.indexOf('a==="cal-edit-tx"'), appSrc.indexOf('a==="cal-edit-tx"') + 200);
  assert.match(block, /openRecord\(id\)/, "編集シートを開いていない");
});

test("日記・健康の項目からそれぞれのページへ飛べる", () => {
  assert.match(appSrc, /a==="cal-edit-diary"[\s\S]{0,200}view="diary"/, "日記へ飛べない");
  assert.match(appSrc, /a==="cal-edit-health"[\s\S]{0,120}view="health"/, "健康へ飛べない");
});

test("既存データ（家計簿・日記・健康）を壊していない", () => {
  const app = bootApp({ state: STATE() });
  app.run(`view="calendar"; render();`);
  assert.equal(app.run(`state.tx.length`), 4);
  assert.equal(app.run(`Object.keys(state.diary).length`), 2);
  assert.equal(app.run(`state.health["2026-07-25"].weight`), 62.5);
});
