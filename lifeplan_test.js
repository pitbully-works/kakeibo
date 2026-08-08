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
  assert.deepEqual(Object.keys(out.inputs).sort(), [
    "banks", "gold", "growthAllocation", "growthSchedule", "loans",
    "privatePensionPlans", "tsumitateAllocation", "tsumitateSchedule",
  ]);
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
  /* NISA・金・銀行・借入・民間年金の5つ（NISAは先取りの欄からも開けるので6か所） */
  assert.equal((out.match(/data-act="lp-open"/g) || []).length, 6, "内訳ボタンの数が合わない");
  assert.match(out, /data-kind="nisa"/, "NISAの内訳ボタンが無い");
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

/* =========================================================================
   【6】生年月日と、NISA積立のスケジュール
   -------------------------------------------------------------------------
   ライフプランの積立は年齢の区間で決まるので、生年月日が要る。
   打てる場所を、いつでも1か所だけにするのがここの肝。
   ========================================================================= */
const NISA = {
  tsumitateSchedule: [{ fromAge: 57.75, toAge: 65, monthlyYen: 90000 }],
  growthSchedule: [{ fromAge: 57.5, toAge: 65, monthlyYen: 10000 }],
  tsumitateAllocation: [{ name: "全世界株式", amount: 40000 }, { name: "S&P500", amount: 40000 }],
};
const autoSettings = () => Core.normalizeSettings({ birth: "1968-11-13", nisaMonthly: 110000, lp: NISA });

test("生年月日から、ライフプランと同じ年齢の出し方をする", () => {
  const a = Core.ageFromBirth("1968-11-13", "2026-08-08");
  assert.ok(Math.abs(a - 57.734) < 0.002, `年齢がずれている: ${a}`);
  assert.equal(Core.ageFromBirth("", "2026-08-08"), null);
  assert.equal(Core.ageFromBirth("1968-11-13", ""), null);
  assert.equal(Core.ageFromBirth("2026-02-31", "2026-08-08"), null, "存在しない日付を受け入れている");
  assert.equal(Core.ageFromBirth("2030-01-01", "2026-08-08"), null, "未来の生年月日を受け入れている");
});

test("生年月日は、妥当なものだけ設定に残す", () => {
  assert.equal(Core.normalizeSettings({ birth: "1968-11-13" }).birth, "1968-11-13");
  assert.equal(Core.normalizeSettings({ birth: "2026-02-31" }).birth, "");
  assert.equal(Core.normalizeSettings({ birth: "こわれ" }).birth, "");
  assert.equal(Core.normalizeSettings({}).birth, "");
});

test("年齢の区間から、今月の先取り額を出す", () => {
  const s = autoSettings();
  /* 8/8 は成長投資枠だけ始まっている */
  assert.equal(Core.nisaPlannedOn(s, "2026-08-08"), 10000);
  /* つみたて（57歳9ヶ月＝2026-08-13ごろ）が始まると足される */
  assert.equal(Core.nisaPlannedOn(s, "2026-09-08"), 100000);
  /* 区間を過ぎたら0 */
  assert.equal(Core.nisaPlannedOn(s, "2040-01-01"), 0);
});

test("重なった区間は足す（ライフプランと同じ数え方）", () => {
  assert.equal(Core.scheduledMonthly([
    { fromAge: 55, toAge: 65, monthlyYen: 30000 },
    { fromAge: 57, toAge: 60, monthlyYen: 20000 },
  ], 58), 50000);
  assert.equal(Core.scheduledMonthly([{ fromAge: 55, toAge: 65, monthlyYen: 30000 }], 65), 30000, "終了年齢は含む");
  assert.equal(Core.scheduledMonthly([{ fromAge: 55, toAge: 65, monthlyYen: 30000 }], 54.9), 0);
  assert.equal(Core.scheduledMonthly(null, 58), 0);
  assert.equal(Core.scheduledMonthly([{ fromAge: 55, toAge: 65, monthlyYen: 30000 }], null), 0);
});

test("終わりが始まりより前の区間は、始まりにそろえる", () => {
  const a = Core.normalizeLpSchedule([{ fromAge: 60, toAge: 50, monthlyYen: 10000 }]);
  assert.equal(a[0].toAge, 60);
});

test("打てる場所は1か所だけ（自動か手入力かが切り替わる）", () => {
  assert.equal(Core.nisaAuto(autoSettings()), true, "そろっているのに自動になっていない");
  /* 生年月日が無ければ手入力のまま */
  assert.equal(Core.nisaAuto(Core.normalizeSettings({ nisaMonthly: 110000, lp: NISA })), false);
  /* 区間が無ければ手入力のまま */
  assert.equal(Core.nisaAuto(Core.normalizeSettings({ birth: "1968-11-13", nisaMonthly: 110000 })), false);
});

test("前から使っている人の金額が、ある日いきなり0にならない", () => {
  /* 生年月日も区間も入れていない人は、これまでどおり打ち込んだ月額を使う */
  const old = Core.normalizeSettings({ nisaMonthly: 110000 });
  assert.equal(Core.nisaPlannedOn(old, "2026-08-08"), 110000);
  const c = Core.computeMonth(old, [{ id: "1", date: "2026-08-05", type: "income", cat: "salary", amount: 300000 }], "2026-08");
  assert.equal(c.nisaPlanned, 110000);
});

test("「いつから いくら」が分かる", () => {
  const next = Core.nisaUpcoming(autoSettings(), "2026-08-08");
  assert.equal(next.fromAge, 57.75);
  assert.equal(next.monthly, 90000);
  assert.equal(next.startDate, "2026-08-13");
  /* すべて始まっていれば、これから始まるものは無い */
  assert.equal(Core.nisaUpcoming(autoSettings(), "2026-09-08"), null);
  assert.equal(Core.nisaUpcoming(Core.normalizeSettings({ nisaMonthly: 1 }), "2026-08-08"), null);
});

test("いつ計算しても同じ答えになる（区切りの初日で見る）", () => {
  const s = autoSettings();
  const txs = [{ id: "1", date: "2026-08-05", type: "income", cat: "salary", amount: 300000 }];
  const a = Core.computeMonth(s, txs, "2026-08");
  const b = Core.computeMonth(s, txs, "2026-08");
  assert.equal(a.nisaPlanned, b.nisaPlanned);
  assert.equal(a.nisaPlanned, Core.nisaPlannedOn(s, a.periodFrom));
});

test("NISAのスケジュールと銘柄も、ライフプランへそのまま渡す", () => {
  const out = Core.buildLifePlanInputs(autoSettings()).inputs;
  assert.deepEqual(out.tsumitateSchedule, [{ fromAge: 57.75, toAge: 65, monthlyYen: 90000 }]);
  assert.deepEqual(out.tsumitateAllocation, [{ name: "全世界株式", amount: 40000 }, { name: "S&P500", amount: 40000 }]);
  assert.deepEqual(Object.keys(out.tsumitateSchedule[0]).sort(), ["fromAge", "monthlyYen", "toAge"]);
  assert.deepEqual(Object.keys(out.tsumitateAllocation[0]).sort(), ["amount", "name"]);
  /* 生年月日そのものは渡さない（ライフプラン側で入れる項目） */
  assert.equal("birth" in out, false);
  assert.equal("birthDate" in out, false);
});

test("せっていに生年月日の欄があり、なぜ要るかが書いてある", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  const out = app.run(`view="settings"; render(); document.getElementById("app").innerHTML`);
  assert.match(out, /id="f-birth"/, "生年月日の欄が無い");
  assert.match(out, /なぜ必要か/, "理由が書いていない");
  assert.match(out, /年齢の区間/, "年齢の区間で決まることを説明していない");
});

test("生年月日を保存できる", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  app.run(`view="settings"; render(); document.getElementById("f-birth").value="1968-11-13"; saveSettings();`);
  assert.equal(app.run(`state.settings.birth`), "1968-11-13");
});

test("自動のときは、月額の欄が打てない（読み取り専用）", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-13", lp: NISA }, tx: [] } });
  const out = app.run(`view="settings"; render(); document.getElementById("app").innerHTML`);
  const field = out.slice(out.indexOf('id="f-nisa"') - 60, out.indexOf('id="f-nisa"') + 60);
  assert.match(field, /readonly/, "自動なのに打ててしまう");
});

test("自動のときは、月額の欄の値で上書きしない", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-13", lp: NISA }, tx: [] } });
  app.run(`view="settings"; render(); document.getElementById("f-nisa").value="999999"; saveSettings();`);
  assert.notEqual(app.run(`state.settings.nisaMonthly`), 999999, "読み取り専用の表示を書き戻している");
});

test("開始前は0で、いつから幾らになるかを画面に出す", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-13", lp: { tsumitateSchedule: [{ fromAge: 90, toAge: 95, monthlyYen: 90000 }] } }, tx: [] } });
  const out = app.run(`view="settings"; render(); document.getElementById("app").innerHTML`);
  assert.match(out, /まだ積立の期間に入っていない/, "0である理由を伝えていない");
  assert.match(out, /から 月¥90,000/, "いつから幾らかを出していない");
});

test("NISAの内訳を直して保存できる", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-13", lp: NISA }, tx: [] } });
  app.run(`view="lp"; lpKind="nisa"; render();
    document.getElementById("lp-ts-from-0").value="58";
    document.getElementById("lp-ts-to-0").value="65";
    document.getElementById("lp-ts-yen-0").value="80000";
    document.getElementById("lp-gs-from-0").value="57.5";
    document.getElementById("lp-gs-to-0").value="65";
    document.getElementById("lp-gs-yen-0").value="10000";
    lpSaveNisa();`);
  assert.equal(app.run(`state.settings.lp.tsumitateSchedule[0].monthlyYen`), 80000);
  assert.equal(app.run(`state.settings.lp.tsumitateSchedule[0].fromAge`), 58);
});

test("NISAの内訳に、区間と銘柄の両方を足せる", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-13", lp: NISA }, tx: [] } });
  app.run(`view="lp"; lpKind="nisa"; render(); lpAddRow("tsumitateSchedule");`);
  assert.equal(app.run(`state.settings.lp.tsumitateSchedule.length`), 2);
  app.run(`lpAddRow("growthAllocation");`);
  assert.equal(app.run(`state.settings.lp.growthAllocation.length`), 1);
});

test("NISAの内訳の行を、確かめてから消せる", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-13", lp: NISA }, tx: [] } });
  app.run(`view="lp"; lpKind="nisa"; render(); confirm=()=>false; lpDeleteRow(0,"tsumitateAllocation");`);
  assert.equal(app.run(`state.settings.lp.tsumitateAllocation.length`), 2, "確かめずに消している");
  app.run(`confirm=()=>true; lpDeleteRow(0,"tsumitateAllocation");`);
  assert.equal(app.run(`state.settings.lp.tsumitateAllocation.length`), 1);
});

test("NISAの画面が白くならない", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  const out = app.run(`view="lp"; lpKind="nisa"; render(); document.getElementById("app").innerHTML`);
  assert.ok(out.length > 300, "画面が空");
  assert.match(out, /生年月日/, "生年月日を入れる案内が無い");
});
