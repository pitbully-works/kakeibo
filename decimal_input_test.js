/* =========================================================================
   かけいぼ ― セント対応 第2段階（小数の打ち込み・電卓・レシート読み取り）
   -------------------------------------------------------------------------
   第1段階で内部を最小通貨単位にした。第2段階で、はじめて
   $12.34 を打てるようにする。

   守りたいこと：
     ・日本の動きは1つも変わらない（小数点キーが出ない、計算も同じ）
     ・小数の計算で誤差が出ない（0.1 + 0.2 が 0.30 になる）
     ・掛け算・割り算が「金額×個数」の意味で正しい（$1.00 × 3 = $3.00）
     ・レシートの $9.99 を 99（＝$99.00）と読み違えない
     ・第1段階の決めごと（最小単位保存・dataVersion・二重移行防止・
       ライフプラン連携）を1つも壊していない

   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

const D = (d) => "2026-08-" + String(d).padStart(2, "0");

/* キーを順に押す。dec は通貨の小数桁（JP=0、US/GB/CA/AU=2）。 */
const press = (dec, keys) => keys.reduce((c, k) => Core.calcPress(c, k), Core.newCalc(dec));
const shown = (dec, keys) => Core.calcDisplay(press(dec, keys));
const value = (dec, keys) => Core.calcValue(press(dec, keys));

/* =========================================================================
   1. 日本の動きは1つも変わらない
   ========================================================================= */

test("円の電卓は、これまでとまったく同じ", () => {
  assert.equal(shown(0, ["1", "2", "3"]), "123");
  assert.equal(value(0, ["1", "0", "0", "*", "3", "="]), 300);
  assert.equal(value(0, ["1", "0", "0", "0", "/", "4", "="]), 250);
  assert.equal(value(0, ["1", "0", "0", "+", "2", "0", "="]), 120);
  assert.equal(value(0, ["1", "0", "0", "0", "0", "-", "1", "="]), 9999);
  assert.equal(press(0, ["1", "/", "0", "="]).error, "0では割れません");
});

test("円では、小数点キーを押しても何も起きない", () => {
  assert.equal(shown(0, ["1", ".", "5"]), "15", "円に小数が入ってしまった");
  assert.equal(value(0, ["1", ".", "5"]), 15);
});

test("電卓のキーの並びは、5か国とも同じ", () => {
  /* 国によって配置が変わると、どの国の画面かで指の位置が変わってしまう。
     並びは 0 / . / 00 で統一する。円では小数点キーは押しても何も起きない
     （円に小数は無いため）が、キーの位置は動かさない。 */
  for (const c of ["JP", "US", "GB", "CA", "AU"]) {
    const app = bootApp({ state: { settings: { country: c }, tx: [] } });
    app.run(`openRecord(null);`);
    const pad = app.run(`document.getElementById("sheet").innerHTML`);
    assert.match(pad, /data-key="0"/, c + "：0 キーが無い");
    assert.match(pad, /data-key="\."/, c + "：小数点キーが無い");
    assert.match(pad, /data-key="00"/, c + "：00 キーが無い");
    assert.equal(/data-key="000"/.test(pad), false, c + "：000 キーが残っている");
  }
});

test("円では、小数点キーを押しても金額は変わらない", () => {
  /* キーは出すが、円に小数は無いので何も起きない。 */
  assert.equal(shown(0, ["1", ".", "5"]), "15");
  assert.equal(value(0, ["1", ".", "5"]), 15);
});

/* =========================================================================
   2. 小数の打ち込み
   ========================================================================= */

test("小数を打てる。内部には最小単位の整数で入る", () => {
  assert.equal(shown(2, ["1", "2", ".", "3", "4"]), "12.34");
  assert.equal(value(2, ["1", "2", ".", "3", "4"]), 1234);
  assert.equal(value(2, ["0", ".", "9", "9"]), 99);
  assert.equal(value(2, ["5"]), 500, "小数を打たなければ、そのままドル");
});

test("小数点は1つだけ。桁も通貨の桁数まで", () => {
  /* 2つ目の小数点は、押した時点で置かせない（"1.2." のような形を作らない）。 */
  assert.equal(shown(2, ["1", ".", "2", "."]), "1.2", "2つ目の小数点が入った");
  assert.equal(shown(2, ["1", ".", "2", ".", "3"]), "1.23", "小数点が2つ入った");
  assert.equal(shown(2, ["1", ".", "2", "3", "4", "5"]), "1.23", "小数3桁を打ててしまう");
  assert.equal(shown(2, [".", "5"]), "0.5", "先頭の小数点で 0 が出ない");
});

test("小数の足し引きで、誤差が出ない", () => {
  /* 0.1 + 0.2 を小数のまま足すと 0.30000000000000004 になる。
     最小単位の整数で計算しているので、そうならない。 */
  assert.equal(value(2, ["0", ".", "1", "+", "0", ".", "2", "="]), 30);
  assert.equal(Core.calcDisplay(press(2, ["0", ".", "1", "+", "0", ".", "2", "="])), "0.30");
  /* 1セントずつ100回足しても、ぴったり $1.00 */
  let c = Core.newCalc(2);
  for (let i = 0; i < 100; i++) {
    c = Core.calcPress(c, "0"); c = Core.calcPress(c, "."); c = Core.calcPress(c, "0"); c = Core.calcPress(c, "1");
    c = Core.calcPress(c, "+");
  }
  assert.equal(c.acc, 100, "1セントを100回足して $1.00 にならない");
});

test("掛け算・割り算は「金額 × 個数」の意味で正しい", () => {
  /* $1.00 × 3 は $3.00。ここを素直に掛けると $300.00 になる。 */
  assert.equal(value(2, ["1", ".", "0", "0", "*", "3", "="]), 300);
  assert.equal(value(2, ["1", "2", ".", "5", "0", "*", "4", "="]), 5000);
  assert.equal(value(2, ["1", "0", "/", "4", "="]), 250, "$10.00 ÷ 4 が $2.50 でない");
  assert.equal(value(2, ["1", "0", "/", "3", "="]), 333, "割り切れないときは1セントに丸める");
});

test("計算の途中の式も、その通貨の書き方で出る", () => {
  assert.equal(press(2, ["1", "2", ".", "5", "0", "*", "4", "="]).expr, "12.50 × 4.00 ＝");
  assert.equal(press(0, ["1", "0", "0", "*", "3", "="]).expr, "100 × 3 ＝", "円の式が変わっている");
});

test("Cと⌫は、小数を打っている途中でも効く", () => {
  assert.equal(shown(2, ["1", ".", "2", "back"]), "1.");
  assert.equal(shown(2, ["1", ".", "2", "back", "back"]), "1");
  assert.equal(shown(2, ["1", ".", "2", "C"]), "");
  assert.equal(Core.calcPress(Core.newCalc(2), "C").dec, 2, "Cで小数桁を忘れている");
});

test("字と最小単位の行き来は、いつでもぴったり戻る", () => {
  for (const [text, dec, minor] of [
    ["12.34", 2, 1234], ["0.05", 2, 5], ["1234", 2, 123400],
    ["12.3", 2, 1230], ["12.", 2, 1200], ["1234", 0, 1234], ["", 2, 0],
  ]) {
    assert.equal(Core.majorTextToMinor(text, dec), minor, `"${text}" が ${minor} にならない`);
  }
  assert.equal(Core.minorToMajorText(1234, 2), "12.34");
  assert.equal(Core.minorToMajorText(5, 2), "0.05");
  assert.equal(Core.minorToMajorText(1234, 0), "1234", "円に小数点が付いた");
});

test("字のまま桁を組む（掛け算で丸めない）", () => {
  /* Number("12.345")*100 は 1234.5 になり、四捨五入で 1235 になる。
     字のまま組めば、通貨の桁より下は素直に落ちて 1234 になる。
     打ち込みの途中で勝手に切り上がるのは、金額としてまずい。 */
  assert.equal(Core.majorTextToMinor("12.345", 2), 1234, "小数を掛けて丸めている");
  assert.equal(Core.majorTextToMinor("0.999", 2), 99, "1円ぶん切り上がっている");
  assert.equal(Core.majorTextToMinor("1.005", 2), 100);
  /* 小数を掛けると誤差が出る組み合わせでも、字組みならぴったり */
  for (const [t, want] of [["8.16", 816], ["1.15", 115], ["4.35", 435], ["1.005", 100]]) {
    assert.equal(Core.majorTextToMinor(t, 2), want, `"${t}" が ${want} にならない`);
  }
});

/* =========================================================================
   3. 画面から入れて、保存されるまで
   ========================================================================= */

const fill = (app, amount) => app.run(`
  document.getElementById("s-amt").value=${JSON.stringify(String(amount))};
  document.getElementById("s-date").value=${JSON.stringify(D(10))};
`);

test("$12.34 と打つと、1234 として保存され、$12.34 と出る", async () => {
  const app = bootApp({ state: { settings: { country: "US" }, tx: [] } });
  app.run(`openRecord(null);`);
  /* 電卓のキーを順に押す（画面の押下と同じ経路を通す） */
  ["1", "2", ".", "3", "4"].forEach((k) => app.run(
    `handleAct("calc", { target: { closest: (sel) => (String(sel).indexOf("data-key") >= 0 ? { dataset: { key: ${JSON.stringify(k)} } } : null) } });`));
  assert.equal(app.run(`Core.calcDisplay(sheetState.calc)`), "12.34", "キーを押しても欄に出ていない");
  /* 本物の画面では、押すたびに欄の字が書き換わる。最小DOMでは書き換わらないので、
     画面と同じ字を欄に入れてから保存する。 */
  fill(app, app.run(`Core.calcDisplay(sheetState.calc)`));
  await app.run(`saveTx()`);
  const t = JSON.parse(app.saved()).tx[0];
  assert.equal(t.amount, 1234, "$12.34 が最小単位で保存されていない");
  assert.equal(Core.formatAmount(t.amount, "US"), "$12.34");
});

test("打ち込み欄に小数を入れても、正しく保存される", async () => {
  for (const [c, text, want] of [
    ["US", "12.34", 1234], ["GB", "0.99", 99], ["CA", "1234.5", 123450],
    ["AU", "7", 700], ["JP", "1234", 1234],
  ]) {
    const app = bootApp({ state: { settings: { country: c }, tx: [] } });
    app.run(`openRecord(null);`);
    fill(app, text);
    await app.run(`saveTx()`);
    assert.equal(JSON.parse(app.saved()).tx[0].amount, want, `${c}："${text}" が ${want} で保存されていない`);
  }
});

test("直すときは、セントまでそのまま出て、そのまま戻る", async () => {
  const app = bootApp({ state: {
    settings: { country: "US" },
    tx: [{ id: "u1", type: "expense", amount: 1234, cat: "food", date: D(1),
           memo: "", photo: null, country: "US" }],
  } });
  app.run(`openRecord("u1");`);
  assert.equal(app.run(`sheetState.amount`), "12.34", "セントが落ちている");
  await app.run(`saveTx()`);
  assert.equal(JSON.parse(app.saved()).tx[0].amount, 1234, "直しただけで金額が変わった");
});

test("US画面のまま日本の記録を直しても、円の電卓のまま", () => {
  const app = bootApp({ state: {
    settings: { country: "US" },
    tx: [{ id: "j1", type: "expense", amount: 12345, cat: "food", date: D(1), memo: "", photo: null }],
  } });
  app.run(`openRecord("j1");`);
  assert.equal(app.run(`sheetState.amount`), "12345", "円の金額に小数点が付いた");
  assert.equal(app.run(`sheetState.calc.dec`), 0, "円の記録なのにセントの電卓になっている");
});

test("設定の金額欄にも小数を入れられる", () => {
  const app = bootApp({ state: { settings: { country: "US" }, tx: [] } });
  app.run(`view="settings"; render();`);
  app.run(`document.getElementById("f-gtarget").value="1234.56"; autoSave("f-gtarget");`);
  assert.equal(app.run(`state.settings.goalTarget`), 123456, "設定の小数が落ちている");

  const jp = bootApp({ state: { settings: { country: "JP" }, tx: [] } });
  jp.run(`view="settings"; render();`);
  jp.run(`document.getElementById("f-gtarget").value="1000000"; autoSave("f-gtarget");`);
  assert.equal(jp.run(`state.settings.goalTarget`), 1000000, "円の設定が変わった");
});

test("金額の欄は、通貨に合わせたキーボードを出す", () => {
  const us = bootApp({ state: { settings: { country: "US" }, tx: [] } });
  us.run(`view="settings"; render();`);
  assert.match(us.run(`document.getElementById("app").innerHTML`), /id="f-gtarget"[^>]*inputmode="decimal"/,
    "ドルなのに小数を打てないキーボードが出ている");

  const jp = bootApp({ state: { settings: { country: "JP" }, tx: [] } });
  jp.run(`view="settings"; render();`);
  assert.match(jp.run(`document.getElementById("app").innerHTML`), /id="f-gtarget"[^>]*inputmode="numeric"/,
    "円なのに小数のキーボードが出ている");
});

/* =========================================================================
   4. レシートの読み取り
   ========================================================================= */

const read = (text, mode, dec) => Core.parseAmount(text, mode, dec);

test("$9.99 を 99（＝$99.00）と読み違えない", () => {
  /* 小数を見ないと "9" は1桁で捨てられ、"99" だけが残って
     $99.00 になる。10倍のまちがいが黙って入る。 */
  assert.equal(read("TOTAL  $9.99", "total", 2), 999);
  assert.equal(read("$0.99", "total", 2), 99);
  assert.equal(read("$1,234.56", "total", 2), 123456);
});

test("英語のレシートで、合計とそれ以外を見分ける", () => {
  assert.equal(read("Subtotal  $10.00\nSales Tax  $0.83\nTotal  $10.83", "full", 2), 1083);
  assert.equal(read("Total  $10.83\nCash  $20.00\nChange  $9.17", "full", 2), 1083,
    "お釣りを合計として拾っている");
  assert.equal(read("Amount Due   $42.50", "full", 2), 4250);
  assert.equal(read("Grand Total   $8.05", "full", 2), 805);
  assert.equal(read("Balance Due  $15.00", "full", 2), 1500);
  /* 合計の語を知らないと、その行を飛ばして、ほかの大きい数を拾ってしまう */
  assert.equal(read("Amount Due   $42.50\nTip suggestion  $50.00", "full", 2), 4250,
    "Amount Due を合計として読めていない");
  assert.equal(read("Balance Due  $15.00\nDeposit paid  $99.00", "full", 2), 1500,
    "Balance Due を合計として読めていない");
});

test("合計の語が無いレシートでは、お釣り・現金を拾わない", () => {
  /* 合計の語が見つからないと、いちばん大きい数を拾う道に落ちる。
     そこでお釣りや預り金を除けていないと、お釣りが金額になる。 */
  assert.equal(read("Groceries  $5.00\nChange  $9.17", "full", 2), 500, "お釣りを拾っている");
  assert.equal(read("Groceries  $5.00\nCash  $20.00", "full", 2), 500, "預り金を拾っている");
  assert.equal(read("パン 500\nお釣り 715", "full", 0), 500, "円のお釣りを拾っている");
});

test("Subtotal を Total と取り違えない", () => {
  /* Subtotal の中に total が入っているので、先に落とさないと拾ってしまう。 */
  assert.equal(read("Subtotal  $99.00\nTotal  $10.00", "full", 2), 1000, "小計を合計として拾った");
});

test("日本のレシートの読み取りは、1つも変わらない", () => {
  assert.equal(read("小計 1,190\n消費税 95\n合計 1,285", "full", 0), 1285);
  assert.equal(read("¥1,285", "total", 0), 1285);
  assert.equal(read("お預り 2,000\nお釣り 715\n合計 1,285", "full", 0), 1285);
  assert.equal(read("", "total", 0), null);
});

test("読み取った候補は、最小単位で返る", () => {
  const d = Core.amountDetails("Total  $10.83", 2);
  assert.equal(d.length >= 1, true, "候補が拾えていない");
  assert.equal(d.some((x) => x.amount === 1083), true, "セントまで拾えていない");

  const jp = Core.amountDetails("合計 1,285", 0);
  assert.equal(jp.some((x) => x.amount === 1285), true, "円の候補が変わっている");
});

/* =========================================================================
   5. 第1段階の決めごとを壊していない
   ========================================================================= */

test("移行の決めごとは、そのまま生きている", () => {
  assert.equal(Core.needsMinorUnitMigration({ dataVersion: 2 }), false);
  const once = Core.migrateToMinorUnits({
    settings: { country: "US", goalTarget: 5000 },
    tx: [{ id: "t", type: "expense", amount: 1234, cat: "food", date: D(1), country: "US" }],
  });
  assert.equal(once.state.tx[0].amount, 123400, "×100 されていない");
  assert.equal(Core.migrateToMinorUnits(once.state).changed, false, "二重移行しようとしている");
  assert.equal(Core.migrateToMinorUnits(once.state).state.tx[0].amount, 123400, "二重に100倍された");
});

test("JPの金額は、第2段階でも1円も変わらない", () => {
  const before = {
    settings: { country: "JP", goalTarget: 3000000, nisaMonthly: 90000 },
    tx: [{ id: "a", type: "expense", amount: 12345, cat: "food", date: D(1) }],
  };
  const after = Core.migrateToMinorUnits(before).state;
  assert.equal(after.tx[0].amount, 12345);
  assert.equal(after.settings.goalTarget, 3000000);
  assert.equal(Core.formatAmount(12345, "JP"), "¥12,345");
});

test("ライフプランへ渡す数値は、主単位のまま", () => {
  const snap = Core.buildSnapshot({ country: "US", cycleStart: 1 }, [
    { id: "s", type: "income", amount: 420000, cat: "salary", date: D(25), country: "US" },
  ], "2026-08");
  assert.equal(snap.income_actual_total, 4200, "セントのまま渡している");
  assert.equal(snap.amount_unit, "major");
  assert.equal(snap.minor_unit_scale, 100);
  assert.equal(snap.schema_version, "2.3");

  const jp = Core.buildSnapshot({ cycleStart: 1 }, [
    { id: "s", type: "income", amount: 300000, cat: "salary", date: D(25) },
  ], "2026-08");
  assert.equal(jp.income_actual_total, 300000, "JPの渡す数値が変わった");
  assert.equal(jp.minor_unit_scale, 1);
});

test("バックアップの版数と単位の明示は、そのまま", () => {
  const b = Core.buildBackup({ settings: { country: "US" }, tx: [] });
  assert.equal(b.version, 2);
  assert.equal(b.amountUnit, "minor");
  assert.throws(() => Core.normalizeBackup({ version: 3, settings: {}, tx: [] }), /新しすぎます/);
});

test("小数を打って保存しても、バックアップの往復で1セントも変わらない", async () => {
  const app = bootApp({ state: { settings: { country: "US" }, tx: [] } });
  app.run(`openRecord(null);`);
  fill(app, "12.34");
  await app.run(`saveTx()`);
  const state = JSON.parse(app.saved());
  const back = Core.normalizeBackup(JSON.parse(JSON.stringify(Core.buildBackup(state))));
  assert.equal(back.tx[0].amount, 1234, "往復でセントが変わった");
});
