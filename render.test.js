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
    closest: () => null, querySelectorAll: () => [] };
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
      setItem: (k, v) => { store[k] = String(v); } },
    document: {
      getElementById: get,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => makeEl("tmp"),
      head: makeEl("head"), body: makeEl("body") },
    navigator: {},
    window: {},
    scrollTo() {},
    setTimeout: () => 0,
    clearTimeout() {},
    Blob: function () {}, URL: { createObjectURL: () => "blob:", revokeObjectURL() {} },
    FileReader: function () {} };
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
const SETTINGS = { birth: "1968-11-13", lp: { banks: [{ name: "貯金", monthlyDeposit: 40000 }], tsumitateSchedule: [{ fromAge: 0, toAge: 120, funds: [{ name: "全世界株式", amount: 33000 }] }] }, currency: "JPY" };
const yen = (n) => "¥" + Math.round(n).toLocaleString("en-US");
/* 給与の入力口は「記録」だけ */
const SALARY = { id: "s", type: "income", amount: 290000, cat: "salary", date: D(25) };
/* 支出98,000ぶんの記録 */
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
    ] };
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
    ] };
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

test("支出を記録しても、まとめの支出が二重にならない", () => {
  const tx = [SALARY, { id: "c", type: "expense", amount: 12000, cat: "power", date: D(10) }];
  const { app, html: out } = bootApp({ settings: SETTINGS, tx });
  const c = Core.computeMonth(SETTINGS, tx, YM);
  assert.equal(c.spendTotal, 12000, "記録した1件ぶんだけが支出になる");
  app.setView("summary");
  assert.ok(out().includes(yen(12000)));
});

test("ライフプランへ渡す資産が、画面の内訳と同じになっている", () => {
  const tx = [
    SALARY, ...FIXED98,
    { id: "a", type: "expense", amount: 20000, cat: "food", date: D(5) },
    { id: "b", type: "income", amount: 50000, cat: "bonus", date: D(25) },
  ];
  const { app } = bootApp({ settings: SETTINGS, tx });
  const j = Core.buildLifePlanInputs(app.state.settings);
  const c = Core.computeMonth(SETTINGS, tx, YM);
  assert.equal(j.source, "kakeibo");
  assert.equal(j.inputs.banks[0].monthlyDeposit, 40000, "銀行貯金が渡っていない");
  assert.equal(j.inputs.tsumitateSchedule[0].monthlyYen, 33000, "NISAの区間が渡っていない");
  /* 画面の先取りと、渡す資産の毎月ぶんが食い違わない */
  assert.equal(c.nisaPlanned, 33000);
});

test("旧保存データ（支出が合計欄）を読んでも落ちない", () => {
  const old = {
    settings: { incomeNet: 290000, fixedCost: 98000, fixed: { rent: 60000 }, birth: "1968-11-13", lp: { banks: [{ name: "貯金", monthlyDeposit: 40000 }], tsumitateSchedule: [{ fromAge: 0, toAge: 120, funds: [{ name: "全世界株式", amount: 33000 }] }] } },
    tx: [SALARY, ...FIXED98] };
  const { app, html: out } = bootApp(old);
  app.setView("home");
  assert.ok(out().includes(yen(119000)), "旧設定値が計算に混ざっている");
  app.setView("settings");
  assert.ok(out().length > 200);
});

test("せってい画面に給料・支出の入力欄が無い（入力口はひとつだけ）", () => {
  const { app, html: out } = bootApp({ settings: SETTINGS, tx: [] });
  app.setView("settings");
  const h = out();
  assert.equal(h.includes('id="f-income"'), false, "設定に手取り収入欄が残っている");
  assert.equal(h.includes('id="f-fx-'), false, "設定に支出の予定額欄が残っている");
  assert.equal(h.includes("家賃・住居"), false, "設定に支出の項目が残っている");
  assert.equal(h.includes('id="f-save"'), false, "廃止した先取り貯金の欄が残っている");
  assert.equal(h.includes('id="f-nisa"'), false, "廃止したNISA積立の欄が残っている");
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

test("タイルから、それぞれの入力口へジャンプできる", () => {
  const { app, html: out } = bootApp({ settings: SETTINGS, tx: [SALARY] });
  app.setView("home");
  const h = out();
  /* NISAの入力口は「内訳」だけ。設定の古い欄へは飛ばさない。 */
  assert.match(h, /data-act="lp-open" data-kind="nisa"/, "NISAが内訳へ飛ばない");
  assert.equal(h.includes('data-focus="f-nisa"'), false, "廃止したNISAの欄へ飛んでいる");
  assert.equal(h.includes('data-focus="f-save"'), false, "廃止した先取り貯金の欄へ飛んでいる");
  ["gold", "banks", "loans", "ideco", "insurance", "pension"].forEach((k) =>
    assert.ok(h.includes(`data-kind="${k}"`), `${k} のタイルが無い`));
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

/* ---------- まとめ画面：棒グラフは収入比・週次ヘッダーは重複削除 ---------- */
test("まとめの「今週つかった」ヘッダーは削除されている（きろくと重複）", () => {
  assert.equal(appSrc.includes("今週つかった（記録した支出）"), false, "週次の重複ヘッダーが残っている");
});

test("支出の横棒は収入に対する割合で表示する", () => {
  assert.match(appSrc, /const barBase = c\.incomeTotal>0 \? c\.incomeTotal/, "棒の基準が収入になっていない");
  assert.match(appSrc, /v\/barBase\*100/, "収入比で幅を計算していない");
  assert.match(appSrc, /\$\{pct\}%/, "パーセント表示が無い");
});

test("収入が無い月でも棒グラフが壊れない", () => {
  const { app, html: out } = bootApp({ settings: SETTINGS, tx: [
    { id:"a", type:"expense", amount:1000, cat:"food", date:D(1) },
  ]});
  app.setView("summary");
  const h = out();
  assert.ok(h.includes("食費"), "支出が表示されていない");
  assert.equal(/width:NaN/.test(h), false, "幅の計算が壊れている");
});

test("収入に対する割合が正しい（支出2万・収入28万なら約7%）", () => {
  const { app, html: out } = bootApp({ settings: SETTINGS, tx: [
    { id:"s", type:"income", amount:280000, cat:"salary", date:D(25) },
    { id:"f", type:"expense", amount:20000, cat:"food", date:D(5) },
  ]});
  app.setView("summary");
  const h = out();
  assert.ok(h.includes("7%"), "収入比のパーセントが出ていない: " + (h.match(/\d+%/g)||[]).join(","));
});

test("まとめの記録一覧の見出しが「記録（タップで編集）」になっている", () => {
  assert.match(appSrc, /記録（タップで編集）/, "見出しが更新されていない");
  assert.equal(appSrc.includes(">きろく<"), false, "古い「きろく」見出しが残っている");
});

/* ---------- まとめの円グラフ（Ver.2 ④） ---------- */
test("収入を100%として支出・先取り・のこりの割合を返す", () => {
  const c = { incomeTotal: 290000, spendTotal: 80000, setAside: 73000, available: 137000 };
  const b = Core.budgetBreakdown(c);
  assert.equal(b.income, 290000);
  const spend = b.parts.find(p => p.key === "spend");
  const setAside = b.parts.find(p => p.key === "setAside");
  const remain = b.parts.find(p => p.key === "remain");
  assert.equal(spend.amount, 80000);
  assert.equal(setAside.amount, 73000);
  assert.equal(remain.amount, 137000);
  assert.equal(spend.pct + setAside.pct + remain.pct, 100, "割合の合計が100%でない");
});

test("使いすぎ（支出+先取り>収入）は over で示し、のこりは0", () => {
  const c = { incomeTotal: 100000, spendTotal: 150000, setAside: 100000 };
  const b = Core.budgetBreakdown(c);
  assert.equal(b.over, 150000, "使いすぎ分が合わない");
  assert.equal(b.parts.find(p => p.key === "remain").amount, 0, "のこりがマイナスになっている");
});

test("収入0でも割合計算が壊れない", () => {
  const b = Core.budgetBreakdown({ incomeTotal: 0, spendTotal: 5000, setAside: 0 });
  assert.equal(b.income, 0);
  b.parts.forEach(p => assert.ok(Number.isFinite(p.pct), "pctがNaN"));
});

test("まとめ画面に円グラフ（SVG）が出る", () => {
  const { app, html: out } = bootApp({ settings: SETTINGS, tx: [
    { id: "s", type: "income", amount: 290000, cat: "salary", date: D(25) },
    { id: "e", type: "expense", amount: 80000, cat: "food", date: D(5) },
  ]});
  app.setView("summary");
  const h = out();
  assert.match(h, /収入の使いみち/, "円グラフの見出しが無い");
  assert.match(h, /<svg/, "SVGが描かれていない");
  assert.match(h, /<circle/, "円が描かれていない");
  assert.ok(h.includes("支出") && h.includes("先取り") && h.includes("のこり"), "凡例が無い");
});

test("円グラフの割合表示が正しい（支出28%など）", () => {
  const { app, html: out } = bootApp({ settings: SETTINGS, tx: [
    { id: "s", type: "income", amount: 290000, cat: "salary", date: D(25) },
    { id: "e", type: "expense", amount: 80000, cat: "food", date: D(5) },
  ]});
  app.setView("summary");
  const h = out();
  assert.ok(h.includes("28%"), "支出28%が出ていない: " + (h.match(/\d+%/g) || []).join(","));
});

test("既存のカード表示・横棒グラフは残っている", () => {
  const { app, html: out } = bootApp({ settings: SETTINGS, tx: [
    { id: "e", type: "expense", amount: 80000, cat: "food", date: D(5) },
  ]});
  app.setView("summary");
  const h = out();
  assert.ok(h.includes("sumcards"), "サマリーカードが消えている");
  assert.match(appSrc, /const bars =/, "横棒グラフが消えている");
});
