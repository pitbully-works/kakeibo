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

test("給与未記録の月は、金額を出さずに記録をうながす", () => {
  const { app, html: out } = bootApp({ settings: SETTINGS, tx: [] });
  app.setView("home");
  const h = out();
  assert.ok(h.includes("給料を記録すると、ここに出ます"), "記録をうながす案内が出ていない");
  assert.ok(h.includes("—"), "金額のかわりのダッシュが出ていない");
  assert.equal(h.includes("先取り貯金・NISA積立の予定額を除いています"), false);
});

test("ホームから消した要素が復活していない", () => {
  const { app, html: out } = bootApp({ settings: SETTINGS, tx: [SALARY] });
  app.setView("home");
  const h = out();
  for (const gone of ["今月 つかった金額", "手で入力", "きろく", "手取りは設定", 'aria-label="設定"']) {
    assert.equal(h.includes(gone), false, `ホームに「${gone}」が残っている`);
  }
});

test("ホームの日付が大きく表示される", () => {
  const { app, html: out } = bootApp({ settings: SETTINGS, tx: [SALARY] });
  app.setView("home");
  const d = new Date();
  assert.ok(out().includes(`class="date"`), "日付の大きい表示が無い");
  assert.ok(out().includes(`${d.getMonth() + 1}月${d.getDate()}日`), "今日の日付が出ていない");
});

test("目標・NISA・貯金のタイルから設定の入力欄へジャンプできる", () => {
  const { app, html: out } = bootApp({ settings: SETTINGS, tx: [SALARY] });
  app.setView("home");
  const h = out();
  for (const id of ["f-nisa", "f-save"]) {
    assert.ok(h.includes(`data-focus="${id}"`), `${id} へのジャンプが無い`);
  }
  assert.ok(h.includes('data-focus="f-gname"') || h.includes('data-focus="f-gcur"'), "目標へのジャンプが無い");
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "index.html"), "utf8");
  assert.match(src, /function focusField\(id\)/, "ジャンプ後にフォーカスする処理が無い");
});

test("記録シートを開いてもナビが隠れない（ナビが前面・シートはナビの上まで）", () => {
  const fs2 = require("node:fs");
  const css = fs2.readFileSync(require("node:path").join(__dirname, "index.html"), "utf8");
  const navZ = /\.nav\{[^}]*z-index:(\d+)\}/.exec(css);
  const sheetZ = /\.sheet\{[^}]*z-index:(\d+)/.exec(css);
  assert.ok(navZ && sheetZ, "z-index が読み取れない");
  assert.ok(Number(navZ[1]) > Number(sheetZ[1]), "ナビがシートより後ろにある");
  assert.match(css, /\.sheet\{[^}]*bottom:calc\(var\(--nav-h\)/, "シートがナビの上で止まっていない");
});

test("記録シートに閉じるボタンがある", () => {
  const { ctx } = bootApp({ settings: SETTINGS, tx: [] });
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "index.html"), "utf8");
  assert.match(src, /data-act="close-sheet"/, "閉じるボタンが無い");
  assert.match(src, /if\(a==="close-sheet"\) return showSheet\(false\);/, "閉じる処理が無い");
});

test("ナビを押すと記録シートが閉じてから画面が切り替わる", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "index.html"), "utf8");
  assert.match(src, /closest\("#nav button"\); if\(nav\)\{ showSheet\(false\);/, "ナビ操作でシートを閉じていない");
});
