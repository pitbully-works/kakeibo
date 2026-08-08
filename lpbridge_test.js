/* =========================================================================
   ライフプランへの受け渡しと、「毎月いくら」の表示
   -------------------------------------------------------------------------
   ここで固定したい決めごとは3つ。

   1) 設定とホームに出す数字は「毎月いくら」。
      長いあいだ残高（金の評価額・預金残高・借入の元金）を出していたため、
      毎月の積立額や返済額を入れても画面が動かず、
      「入れたのに反映されない」ように見えていた。

   2) 行のしるし（id）を持ち回る。
      ライフプラン側は id が一致する行を最優先で対応させる。
      id が無いと名前で照合するしかなく、名前が空・同名だと
      渡すたびに同じ行が増えてしまう。

   3) 生年月日を渡す。
      ライフプラン側は生年月日を書き換えず、食い違いを知らせるためだけに使う。
      渡していなかったため、その知らせが実際には出ていなかった。
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { bootApp } = require("./boot-app.cjs");
const Core = require(path.join(__dirname, "core.js"));

/* 番号を決め打ちにして、テストのたびに違う id にならないようにする */
function seqId() {
  let n = 0;
  return () => "test-" + (++n);
}

const settingsWith = (lp, extra) =>
  Object.assign({ birth: "1968-11-20", cycleStart: 20, lp: lp }, extra || {});

/* ---------------------------------------------------------------- 毎月いくら */

test("金：毎月の積立額を返す（評価額ではない）", () => {
  const s = settingsWith({ gold: { currentGrams: 500, pricePerGram: 15000, monthlyYen: 20000 } });
  assert.strictEqual(Core.lpMonthlyOf(s, "gold", 57), 20000);
  /* 評価額は別物として、これまでどおり出せる */
  assert.strictEqual(Core.lpGoldValue(s.lp.gold), 7500000);
});

test("銀行貯金：毎月の入金の合計を返す（残高ではない）", () => {
  const s = settingsWith({ banks: [
    { name: "A銀行", balance: 3000000, monthlyDeposit: 10000 },
    { name: "B銀行", balance: 1000000, monthlyDeposit: 5000 },
  ] });
  assert.strictEqual(Core.lpMonthlyOf(s, "banks", 57), 15000);
  assert.strictEqual(Core.lpBanksTotal(s.lp.banks), 4000000);
});

test("借入金：毎月の返済の合計を返す（残っている元金ではない）", () => {
  const s = settingsWith({ loans: [
    { name: "車", principal: 1000000, monthlyPayment: 30000 },
    { name: "家", principal: 9000000, monthlyPayment: 70000 },
  ] });
  assert.strictEqual(Core.lpMonthlyOf(s, "loans", 57), 100000);
  assert.strictEqual(Core.lpLoansTotal(s.lp.loans), 10000000);
});

test("民間年金：掛けている期間の中だけを足す", () => {
  const s = settingsWith({ privatePensionPlans: [
    { name: "共済", monthlyContribution: 15000, contribFromAge: 40, contribToAge: 60 },
  ] });
  assert.strictEqual(Core.lpMonthlyOf(s, "pension", 57), 15000);
  assert.strictEqual(Core.lpMonthlyOf(s, "pension", 61), 0, "終わった契約は足さない");
  assert.strictEqual(Core.lpMonthlyOf(s, "pension", 39), 0, "まだ始まっていない契約は足さない");
});

test("生命保険：保険料を払う期間の中だけを足す", () => {
  const s = settingsWith({ insurancePolicies: [
    { name: "○○生命", monthlyPremium: 8000, premiumFromAge: 46, premiumToAge: 65, coverageUntilAge: 82 },
  ] });
  assert.strictEqual(Core.lpMonthlyOf(s, "insurance", 57), 8000);
  assert.strictEqual(Core.lpMonthlyOf(s, "insurance", 66), 0);
  /* 保障が続く年齢（82）とは別物。保険料はもう払っていない */
  assert.strictEqual(Core.lpMonthlyOf(s, "insurance", 80), 0);
});

test("iDeCo：掛けている期間の中だけを足す", () => {
  const s = settingsWith({ ideco: { monthlyContribution: 23000, startAge: 50, endAge: 65 } });
  assert.strictEqual(Core.lpMonthlyOf(s, "ideco", 57), 23000);
  assert.strictEqual(Core.lpMonthlyOf(s, "ideco", 66), 0);
});

test("年齢が出せないときは、これまでどおり払っている扱いにする", () => {
  const s = settingsWith({ privatePensionPlans: [
    { name: "共済", monthlyContribution: 15000, contribFromAge: 40, contribToAge: 60 },
  ] }, { birth: "" });
  assert.strictEqual(Core.lpMonthlyOf(s, "pension", null), 15000);
});

test("何も入れていなければ0。知らない種類も0", () => {
  const s = settingsWith({});
  assert.strictEqual(Core.lpMonthlyOf(s, "banks", 57), 0);
  assert.strictEqual(Core.lpMonthlyOf(s, "しらない種類", 57), 0);
});

test("毎月いくらの合計は、内訳の足し算と一致する", () => {
  const s = settingsWith({
    gold: { monthlyYen: 20000 },
    banks: [{ name: "A", monthlyDeposit: 10000 }],
    loans: [{ name: "車", monthlyPayment: 30000 }],
    privatePensionPlans: [{ name: "共済", monthlyContribution: 15000 }],
  });
  const parts = ["gold", "banks", "loans", "pension", "ideco", "insurance"]
    .reduce((t, k) => t + Core.lpMonthlyOf(s, k, 57), 0);
  assert.strictEqual(parts, Core.lpMonthlyTotal(s, 57));
});

/* ------------------------------------------------------------ 行のしるし(id) */

test("id は保存の形に残る。無い行には足さない（古いデータの形を変えない）", () => {
  const a = Core.normalizeLifePlanAssets({
    banks: [{ name: "A", id: "keep-1" }, { name: "B" }],
  });
  assert.strictEqual(a.banks[0].id, "keep-1");
  assert.ok(!("id" in a.banks[1]), "id が無い行に空の id を足さない");
});

test("id は使える文字だけにする", () => {
  const a = Core.normalizeLifePlanAssets({ banks: [{ name: "A", id: "a b/c<>-1" }] });
  assert.strictEqual(a.banks[0].id, "abc-1");
});

test("lpEnsureIds：無い行にだけ付ける。すでにある id は付け替えない", () => {
  const a = Core.lpEnsureIds({
    banks: [{ name: "A", id: "keep-1" }, { name: "B" }],
    loans: [{ name: "車" }],
    privatePensionPlans: [{ name: "共済" }],
    insurancePolicies: [{ name: "○○生命" }],
    lumpSums: [{ age: 59, amount: 1000000 }],
    tsumitateSchedule: [{ fromAge: 57, toAge: 65, funds: [{ name: "全世界", amount: 90000 }] }],
    growthSchedule: [{ fromAge: 57, toAge: 65, monthlyYen: 50000 }],
  }, seqId());
  assert.strictEqual(a.banks[0].id, "keep-1", "すでにある id は絶対に変えない");
  assert.strictEqual(a.banks[1].id, "test-1");
  [a.loans[0], a.privatePensionPlans[0], a.insurancePolicies[0],
   a.lumpSums[0], a.tsumitateSchedule[0], a.growthSchedule[0]]
    .forEach((r) => assert.ok(r.id, "しるしの無い行が残っている"));
});

test("lpEnsureIds をくり返しても id は変わらない", () => {
  const once = Core.lpEnsureIds({ loans: [{ name: "車" }] }, seqId());
  const twice = Core.lpEnsureIds(once, seqId());
  assert.strictEqual(twice.loans[0].id, once.loans[0].id);
});

/* -------------------------------------------------------------- 空の行の掃除 */

test("名前も金額も無い行は空とみなす。しるしだけの行も空", () => {
  assert.strictEqual(Core.lpRowIsEmpty({ name: "", balance: 0, monthlyDeposit: 0 }), true);
  assert.strictEqual(Core.lpRowIsEmpty({ name: "", balance: 0, id: "x-1" }), true);
  assert.strictEqual(Core.lpRowIsEmpty({ name: "A", balance: 0 }), false, "名前だけでも空ではない");
  assert.strictEqual(Core.lpRowIsEmpty({ name: "", balance: 100 }), false, "金額だけでも空ではない");
  assert.strictEqual(Core.lpRowIsEmpty(null), true);
});

test("lpDropEmptyRows：空の行だけを捨て、中身のある行は残す", () => {
  const a = Core.lpDropEmptyRows({
    banks: [{ name: "", balance: 0 }, { name: "A銀行", balance: 100 }],
    loans: [{ name: "", principal: 0, monthlyPayment: 0 }],
    privatePensionPlans: [{ name: "", monthlyContribution: 0 }],
    lumpSums: [{ age: 0, amount: 0 }, { age: 59, amount: 1000000 }],
  });
  assert.strictEqual(a.banks.length, 1);
  assert.strictEqual(a.banks[0].name, "A銀行");
  assert.strictEqual(a.loans.length, 0);
  assert.strictEqual(a.privatePensionPlans.length, 0);
  assert.strictEqual(a.lumpSums.length, 1);
});

test("lpDropEmptyRows は金・iDeCo には手を出さない", () => {
  const a = Core.lpDropEmptyRows({ gold: { monthlyYen: 20000 }, ideco: { monthlyContribution: 23000 } });
  assert.strictEqual(a.gold.monthlyYen, 20000);
  assert.strictEqual(a.ideco.monthlyContribution, 23000);
});

/* ------------------------------------------------------------ 渡すデータの形 */

test("渡すデータに生年月日が入る（食い違いの知らせに使われる）", () => {
  const out = Core.buildLifePlanInputs(settingsWith({ banks: [{ name: "A", balance: 1 }] }), "2026-08-08");
  assert.strictEqual(out.birth, "1968-11-20");
});

test("生年月日が未入力なら空文字。勝手な値は入れない", () => {
  const out = Core.buildLifePlanInputs(
    settingsWith({ banks: [{ name: "A", balance: 1 }] }, { birth: "" }), "2026-08-08");
  assert.strictEqual(out.birth, "");
});

test("渡すデータの各行に id が入る", () => {
  const s = settingsWith(Core.lpEnsureIds({
    banks: [{ name: "A", balance: 1 }],
    loans: [{ name: "車", principal: 1 }],
    privatePensionPlans: [{ name: "共済", monthlyContribution: 1 }],
    insurancePolicies: [{ name: "○○生命", monthlyPremium: 1 }],
    lumpSums: [{ age: 59, amount: 1 }],
  }, seqId()));
  const io = Core.buildLifePlanInputs(s, "2026-08-08").inputs;
  ["banks", "loans", "privatePensionPlans", "insurancePolicies", "lumpSums"]
    .forEach((k) => assert.ok(io[k][0].id, k + " に id が無い"));
});

test("積立の区間も id を落とさない（区間は名前を持たないため）", () => {
  const s = settingsWith(Core.lpEnsureIds({
    tsumitateSchedule: [{ fromAge: 57, toAge: 65, funds: [{ name: "全世界", amount: 90000 }] }],
  }, seqId()));
  const io = Core.buildLifePlanInputs(s, "2026-08-08").inputs;
  assert.strictEqual(io.tsumitateSchedule[0].id, "test-1");
  assert.strictEqual(io.tsumitateSchedule[0].monthlyYen, 90000);
  assert.ok(!("funds" in io.tsumitateSchedule[0]), "銘柄は区間には付けずに渡す");
});

test("2回渡しても id は同じ（向こうで同じ行が増えない）", () => {
  const s = settingsWith(Core.lpEnsureIds({ loans: [{ name: "車", principal: 1 }] }, seqId()));
  const a = Core.buildLifePlanInputs(s, "2026-08-08").inputs.loans[0].id;
  const b = Core.buildLifePlanInputs(s, "2026-09-08").inputs.loans[0].id;
  assert.strictEqual(a, b);
});

/* ------------------------------------------------------------------ 画面の側 */

test("内訳に入れた毎月の金額が、設定の一覧にそのまま出る", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-20", cycleStart: 20 } } });
  app.run(`lpKind="loans"; view="lp"; lpAddRow();`);
  app.run(`document.getElementById("lp-l-name-0").value="車のローン";
    document.getElementById("lp-l-pri-0").value="1000000";
    document.getElementById("lp-l-pay-0").value="30000";
    lpSaveLoans();`);
  const html = app.run(`lpSummaryHtml()`);
  assert.match(html, /¥30,000\/月/, "毎月の返済が出ていない");
  assert.match(html, /残り ¥1,000,000/, "残高は名前の下に出す");
});

test("ホームのタイルも毎月いくらで出る", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-20", cycleStart: 20 } } });
  app.run(`lpKind="banks"; view="lp"; lpAddRow();`);
  app.run(`document.getElementById("lp-b-name-0").value="A銀行";
    document.getElementById("lp-b-bal-0").value="3000000";
    document.getElementById("lp-b-mon-0").value="10000";
    lpSaveBanks();`);
  const html = app.run(`renderHome()`);
  assert.match(html, /¥10,000\/月/, "毎月の入金が出ていない");
});

test("「＋ 足す」で作った空行は消えない。「保存する」で消える", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-20", cycleStart: 20 } } });
  app.run(`lpKind="pension"; view="lp"; lpAddRow();`);
  assert.strictEqual(app.run(`state.settings.lp.privatePensionPlans.length`), 1, "足した直後は残る");
  app.run(`lpSavePension()`);
  assert.strictEqual(app.run(`(state.settings.lp&&state.settings.lp.privatePensionPlans||[]).length`), 0,
    "何も入れずに保存したら空行は消える");
});

test("保存すると、行にしるし（id）が付いて端末にも残る", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-20", cycleStart: 20 } } });
  app.run(`lpKind="loans"; view="lp"; lpAddRow();`);
  app.run(`document.getElementById("lp-l-name-0").value="車";
    document.getElementById("lp-l-pay-0").value="30000"; lpSaveLoans();`);
  const id = app.run(`state.settings.lp.loans[0].id`);
  assert.ok(id, "id が付いていない");
  assert.strictEqual(JSON.parse(app.saved()).settings.lp.loans[0].id, id, "端末に残っていない");
  /* 書き直しても id は変わらない */
  app.run(`document.getElementById("lp-l-pay-0").value="40000"; lpSaveLoans();`);
  assert.strictEqual(app.run(`state.settings.lp.loans[0].id`), id);
});

test("終了年齢の欄に「その誕生日まで」の注記がある", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-20", cycleStart: 20 } } });
  app.run(`lpKind="pension"; view="lp"; lpAddRow();`);
  assert.match(app.run(`renderLp()`), /掛ける 終了年齢（その誕生日まで）/);
  app.run(`lpKind="ideco";`);
  assert.match(app.run(`renderLp()`), /掛金 終了年齢（その誕生日まで）/);
  app.run(`lpKind="insurance"; lpAddRow();`);
  assert.match(app.run(`renderLp()`), /払い終わり年齢（その誕生日まで）/);
});

test("注記どおり、終了年齢の誕生日を過ぎたら掛金は止まる", () => {
  const s = settingsWith({ privatePensionPlans: [
    { name: "共済", monthlyContribution: 15000, contribFromAge: 40, contribToAge: 60 },
  ] });
  assert.strictEqual(Core.lpMonthlyOf(s, "pension", 59.99), 15000);
  assert.strictEqual(Core.lpMonthlyOf(s, "pension", 60), 15000, "誕生日ちょうどは払う");
  assert.strictEqual(Core.lpMonthlyOf(s, "pension", 60.01), 0);
});

test("ホームのタイルは横スクロールできる形になっている", () => {
  const html = require("fs").readFileSync(path.join(__dirname, "index.html"), "utf8");
  const css = html.slice(html.indexOf(".dreamstrip{"), html.indexOf(".dreamstrip{") + 400);
  assert.match(css, /overflow-x:auto/, "横スクロールになっていない");
  assert.match(html, /\.ds\{flex:0 0 /, "タイルの幅が決まっていない（詰めると潰れる）");
});
