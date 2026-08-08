/* =========================================================================
   かけいぼ ― ライフプランへ渡す資産（金・銀行貯金・借入金・民間年金）
   -------------------------------------------------------------------------
   ねらいは「ライフプランアプリへ入れ直す手間をなくす」こと。
   そのため渡す形は、ライフプラン側の inputs にそのまま合わせてある。

   ここで確かめること：
     【1】数の整え方（範囲・件数・壊れた値）
     【2】設定に出す合計
     【3】渡す形（ライフプランの「バックアップの読み込み」が受け取れるか）
     【4】二重入力になっていないこと（家計の計算に混ざらない）
     【5】画面（合計と内訳ボタン、内訳の編集・追加・削除）

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

const SAMPLE = {
  gold: { currentGrams: 208, pricePerGram: 24000, monthlyYen: 10000 },
  banks: [
    { name: "JAめぐみの", balance: 501192, monthlyDeposit: 0, interestPct: 0 },
    { name: "八幡信用金庫", balance: 601578, monthlyDeposit: 5000, interestPct: 0.02 },
  ],
  loans: [{ name: "車", principal: 3051600, annualRatePct: 3.9, monthlyPayment: 32200 }],
  privatePensionPlans: [
    { name: "JA年金共済", contribFromAge: 35, contribToAge: 60, monthlyContribution: 15000,
      payoutFromAge: 60, payoutToAge: 70, monthlyPayout: 42500 },
  ],
};

/* =========================================================================
   【1】数の整え方
   ========================================================================= */
test("入れた値を、そのままの形で受け取れる", () => {
  const a = Core.normalizeLifePlanAssets(SAMPLE);
  assert.equal(a.gold.currentGrams, 208);
  assert.equal(a.banks.length, 2);
  assert.equal(a.banks[1].interestPct, 0.02);
  assert.equal(a.loans[0].annualRatePct, 3.9);
  assert.equal(a.privatePensionPlans[0].monthlyPayout, 42500);
});

test("何も渡さなくても、空の形が返る（落ちない）", () => {
  for (const v of [null, undefined, "こわれ", 123, []]) {
    const a = Core.normalizeLifePlanAssets(v);
    assert.deepEqual(a.gold, { currentGrams: 0, pricePerGram: 0, monthlyYen: 0 });
    assert.deepEqual(a.banks, []);
    assert.deepEqual(a.loans, []);
    assert.deepEqual(a.privatePensionPlans, []);
  }
});

test("文字や記号が混ざっていても、数として読み取る", () => {
  const a = Core.normalizeLifePlanAssets({
    gold: { currentGrams: "208", pricePerGram: "24,000", monthlyYen: "¥10000" },
    banks: [{ name: "A", balance: "501,192" }],
  });
  assert.equal(a.gold.currentGrams, 208);
  assert.equal(a.gold.pricePerGram, 24000);
  assert.equal(a.gold.monthlyYen, 10000);
  assert.equal(a.banks[0].balance, 501192);
});

test("読み取れない値・マイナスは0にする", () => {
  const a = Core.normalizeLifePlanAssets({
    gold: { currentGrams: "あいうえお", pricePerGram: -500, monthlyYen: NaN },
    loans: [{ name: "A", principal: -100 }],
  });
  assert.equal(a.gold.currentGrams, 0);
  assert.equal(a.gold.pricePerGram, 0);
  assert.equal(a.gold.monthlyYen, 0);
  assert.equal(a.loans[0].principal, 0);
});

test("年齢は0〜120で、ヶ月（小数）も入れられる", () => {
  const a = Core.normalizeLifePlanAssets({
    privatePensionPlans: [{ name: "A", contribFromAge: 57.5, contribToAge: 999, payoutFromAge: -3 }],
  });
  assert.equal(a.privatePensionPlans[0].contribFromAge, 57.5);
  assert.equal(a.privatePensionPlans[0].contribToAge, 120);
  assert.equal(a.privatePensionPlans[0].payoutFromAge, 0);
});

test("名前が長すぎるときは切り、件数にも上限がある", () => {
  assert.equal(Core.LP_MAX_ROWS, 20, "上限が決まっていない");
  const many = [];
  for (let i = 0; i < Core.LP_MAX_ROWS + 10; i++) many.push({ name: "銀行" + i, balance: 1 });
  const a = Core.normalizeLifePlanAssets({ banks: many.concat([{ name: "あ".repeat(50), balance: 1 }]) });
  assert.equal(a.banks.length, Core.LP_MAX_ROWS);
  const long = Core.normalizeLifePlanAssets({ banks: [{ name: "あ".repeat(50) }] });
  assert.equal(long.banks[0].name.length, 24);
  /* 上限そのものを動かされても気づけるよう、実数でも確かめる */
  const over = [];
  for (let i = 0; i < 40; i++) over.push({ name: "銀行" + i, balance: 1 });
  assert.equal(Core.normalizeLifePlanAssets({ banks: over }).banks.length, 20);
  assert.equal(Core.normalizeLifePlanAssets({ loans: over }).loans.length, 20);
  assert.equal(Core.normalizeLifePlanAssets({ privatePensionPlans: over }).privatePensionPlans.length, 20);
});

test("行の中身が壊れていても落ちない", () => {
  const a = Core.normalizeLifePlanAssets({ banks: [null, undefined, "こわれ", { name: "A", balance: 5 }] });
  assert.equal(a.banks.length, 4);
  assert.equal(a.banks[0].balance, 0);
  assert.equal(a.banks[3].balance, 5);
});

/* =========================================================================
   【2】設定に出す合計
   ========================================================================= */
test("金は「量 × 1グラムの値段」で評価する", () => {
  assert.equal(Core.lpGoldValue(SAMPLE.gold), 208 * 24000);
  assert.equal(Core.lpGoldValue(null), 0);
  assert.equal(Core.lpGoldValue({ currentGrams: 10.5, pricePerGram: 24000 }), 252000);
});

test("銀行・借入・民間年金の合計が出る", () => {
  assert.equal(Core.lpBanksTotal(SAMPLE.banks), 501192 + 601578);
  assert.equal(Core.lpLoansTotal(SAMPLE.loans), 3051600);
  assert.equal(Core.lpPensionMonthly(SAMPLE.privatePensionPlans), 15000);
  assert.equal(Core.lpBanksTotal(null), 0);
  assert.equal(Core.lpLoansTotal("こわれ"), 0);
  assert.equal(Core.lpPensionMonthly(undefined), 0);
});

/* =========================================================================
   【3】渡す形
   ========================================================================= */
test("ライフプランの「バックアップの読み込み」が受け取れる形で出す", () => {
  const out = Core.buildLifePlanInputs(Core.normalizeSettings({ lp: SAMPLE }));
  /* 向こうは parsed.inputs があるかを見て取り込む */
  assert.ok(out.inputs, "inputs が無いと読み込んでもらえない");
  assert.deepEqual(Object.keys(out.inputs).sort(), ["banks", "gold", "loans", "privatePensionPlans"]);
});

test("キー名は、ライフプラン側とまったく同じにする（言い換えない）", () => {
  const out = Core.buildLifePlanInputs(Core.normalizeSettings({ lp: SAMPLE })).inputs;
  assert.deepEqual(Object.keys(out.gold).sort(), ["currentGrams", "monthlyYen", "pricePerGram"]);
  assert.deepEqual(Object.keys(out.banks[0]).sort(), ["balance", "interestPct", "monthlyDeposit", "name"]);
  assert.deepEqual(Object.keys(out.loans[0]).sort(), ["annualRatePct", "monthlyPayment", "name", "principal"]);
  assert.deepEqual(Object.keys(out.privatePensionPlans[0]).sort(),
    ["contribFromAge", "contribToAge", "monthlyContribution", "monthlyPayout", "name", "payoutFromAge", "payoutToAge"]);
});

test("渡すのは4つだけ。ライフプランでしか入れない値を上書きしない", () => {
  const out = Core.buildLifePlanInputs(Core.normalizeSettings({ lp: SAMPLE })).inputs;
  for (const k of ["currentAge", "retireAge", "pensionMonthly", "tsumitateHoldings", "ideco", "insurancePolicies"]) {
    assert.equal(k in out, false, `${k} まで渡すと、ライフプラン側の入力が消える`);
  }
});

test("何も入れていなくても、空の形で出せる（落ちない）", () => {
  const out = Core.buildLifePlanInputs({});
  assert.deepEqual(out.inputs.banks, []);
  assert.deepEqual(out.inputs.gold, { currentGrams: 0, pricePerGram: 0, monthlyYen: 0 });
  assert.doesNotThrow(() => Core.buildLifePlanInputs(null));
});

/* =========================================================================
   【4】二重入力にしない・家計の計算に混ぜない
   ========================================================================= */
test("設定に保存され、バックアップでも往復する", () => {
  const s = Core.normalizeSettings({ savingsTarget: 30000, lp: SAMPLE });
  assert.equal(s.lp.banks.length, 2);
  const again = Core.normalizeSettings(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(again.lp, s.lp);
  assert.equal(again.savingsTarget, 30000, "ほかの設定が消えている");
});

test("何も入れていないうちは、設定に持たせない（保存を太らせない）", () => {
  assert.equal("lp" in Core.normalizeSettings({}), false);
  assert.equal("lp" in Core.normalizeSettings({ lp: { banks: [] } }), false);
  assert.equal("lp" in Core.normalizeSettings({ lp: { banks: [{ name: "A", balance: 1 }] } }), true);
  assert.equal("lp" in Core.normalizeSettings({ lp: { gold: { currentGrams: 1 } } }), true);
});

test("借入の毎月返済を入れても、今月の使えるお金は変わらない", () => {
  /* ここが二重計上の分かれ目。実際に払ったお金は「記録」から入れる決めごと。 */
  const txs = [
    { id: "1", date: "2026-08-05", type: "income", cat: "salary", amount: 300000 },
    { id: "2", date: "2026-08-06", type: "expense", cat: "food", amount: 50000 },
  ];
  const plain = Core.computeMonth(Core.normalizeSettings({}), txs, "2026-08");
  const withLp = Core.computeMonth(Core.normalizeSettings({ lp: SAMPLE }), txs, "2026-08");
  assert.equal(withLp.usable, plain.usable, "ライフプラン用の資産が家計の計算に混ざっている");
  assert.equal(withLp.spendTotal, plain.spendTotal);
  assert.equal(withLp.incomeTotal, plain.incomeTotal);
});

test("月次スナップショットにも混ざらない", () => {
  const a = Core.buildSnapshot(Core.normalizeSettings({}), [], "2026-08");
  const b = Core.buildSnapshot(Core.normalizeSettings({ lp: SAMPLE }), [], "2026-08");
  assert.deepEqual(b, a, "スナップショットの中身が変わっている");
});

test("入力口はここだけ（同じ欄をほかの画面に作らない）", () => {
  /* 金・銀行・借入・民間年金の入力欄が、内訳の画面の外にできていないこと */
  const ids = ["lp-g-grams", "lp-g-price", "lp-b-bal-", "lp-l-pri-", "lp-p-mon-"];
  for (const id of ids) {
    const n = (appSrc.match(new RegExp(`id="${id}`, "g")) || []).length;
    assert.equal(n, 1, `${id} の入力欄が ${n} か所にある`);
  }
});

/* =========================================================================
   【5】画面
   ========================================================================= */
const withLp = () => bootApp({ state: { settings: { lp: SAMPLE }, tx: [] } });

/* テスト用の最小DOMは画面の中身を読み取らないので、描いたあとの入力欄には
   何も入っていない。実機では描いた値が入っているので、その状態を作ってから操作する。 */
function fillBankFields(app){
  app.run(`state.settings.lp.banks.forEach((b,i)=>{
    document.getElementById("lp-b-name-"+i).value = b.name;
    document.getElementById("lp-b-bal-"+i).value = String(b.balance);
    document.getElementById("lp-b-mon-"+i).value = String(b.monthlyDeposit);
    document.getElementById("lp-b-int-"+i).value = String(b.interestPct);
  });`);
}

test("せっていには、合計と内訳ボタンだけを出す", () => {
  const app = withLp();
  const out = app.run(`view="settings"; render(); document.getElementById("app").innerHTML`);
  assert.match(out, /ライフプランへ渡すデータ/, "見出しが無い");
  assert.match(out, /¥4,992,000/, "金の評価額が出ていない");
  assert.match(out, /¥1,102,770/, "銀行の合計が出ていない");
  assert.match(out, /¥3,051,600/, "借入の合計が出ていない");
  assert.equal((out.match(/data-act="lp-open"/g) || []).length, 4, "内訳ボタンが4つ無い");
  /* 一覧の中に入力欄は出さない */
  assert.equal(out.includes('id="lp-b-bal-0"'), false, "せっていに内訳の入力欄が出ている");
});

test("内訳を開くと、その種類の入力欄が出る", () => {
  const app = withLp();
  const banks = app.run(`view="lp"; lpKind="banks"; render(); document.getElementById("app").innerHTML`);
  assert.match(banks, /id="lp-b-bal-0"/, "銀行の残高欄が無い");
  assert.match(banks, /JAめぐみの/, "入れた名前が出ていない");
  const gold = app.run(`lpKind="gold"; render(); document.getElementById("app").innerHTML`);
  assert.match(gold, /id="lp-g-grams"/, "金の欄が無い");
  const pension = app.run(`lpKind="pension"; render(); document.getElementById("app").innerHTML`);
  assert.match(pension, /id="lp-p-pay-0"/, "民間年金の欄が無い");
});

test("内訳を開く道すじが、書きかけを保存してから移っている", () => {
  /* ここが外れると、せっていに打ちかけた数字が黙って消える */
  const idx = appSrc.indexOf('if(a==="lp-open")');
  assert.ok(idx > 0, "内訳を開く道が無い");
  const block = appSrc.slice(idx, idx + 260);
  assert.match(block, /saveSettingsQuiet\(\);/, "移る前に書きかけを保存していない");
  assert.ok(block.indexOf("saveSettingsQuiet()") < block.indexOf('view="lp"'),
    "保存より先に画面を移している");
});

test("内訳を開くとき、せっていの書きかけを取りこぼさない", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  app.run(`view="settings"; render();
    document.getElementById("f-save").value="30000";
    saveSettingsQuiet();`);
  assert.equal(app.run(`state.settings.savingsTarget`), 30000, "書きかけが消えている");
});

test("内訳を直して保存できる", () => {
  const app = withLp();
  app.run(`view="lp"; lpKind="banks"; render();
    document.getElementById("lp-b-bal-0").value="777777";
    lpSaveBanks();`);
  assert.equal(app.run(`state.settings.lp.banks[0].balance`), 777777);
});

test("保存できなかったら、元の値へ完全に戻す", () => {
  const app = bootApp({ state: { settings: { lp: SAMPLE }, tx: [] }, storageFull: true });
  app.run(`view="lp"; lpKind="banks"; render();
    document.getElementById("lp-b-bal-0").value="777777";
    lpSaveBanks();`);
  assert.equal(app.run(`state.settings.lp.banks[0].balance`), 501192, "失敗したのに変わっている");
});

test("行を足せる。足す前の書きかけも残る", () => {
  const app = withLp();
  app.run(`view="lp"; lpKind="banks"; render();`);
  fillBankFields(app);
  app.run(`document.getElementById("lp-b-bal-1").value="999"; lpAddRow();`);
  assert.equal(app.run(`state.settings.lp.banks.length`), 3, "足せていない");
  assert.equal(app.run(`state.settings.lp.banks[1].balance`), 999, "足すときに書きかけが消えている");
  assert.equal(app.run(`state.settings.lp.banks[0].name`), "JAめぐみの", "足すときにほかの行が消えている");
});

test("行を消せる。確かめてから消す", () => {
  const app = withLp();
  app.run(`view="lp"; lpKind="banks"; render(); confirm=()=>false;`);
  fillBankFields(app);
  app.run(`lpDeleteRow(0);`);
  assert.equal(app.run(`state.settings.lp.banks.length`), 2, "確かめずに消している");
  app.run(`confirm=()=>true; lpDeleteRow(0);`);
  assert.equal(app.run(`state.settings.lp.banks.length`), 1);
  assert.equal(app.run(`state.settings.lp.banks[0].name`), "八幡信用金庫", "消す行を取り違えている");
});

test("上限を超えて足せない", () => {
  const many = [];
  for (let i = 0; i < Core.LP_MAX_ROWS; i++) many.push({ name: "銀行" + i, balance: 1 });
  const app = bootApp({ state: { settings: { lp: { banks: many } }, tx: [] } });
  app.run(`view="lp"; lpKind="banks"; render(); lpAddRow();`);
  assert.equal(app.run(`state.settings.lp.banks.length`), Core.LP_MAX_ROWS);
  assert.match(app.toastText(), /件までです/, "上限を伝えていない");
});

test("画面が白くならない（4種類とも描ける）", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  for (const kind of ["gold", "banks", "loans", "pension"]) {
    const out = app.run(`view="lp"; lpKind="${kind}"; render(); document.getElementById("app").innerHTML`);
    assert.ok(out.length > 150, `${kind} の画面が空`);
  }
});

test("せっていへ戻れる", () => {
  const app = withLp();
  app.run(`view="lp"; render();`);
  assert.match(appSrc, /if\(a==="lp-back"\)\{ view="settings"; render\(\); return; \}/, "戻る道が無い");
});
