/* =========================================================================
   かけいぼ ― 今日やることカードのテスト
   -------------------------------------------------------------------------
   守りたいこと：
     ・やることを増やしすぎない（最大2件）
     ・まだ使っていない機能を催促しない（はじめての人を追い立てない）
     ・済んだら自動で消える
     ・カードは見るだけ。記録を書き換えない
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

const S = { lp: { banks: [{ name: "貯金", monthlyDeposit: 40000 }] }, nisaMonthly: 33000, currency: "JPY" };
const TODAY = "2026-07-16";
const exp = (id, amount, cat, date, recurring) => {
  const t = { id, type: "expense", amount, cat, date };
  if (recurring) t.recurring = true;
  return t;
};
const salary = (id, date) => ({ id, type: "income", amount: 300000, cat: "salary", date });
const stateOf = (o) => ({ settings: S, tx: (o && o.tx) || [], health: (o && o.health) || {}, diary: (o && o.diary) || {} });
const keys = (st, today) => Core.todayTasks(st, today || TODAY).map((t) => t.key);

/* 今月の記録がひととおりあり、やることが何も無い状態 */
const CLEAN = stateOf({
  tx: [
    salary("s6", "2026-06-25"), salary("s7", "2026-07-10"),
    exp("r6", 60000, "rent", "2026-06-01", true),
    exp("r7", 60000, "rent", "2026-07-01", true),
    exp("f", 3000, "food", "2026-07-15"),
  ],
});

test("やることが無い日は、1件も出ない", () => {
  assert.deepEqual(keys(CLEAN), []);
});

/* =========================================================================
   1. 先月の毎月固定
   ========================================================================= */
test("先月の毎月固定が入っていなければ、いちばん上に出る", () => {
  const st = stateOf({ tx: [salary("s6", "2026-06-25"), salary("s7", "2026-07-10"),
                            exp("r6", 60000, "rent", "2026-06-01", true), exp("f", 3000, "food", "2026-07-15")] });
  const tasks = Core.todayTasks(st, TODAY);
  assert.equal(tasks[0].key, "carry");
  assert.match(tasks[0].text, /1件/);
  assert.match(tasks[0].sub, /¥60,000/);
});

test("入れ終われば、その項目は消える", () => {
  assert.equal(keys(CLEAN).includes("carry"), false);
});

/* =========================================================================
   2. 給料
   ========================================================================= */
test("先月までの給料日を過ぎたら、記録をうながす", () => {
  const st = stateOf({ tx: [salary("s6", "2026-06-25"), exp("f", 3000, "food", "2026-07-15")] });
  assert.equal(keys(st, "2026-07-25").includes("salary"), true);
});

test("給料日より前は、まだ催促しない", () => {
  const st = stateOf({ tx: [salary("s6", "2026-06-25"), exp("f", 3000, "food", "2026-07-15")] });
  assert.equal(keys(st, "2026-07-24").includes("salary"), false);
});

test("はじめて使う人（給料の履歴が無い人）には催促しない", () => {
  const st = stateOf({ tx: [exp("f", 3000, "food", "2026-07-15")] });
  assert.equal(keys(st, "2026-07-31").includes("salary"), false);
});

test("今月の給料を記録したら消える", () => {
  const st = stateOf({ tx: [salary("s6", "2026-06-25"), salary("s7", "2026-07-25"), exp("f", 3000, "food", "2026-07-25")] });
  assert.equal(keys(st, "2026-07-26").includes("salary"), false);
});

test("給料日のヒントは、いちばん近い過去の記録から取る", () => {
  const txs = [salary("a", "2026-05-20"), salary("b", "2026-06-25")];
  assert.equal(Core.salaryDayHint(txs, "2026-07"), 25);
  assert.equal(Core.salaryDayHint([], "2026-07"), null);
});

/* =========================================================================
   3. 記録がとだえている
   ========================================================================= */
test("3日あいたら、記録をうながす", () => {
  const st = stateOf({ tx: [salary("s7", "2026-07-10"), exp("f", 3000, "food", "2026-07-13")] });
  assert.equal(keys(st, "2026-07-16").includes("quiet"), true);
});

test("2日なら、まだ声をかけない", () => {
  const st = stateOf({ tx: [salary("s7", "2026-07-10"), exp("f", 3000, "food", "2026-07-14")] });
  assert.equal(keys(st, "2026-07-16").includes("quiet"), false);
});

test("支出の記録が1件も無い人には出さない（はじめの一歩を急かさない）", () => {
  const st = stateOf({ tx: [salary("s7", "2026-07-10")] });
  assert.equal(keys(st, "2026-07-31").includes("quiet"), false);
});

test("まだ来ていない日付の記録は、最後の記録に数えない", () => {
  const txs = [exp("a", 1000, "food", "2026-07-13"), exp("b", 1000, "food", "2026-08-01")];
  assert.equal(Core.lastExpenseDate(txs, TODAY), "2026-07-13");
});

test("あいた日数がそのまま文言に出る", () => {
  const st = stateOf({ tx: [salary("s7", "2026-07-10"), exp("f", 3000, "food", "2026-07-11")] });
  const t = Core.todayTasks(st, "2026-07-16").filter((x) => x.key === "quiet")[0];
  assert.match(t.text, /5日/);
});

/* =========================================================================
   4. 日記・健康（続けている人にだけ）
   ========================================================================= */
const habitDiary = { "2026-07-13": { text: "a" }, "2026-07-14": { text: "b" }, "2026-07-15": { text: "c" } };

test("日記を続けている人には、今日ぶんをうながす", () => {
  const st = stateOf({ tx: CLEAN.tx, diary: habitDiary });
  assert.equal(keys(st).includes("diary"), true);
});

test("今日ぶんを書いたら消える", () => {
  const diary = Object.assign({}, habitDiary, { "2026-07-16": { text: "きょう" } });
  assert.equal(keys(stateOf({ tx: CLEAN.tx, diary: diary })).includes("diary"), false);
});

test("たまにしか書かない人には、日記を催促しない", () => {
  const st = stateOf({ tx: CLEAN.tx, diary: { "2026-07-14": { text: "a" }, "2026-07-15": { text: "b" } } });
  assert.equal(keys(st).includes("diary"), false);
});

test("ずっと前に書いただけの人にも催促しない", () => {
  const old = { "2026-05-01": { text: "a" }, "2026-05-02": { text: "b" }, "2026-05-03": { text: "c" } };
  assert.equal(keys(stateOf({ tx: CLEAN.tx, diary: old })).includes("diary"), false);
});

test("健康も、続けている人にだけ出る", () => {
  const health = { "2026-07-13": { weight: 62 }, "2026-07-14": { weight: 62 }, "2026-07-15": { weight: 62 } };
  assert.equal(keys(stateOf({ tx: CLEAN.tx, health: health })).includes("health"), true);
  assert.equal(keys(stateOf({ tx: CLEAN.tx, health: { "2026-07-15": { weight: 62 } } })).includes("health"), false);
});

test("習慣の判定は、今日を除いた直近14日で見る", () => {
  assert.equal(Core.HABIT_WINDOW, 14);
  assert.equal(Core.isHabit({ "2026-07-16": 1, "2026-07-15": 1, "2026-07-14": 1 }, "2026-07-16"), false);
  assert.equal(Core.isHabit({ "2026-07-15": 1, "2026-07-14": 1, "2026-07-13": 1 }, "2026-07-16"), true);
});

/* =========================================================================
   5. 出しすぎない
   ========================================================================= */
test("やることは、多くても2件まで", () => {
  const st = stateOf({
    tx: [salary("s6", "2026-06-01"), exp("r6", 60000, "rent", "2026-06-01", true), exp("f", 3000, "food", "2026-07-01")],
    diary: habitDiary,
    health: { "2026-07-13": { weight: 62 }, "2026-07-14": { weight: 62 }, "2026-07-15": { weight: 62 } },
  });
  const all = Core.todayTasks(st, TODAY);
  assert.equal(all.length, 2, "3件以上出ている: " + all.length);
  assert.deepEqual(all.map((t) => t.key), ["carry", "salary"], "優先順がちがう");
  assert.equal(Core.TASK_MAX, 2);
});

test("日付がおかしいときは、何も出さない（落ちない）", () => {
  assert.deepEqual(Core.todayTasks(CLEAN, "2026-02-31"), []);
  assert.deepEqual(Core.todayTasks(null, TODAY), []);
});

/* =========================================================================
   6. 画面
   ========================================================================= */
const NOW = new Date().toISOString().slice(0, 10);
const NOW_YM = NOW.slice(0, 7);
const PREV = Core.shiftYm(NOW_YM, -1);
const liveState = {
  settings: S,
  tx: [
    { id: "p1", type: "expense", amount: 60000, cat: "rent", date: PREV + "-05", recurring: true },
    { id: "p2", type: "expense", amount: 3000, cat: "food", date: PREV + "-06" },
  ],
  health: {}, diary: {},
};
const homeHtml = (state) => {
  const app = bootApp({ state: state });
  app.run(`__kakeibo.setView("home")`);
  return { app: app, html: app.el("app").innerHTML };
};

test("ホームに「今日やること」が出る", () => {
  const { html } = homeHtml(liveState);
  assert.match(html, /今日やること/);
  assert.match(html, /data-act="task"/);
  assert.match(html, /先月の毎月固定/);
});

test("やることが無ければ、カードごと出ない", () => {
  const { html } = homeHtml({ settings: S, tx: [], health: {}, diary: {} });
  assert.equal(/今日やること/.test(html), false, "空のカードが出ている");
});

test("タップすると、まとめ画面へ移る", () => {
  const { app } = homeHtml(liveState);
  app.run(`goTask("carry")`);
  assert.match(app.el("app").innerHTML, /先月の毎月固定が/);
});

test("給料のやることをタップすると、収入の記録が開く", () => {
  const st = { settings: S, tx: [
    { id: "s6", type: "income", amount: 300000, cat: "salary", date: PREV + "-01" },
    { id: "e1", type: "expense", amount: 3000, cat: "food", date: NOW },
  ], health: {}, diary: {} };
  const { app } = homeHtml(st);
  app.run(`goTask("salary")`);
  assert.equal(app.run(`sheetState.type`), "income");
  assert.equal(app.run(`sheetState.cat`), "salary");
});

test("カードを見ても、記録は書き換わらない", () => {
  const app = bootApp({ state: liveState });
  const before = app.saved();
  app.run(`__kakeibo.setView("home"); goTask("carry");`);
  assert.equal(app.saved(), before, "見ただけで保存データが変わっている");
});
