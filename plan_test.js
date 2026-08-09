/* =========================================================================
   かけいぼ ― 予定（スケジュール）のテスト
   -------------------------------------------------------------------------
   守りたいこと：
     ・カレンダーで日を選び、その日の画面で予定を書ける
     ・1日に何件でも入れられ、時刻は任意。時刻の早い順にならぶ
     ・済んだらチェックでき、今日の予定はホームにも出る
     ・予定はお金の計算にいっさい関わらない
     ・保存に失敗したら、書く前の状態へ完全に戻す
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

const TODAY = new Date().toISOString().slice(0, 10);
const plan = (id, time, text, done) => ({ id, time, text, done: done === true });
const stateWith = (plans, tx) => ({ settings: {}, tx: tx || [], health: {}, diary: {}, plans: plans || {} });
const boot = (plans, tx, opts) => bootApp(Object.assign({ state: stateWith(plans, tx) }, opts || {}));
/* ホームの「今日やること」カードだけを切り出す（下の「今月の予定」と混ぜないため） */
const todosCard = (h) => {
  const from = h.indexOf('class="todos"');
  return from < 0 ? "" : h.slice(from, h.indexOf('class="dreamlbl"'));
};
const screen = (app, view, date) => {
  app.run(`view=${JSON.stringify(view)}; ${date ? `diaryEditDate=${JSON.stringify(date)};` : ""} render();`);
  return app.el("app").innerHTML;
};

/* ---------- 1. 予定の形をそろえる ---------- */

test("時刻は HH:MM にそろえる。おかしな値は「時刻なし」にする", () => {
  assert.equal(Core.normalizeTimeString("9:05"), "09:05");
  assert.equal(Core.normalizeTimeString("14:00"), "14:00");
  assert.equal(Core.normalizeTimeString(""), "");
  assert.equal(Core.normalizeTimeString("25:00"), "");
  assert.equal(Core.normalizeTimeString("14:60"), "");
  assert.equal(Core.normalizeTimeString("ひる"), "");
  assert.equal(Core.normalizeTimeString(null), "");
});

test("中身の無い予定は残さない", () => {
  const out = Core.normalizePlans({ "2026-08-03": [plan("a", "10:00", "  "), plan("b", "", "床屋"), null, "x"] });
  assert.equal(out["2026-08-03"].length, 1);
  assert.equal(out["2026-08-03"][0].text, "床屋");
});

test("おかしな日付の予定は読み捨てる", () => {
  assert.deepEqual(Core.normalizePlans({ "2026-13-40": [plan("a", "", "×")] }), {});
  assert.deepEqual(Core.normalizePlans(null), {});
  assert.deepEqual(Core.normalizePlans([1, 2]), {});
});

test("時刻の早い順にならび、時刻なしは最後になる", () => {
  const list = Core.sortPlans([plan("a", "", "夜に洗濯"), plan("b", "14:00", "病院"), plan("c", "09:30", "歯医者")]);
  assert.deepEqual(list.map((p) => p.text), ["歯医者", "病院", "夜に洗濯"]);
});

test("1日に入れられる件数と、1件の文字数に上限がある", () => {
  const many = [];
  for (let i = 0; i < Core.PLAN_PER_DAY_MAX + 5; i++) many.push(plan("p" + i, "", "予定" + i));
  assert.equal(Core.normalizePlans({ "2026-08-03": many })["2026-08-03"].length, Core.PLAN_PER_DAY_MAX);

  const long = "あ".repeat(Core.PLAN_TEXT_MAX + 30);
  assert.equal(Core.normalizePlans({ "2026-08-03": [plan("a", "", long)] })["2026-08-03"][0].text.length, Core.PLAN_TEXT_MAX);
});

/* ---------- 2. 読み出し ---------- */

test("今日の予定は、まだ済んでいないものだけ返す", () => {
  const st = stateWith({ [TODAY]: [plan("a", "09:00", "済んだ用事", true), plan("b", "10:00", "これから")] });
  assert.deepEqual(Core.dayPlans(st, TODAY).map((p) => p.text), ["済んだ用事", "これから"]);
  assert.deepEqual(Core.todayPlans(st, TODAY).map((p) => p.text), ["これから"]);
  assert.deepEqual(Core.todayPlans(st, "こわれた日付"), []);
});

test("これから先の予定を、日付の早い順に取り出せる", () => {
  const st = stateWith({
    "2026-08-05": [plan("b", "", "後の日")],
    "2026-08-03": [plan("a", "", "先の日")],
    "2020-01-01": [plan("z", "", "ずっと前")] });
  assert.deepEqual(Core.upcomingPlans(st, "2026-08-01", 10).map((x) => x.plan.text), ["先の日", "後の日"]);
});

test("カレンダーの印と、その日の中身に予定が入る", () => {
  const st = stateWith({ "2026-08-03": [plan("a", "14:00", "病院")] });
  assert.equal(Core.monthMarks(st, "2026-08")["2026-08-03"].plan, true);
  const dd = Core.dayDetail(st, "2026-08-03");
  assert.equal(dd.plans.length, 1);
  assert.equal(dd.plans[0].text, "病院");
  assert.equal(dd.hasAny, true, "予定だけの日も「記録あり」として扱う");
});

/* ---------- 3. お金には関わらない ---------- */

test("予定を入れても、お金の計算は1円も変わらない", () => {
  const tx = [{ id: "s", type: "income", amount: 300000, cat: "salary", date: "2026-08-03" },
              { id: "e", type: "expense", amount: 5000, cat: "food", date: "2026-08-04" }];
  const before = Core.computeMonth({}, tx, "2026-08");
  const st = stateWith({ "2026-08-03": [plan("a", "14:00", "病院")] }, tx);
  const after = Core.computeMonth(st.settings, st.tx, "2026-08");
  assert.equal(after.incomeTotal, before.incomeTotal);
  assert.equal(after.spendTotal, before.spendTotal);
  assert.equal(after.available, before.available);
});

test("バックアップに予定が入り、読み込みで戻る", () => {
  const st = stateWith({ "2026-08-03": [plan("a", "14:00", "病院")] });
  const back = Core.buildBackup(st);
  assert.equal(back.plans["2026-08-03"][0].text, "病院");
  const restored = Core.normalizeBackup(JSON.parse(JSON.stringify(back)));
  assert.equal(restored.plans["2026-08-03"][0].time, "14:00");
});

test("予定が入っていない古いバックアップでも落ちない", () => {
  const old = { version: 1, settings: {}, tx: [], diary: {}, health: {} };
  assert.deepEqual(Core.normalizeBackup(old).plans, {});
});

/* ---------- 4. 画面 ---------- */

test("カレンダーで日を選ぶと、その日の予定を書く入口が出る", () => {
  const app = boot({ "2026-08-03": [plan("a", "14:00", "病院")] });
  app.run(`view="calendar"; calYM="2026-08"; calSelected="2026-08-03"; render();`);
  const h = app.el("app").innerHTML;
  assert.match(h, /この日の予定を書く/, "予定を書く入口が無い");
  assert.match(h, /📝 <b class="mono">14:00<\/b> 病院/, "その日の予定が出ていない");
  assert.match(h, /background:#8a76c4/, "カレンダーに予定の印が出ていない");
});

test("日記の画面の上に、その日の予定を書くところがある", () => {
  const h = screen(boot({}), "diary", "2026-08-03");
  assert.ok(h.indexOf("予定（08/03）") < h.indexOf("日記（08/03）"), "予定が日記より下にある");
  assert.match(h, /id="p-time"/);
  assert.match(h, /id="p-text"/);
  assert.match(h, /この日の予定はありません/);
});

test("予定を入れると保存される（時刻あり）", () => {
  const app = boot({});
  screen(app, "diary", "2026-08-03");
  app.el("p-time").value = "09:30";
  app.el("p-text").value = "歯医者";
  app.run(`addPlan("2026-08-03");`);
  const saved = JSON.parse(app.saved()).plans["2026-08-03"];
  assert.equal(saved.length, 1);
  assert.equal(saved[0].time, "09:30");
  assert.equal(saved[0].text, "歯医者");
  assert.equal(saved[0].done, false);
});

test("時刻を入れなくても予定を入れられる", () => {
  const app = boot({});
  screen(app, "diary", "2026-08-03");
  app.el("p-text").value = "クリーニング";
  app.run(`addPlan("2026-08-03");`);
  assert.equal(JSON.parse(app.saved()).plans["2026-08-03"][0].time, "");
});

test("何も書かずに押しても、予定は増えない", () => {
  const app = boot({});
  screen(app, "diary", "2026-08-03");
  app.el("p-text").value = "   ";
  app.run(`addPlan("2026-08-03");`);
  assert.equal(app.run(`Object.keys(state.plans).length`), 0);
  assert.match(app.toastText(), /予定を書いて/);
});

test("チェックすると済みになり、もう一度押すと戻る", () => {
  const app = boot({ "2026-08-03": [plan("a", "14:00", "病院")] });
  app.run(`togglePlan("2026-08-03","a");`);
  assert.equal(JSON.parse(app.saved()).plans["2026-08-03"][0].done, true);
  app.run(`togglePlan("2026-08-03","a");`);
  assert.equal(JSON.parse(app.saved()).plans["2026-08-03"][0].done, false);
});

test("予定を消せる。最後の1件を消したら、その日ごと消える", () => {
  const app = boot({ "2026-08-03": [plan("a", "", "床屋"), plan("b", "", "買い物")] });
  app.run(`delPlan("2026-08-03","a");`);
  assert.deepEqual(JSON.parse(app.saved()).plans["2026-08-03"].map((p) => p.text), ["買い物"]);
  app.run(`delPlan("2026-08-03","b");`);
  assert.equal(JSON.parse(app.saved()).plans["2026-08-03"], undefined);
});

test("保存できないときは、書く前の状態へ完全に戻す", () => {
  const app = boot({}, [], { storageFull: true });
  screen(app, "diary", "2026-08-03");
  app.el("p-text").value = "歯医者";
  app.run(`addPlan("2026-08-03");`);
  assert.equal(app.run(`Object.keys(state.plans).length`), 0, "画面の状態に書き込みが残っている");
  assert.match(app.toastText(), /保存できません/);
});

test("ホームの「今日やること」に、今日の予定が出る", () => {
  const app = boot({ [TODAY]: [plan("a", "14:00", "病院")] });
  const h = screen(app, "home");
  assert.match(h, /今日やること/);
  assert.match(h, /14:00　病院/);
  assert.match(h, /data-act="plan-toggle"/, "その場でチェックできない");
});

test("済んだ予定は、「今日やること」から消える", () => {
  const h = screen(boot({ [TODAY]: [plan("a", "14:00", "病院", true)] }), "home");
  assert.equal(todosCard(h).includes("病院"), false);
});

test("今日の予定が多いときは、上から3件だけ出す", () => {
  const list = [];
  for (let i = 1; i <= 6; i++) list.push(plan("p" + i, "0" + i + ":00", "予定" + i));
  const card = todosCard(screen(boot({ [TODAY]: list }), "home"));
  assert.match(card, /予定1/);
  assert.match(card, /予定3/);
  assert.equal(card.includes("予定4"), false, "4件目まで出ている");
  assert.match(card, /ほか 3件 の予定があります/);
});

test("予定も やることも 無ければ、カードごと出ない", () => {
  const h = screen(boot({}), "home");
  assert.equal(h.includes("今日やること"), false);
});

/* ---------- 5. ホームの「今月の予定」 ---------- */

const YM = TODAY.slice(0, 7);
const D = (d) => `${YM}-${String(d).padStart(2, "0")}`;
/* ホーム下部の「今月の予定」だけを切り出す */
const monthCard = (h) => {
  const from = h.indexOf("今月の予定（");
  return from < 0 ? "" : h.slice(from);
};

test("暦の月でまとめる（給料日起点の設定には引きずられない）", () => {
  const st = { settings: { cycleStart: 20 }, tx: [], health: {}, diary: {},
    plans: { "2026-07-05": [plan("a", "", "月の前半")], "2026-08-01": [plan("b", "", "来月")] } };
  const m = Core.monthPlans(st, "2026-07");
  assert.deepEqual(m.days.map((d) => d.date), ["2026-07-05"], "暦の月の外が混ざっている");
  assert.equal(m.total, 1);
});

test("件数と、のこり件数を数える", () => {
  const m = Core.monthPlans(stateWith({
    "2026-07-05": [plan("a", "", "済んだ", true), plan("b", "", "まだ")],
    "2026-07-09": [plan("c", "", "まだ2")] }), "2026-07");
  assert.equal(m.total, 3);
  assert.equal(m.done, 1);
  assert.equal(m.left, 2);
});

test("ホームに今月の予定が、日付の早い順に出る", () => {
  const h = screen(boot({ [D(9)]: [plan("b", "10:00", "後の日")], [D(3)]: [plan("a", "", "先の日")] }), "home");
  const card = monthCard(h);
  assert.match(card, /今月の予定（\d+月）/);
  assert.ok(card.indexOf("先の日") < card.indexOf("後の日"), "日付の順になっていない");
  assert.match(card, /2件　のこり <b[^>]*>2件<\/b>/);
});

test("済んだ予定も、グレーで残る", () => {
  const card = monthCard(screen(boot({ [D(3)]: [plan("a", "", "済んだ用事", true)] }), "home"));
  assert.match(card, /class="prow done"/, "グレーの印が付いていない");
  assert.match(card, /済んだ用事/, "一覧から消えている");
  assert.match(card, /☑/);
});

test("ほかの月の予定は出さない", () => {
  const card = monthCard(screen(boot({ "2020-01-05": [plan("a", "", "ずっと前")], [D(3)]: [plan("b", "", "今月")] }), "home"));
  assert.match(card, /今月/);
  assert.equal(card.includes("ずっと前"), false);
});

test("予定が無い月は、カードごと出さない", () => {
  assert.equal(screen(boot({ "2020-01-05": [plan("a", "", "ずっと前")] }), "home").includes("今月の予定（"), false);
});

test("一覧からその場でチェックでき、文字をタップするとその日の画面へ行ける", () => {
  const card = monthCard(screen(boot({ [D(3)]: [plan("a", "09:00", "歯医者")] }), "home"));
  assert.match(card, new RegExp(`data-act="plan-toggle" data-date="${D(3)}" data-id="a"`));
  assert.match(card, new RegExp(`data-act="cal-edit-plan" data-date="${D(3)}"`));
});

test("多すぎるときは打ち切って、カレンダーへ案内する", () => {
  const plans = {};
  for (let d = 1; d <= 25; d++) plans[D(d)] = [plan("p" + d, "", "予定" + d)];
  const card = monthCard(screen(boot(plans), "home"));
  assert.match(card, new RegExp(`ほか ${25 - Core.PLAN_HOME_MAX}件 をカレンダーで見る`));
  assert.match(card, /data-nav="calendar"/);
});

test("今月の予定は、記録するボタンより下に出す", () => {
  const h = screen(boot({ [D(3)]: [plan("a", "", "予定")] }), "home");
  assert.ok(h.indexOf("📸 記録する") < h.indexOf("今月の予定（"), "記録するボタンより上に出ている");
});
