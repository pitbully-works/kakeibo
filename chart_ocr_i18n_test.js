/* =========================================================================
   かけいぼ ― セント対応 第3段階（グラフの目もり・英語レシートの語彙）
   -------------------------------------------------------------------------
   第1段階で内部を最小通貨単位にし、第2段階で小数を打てるようにした。
   第3段階は「見える側」と「読み取る側」を5か国に合わせる。

   守りたいこと：
     ・日本の目もりも読み取りも、1文字も変わらない
     ・英語圏の目もりが、桁の大きさに合った書き方になる（k と M）
     ・目もりの数字が、内部の最小単位ではなく主単位で出る
     ・英語のレシートで、合計とそれ以外を取り違えない
     ・税込みの合計（Total incl VAT / Total inc GST）を捨てない

   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

const D = (d) => "2026-08-" + String(d).padStart(2, "0");

/* その国・その金額で、まとめ（分析）の縦軸に出る目もりを取り出す */
function axisTicks(country, amounts) {
  const tx = amounts.map((a, i) => {
    const t = { id: "t" + i, type: i === 0 ? "income" : "expense",
      amount: a, cat: i === 0 ? "salary" : "food", date: D(i + 1), memo: "", photo: null };
    if (country !== "JP") t.country = country;
    return t;
  });
  const app = bootApp({ state: { settings: { country: country, cycleStart: 1 }, tx: tx } });
  const html = app.run(`view="summary"; sumTab="analysis"; render(); document.getElementById("app").innerHTML`);
  return [...String(html).matchAll(/text-anchor="end"[^>]*>([^<]*)</g)].map((m) => m[1]);
}

/* =========================================================================
   1. 日本は1文字も変わらない
   ========================================================================= */

test("JPの目もりは、これまでどおり「万」で出る", () => {
  assert.deepEqual(axisTicks("JP", [300000, 20000, 15000]).slice(0, 4),
    ["0", "10万", "20万", "30万"], "日本の目もりが変わっている");
});

test("JPの小さい金額は、そのままの数で出る", () => {
  assert.deepEqual(axisTicks("JP", [500, 130, 70]).slice(0, 3),
    ["0", "200", "400"], "日本の小額の目もりが変わっている");
});

test("JPの大きい金額も、これまでどおり「万」のまま", () => {
  /* 1億を「1億」と書く作りにはしていない（既存の表示を変えないため）。
     いまは 1500万 のように万で出し続ける。 */
  assert.deepEqual(axisTicks("JP", [12345670, 456780, 222220]).slice(0, 4),
    ["0", "500万", "1000万", "1500万"], "日本の大きい金額の目もりが変わっている");
});

/* =========================================================================
   2. 英語圏は k と M
   ========================================================================= */

test("英語圏の大きい金額は M で出る（1000k にしない）", () => {
  /* M が無いと 1,500,000 が "1500k" になり、桁がぱっと読めない。 */
  for (const c of ["US", "GB", "CA", "AU"]) {
    const t = axisTicks(c, [123456700, 4567800, 2222200]).slice(0, 4);
    assert.deepEqual(t, ["0", "500k", "1M", "1.5M"], c + " の大きい金額の目もりが違う");
  }
});

test("英語圏のふつうの金額は k で出る", () => {
  for (const c of ["US", "GB", "CA", "AU"]) {
    assert.deepEqual(axisTicks(c, [300000, 20000, 15000]).slice(0, 4),
      ["0", "1k", "2k", "3k"], c + " の目もりが違う");
  }
});

test("英語圏の小さい金額は、そのままの数で出る", () => {
  /* $5.00 の月なら、目もりはドルの数で出る（セントの数ではない）。 */
  assert.deepEqual(axisTicks("US", [500, 120, 80]).slice(0, 3),
    ["0", "2", "4"], "小額の目もりが違う");
});

test("目もりは、内部の最小単位ではなく主単位で出る", () => {
  /* ここが崩れると、USの軸だけ100倍の数字になる。 */
  const us = axisTicks("US", [300000, 20000, 15000]);   // $3,000
  assert.equal(us.includes("300k"), false, "セントのまま目もりに出ている");
  assert.equal(us.includes("3k"), true, "ドルの目もりが出ていない");
});

test("目もりの短縮は、半端な数でも桁を間違えない", () => {
  const app = bootApp({ state: { settings: { country: "US" }, tx: [] } });
  const t = (minor) => app.run(`yenTick(${minor})`);
  assert.equal(t(0), "0");
  assert.equal(t(50000), "500");            // $500
  assert.equal(t(100000), "1k");            // $1,000
  assert.equal(t(150000), "1.5k");          // $1,500
  assert.equal(t(100000000), "1M");         // $1,000,000
  assert.equal(t(250000000), "2.5M");       // $2,500,000
  assert.equal(t(1234), "12.34");           // $12.34（セントも落とさない）

  const jp = bootApp({ state: { settings: { country: "JP" }, tx: [] } });
  const j = (minor) => jp.run(`yenTick(${minor})`);
  assert.equal(j(10000), "1万");
  assert.equal(j(15000), "1.5万");
  assert.equal(j(1000), "1,000", "日本の書き方が変わっている");
  assert.equal(j(100000000), "10000万", "日本の表示を変えていない");
});

/* =========================================================================
   3. 英語レシートの語彙
   ========================================================================= */

const read = (text, dec) => Core.parseAmount(text, "full", dec === undefined ? 2 : dec);

test("税込みの合計を、税の行と間違えて捨てない", () => {
  /* 「Total incl VAT」は税の語を含む。優先しないと丸ごと捨ててしまい、
     合計が読めないまま、ほかの数字を拾ってしまう。 */
  assert.equal(read("Subtotal  £9.03\nVAT 20%  £1.80\nTotal incl VAT   £10.83"), 1083, "英：税込の合計");
  assert.equal(read("Subtotal  $11.90\nGST  $0.60\nTotal inc GST    $12.50"), 1250, "豪：GST込みの合計");
});

test("合計の言い方を知らないと、ほかの行を拾ってしまう", () => {
  /* 「Total」を含まない言い方（Amount Payable / You Pay / Net Payable）は、
     語を知らないと合計の行だと分からず、いちばん大きい数を拾う道に落ちる。
     わざと大きい品目を並べて、合計の行を選べているかを確かめる。 */
  const cases = [
    ["Widget  $88.88\nAmount Payable  $15.75", 1575],
    ["Widget  $88.88\nYou Pay  $15.75", 1575],
    ["Widget  $88.88\nNet Payable  $15.75", 1575],
    ["Widget  $88.88\nTotal Amount  $15.75", 1575],
    ["Widget  $88.88\nPurchase Total  $15.75", 1575],
  ];
  for (const [text, want] of cases) {
    assert.equal(read(text), want, "合計の行を選べていない: " + JSON.stringify(text));
  }
});

test("合計のいろいろな言い方を拾える", () => {
  const cases = [
    ["TOTAL AMOUNT     $42.00", 4200],
    ["Amount Payable   $15.75", 1575],
    ["Total to Pay     $9.99", 999],
    ["You Pay          $8.00", 800],
    ["Purchase Total   $31.20", 3120],
    ["Net Payable      $77.10", 7710],
    ["Grand Total      $8.05", 805],
    ["Order Total      $23.40", 2340],
    ["Balance Due      $15.00", 1500],
    ["Amount Due       $42.50", 4250],
  ];
  for (const [text, want] of cases) {
    assert.equal(read(text), want, "読めていない: " + text.trim());
  }
});

test("税の行を合計として拾わない（VAT/GST/HST/PST/QST）", () => {
  const cases = [
    ["Subtotal  $10.00\nGST 5%   $0.50\nTotal  $10.50", 1050],
    ["Subtotal  $10.00\nHST      $1.30\nTotal  $11.30", 1130],
    ["Subtotal  $10.00\nPST      $0.70\nTotal  $10.70", 1070],
    ["Subtotal  $10.00\nQST      $0.99\nTotal  $10.99", 1099],
    ["Subtotal  $10.00\nVAT      $2.00\nTotal  $12.00", 1200],
  ];
  for (const [text, want] of cases) {
    assert.equal(read(text), want, "税の行を拾っている: " + JSON.stringify(text));
  }
});

test("合計の語が無いレシートでも、税・チップ・値引き・数量は拾わない", () => {
  /* 合計が読めないと、いちばん大きい数を拾う道に落ちる。
     ここで除けていないと、税やチップの額が「使った額」になる。 */
  const cases = [
    ["Bread  $5.00\nGST  $9.00", 500, "税(GST)"],
    ["Bread  $5.00\nVAT  $9.00", 500, "税(VAT)"],
    ["Bread  $5.00\nHST  $9.00", 500, "税(HST)"],
    ["Bread  $5.00\nPST  $9.00", 500, "税(PST)"],
    ["Bread  $5.00\nQST  $9.00", 500, "税(QST)"],
    ["Bread  $5.00\nTip  $9.00", 500, "チップ"],
    ["Bread  $5.00\nGratuity  $9.00", 500, "チップ"],
    ["Bread  $5.00\nService Charge  $9.00", 500, "サービス料"],
    ["Bread  $5.00\nYou Saved  $9.00", 500, "値引き"],
    ["Bread  $5.00\nLoyalty  $9.00", 500, "ポイント"],
    ["Bread  $5.00\nQTY 2  Unit Price  $9.00", 500, "数量・単価"],
    ["Bread  $5.00\nQuantity  $9.00", 500, "数量"],
  ];
  for (const [text, want, label] of cases) {
    assert.equal(read(text), want, label + "を拾っている: " + JSON.stringify(text));
  }
});

test("支払い手段・値引き・チップの行を合計として拾わない", () => {
  const cases = [
    ["Total  $20.00\nTip  $4.00\nVisa  $24.00", 2000],
    ["Total  $20.00\nGratuity  $5.00", 2000],
    ["Total  $12.00\nInterac  $12.00", 1200],
    ["Total  $12.00\nEFTPOS  $12.00", 1200],
    ["Total  $12.00\nMastercard  $12.00", 1200],
    ["Total  $12.00\nAmex  $12.00", 1200],
    ["Total   $9.00\nYou Saved  $3.00", 900],
    ["Total   $9.00\nLoyalty  $30.00", 900],
    ["Total  $18.00\nRounding  $0.02\nCash  $20.00\nChange  $1.98", 1800],
    ["Total  $18.00\nService Charge  $99.00", 1800],
    ["Total  $18.00\nDeposit  $50.00", 1800],
    ["Total  $18.00\nRefund  $99.00", 1800],
  ];
  for (const [text, want] of cases) {
    assert.equal(read(text), want, "合計以外を拾っている: " + JSON.stringify(text));
  }
});

test("数量・単価の行を合計として拾わない", () => {
  assert.equal(read("Qty 3  Unit Price $5.00\nTotal  $15.00"), 1500);
  assert.equal(read("Items: 4\nTotal  $15.00"), 1500);
});

test("合計の語が無いときも、支払い手段やお釣りは拾わない", () => {
  /* 合計が読めないと、いちばん大きい数を拾う道に落ちる。
     そこで除けていないと、預り金やお釣りが金額になる。 */
  assert.equal(read("Groceries  $5.00\nCash  $20.00\nChange  $15.00"), 500);
  assert.equal(read("Groceries  $5.00\nVisa  $20.00"), 500);
});

/* =========================================================================
   4. 日本の読み取りは1つも変わらない
   ========================================================================= */

test("日本のレシートの読み取りは、これまでどおり", () => {
  const cases = [
    ["小計 1,190\n消費税 95\n合計 1,285", 1285],
    ["お預り 2,000\nお釣り 715\n合計 1,285", 1285],
    ["ご請求金額 3,300", 3300],
    ["税込計 980", 980],
    ["お買上計 2,480", 2480],
    ["総額 5,500", 5500],
    ["現金 3,000\n合計 2,750", 2750],
    ["ポイント 120\n合計 1,980", 1980],
  ];
  for (const [text, want] of cases) {
    assert.equal(Core.parseAmount(text, "full", 0), want, "日本の読み取りが変わった: " + JSON.stringify(text));
  }
  assert.equal(Core.parseAmount("¥1,285", "total", 0), 1285, "アップ撮影が変わった");
  assert.equal(Core.parseAmount("", "total", 0), null);
});

/* =========================================================================
   5. 第1・第2段階を壊していない
   ========================================================================= */

test("最小単位・移行・二重移行防止は、そのまま", () => {
  assert.equal(Core.minorScale("JP"), 1);
  assert.equal(Core.minorScale("US"), 100);
  assert.equal(Core.needsMinorUnitMigration({ dataVersion: 2 }), false);
  const once = Core.migrateToMinorUnits({
    settings: { country: "US", goalTarget: 5000 },
    tx: [{ id: "t", type: "expense", amount: 1234, cat: "food", date: D(1), country: "US" }],
  });
  assert.equal(once.state.tx[0].amount, 123400);
  assert.equal(Core.migrateToMinorUnits(once.state).changed, false, "二重移行しようとしている");
});

test("ライフプランへ渡す数値と単位の明示は、そのまま", () => {
  const snap = Core.buildSnapshot({ country: "US", cycleStart: 1 }, [
    { id: "s", type: "income", amount: 420000, cat: "salary", date: D(25), country: "US" },
  ], "2026-08");
  assert.equal(snap.income_actual_total, 4200);
  assert.equal(snap.amount_unit, "major");
  assert.equal(snap.minor_unit_scale, 100);
  assert.equal(snap.schema_version, "2.3");
});

test("小数の打ち込みと計算は、そのまま", () => {
  const press = (dec, keys) => keys.reduce((c, k) => Core.calcPress(c, k), Core.newCalc(dec));
  assert.equal(Core.calcDisplay(press(2, ["0", ".", "1", "+", "0", ".", "2", "="])), "0.30");
  assert.equal(Core.calcValue(press(2, ["1", ".", "0", "0", "*", "3", "="])), 300);
  assert.equal(Core.calcValue(press(0, ["1", "0", "0", "*", "3", "="])), 300, "円の計算が変わっている");
});

test("金額の計算式そのものは変えていない", () => {
  const c = Core.computeMonth({ cycleStart: 1, nisaMonthly: 30000 }, [
    { id: "s", type: "income", amount: 300000, cat: "salary", date: D(25) },
    { id: "f", type: "expense", amount: 20000, cat: "food", date: D(5) },
  ], "2026-08");
  assert.equal(c.available, 300000 - 20000 - 30000);
});

/* =========================================================================
   6. 電卓のキーは5か国共通／関数電卓の答えを記録へ
   -------------------------------------------------------------------------
   国によってキーの並びが変わると、指の位置が国で変わってしまう。
   並びは 0 / . / 00 で固定する。
   そして「関数電卓で計算した答えを、そのまま家計簿へ入れる」導線は、
   このアプリの目玉のひとつ。消えていないことをここで見張る。
   ========================================================================= */

/* 関数電卓のキーを押す（画面の押下と同じ経路） */
function sciPress(app, keys) {
  keys.forEach((k) => app.run(
    `handleAct("sci",{target:{closest:(sel)=>String(sel).indexOf("data-key")>=0?{dataset:{key:${JSON.stringify(k)}}}:null}});`));
}

test("関数電卓のキーの並びも、5か国とも同じ", () => {
  for (const c of ["JP", "US", "GB", "CA", "AU"]) {
    const app = bootApp({ state: { settings: { country: c }, tx: [] } });
    const html = app.run(`view="calc"; render(); document.getElementById("app").innerHTML`);
    for (const key of ["0", ".", "00"]) {
      assert.ok(String(html).includes(`data-key="${key}"`), `${c}：${key} キーが無い`);
    }
    assert.equal(/data-key="000"/.test(html), false, c + "：000 キーが残っている");
  }
});

test("関数電卓で ＝ を押すと、家計簿へ記録するボタンが出る", () => {
  for (const c of ["JP", "US", "GB", "CA", "AU"]) {
    const app = bootApp({ state: { settings: { country: c }, tx: [] } });
    app.run(`view="calc"; render();`);
    /* ＝ を押す前は、ボタンではなく案内が出る */
    const before = app.run(`document.getElementById("app").innerHTML`);
    assert.equal(/data-act="sci-record"/.test(before), false, c + "：＝ の前にボタンが出ている");

    sciPress(app, ["1", "2", "+", "3", "="]);
    const after = app.run(`document.getElementById("app").innerHTML`);
    assert.match(String(after), /data-act="sci-record"/, c + "：記録するボタンが出ていない");
  }
});

test("ボタンに出る金額と、記録画面へ入る金額が一致する", () => {
  /* ここが食い違うと、$12.34 と書いてあるのに $1,234.00 が入る。 */
  const cases = [
    ["JP", ["1", "2", "+", "3", "="], "¥15", "15"],
    ["US", ["1", "2", ".", "3", "4", "="], "$12.34", "12.34"],
    ["GB", ["1", "0", "="], "£10.00", "10.00"],
    ["CA", ["2", ".", "5", "0", "="], "CA$2.50", "2.50"],
    ["AU", ["7", "="], "A$7.00", "7.00"],
  ];
  for (const [c, keys, shownText, typed] of cases) {
    const app = bootApp({ state: { settings: { country: c }, tx: [] } });
    app.run(`view="calc"; render();`);
    sciPress(app, keys);
    const html = String(app.run(`document.getElementById("app").innerHTML`));
    const label = /data-act="sci-record"[^>]*>([^<]*)</.exec(html);
    assert.ok(label, c + "：記録するボタンが無い");
    assert.ok(label[1].includes(shownText), `${c}：ボタンの金額が違う（${label[1]}）`);

    app.run(`handleAct("sci-record",{});`);
    assert.equal(app.run(`!!sheetState`), true, c + "：記録画面が開いていない");
    assert.equal(app.run(`sheetState.amount`), typed, c + "：記録画面へ入る金額が違う");
  }
});

test("関数電卓の答えを、そのまま記録として保存できる", async () => {
  for (const [c, keys, want] of [
    ["JP", ["1", "2", "+", "3", "="], 15],
    ["US", ["1", "2", ".", "3", "4", "="], 1234],
    ["GB", ["1", "0", "="], 1000],
  ]) {
    const app = bootApp({ state: { settings: { country: c }, tx: [] } });
    app.run(`view="calc"; render();`);
    sciPress(app, keys);
    app.run(`handleAct("sci-record",{});`);
    /* 最小DOMでは欄の字が書き換わらないので、画面と同じ字を入れてから保存する */
    app.run(`
      document.getElementById("s-amt").value=sheetState.amount;
      document.getElementById("s-date").value=${JSON.stringify(D(10))};
    `);
    await app.run(`saveTx()`);
    const tx = JSON.parse(app.saved()).tx;
    assert.equal(tx.length, 1, c + "：記録されていない");
    assert.equal(tx[0].amount, want, c + "：保存された金額が違う");
  }
});

test("割り切れない答えでも、丸めた額でボタンが出る（5か国とも）", () => {
  /* 前は「ちょうど表せる答え」しか記録させなかった。そのため円では
     1000÷3・√2・sin30 のような答えでボタンが出ず、
     関数電卓で出した額をそのまま記録できなかった。
     いまは丸めて記録でき、**丸めたあとの額がボタンに出る**ので、
     いくらで記録されるかは押す前に必ず見える。 */
  for (const [c, keys, label] of [
    ["JP", ["1", "0", "0", "0", "/", "3", "="], "¥333"],
    ["US", ["1", "0", "0", "0", "/", "3", "="], "$333.33"],
    ["GB", ["3", "/", "2", "="], "£1.50"],
    ["JP", ["3", "/", "2", "="], "¥2"],
  ]) {
    const app = bootApp({ state: { settings: { country: c }, tx: [] } });
    app.run(`view="calc"; render();`);
    sciPress(app, keys);
    const html = String(app.run(`document.getElementById("app").innerHTML`));
    assert.match(html, /data-act="sci-record"/, c + "：ボタンが出ていない");
    assert.ok(html.includes(label), c + "：丸めたあとの額がボタンに出ていない（期待 " + label + "）");
  }
});

test("0円以下になる答えでは、ボタンを出さずに案内を出す", () => {
  for (const [c, keys] of [["JP", ["1", "-", "5", "="]], ["JP", ["0", "*", "5", "="]],
                           ["US", ["1", "-", "5", "="]]]) {
    const app = bootApp({ state: { settings: { country: c }, tx: [] } });
    app.run(`view="calc"; render();`);
    sciPress(app, keys);
    const html = String(app.run(`document.getElementById("app").innerHTML`));
    assert.equal(/data-act="sci-record"/.test(html), false, c + "：0円以下を記録できてしまう");
    assert.match(html, /calcnote/, c + "：案内が出ていない");
  }
});

test("記録できる額は、その通貨の細かさへ丸める", () => {
  const mk = (v) => ({ result: v });
  assert.equal(Core.sciRecordAmount(mk(15), 0), 15);
  assert.equal(Core.sciRecordAmount(mk(1.5), 0), 2, "円へ四捨五入していない");
  assert.equal(Core.sciRecordAmount(mk(1.4), 0), 1);
  assert.equal(Core.sciRecordAmount(mk(333.333), 0), 333);
  assert.equal(Core.sciRecordAmount(mk(12.34), 2), 1234);
  assert.equal(Core.sciRecordAmount(mk(12.345), 2), 1235, "セントへ四捨五入していない");
  assert.equal(Core.sciRecordAmount(mk(0.05), 2), 5);
  /* 0円以下と、数でないものは記録しない */
  assert.equal(Core.sciRecordAmount(mk(0), 2), null);
  assert.equal(Core.sciRecordAmount(mk(0.001), 0), null, "0円になる答えを記録できてしまう");
  assert.equal(Core.sciRecordAmount(mk(-5), 2), null);
  assert.equal(Core.sciRecordAmount(mk(null), 2), null);
  assert.equal(Core.sciRecordAmount(mk(Infinity), 2), null);
});
