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
test("家計簿から来たデータだと分かる印をつける", () => {
  const out = Core.buildLifePlanInputs(Core.normalizeSettings({ lp: SAMPLE }));
  assert.equal(out.source, "kakeibo", "通常のバックアップ復元と見分けがつかない");
  assert.equal(out.schemaVersion, 1);
  assert.ok(out.inputs, "inputs が無いと読み込んでもらえない");
  assert.deepEqual(Object.keys(out.inputs).sort(), [
    "banks", "gold", "loans", "privatePensionPlans",
  ], "登録した分類だけを渡していない");
});

test("登録が無い分類は渡さない（空配列で既存データを消させない）", () => {
  const out = Core.buildLifePlanInputs(Core.normalizeSettings({ lp: { banks: [{ name: "A", balance: 100 }] } }));
  assert.deepEqual(Object.keys(out.inputs), ["banks"], "空の分類まで渡している");
  for (const k of ["loans", "insurancePolicies", "privatePensionPlans", "gold", "ideco", "lumpSums"]) {
    assert.equal(k in out.inputs, false, `${k} を空で渡すと、向こうの既存データが消える恐れがある`);
  }
});

test("キー名は、ライフプラン側とまったく同じにする（言い換えない）", () => {
  const out = Core.buildLifePlanInputs(Core.normalizeSettings({ lp: SAMPLE })).inputs;
  assert.deepEqual(Object.keys(out.gold).sort(), ["currentGrams", "monthlyYen", "pricePerGram"]);
  assert.deepEqual(Object.keys(out.banks[0]).sort(), ["balance", "interestPct", "monthlyDeposit", "name"]);
  assert.deepEqual(Object.keys(out.loans[0]).sort(), ["annualRatePct", "monthlyPayment", "name", "principal"]);
  assert.deepEqual(Object.keys(out.privatePensionPlans[0]).sort(),
    ["contribFromAge", "contribToAge", "monthlyContribution", "monthlyPayout", "name", "payoutFromAge", "payoutToAge"]);
});

test("ライフプランでしか入れない値は上書きしない", () => {
  const out = Core.buildLifePlanInputs(Core.normalizeSettings({ lp: SAMPLE })).inputs;
  for (const k of ["currentAge", "retireAge", "pensionMonthly", "tsumitateHoldings", "growthHoldings", "banksExtra"]) {
    assert.equal(k in out, false, `${k} まで渡すと、ライフプラン側の入力が消える`);
  }
});

test("何も入れていなければ、渡すものが無い（落ちない）", () => {
  const out = Core.buildLifePlanInputs({});
  assert.deepEqual(out.inputs, {}, "未登録なのに何かを渡している");
  assert.equal(out.source, "kakeibo");
  assert.doesNotThrow(() => Core.buildLifePlanInputs(null));
});

/* =========================================================================
   【4】二重入力にしない・家計の計算に混ぜない
   ========================================================================= */
test("設定に保存され、バックアップでも往復する", () => {
  const s = Core.normalizeSettings({ goalTarget: 30000, lp: SAMPLE });
  assert.equal(s.lp.banks.length, 2);
  const again = Core.normalizeSettings(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(again.lp, s.lp);
  assert.equal(again.goalTarget, 30000, "ほかの設定が消えている");
});

test("何も入れていないうちは、設定に持たせない（保存を太らせない）", () => {
  assert.equal("lp" in Core.normalizeSettings({}), false);
  assert.equal("lp" in Core.normalizeSettings({ lp: { banks: [] } }), false);
  assert.equal("lp" in Core.normalizeSettings({ lp: { banks: [{ name: "A", balance: 1 }] } }), true);
  assert.equal("lp" in Core.normalizeSettings({ lp: { gold: { currentGrams: 1 } } }), true);
});

test("貯まるものは先取り、出ていくものは支出（どちらも二重に引かない）", () => {
  const txs = [
    { id: "1", date: "2026-08-05", type: "income", cat: "salary", amount: 300000 },
    { id: "2", date: "2026-08-06", type: "expense", cat: "food", amount: 50000 },
  ];
  const plain = Core.computeMonth(Core.normalizeSettings({}), txs, "2026-08");
  const withLp = Core.computeMonth(Core.normalizeSettings({ lp: SAMPLE }), txs, "2026-08");
  /* 貯まるもの：銀行への入金5,000＋民間年金15,000＋金の積立10,000 */
  const keep = 5000 + 15000 + 10000;
  /* 出ていくもの：借入の返済32,200 */
  const gone = 32200;
  assert.equal(withLp.lpSetAsideSum, keep, "先取りの中身が違う");
  assert.equal(withLp.lpSpendSum, gone, "支出の中身が違う");
  assert.equal(withLp.setAside, plain.setAside + keep, "貯まるものが先取りに入っていない");
  assert.equal(withLp.spendTotal, plain.spendTotal + gone, "出ていくものが支出に入っていない");
  assert.equal(withLp.recurringSpend, plain.recurringSpend + gone, "毎月固定に入っていない");
  /* 使えるお金からは、合わせて1回だけ引かれる */
  assert.equal(withLp.available, plain.available - keep - gone, "二重に引かれている");
  assert.equal(withLp.incomeTotal, plain.incomeTotal);
});

test("まとめに、先取りと毎月固定の支出が分けて出る", () => {
  const app = bootApp({ state: { settings: { lp: SAMPLE }, tx: [
    { id: "1", date: new Date().toISOString().slice(0, 10), type: "income", cat: "salary", amount: 300000 }] } });
  const out = app.run(`view="summary"; sumTab="month"; render(); document.getElementById("app").innerHTML`);
  assert.match(out, /先取り（貯まるお金）/, "先取りの見出しが無い");
  assert.match(out, /毎月固定（支出）/, "支出の見出しが無い");
  assert.match(out, /金（きん）の積立/, "先取りの内わけが出ていない");
  assert.match(out, /借入の返済/, "支出の内わけが出ていない");
  assert.match(out, /記録からは入れません/, "二重にしない決めごとを書いていない");
});

test("一括投資は、かけいぼの計算にも月次スナップショットにも入らない", () => {
  const lumps = { lumpSums: [{ age: 59, amount: 2280000 }] };
  const txs = [{ id: "1", date: "2026-08-05", type: "income", cat: "salary", amount: 300000 }];
  const plain = Core.computeMonth(Core.normalizeSettings({}), txs, "2026-08");
  const withLump = Core.computeMonth(Core.normalizeSettings({ lp: lumps }), txs, "2026-08");
  assert.equal(withLump.available, plain.available, "一括投資が毎月の計算に入っている");
  assert.deepEqual(
    Core.buildSnapshot(Core.normalizeSettings({ lp: lumps }), [], "2026-08"),
    Core.buildSnapshot(Core.normalizeSettings({}), [], "2026-08"));
  /* ライフプランへは渡す */
  assert.deepEqual(Core.buildLifePlanInputs(Core.normalizeSettings({ lp: lumps })).inputs.lumpSums,
    [{ age: 59, amount: 2280000 }]);
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
/* NISAの区間と銘柄も、描いたあとの入力欄の値を手で入れて実機と同じ状態にする */
function fillNisaFields(app){
  app.run(`["tsumitateSchedule:lp-ts","growthSchedule:lp-gs"].forEach((pair)=>{
    const [key,id]=pair.split(":");
    (state.settings.lp[key]||[]).forEach((r,i)=>{
      document.getElementById(id+"-from-"+i).value = String(r.fromAge);
      document.getElementById(id+"-to-"+i).value = String(r.toAge);
      (r.funds||[]).forEach((f,n)=>{
        document.getElementById(id+"-fn-"+i+"-"+n).value = f.name;
        document.getElementById(id+"-fa-"+i+"-"+n).value = String(f.amount);
      });
    });
  });`);
}

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
  /* NISA・金・銀行・借入・iDeCo・生命保険・民間年金の7つ。
     先取りの欄は廃止したので、NISAを開ける場所もここ1か所だけ。 */
  assert.equal((out.match(/data-act="lp-open"/g) || []).length, 7, "内訳ボタンの数が合わない");
  assert.match(out, /data-kind="ideco"/, "iDeCoの内訳ボタンが無い");
  assert.match(out, /data-kind="insurance"/, "生命保険の内訳ボタンが無い");
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
    document.getElementById("f-gtarget").value="30000";
    saveSettingsQuiet();`);
  assert.equal(app.run(`state.settings.goalTarget`), 30000, "書きかけが消えている");
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
  /* 月額は銘柄の合計。打つのは銘柄名と金額だけ。 */
  tsumitateSchedule: [{ fromAge: 57.75, toAge: 65, funds: [
    { name: "全世界株式", amount: 40000 }, { name: "S&P500", amount: 40000 }, { name: "タワラ8", amount: 10000 }] }],
  growthSchedule: [{ fromAge: 57.5, toAge: 65, funds: [{ name: "AI", amount: 10000 }] }],
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
  /* 開始日は「その年齢に達する最初の日」。判定に使う ageFromBirth とそろえる。
     2026-08-13 は 57.7479歳でまだ 57.75 に届かず、積立は始まらない。
     以前はここだけ経過日数の近似で出していたため、1日前を出していた。 */
  assert.equal(next.startDate, "2026-08-14");
  const before = Core.nisaPlannedOn(autoSettings(), "2026-08-13");
  const on = Core.nisaPlannedOn(autoSettings(), next.startDate);
  assert.equal(on - before, next.monthly, "出した開始日に、その区間ぶんが増えていない");
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
  const out = Core.buildLifePlanInputs(autoSettings(), "2026-09-08").inputs;
  assert.deepEqual(out.tsumitateSchedule, [{ fromAge: 57.75, toAge: 65, monthlyYen: 90000 }],
    "月額は銘柄の合計になっていない");
  assert.deepEqual(out.tsumitateAllocation, [
    { name: "全世界株式", amount: 40000 }, { name: "S&P500", amount: 40000 }, { name: "タワラ8", amount: 10000 }]);
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
  assert.match(out, /NISA積立の年齢区間/, "NISA積立の年齢区間で決まることを説明していない");
});

test("生年月日を保存できる（保存ボタンでも、内訳へ移るときでも）", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  app.run(`view="settings"; render(); document.getElementById("f-birth").value="1968-11-13"; saveSettings();`);
  assert.equal(app.run(`state.settings.birth`), "1968-11-13");
  /* 内訳へ移るときの静かな保存でも拾う（ここが外れると、打ちかけた生年月日が消える） */
  const app2 = bootApp({ state: { settings: {}, tx: [] } });
  app2.run(`view="settings"; render(); document.getElementById("f-birth").value="1970-01-05"; saveSettingsQuiet();`);
  assert.equal(app2.run(`state.settings.birth`), "1970-01-05", "内訳へ移るときに生年月日を捨てている");
});

test("せっていにNISAを打ち込む欄は無い（入力口は内訳だけ）", () => {
  /* 区間がまだ無い人でも、せっていからは打てない。二重に書ける場所を作らないため。 */
  const app = bootApp({ state: { settings: { nisaMonthly: 110000 }, tx: [] } });
  const out = app.run(`view="settings"; render(); document.getElementById("app").innerHTML`);
  assert.equal(out.includes('id="f-nisa"'), false, "廃止したNISAの欄が残っている");
  assert.match(out, /data-kind="nisa"/, "内訳へ行くボタンが無い");
});

test("せっていの一覧には、いまのNISAの月額が出る", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-13", lp: NISA }, tx: [] } });
  const out = app.run(`view="settings"; render(); document.getElementById("app").innerHTML`);
  assert.match(out, /NISA積立/, "NISAの行が無い");
  assert.match(out, /\/月/, "毎月いくらとして出ていない");
});

test("せっていから、NISAの月額を書き換えられない", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-13", lp: NISA }, tx: [] } });
  app.run(`view="settings"; render(); saveSettings();`);
  assert.notEqual(app.run(`state.settings.nisaMonthly`), 999999);
});

test("開始前は0で、いつから幾らになるかを画面に出す", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-13", lp: { tsumitateSchedule: [{ fromAge: 90, toAge: 95, monthlyYen: 90000 }] } }, tx: [] } });
  const out = app.run(`view="settings"; render(); document.getElementById("app").innerHTML`);
  assert.match(out, /まだ積立の期間に入っていません/, "0である理由を伝えていない");
  assert.match(out, /90歳から 月¥90,000/, "いつから幾らかを出していない");
});

test("NISAの内訳を直して保存できる", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-13", lp: NISA }, tx: [] } });
  app.run(`view="lp"; lpKind="nisa"; render();
    document.getElementById("lp-ts-from-0").value="58";
    document.getElementById("lp-ts-to-0").value="65";
    document.getElementById("lp-ts-fn-0-0").value="全世界株式";
    document.getElementById("lp-ts-fa-0-0").value="30000";
    document.getElementById("lp-ts-fn-0-1").value="S&P500";
    document.getElementById("lp-ts-fa-0-1").value="20000";
    document.getElementById("lp-ts-fn-0-2").value="タワラ8";
    document.getElementById("lp-ts-fa-0-2").value="10000";
    document.getElementById("lp-gs-from-0").value="57.5";
    document.getElementById("lp-gs-to-0").value="65";
    document.getElementById("lp-gs-fn-0-0").value="AI";
    document.getElementById("lp-gs-fa-0-0").value="10000";
    lpSaveNisa();`);
  assert.equal(app.run(`state.settings.lp.tsumitateSchedule[0].fromAge`), 58);
  assert.equal(app.run(`state.settings.lp.tsumitateSchedule[0].monthlyYen`), 60000,
    "月額が銘柄の合計になっていない");
});

test("NISAの内訳に、区間と銘柄の両方を足せる", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-13", lp: NISA }, tx: [] } });
  app.run(`view="lp"; lpKind="nisa"; render(); lpAddRow("tsumitateSchedule");`);
  assert.equal(app.run(`state.settings.lp.tsumitateSchedule.length`), 2, "区間を足せていない");
  app.run(`render(); lpAddFund("tsumitateSchedule", 1);`);
  assert.equal(app.run(`state.settings.lp.tsumitateSchedule[1].funds.length`), 1, "銘柄を足せていない");
  app.run(`render(); lpAddRow("lumpSums");`);
  assert.equal(app.run(`state.settings.lp.lumpSums.length`), 1, "一括投資を足せていない");
});

test("NISAの内訳の行を、確かめてから消せる", () => {
  const app = bootApp({ state: { settings: { birth: "1968-11-13", lp: NISA }, tx: [] } });
  app.run(`view="lp"; lpKind="nisa"; render();`);
  fillNisaFields(app);
  app.run(`confirm=()=>false; lpDeleteFund("tsumitateSchedule",0,0);`);
  assert.equal(app.run(`state.settings.lp.tsumitateSchedule[0].funds.length`), 3, "確かめずに消している");
  app.run(`confirm=()=>true; lpDeleteFund("tsumitateSchedule",0,0);`);
  assert.equal(app.run(`state.settings.lp.tsumitateSchedule[0].funds.length`), 2);
  assert.equal(app.run(`state.settings.lp.tsumitateSchedule[0].monthlyYen`), 50000, "月額が合計し直されていない");
});

test("NISAの画面が白くならない", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  const out = app.run(`view="lp"; lpKind="nisa"; render(); document.getElementById("app").innerHTML`);
  assert.ok(out.length > 300, "画面が空");
  assert.match(out, /生年月日/, "生年月日を入れる案内が無い");
});

/* =========================================================================
   【7】iDeCo・生命保険
   ========================================================================= */
test("生命保険の保険料は、毎月固定の支出として数える", () => {
  const ins = { insurancePolicies: [{ name: "医療共済", monthlyPremium: 15767, premiumFromAge: 46, premiumToAge: 65 }] };
  const txs = [{ id: "1", date: "2026-08-05", type: "income", cat: "salary", amount: 300000 }];
  const plain = Core.computeMonth(Core.normalizeSettings({}), txs, "2026-08");
  const withIns = Core.computeMonth(Core.normalizeSettings({ lp: ins }), txs, "2026-08");
  assert.equal(withIns.spendTotal, plain.spendTotal + 15767, "支出に入っていない");
  assert.equal(withIns.setAside, plain.setAside, "先取りにも入れていて二重になっている");
});

test("iDeCoの掛金は先取りとして引く（評価額は家計に混ぜない）", () => {
  const d = { ideco: { monthlyContribution: 23000, currentValue: 500000, productName: "全世界株式" } };
  const txs = [{ id: "1", date: "2026-08-05", type: "income", cat: "salary", amount: 300000 }];
  const plain = Core.computeMonth(Core.normalizeSettings({}), txs, "2026-08");
  const withId = Core.computeMonth(Core.normalizeSettings({ lp: d }), txs, "2026-08");
  /* 毎月ほんとうに出ていくお金なので、金や民間年金の掛金と同じ扱い */
  assert.equal(withId.setAside, plain.setAside + 23000, "掛金が先取りに入っていない");
  assert.equal(withId.available, plain.available - 23000, "使えるお金から引かれていない");
  assert.equal(withId.spendTotal, plain.spendTotal, "支出にも足していて二重になっている");
  /* 評価額（すでに積み上がった残高）は、毎月の計算には混ぜない */
  const big = Core.computeMonth(Core.normalizeSettings({ lp: { ideco: { currentValue: 5000000 } } }), txs, "2026-08");
  assert.equal(big.available, plain.available, "評価額が毎月の計算に混ざっている");
  /* ライフプランへは渡す */
  const out = Core.buildLifePlanInputs(Core.normalizeSettings({ lp: d })).inputs;
  assert.equal(out.ideco.monthlyContribution, 23000);
  assert.equal(out.ideco.productName, "全世界株式");
});

test("生命保険とiDeCoも、ライフプランと同じキー名で渡す", () => {
  const out = Core.buildLifePlanInputs(Core.normalizeSettings({ lp: {
    insurancePolicies: [{ name: "A", monthlyPremium: 1000, premiumFromAge: 46, premiumToAge: 65, coverageUntilAge: 82 }],
    ideco: { monthlyContribution: 23000 },
  } })).inputs;
  assert.deepEqual(Object.keys(out.insurancePolicies[0]).sort(),
    ["coverageUntilAge", "monthlyPremium", "name", "premiumFromAge", "premiumToAge"]);
  assert.deepEqual(Object.keys(out.ideco).sort(),
    ["currentValue", "endAge", "monthlyContribution", "payoutStartAge", "payoutYears", "principalTotal", "productName", "startAge"]);
});

test("iDeCoと生命保険の画面が白くならない", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  for (const kind of ["ideco", "insurance"]) {
    const out = app.run(`view="lp"; lpKind="${kind}"; render(); document.getElementById("app").innerHTML`);
    assert.ok(out.length > 300, `${kind} の画面が空`);
  }
});

test("iDeCoを直して保存できる", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  app.run(`view="lp"; lpKind="ideco"; render();
    document.getElementById("lp-id-monthly").value="23000";
    document.getElementById("lp-id-name").value="全世界株式";
    lpSaveIdeco();`);
  assert.equal(app.run(`state.settings.lp.ideco.monthlyContribution`), 23000);
  assert.equal(app.run(`state.settings.lp.ideco.productName`), "全世界株式");
});

test("生命保険を足して、直して、消せる", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  app.run(`view="lp"; lpKind="insurance"; render(); lpAddRow("insurancePolicies");`);
  assert.equal(app.run(`state.settings.lp.insurancePolicies.length`), 1);
  app.run(`render();
    document.getElementById("lp-in-name-0").value="医療共済";
    document.getElementById("lp-in-prem-0").value="15767";
    lpSaveInsurance();`);
  assert.equal(app.run(`state.settings.lp.insurancePolicies[0].monthlyPremium`), 15767);
  app.run(`render();
    document.getElementById("lp-in-name-0").value="医療共済";
    document.getElementById("lp-in-prem-0").value="15767";
    confirm=()=>true; lpDeleteRow(0, "insurancePolicies");`);
  /* 最後の1件を消すと中身が空になるので、設定からは lp ごと消える（保存を太らせないため） */
  assert.equal(app.run(`Core.normalizeLifePlanAssets(state.settings.lp).insurancePolicies.length`), 0);
});

test("ホームから、追加した項目それぞれへ入れに行ける", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  const out = app.run(`view="home"; render(); document.getElementById("app").innerHTML`);
  for (const kind of ["pension", "insurance", "gold", "ideco", "loans", "banks"]) {
    assert.match(out, new RegExp(`data-kind="${kind}"`), `ホームに ${kind} の入口が無い`);
  }
});

test("記録の選択から、生命保険と私年金を外す（入力口はライフプラン欄だけ）", () => {
  const pick = Core.EXP_PICK_CATS.map((c) => c.k);
  assert.equal(pick.includes("insure"), false, "保険が記録の選択に残っている");
  assert.equal(pick.includes("pension"), false, "私年金が記録の選択に残っている");
  /* 過去に記録した分は、これまでどおり名前が出て集計にも入る */
  assert.equal(Core.EXP_CATS.some((c) => c.k === "insure"), true, "過去の記録の名前が出せなくなっている");
  const c = Core.computeMonth(Core.normalizeSettings({}),
    [{ id: "1", date: "2026-08-05", type: "expense", cat: "insure", amount: 15767 }], "2026-08");
  assert.equal(c.spendTotal, 15767, "過去の記録が集計から消えている");
});

/* =========================================================================
   【8】払う期間の中だけを家計から引く
   -------------------------------------------------------------------------
   【不具合】iDeCo・民間年金・生命保険について、開始年齢・終了年齢を見ずに
   月額を足していた。払い終わった保険料や、まだ始まっていない掛金まで
   毎月引かれていた。考え方は NISA のスケジュール判定と同じにそろえる。

   期間が入っていない古い保存データが残っているので、判断できないときは
   「払っている」側に倒す（＝これまでどおりの金額。いきなり変わらない）。
   ========================================================================= */
const PERIOD = (over = {}) => Object.assign({
  privatePensionPlans: [{ name: "年金共済", monthlyContribution: 15000, contribFromAge: 35, contribToAge: 60 }],
  insurancePolicies: [{ name: "医療共済", monthlyPremium: 15767, premiumFromAge: 46, premiumToAge: 63 }],
  ideco: { monthlyContribution: 23000, startAge: 50, endAge: 65 },
}, over);
const TXS = [{ id: "1", date: "2026-08-05", type: "income", cat: "salary", amount: 300000 }];
/* 1968-11-13生まれ → 2026-08-01時点で約57.72歳 */
const atAge = (lp, birth) => Core.computeMonth(Core.normalizeSettings({ birth: birth, lp: lp }), TXS, "2026-08");

test("期間の判定は、開始年齢と終了年齢の両端を含む", () => {
  assert.equal(Core.lpInPeriod(46, 63, 45.99), false, "開始年齢の前なのに払っている");
  assert.equal(Core.lpInPeriod(46, 63, 46), true, "開始年齢ちょうどで払っていない");
  assert.equal(Core.lpInPeriod(46, 63, 63), true, "終了年齢ちょうどで払っていない");
  assert.equal(Core.lpInPeriod(46, 63, 63.01), false, "終了年齢の後なのに払っている");
});

test("期間が入っていないときは、これまでどおり払っている扱い", () => {
  assert.equal(Core.lpInPeriod(0, 0, 57.7), true, "期間未設定で0円にしている");
  assert.equal(Core.lpInPeriod(50, 0, 57.7), true, "終了だけ未設定で0円にしている");
  assert.equal(Core.lpInPeriod(50, 0, 49), false, "開始前なのに払っている");
  assert.equal(Core.lpInPeriod(0, 60, 57.7), true, "開始だけ未設定で0円にしている");
  assert.equal(Core.lpInPeriod(0, 60, 61), false, "終了後なのに払っている");
  assert.equal(Core.lpInPeriod(63, 46, 57.7), true, "逆さまの期間を勝手に0円にしている");
  assert.equal(Core.lpInPeriod(46, 63, null), true, "年齢が出せないのに0円にしている");
  assert.equal(Core.lpInPeriod(46, 63, NaN), true);
});

test("生年月日が無ければ、これまでどおり全部引く（金額がいきなり変わらない）", () => {
  const c = atAge(PERIOD(), "");
  assert.equal(c.lpSetAsideSum, 15000 + 23000);
  assert.equal(c.lpSpendSum, 15767);
});

test("払う期間の中なら、これまでどおり引く", () => {
  const c = atAge(PERIOD(), "1968-11-13");   // 約57.7歳
  assert.equal(c.lpSetAsideSum, 15000 + 23000, "民間年金とiDeCoが引かれていない");
  assert.equal(c.lpSpendSum, 15767, "保険料が引かれていない");
});

test("払い終わった契約は0円になる", () => {
  /* 1958-11-13生まれ → 約67.7歳。年金(〜60)・保険(〜63)・iDeCo(〜65)すべて終了 */
  const c = atAge(PERIOD(), "1958-11-13");
  assert.equal(c.lpSetAsideSum, 0, "終わった掛金を引き続けている");
  assert.equal(c.lpSpendSum, 0, "払い終わった保険料を引き続けている");
  const plain = Core.computeMonth(Core.normalizeSettings({ birth: "1958-11-13" }), TXS, "2026-08");
  assert.equal(c.available, plain.available, "使えるお金に響いている");
});

test("まだ始まっていない契約は0円になる", () => {
  /* 1988-11-13生まれ → 約37.7歳。年金(35〜)だけ始まっている */
  const c = atAge(PERIOD(), "1988-11-13");
  assert.equal(c.lpSetAsideSum, 15000, "始まっていないiDeCoまで引いている");
  assert.equal(c.lpSpendSum, 0, "始まっていない保険料を引いている");
});

test("誕生日の前月・当月・翌月で、切り替わる月が1か月ずれない", () => {
  /* 終了年齢は「その誕生日まで」の意味（ライフプラン側と同じ数え方）。
     1966-09-20生まれ・終了60歳 → 2026-09-20に60歳になる。
     区切りの初日で見るので、9月分（9/1時点＝59.95歳）はまだ払い、10月分（60.03歳）は終了。 */
  const lp = { insurancePolicies: [{ name: "A", monthlyPremium: 10000, premiumFromAge: 40, premiumToAge: 60 }] };
  const s = Core.normalizeSettings({ birth: "1966-09-20", lp: lp });
  assert.equal(Core.computeMonth(s, [], "2026-08").lpSpendSum, 10000, "誕生日の前月で切れている");
  assert.equal(Core.computeMonth(s, [], "2026-09").lpSpendSum, 10000, "誕生日の当月で切れている");
  assert.equal(Core.computeMonth(s, [], "2026-10").lpSpendSum, 0, "誕生日を過ぎても払い続けている");
});

test("年をまたいでも正しく判定する", () => {
  const lp = { ideco: { monthlyContribution: 20000, startAge: 60, endAge: 65 } };
  const s = Core.normalizeSettings({ birth: "1966-12-15", lp: lp });   // 2026-12-15に60歳
  assert.equal(Core.computeMonth(s, [], "2026-11").lpSetAsideSum, 0, "開始前なのに引いている");
  assert.equal(Core.computeMonth(s, [], "2027-01").lpSetAsideSum, 20000, "開始後なのに引いていない");
});

test("複数の契約が混ざっていても、期間の中のものだけを足す", () => {
  const lp = { insurancePolicies: [
    { name: "終わった", monthlyPremium: 8000, premiumFromAge: 30, premiumToAge: 50 },
    { name: "いま払っている", monthlyPremium: 15767, premiumFromAge: 46, premiumToAge: 63 },
    { name: "これから", monthlyPremium: 3000, premiumFromAge: 60, premiumToAge: 70 },
    { name: "期間なし（古いデータ）", monthlyPremium: 1000 },
  ] };
  const c = atAge(lp, "1968-11-13");
  assert.equal(c.lpSpendSum, 15767 + 1000, "期間の外の契約まで足している");
});

test("おかしな値が入っていても、家計全体にNaNが伝わらない", () => {
  const lp = {
    insurancePolicies: [
      { name: "A", monthlyPremium: "１５０００", premiumFromAge: "abc", premiumToAge: null },
      { name: "B", monthlyPremium: "12,000", premiumFromAge: -5, premiumToAge: 999 },
      { name: "C", monthlyPremium: NaN, premiumFromAge: undefined, premiumToAge: "" },
    ],
    ideco: { monthlyContribution: -1, startAge: 200, endAge: 0 },
    privatePensionPlans: [{ name: "D", monthlyContribution: 1e20, contribFromAge: 0, contribToAge: 0 }],
  };
  const c = atAge(lp, "1968-11-13");
  for (const k of ["available", "setAside", "spendTotal", "lpSetAsideSum", "lpSpendSum"]) {
    assert.ok(Number.isFinite(c[k]), `${k} が数でなくなっている: ${c[k]}`);
  }
  assert.ok(c.lpSpendSum >= 0, "マイナスの保険料が入っている");
});

test("NISAの判定は変えていない（同じ考え方だが別の道すじ）", () => {
  const s = Core.normalizeSettings({ birth: "1968-11-13", lp: {
    tsumitateSchedule: [{ fromAge: 57.75, toAge: 65, funds: [{ name: "全世界株式", amount: 90000 }] }] } });
  assert.equal(Core.nisaPlannedOn(s, "2026-08-08"), 0, "開始前なのに引いている");
  assert.equal(Core.nisaPlannedOn(s, "2026-09-08"), 90000, "開始後なのに引いていない");
});

test("家計簿由来の印が変わったら気づける", () => {
  assert.equal(Core.buildLifePlanInputs(Core.normalizeSettings({ lp: SAMPLE })).source, "kakeibo");
});

test("ライフプランでしか入れない値を、勝手に渡さない", () => {
  /* ここに余計なキーが混ざると、向こうで入れた年齢や年金額が上書きされてしまう */
  const out = Core.buildLifePlanInputs(Core.normalizeSettings({ lp: SAMPLE })).inputs;
  const allowed = ["gold", "ideco", "banks", "loans", "privatePensionPlans",
    "tsumitateSchedule", "growthSchedule", "tsumitateAllocation", "growthAllocation",
    "lumpSums", "insurancePolicies"];
  for (const k of Object.keys(out)) {
    assert.ok(allowed.includes(k), `渡してはいけない項目が混ざっている: ${k}`);
  }
});
