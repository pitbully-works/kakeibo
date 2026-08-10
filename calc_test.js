/* =========================================================================
   かけいぼ ― 金額の電卓のテスト
   -------------------------------------------------------------------------
   守りたいこと：
     ・＋ー×÷ が正しく計算できる（円なので答えは整数）
     ・打っている式が見える
     ・＝ を押し忘れても、記録するときには計算されている
     ・0で割ろうとしても壊れない
     ・iPhoneのキーボードは出さない（アプリの電卓だけで打てる）
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

/* キーを順に押して、最後の状態を返す */
const type = (...keys) => keys.reduce((c, k) => Core.calcPress(c, k), Core.newCalc());
const shown = (c) => Core.calcDisplay(c);

/* ---------- 1. 打ち込み ---------- */

test("数字を押すと、そのまま出る", () => {
  assert.equal(shown(type("1", "2", "0", "0")), "1200");
});

test("何も押していないときは空（0のプレースホルダが出る）", () => {
  assert.equal(shown(Core.newCalc()), "");
});

test("先頭に0はためない", () => {
  assert.equal(shown(type("0", "0", "5")), "5");
  assert.equal(shown(type("0")), "0");
});

test("00 と 000 でまとめて打てる", () => {
  assert.equal(shown(type("1", "000")), "1000");
  assert.equal(shown(type("2", "5", "00")), "2500");
});

test("桁数には上限がある", () => {
  const many = [];
  for (let i = 0; i < Core.CALC_DIGITS_MAX + 5; i++) many.push("9");
  assert.equal(shown(type.apply(null, many)).length, Core.CALC_DIGITS_MAX);
});

test("⌫ で1文字ずつ消える", () => {
  assert.equal(shown(type("1", "2", "3", "back")), "12");
  assert.equal(shown(type("1", "back", "back")), "");
});

test("C を押すと、ぜんぶ消える", () => {
  const c = type("1", "2", "+", "3", "C");
  assert.equal(shown(c), "");
  assert.equal(c.expr, "");
  assert.equal(c.op, "");
});

/* ---------- 2. 計算 ---------- */

test("足し算・引き算ができる", () => {
  assert.equal(shown(type("1", "2", "0", "0", "+", "3", "8", "0", "=")), "1580");
  assert.equal(shown(type("1", "0", "0", "0", "-", "2", "5", "0", "=")), "750");
});

test("かけ算・わり算ができる", () => {
  assert.equal(shown(type("5", "0", "0", "*", "3", "=")), "1500");
  assert.equal(shown(type("1", "2", "0", "0", "/", "4", "=")), "300");
});

test("わり算の答えは、四捨五入して整数にする（円なので）", () => {
  assert.equal(shown(type("1", "0", "0", "0", "/", "3", "=")), "333");
  assert.equal(shown(type("1", "0", "/", "4", "=")), "3");
});

test("マイナスの答えも出せる", () => {
  assert.equal(shown(type("1", "0", "0", "-", "3", "0", "0", "=")), "-200");
});

test("続けて押すと、そのつど計算していく", () => {
  assert.equal(shown(type("1", "+", "2", "+", "3", "=")), "6");
  assert.equal(shown(type("2", "*", "3", "*", "4", "=")), "24");
});

test("演算子は押し直せる", () => {
  assert.equal(shown(type("1", "0", "+", "*", "3", "=")), "30");
});

test("0で割ろうとしたら教える。打った数は壊さない", () => {
  const c = type("9", "/", "0", "=");
  assert.match(c.error, /0では割れません/);
  assert.equal(shown(c), "0", "打った数が消えている");
  const next = Core.calcPress(c, "back");
  assert.equal(next.error, "", "次のキーで注意書きは消える");
});

/* ---------- 3. 式が見える ---------- */

test("演算子を押すと、左の数と記号が式に出る", () => {
  assert.equal(type("1", "2", "0", "0", "+").expr, "1,200 ＋");
  assert.equal(type("5", "0", "0", "*").expr, "500 ×");
});

test("＝ を押すと、式がまるごと残る", () => {
  assert.equal(type("1", "2", "0", "0", "+", "3", "8", "0", "=").expr, "1,200 ＋ 380 ＝");
});

test("＝ のあとに数字を押すと、新しく打ち直しになる", () => {
  const c = type("1", "2", "+", "3", "=", "9");
  assert.equal(shown(c), "9");
  assert.equal(c.expr, "", "前の式が残っている");
});

/* ---------- 4. 記録するときの金額 ---------- */

test("＝ を押していなくても、待っている計算を済ませた金額になる", () => {
  assert.equal(Core.calcValue(type("5", "0", "0", "*", "3")), 1500);
  assert.equal(Core.calcValue(type("1", "2", "0", "0", "+", "3", "8", "0")), 1580);
});

test("計算していないときは、打った数がそのまま金額になる", () => {
  assert.equal(Core.calcValue(type("1", "2", "3")), 123);
  assert.equal(Core.calcValue(Core.newCalc()), 0);
});

test("金額から電卓を作れる（記録を直すとき）", () => {
  assert.equal(shown(Core.calcFrom(1580)), "1580");
  assert.equal(shown(Core.calcFrom("1580")), "1580");
  assert.equal(shown(Core.calcFrom("")), "");
  assert.equal(shown(Core.calcFrom(null)), "");
});

test("知らないキーを押しても、何も変わらない", () => {
  const c = type("1", "2");
  assert.equal(shown(Core.calcPress(c, "あ")), "12");
  assert.equal(shown(Core.calcPress(c, "%")), "12");
});

/* ---------- 5. 画面 ---------- */

const boot = () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {}, diary: {}, plans: {} } });
  return app;
};
const press = (app, ...keys) => keys.forEach((k) =>
  app.run(`handleAct("calc",{target:{closest:()=>({dataset:{key:${JSON.stringify(k)}}})}});`));
const sheet = (app) => app.el("sheet").innerHTML;
const bigNumber = (app) => {
  const m = /id="s-amt"[^>]*value="([^"]*)"/.exec(sheet(app));
  return m ? m[1] : null;
};
const exprLine = (app) => {
  const m = /id="s-expr">([^<]*)</.exec(sheet(app));
  return m ? m[1] : null;
};

test("記録の画面に電卓が出る", () => {
  const app = boot();
  app.run(`openRecord(null);`);
  const h = sheet(app);
  assert.match(h, /class="calcpad"/, "電卓が出ていない");
  /* キーの並びは5か国とも同じ。000 は小数点キーに置き換えた
     （国ごとに配置が変わると、どの国の画面か分からなくなるため）。 */
  for (const key of ["7", "0", "00", ".", "+", "-", "*", "/", "=", "C", "back"]) {
    assert.ok(h.includes(`data-key="${key}"`), `${key} のキーが無い`);
  }
});

test("iPhoneのキーボードは出さない（金額欄は読み取り専用）", () => {
  const app = boot();
  app.run(`openRecord(null);`);
  assert.match(sheet(app), /id="s-amt" readonly inputmode="none"/, "キーボードが出る作りに戻っている");
});

test("キーを押すと、金額と式の表示が変わる", () => {
  const app = boot();
  app.run(`openRecord(null);`);
  press(app, "1", "2", "0", "0");
  assert.equal(bigNumber(app), "1200");
  assert.equal(exprLine(app), "");
  press(app, "+", "3", "8", "0");
  assert.equal(bigNumber(app), "380");
  assert.equal(exprLine(app), "1,200 ＋");
  press(app, "=");
  assert.equal(bigNumber(app), "1580");
  assert.equal(exprLine(app), "1,200 ＋ 380 ＝");
});

test("＝ を押さずに記録しても、計算された金額で残る", async () => {
  const app = boot();
  app.run(`openRecord(null);`);
  press(app, "5", "0", "0", "*", "3");
  app.run(`sheetState.cat="food"; sheetState.date="2026-08-01";`);
  await app.run(`saveTx()`);
  const tx = JSON.parse(app.saved()).tx;
  assert.equal(tx.length, 1);
  assert.equal(tx[0].amount, 1500, "＝を押していない分が記録されていない");
});

test("記録を直すときは、その金額から始まる", () => {
  const app = bootApp({ state: { settings: {}, tx: [{ id: "t1", type: "expense", amount: 2400, cat: "food", date: "2026-08-01" }], health: {}, diary: {}, plans: {} } });
  app.run(`openRecord("t1");`);
  assert.equal(bigNumber(app), "2400");
  press(app, "+", "6", "0", "0", "=");
  assert.equal(bigNumber(app), "3000");
});

test("C を押すと、金額の表示が空に戻る", () => {
  const app = boot();
  app.run(`openRecord(null);`);
  press(app, "1", "2", "3", "C");
  assert.equal(bigNumber(app), "");
});

test("電卓を使っても、日付とメモは消えない", () => {
  const app = boot();
  app.run(`openRecord(null);`);
  app.el("s-date").value = "2026-08-02";
  app.el("s-memo").value = "スーパー";
  press(app, "9", "9", "0");
  assert.equal(app.run(`sheetState.date`), "2026-08-02");
  assert.equal(app.run(`sheetState.memo`), "スーパー");
});
