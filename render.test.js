/* =========================================================================
   かけいぼ ― 画面レンダリングテスト（最小DOMで本物のアプリを動かす）
   ブラウザを使わずに「白画面」を検出するのが目的。
   ホーム・まとめ・せってい の3画面を実際に描画し、
   表示された金額がコアの計算と一致することまで確認する。
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("./core.js");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const coreSrc = fs.readFileSync(path.join(__dirname, "core.js"), "utf8");
const appSrc = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].pop()[1];

/* ---------- 最小DOMシム ---------- */
function makeEl(id) {
  const el = {
    id, innerHTML: "", textContent: "", value: "", dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, appendChild() {}, click() {}, focus() {}, remove() {},
    closest: () => null, querySelectorAll: () => [],
  };
  return el;
}

function bootApp(stored) {
  const els = {};
  const get = (id) => (els[id] = els[id] || makeEl(id));
  const store = {};
  if (stored) store["kakeibo:v1:state"] = JSON.stringify(stored);

  const sandbox = {
    console,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    document: {
      getElementById: get,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => makeEl("tmp"),
      head: makeEl("head"), body: makeEl("body"),
    },
    navigator: {},
    window: {},
    scrollTo() {},
    setTimeout: () => 0,
    clearTimeout() {},
    Blob: function () {}, URL: { createObjectURL: () => "blob:", revokeObjectURL() {} },
    FileReader: function () {},
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.window.scrollTo = sandbox.scrollTo;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(coreSrc, ctx, { filename: "core.js" });
  vm.runInContext(appSrc, ctx, { filename: "index.html:inline" });
  return { ctx, app: sandbox.window.__kakeibo, html: () => get("app").innerHTML };
}

const YM = new Date().toISOString().slice(0, 7);
const D = (n) => `${YM}-${String(n).padStart(2, "0")}`;
const SETTINGS = { savingsTarget: 40000, nisaMonthly: 33000, currency: "JPY" };
const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
/* 給与の入力口は「記録」だけ */
const SALARY = { id: "s", type: "income", amount: 290000, cat: "salary", date: D(25) };
/* 固定費98,000ぶんの記録 */
const FIXED98 = [
  { id: "f1", type: "expense", amount: 60000, cat: "rent", date: D(1) },
  { id: "f2", type: "expense", amount: 12000, cat: "power", date: D(2) },
  { id: "f3", type: "expense", amount: 6000, cat: "gas", date: D(2) },
  { id: "f4", type: "expense", amount: 4000, cat: "water", date: D(2) },
  { id: "f5", type: "expense", amount: 8000, cat: "comm", date: D(3) },
  { id: "f6", type: "expense", amount: 3000, cat: "subs", date: D(3) },
  { id: "f7", type: "expense", amount: 5000, cat: "insure", date: D(3) },
];

test("初回起動（データなし）でも3画面が白画面にならない", () => {
  const { app, html: out } = bootApp(null);
  for (const v of ["home", "summary", "settings"]) {
    app.setView(v);
    assert.ok(out().length > 200, `${v} 画面が描画されていない`);
  }
});

test("データありでも3画面が描画される", () => {
  const state = {
    settings: SETTINGS,
    tx: [
      SALARY, ...FIXED98,
      { id: "a", type: "expense", amount: 20000, cat: "food", date: D(5) },
      { id: "b", type: "income", amount: 50000, cat: "bonus", date: D(25) },
    ],
  };
  const { app, html: out } = bootApp(state);
  for (const v of ["home", "summary", "settings"]) {
    app.setView(v);
    assert.ok(out().length > 200, `${v} 画面が描画されていない`);
  }
});

test("ホームに表示される金額が、コアの計算と一致する", () => {
  const state = { settings: SETTINGS, tx: [SALARY, ...FIXED98, { id: "a", type: "expense", amount: 20000, cat: "food", date: D(5) }] };
  const { app, html: out } = bootApp(state);
  const c = Core.computeMonth(SETTINGS, state.tx, YM);
  app.setView("home");
  assert.equal(c.available, 99000);
  assert.ok(out().includes(yen(99000)), `ホームに ${yen(99000)} が出ていない`);
  assert.ok(out().includes("先取り貯金・NISA積立の予定額を除いています"));
});

test("ホームとまとめに、同じ「のこり」が表示される", () => {
  const state = {
    settings: SETTINGS,
    tx: [
      SALARY, ...FIXED98,
      { id: "a", type: "expense", amount: 20000, cat: "food", date: D(5) },
      { id: "b", type: "income", amount: 50000, cat: "bonus", date: D(25) },
    ],
  };
  const { app, html: out } = bootApp(state);
  const c = Core.computeMonth(SETTINGS, state.tx, YM);
  assert.equal(c.available, 149000);

  app.setView("home");
  const home = out();
  app.setView("summary");
  const summary = out();

  assert.ok(home.includes(yen(149000)), "ホームに のこり が出ていない");
  assert.ok(summary.includes(yen(149000)), "まとめに のこり が出ていない");
});

test("固定費を記録しても、まとめの支出が二重にならない", () => {
  const tx = [SALARY, { id: "c", type: "expense", amount: 12000, cat: "power", date: D(10) }];
  const { app, html: out } = bootApp({ settings: SETTINGS, tx });
  const c = Core.computeMonth(SETTINGS, tx, YM);
  assert.equal(c.spendTotal, 12000, "記録した1件ぶんだけが支出になる");
  app.setView("summary");
  assert.ok(out().includes(yen(12000)));
});

test("書き出したJSONが、画面と同じ金額になっている", () => {
  const tx = [
    SALARY, ...FIXED98,
    { id: "a", type: "expense", amount: 20000, cat: "food", date: D(5) },
    { id: "b", type: "income", amount: 50000, cat: "bonus", date: D(25) },
  ];
  const { app } = bootApp({ settings: SETTINGS, tx });
  const j = app.buildSnapshot();
  const c = Core.computeMonth(SETTINGS, tx, YM);
  assert.equal(j.available_to_spend, c.available);
  assert.equal(j.income_actual_total, c.incomeTotal);
  assert.equal(j.variable_spend, c.variableSpend);
  assert.equal(j.fixed_cost, c.fixedSpend);
  assert.equal(j.accounts.find((a) => a.type === "TAX_FREE_INVEST").planned_contribution, 33000);
});

test("旧保存データ（固定費が合計欄）を読んでも落ちない", () => {
  const old = {
    settings: { incomeNet: 290000, fixedCost: 98000, fixed: { rent: 60000 }, savingsTarget: 40000, nisaMonthly: 33000 },
    tx: [SALARY, ...FIXED98],
  };
  const { app, html: out } = bootApp(old);
  app.setView("home");
  assert.ok(out().includes(yen(119000)), "旧設定値が計算に混ざっている");
  app.setView("settings");
  assert.ok(out().length > 200);
});

test("せってい画面に給料・固定費の入力欄が無い（入力口はひとつだけ）", () => {
  const { app, html: out } = bootApp({ settings: SETTINGS, tx: [] });
  app.setView("settings");
  const h = out();
  assert.equal(h.includes('id="f-income"'), false, "設定に手取り収入欄が残っている");
  assert.equal(h.includes('id="f-fx-'), false, "設定に固定費の予定額欄が残っている");
  assert.equal(h.includes("家賃・住居"), false, "設定に固定費の項目が残っている");
  assert.ok(h.includes('id="f-save"') && h.includes('id="f-nisa"'), "先取りの欄が無い");
});

test("給与未記録の月は、ホームが給与の記録をうながす", () => {
  const { app, html: out } = bootApp({ settings: SETTINGS, tx: [] });
  app.setView("home");
  const h = out();
  assert.ok(h.includes("通常給与"), "給与を記録する案内が出ていない");
  assert.equal(h.includes("先取り貯金・NISA積立の予定額を除いています"), false);
});
