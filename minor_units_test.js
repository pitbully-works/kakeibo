/* =========================================================================
   かけいぼ ― 最小通貨単位への移行（第1段階）のテスト
   -------------------------------------------------------------------------
   内部の金額を「最小通貨単位の整数」に統一した。
     日本   … 1 = 1円          （scale = 1）
     米英加豪 … 1 = 1セント/ペニー （scale = 100）

   ここで守りたいのは、たったひとつ。
   **誰の金額も、100倍にも 1/100 にもならないこと。**

   そのために確かめること：
     ・JPの既存金額が1円も変わらない
     ・US/GB/CA/AU の既存金額が、正確に ×100 される
     ・記録は tx.country、設定は各 moneyProfiles の国で換算される
     ・dataVersion だけで判定し、二重移行が起きない
     ・移行前の控えが取れたときだけ移行する。取れなければ保存も止める
     ・ライフプランへ渡す数値は、これまでどおり主単位

   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

const coreSrc = fs.readFileSync(path.join(__dirname, "core.js"), "utf8");
const appSrc = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

const D = (d) => "2026-08-" + String(d).padStart(2, "0");
const tx = (o) => Object.assign(
  { id: "t1", type: "expense", amount: 1000, cat: "food", date: D(10), memo: "", photo: null }, o);

/* 移行前の端末（印が無い＝主単位で保存されている） */
function oldDevice(extra) {
  return Object.assign({
    settings: { country: "JP", goalTarget: 1000000, goalCurrent: 250000, nisaMonthly: 30000 },
    tx: [], health: {}, diary: {}, plans: {}, pulse: [],
  }, extra || {});
}
/* 印を付けずに起動する（移行の経路を通す） */
function bootOld(state, opts) {
  const seed = Object.assign({}, state);
  delete seed.dataVersion;
  return bootApp(Object.assign({ rawState: JSON.stringify(seed) }, opts || {}));
}

/* =========================================================================
   1. 単位の変換そのもの
   ========================================================================= */

test("scale は JP だけ 1、ほかの4か国は 100", () => {
  assert.equal(Core.minorScale("JP"), 1);
  for (const c of ["US", "GB", "CA", "AU"]) {
    assert.equal(Core.minorScale(c), 100, c + " の倍率が違う");
  }
});

test("主単位と最小単位を行き来しても、値が変わらない", () => {
  for (const c of ["JP", "US", "GB", "CA", "AU"]) {
    for (const v of [0, 1, 12, 1234, 999999, 123456789]) {
      assert.equal(Core.toMajor(Core.toMinor(v, c), c), v, `${c} の ${v} で往復できない`);
    }
  }
});

test("表示は、最小単位から正しい金額になる", () => {
  assert.equal(Core.formatAmount(1234, "JP"), "¥1,234", "日本の表示が変わっている");
  assert.equal(Core.formatAmount(1234, "US"), "$12.34");
  assert.equal(Core.formatAmount(420000, "US"), "$4,200.00");
  assert.equal(Core.formatAmount(1234, "GB"), "£12.34");
  assert.equal(Core.formatAmount(0, "US"), "$0.00");
});

test("金額の上限は、国ごとに正しい額で止まる", () => {
  assert.equal(Core.amountMax("JP"), 999999999, "日本の上限が変わっている");
  assert.equal(Core.formatAmount(Core.amountMax("US"), "US"), "$999,999,999.99");
  assert.equal(Core.normalizeTransaction(tx({ amount: 1e18 })).amount, Core.amountMax("JP"));
  assert.equal(Core.normalizeTransaction(tx({ amount: 1e18, country: "US" })).amount, Core.amountMax("US"));
});

/* =========================================================================
   2. 移行 ― JPは1円も変えない
   ========================================================================= */

test("JPの既存データは、金額が1つも変わらない", () => {
  const before = oldDevice({
    tx: [
      tx({ id: "a", amount: 12345 }),
      tx({ id: "b", amount: 300000, type: "income", cat: "salary" }),
      tx({ id: "c", amount: 1 }),
    ],
    settings: {
      country: "JP", goalTarget: 3000000, goalCurrent: 1234567, nisaMonthly: 90000,
      lp: {
        banks: [{ name: "みずほ", balance: 5000000, monthlyDeposit: 30000, interestPct: 0.2 }],
        loans: [{ name: "住宅", principal: 20000000, monthlyPayment: 85000, annualRatePct: 1.3 }],
        gold: { currentGrams: 120.5, pricePerGram: 13500, monthlyYen: 10000 },
      },
    },
  });
  const after = Core.migrateToMinorUnits(before).state;

  assert.deepEqual(after.tx.map((t) => t.amount), [12345, 300000, 1], "記録の金額が変わった");
  assert.equal(after.settings.goalTarget, 3000000);
  assert.equal(after.settings.goalCurrent, 1234567);
  assert.equal(after.settings.nisaMonthly, 90000);
  assert.equal(after.settings.lp.banks[0].balance, 5000000);
  assert.equal(after.settings.lp.loans[0].monthlyPayment, 85000);
  assert.equal(after.settings.lp.gold.pricePerGram, 13500);
  assert.equal(after.dataVersion, Core.DATA_VERSION, "印が付いていない");
});

test("JPは端末ごと起動しても、保存された金額が1円も変わらない", () => {
  const before = oldDevice({ tx: [tx({ amount: 12345 }), tx({ id: "t2", amount: 678 })] });
  const app = bootOld(before);
  const saved = JSON.parse(app.saved());
  assert.deepEqual(saved.tx.map((t) => t.amount), [12345, 678], "起動しただけで金額が変わった");
  assert.equal(saved.settings.goalTarget, 1000000);
  assert.equal(saved.dataVersion, Core.DATA_VERSION);
});

/* =========================================================================
   3. 移行 ― 4か国は正確に ×100
   ========================================================================= */

test("US/GB/CA/AU の記録は、正確に ×100 される", () => {
  for (const c of ["US", "GB", "CA", "AU"]) {
    const before = oldDevice({
      settings: { country: c },
      tx: [tx({ id: "x", amount: 1234, country: c }), tx({ id: "y", amount: 1, country: c })],
    });
    const after = Core.migrateToMinorUnits(before).state;
    assert.deepEqual(after.tx.map((t) => t.amount), [123400, 100], c + " の記録が ×100 されていない");
    /* 表示が移行の前後で同じであること＝金額が変わっていないことの証拠 */
    assert.equal(Core.formatAmount(after.tx[0].amount, c), Core.formatMoney(1234, c),
      c + " の表示が移行で変わった");
  }
});

test("US/GB/CA/AU の設定金額も、正確に ×100 される", () => {
  for (const c of ["US", "GB", "CA", "AU"]) {
    const before = oldDevice({
      settings: {
        country: c, goalTarget: 5000, goalCurrent: 1200, nisaMonthly: 300,
        lp: {
          banks: [{ name: "b", balance: 1200, monthlyDeposit: 50, interestPct: 1.5 }],
          ideco: { currentValue: 4000, principalTotal: 3000, monthlyContribution: 200, payoutYears: 20 },
          lumpSums: [{ age: 60, amount: 10000 }],
          tsumitateSchedule: [{ fromAge: 50, toAge: 60, funds: [{ name: "f", amount: 100 }] }],
        },
      },
    });
    const s = Core.migrateToMinorUnits(before).state.settings;
    assert.equal(s.goalTarget, 500000, c);
    assert.equal(s.goalCurrent, 120000, c);
    assert.equal(s.nisaMonthly, 30000, c);
    assert.equal(s.lp.banks[0].balance, 120000, c);
    assert.equal(s.lp.banks[0].monthlyDeposit, 5000, c);
    assert.equal(s.lp.ideco.currentValue, 400000, c);
    assert.equal(s.lp.lumpSums[0].amount, 1000000, c);
    assert.equal(s.lp.tsumitateSchedule[0].funds[0].amount, 10000, c);
  }
});

test("お金でない欄には、100を掛けない", () => {
  /* ここを取り違えると、利率1.5%が150%になり、59歳が5900歳になる。 */
  const before = oldDevice({
    settings: {
      country: "US",
      birth: "1968-11-13", cycleStart: 20,
      lp: {
        gold: { currentGrams: 120.5, pricePerGram: 60, monthlyYen: 100 },
        banks: [{ name: "b", balance: 100, monthlyDeposit: 10, interestPct: 1.5 }],
        loans: [{ name: "l", principal: 100, monthlyPayment: 10, annualRatePct: 3.25 }],
        privatePensionPlans: [{ name: "p", contribFromAge: 45, contribToAge: 60,
          monthlyContribution: 10, payoutFromAge: 65, payoutToAge: 85, monthlyPayout: 20 }],
        insurancePolicies: [{ name: "i", premiumFromAge: 46, premiumToAge: 65,
          monthlyPremium: 30, coverageUntilAge: 82 }],
        ideco: { currentValue: 100, principalTotal: 90, monthlyContribution: 10,
          startAge: 40, endAge: 60, payoutStartAge: 65, payoutYears: 20 },
        lumpSums: [{ age: 59, amount: 100 }],
        tsumitateSchedule: [{ fromAge: 57.5, toAge: 65, funds: [{ name: "f", amount: 90 }] }],
      },
    },
  });
  const s = Core.migrateToMinorUnits(before).state.settings;

  assert.equal(s.birth, "1968-11-13", "生年月日が変わった");
  assert.equal(s.cycleStart, 20, "月の起点が変わった");
  assert.equal(s.lp.gold.currentGrams, 120.5, "グラムに掛けている");
  assert.equal(s.lp.banks[0].interestPct, 1.5, "利率に掛けている");
  assert.equal(s.lp.loans[0].annualRatePct, 3.25, "利率に掛けている");
  assert.equal(s.lp.privatePensionPlans[0].contribFromAge, 45, "年齢に掛けている");
  assert.equal(s.lp.privatePensionPlans[0].payoutToAge, 85, "年齢に掛けている");
  assert.equal(s.lp.insurancePolicies[0].coverageUntilAge, 82, "年齢に掛けている");
  assert.equal(s.lp.ideco.payoutYears, 20, "年数に掛けている");
  assert.equal(s.lp.lumpSums[0].age, 59, "年齢に掛けている");
  assert.equal(s.lp.tsumitateSchedule[0].fromAge, 57.5, "年齢に掛けている");

  /* お金のほうは、ちゃんと掛かっていること（掛け忘れも同じくらい困る） */
  assert.equal(s.lp.gold.pricePerGram, 6000);
  assert.equal(s.lp.banks[0].balance, 10000);
  assert.equal(s.lp.privatePensionPlans[0].monthlyPayout, 2000);
  assert.equal(s.lp.insurancePolicies[0].monthlyPremium, 3000);
});

/* =========================================================================
   4. 換算の基準 ― 記録は tx.country、設定は各プロファイルの国
   ========================================================================= */

test("記録は、いま選んでいる国ではなく、その記録自身の国で換算する", () => {
  /* US滞在中に移行しても、日本の記録は1円も変えてはいけない。 */
  const before = oldDevice({
    settings: { country: "US" },
    tx: [
      tx({ id: "jp", amount: 12345 }),                 // 印なし＝JP
      tx({ id: "us", amount: 1234, country: "US" }),
      tx({ id: "gb", amount: 100, country: "GB" }),
      tx({ id: "au", amount: 50, country: "AU" }),
    ],
  });
  const after = Core.migrateToMinorUnits(before).state;
  const by = {};
  after.tx.forEach((t) => { by[t.id] = t.amount; });

  assert.equal(by.jp, 12345, "日本の記録が100倍になった");
  assert.equal(by.us, 123400);
  assert.equal(by.gb, 10000);
  assert.equal(by.au, 5000);
});

test("設定は、いま選んでいる国ではなく、各プロファイルの国で換算する", () => {
  const before = oldDevice({
    settings: { country: "US", goalTarget: 5000 },
    moneyProfiles: {
      JP: { country: "JP", goalTarget: 3000000, nisaMonthly: 90000 },
      US: { country: "US", goalTarget: 5000, nisaMonthly: 300 },
      GB: { country: "GB", goalTarget: 4000, nisaMonthly: 200 },
    },
  });
  const after = Core.migrateToMinorUnits(before).state;

  assert.equal(after.moneyProfiles.JP.goalTarget, 3000000, "JPプロファイルが100倍になった");
  assert.equal(after.moneyProfiles.JP.nisaMonthly, 90000, "JPプロファイルが100倍になった");
  assert.equal(after.moneyProfiles.US.goalTarget, 500000);
  assert.equal(after.moneyProfiles.US.nisaMonthly, 30000);
  assert.equal(after.moneyProfiles.GB.goalTarget, 400000);
  assert.equal(after.settings.goalTarget, 500000, "いまの設定が換算されていない");
});

test("プロファイルの中身が別の国を名乗っていても、置き場所の国で換算する", () => {
  /* 保存の場所（鍵）を正とする。中身の country が食い違っていても、
     JPの引き出しに入っているものを100倍にはしない。 */
  const before = oldDevice({
    settings: { country: "JP" },
    moneyProfiles: { JP: { country: "US", goalTarget: 1000 } },
  });
  const after = Core.migrateToMinorUnits(before).state;
  assert.equal(after.moneyProfiles.JP.goalTarget, 1000, "JPの引き出しの金額が100倍になった");
});

test("端末ごと起動しても、国ごとの換算が正しい", () => {
  const app = bootOld(oldDevice({
    settings: { country: "US", goalTarget: 5000 },
    moneyProfiles: { JP: { country: "JP", goalTarget: 3000000 }, US: { country: "US", goalTarget: 5000 } },
    tx: [tx({ id: "jp", amount: 12345 }), tx({ id: "us", amount: 1234, country: "US" })],
  }));
  const saved = JSON.parse(app.saved());
  const by = {};
  saved.tx.forEach((t) => { by[t.id] = t.amount; });
  assert.equal(by.jp, 12345);
  assert.equal(by.us, 123400);
  assert.equal(saved.moneyProfiles.JP.goalTarget, 3000000);
  assert.equal(saved.moneyProfiles.US.goalTarget, 500000);
});

/* =========================================================================
   5. 二重移行が起きない
   ========================================================================= */

test("移行済みの印があれば、二度と換算しない", () => {
  const once = Core.migrateToMinorUnits(oldDevice({
    settings: { country: "US", goalTarget: 5000 },
    tx: [tx({ amount: 1234, country: "US" })],
  }));
  assert.equal(once.changed, true, "1回目が移行されていない");

  const twice = Core.migrateToMinorUnits(once.state);
  assert.equal(twice.changed, false, "2回目も移行しようとしている");
  assert.equal(twice.state.tx[0].amount, 123400, "二重に100倍された");
  assert.equal(twice.state.settings.goalTarget, 500000, "二重に100倍された");
});

test("何度読み込み直しても、金額は増えない", () => {
  /* 端末に残ったものを、そのまま次の起動へ渡す。これを3回くり返す。 */
  let app = bootOld(oldDevice({
    settings: { country: "US", goalTarget: 5000 },
    /* 国別プロファイルまで持っている端末（US版を実際に使っていた形） */
    moneyProfiles: { JP: { country: "JP", goalTarget: 3000000 }, US: { country: "US", goalTarget: 5000 } },
    tx: [tx({ amount: 1234, country: "US" })],
  }));
  const first = JSON.parse(app.saved());
  assert.equal(first.tx[0].amount, 123400);

  for (let i = 0; i < 3; i++) {
    app = bootApp({ store: app.storeDump() });
    app.run(`save();`);
    const again = JSON.parse(app.saved());
    assert.equal(again.tx[0].amount, 123400, `${i + 2}回目の起動で金額が変わった`);
    assert.equal(again.settings.goalTarget, 500000, `${i + 2}回目の起動で設定が変わった`);
  }
});

test("移行済みかは dataVersion だけで決める（金額から推測しない）", () => {
  /* 1234 は「$1,234.00（移行前）」とも「$12.34（移行後）」とも読める。
     値を見て決める作りだと、必ずどちらかを取り違える。 */
  assert.equal(Core.needsMinorUnitMigration({ dataVersion: 2 }), false);
  assert.equal(Core.needsMinorUnitMigration({}), true);
  assert.equal(Core.needsMinorUnitMigration({ dataVersion: 1 }), true);
  assert.equal(Core.needsMinorUnitMigration({ dataVersion: "2" }), false, "数として見ていない");

  /* 判定に金額を持ち込んでいないことを、書き方でも見張る */
  const fn = /function needsMinorUnitMigration\(state\) \{[\s\S]*?\n  \}/.exec(coreSrc);
  assert.ok(fn, "判定が見つからない");
  assert.equal(/amount|tx|goal|nisa/.test(fn[0]), false, "金額を見て判定している");
});

test("新しく入れた端末は、移行を通らない", () => {
  const app = bootApp({});
  app.run(`save();`);
  assert.equal(JSON.parse(app.saved()).dataVersion, Core.DATA_VERSION, "印が付いていない");
  assert.equal(app.run(`migrationDone`), null, "何も無いのに移行している");
});

/* =========================================================================
   6. 移行前の控え ― 取れたときだけ移行する
   ========================================================================= */

test("移行の直前に、移行前のままの控えを取る", () => {
  const before = oldDevice({
    settings: { country: "US", goalTarget: 5000 },
    tx: [tx({ amount: 1234, country: "US" })],
  });
  const app = bootOld(before);

  const copy = JSON.parse(app.migrationBackup());
  assert.equal(copy.tx[0].amount, 1234, "控えが移行後の値になっている");
  assert.equal(copy.settings.goalTarget, 5000, "控えが移行後の値になっている");
  assert.equal("dataVersion" in copy, false, "控えに印が付いている");

  /* 本体のほうは移行済みであること */
  assert.equal(JSON.parse(app.saved()).tx[0].amount, 123400);
});

test("控えが取れなければ、移行しない・保存もしない", () => {
  /* 端末の空きが無い状況を作る。控えが書けないので移行を見送る。 */
  const app = bootOld(oldDevice({
    settings: { country: "US", goalTarget: 5000 },
    tx: [tx({ amount: 1234, country: "US" })],
  }), { storageFull: true });

  assert.equal(app.run(`migrationBlocked`), true, "控えが取れないのに移行しようとしている");
  assert.equal(app.run(`state.tx[0].amount`), 1234, "控えが取れないのに換算している");
  assert.equal(app.run(`save()`), false, "移行を見送っているのに保存している");
});

test("控えが取れなかったら、印を付けない（次に開いたときやり直す）", () => {
  const app = bootOld(oldDevice({ settings: { country: "US" }, tx: [tx({ amount: 1234, country: "US" })] }),
    { storageFull: true });
  assert.equal(app.run(`state.dataVersion`), undefined, "移行していないのに印を付けている");
});

test("控えは、書けたかどうかを読み戻して確かめる", () => {
  /* 「書けたつもり」で移行を始めるのが、いちばん危ない。 */
  const fn = /function backupBeforeMigration\(raw\)\{[\s\S]*?\n\}/.exec(appSrc);
  assert.ok(fn, "控えを取る処理が見つからない");
  assert.match(fn[0], /localStorage\.getItem\(MIGRATION_BACKUP_KEY\) === text/, "読み戻して確かめていない");
});

test("写真で場所が足りないときは、写真を外した控えで移行できる", () => {
  const photo = "data:image/jpeg;base64," + "A".repeat(4000);
  const before = oldDevice({
    settings: { country: "US" },
    tx: [tx({ amount: 1234, country: "US", photo: photo })],
  });
  /* 端末の残りが、控えを丸ごと置くには足りない大きさ */
  /* 控えを丸ごと置くには足りないが、写真を外せば置ける大きさ */
  const app = bootOld(before, { maxBytes: JSON.stringify(before).length - 2000 });

  assert.equal(app.run(`migrationBlocked`), false, "写真を外した控えで進めていない");
  assert.equal(app.run(`state.tx[0].amount`), 123400, "移行できていない");
  const copy = JSON.parse(app.migrationBackup());
  assert.equal(copy.tx[0].amount, 1234, "控えの金額が移行後になっている");
  assert.equal(copy.tx[0].photo, null, "写真を外していない");
});

/* =========================================================================
   7. バックアップの書き出し・読み込み
   ========================================================================= */

test("書き出すバックアップは、単位を明示する", () => {
  const b = Core.buildBackup({ settings: { country: "US" }, tx: [] });
  assert.equal(b.version, 2);
  assert.equal(b.amountUnit, "minor");
  assert.equal(b.minorUnitScale.JPY, 1);
  assert.equal(b.minorUnitScale.USD, 100);
});

test("印の無い古いバックアップは、主単位として読む", () => {
  const old = {
    settings: { country: "US", goalTarget: 5000 },
    moneyProfiles: { JP: { country: "JP", goalTarget: 3000000 }, US: { country: "US", goalTarget: 5000 } },
    tx: [tx({ id: "jp", amount: 12345 }), tx({ id: "us", amount: 1234, country: "US" })],
  };
  const r = Core.normalizeBackup(old);
  const by = {};
  r.tx.forEach((t) => { by[t.id] = t.amount; });
  assert.equal(by.jp, 12345, "日本の記録が100倍になった");
  assert.equal(by.us, 123400);
  assert.equal(r.moneyProfiles.JP.goalTarget, 3000000);
  assert.equal(r.moneyProfiles.US.goalTarget, 500000);
});

test("version 2 のバックアップは、そのまま読む", () => {
  const b = {
    version: 2,
    settings: { country: "US", goalTarget: 500000 },
    tx: [tx({ amount: 123400, country: "US" })],
  };
  const r = Core.normalizeBackup(b);
  assert.equal(r.tx[0].amount, 123400, "二重に100倍された");
  assert.equal(r.settings.goalTarget, 500000);
});

test("新しすぎるバックアップは、取り込まずに断る", () => {
  assert.throws(
    () => Core.normalizeBackup({ version: 3, settings: {}, tx: [] }),
    /新しすぎます/,
    "黙って誤変換している");
});

test("書き出して読み直しても、5カ国とも金額が変わらない", () => {
  for (const c of ["JP", "US", "GB", "CA", "AU"]) {
    const state = {
      settings: Core.normalizeSettings({ country: c, goalTarget: 123456, nisaMonthly: 7890 }),
      tx: [tx({ amount: 54321, country: c === "JP" ? undefined : c })],
    };
    const back = Core.normalizeBackup(JSON.parse(JSON.stringify(Core.buildBackup(state))));
    assert.equal(back.tx[0].amount, 54321, c + " の記録が往復で変わった");
    assert.equal(back.settings.goalTarget, 123456, c + " の設定が往復で変わった");
  }
});

test("移行前に取った控えを、移行後のアプリで読み込める", () => {
  /* 6章の控えは移行前の形（version 無し）。それを読み込んだら
     端末の移行とまったく同じ結果になること。 */
  const before = oldDevice({
    settings: { country: "US", goalTarget: 5000 },
    tx: [tx({ id: "us", amount: 1234, country: "US" }), tx({ id: "jp", amount: 12345 })],
  });
  const app = bootOld(before);
  const copy = JSON.parse(app.migrationBackup());

  const r = Core.normalizeBackup(copy);
  const by = {};
  r.tx.forEach((t) => { by[t.id] = t.amount; });
  assert.equal(by.us, 123400, "控えを戻したら端末と結果が違う");
  assert.equal(by.jp, 12345);
});

/* =========================================================================
   8. ライフプランへ渡す数値 ― 主単位のまま
   ========================================================================= */

test("JPのスナップショットは、これまでと同じ数値のまま", () => {
  const txs = [
    { id: "s", type: "income", amount: 300000, cat: "salary", date: D(25) },
    { id: "f", type: "expense", amount: 72345, cat: "food", date: D(3) },
  ];
  const snap = Core.buildSnapshot({ cycleStart: 1, nisaMonthly: 30000 }, txs, "2026-08");
  assert.equal(snap.income_actual_total, 300000);
  assert.equal(snap.spend_total, 72345);
  assert.equal(snap.planned_set_aside, 30000);
  assert.equal(snap.available_to_spend, 300000 - 72345 - 30000);
  assert.equal(snap.minor_unit_scale, 1, "JPは 1 = 1円");
});

test("USのスナップショットは、主単位に戻して渡す", () => {
  const txs = [
    { id: "s", type: "income", amount: 420000, cat: "salary", date: D(25), country: "US" },
    { id: "f", type: "expense", amount: 123456, cat: "food", date: D(3), country: "US" },
  ];
  const snap = Core.buildSnapshot({ cycleStart: 1, country: "US" }, txs, "2026-08");
  assert.equal(snap.income_actual_total, 4200, "セントのまま渡している");
  assert.equal(snap.spend_total, 1234.56);
  assert.equal(snap.by_category[0].amount, 1234.56, "内訳が主単位になっていない");
  assert.equal(snap.available_to_spend, 4200 - 1234.56);
});

test("スナップショットは、単位を明示する", () => {
  const snap = Core.buildSnapshot({ country: "US" }, [], "2026-08");
  assert.equal(snap.schema_version, "2.3");
  assert.equal(snap.amount_unit, "major");
  assert.equal(snap.minor_unit_scale, 100);
  assert.equal(Core.buildSnapshot({ country: "JP" }, [], "2026-08").minor_unit_scale, 1);
});

test("ライフプラン入力も、主単位に戻して渡し、単位を明示する", () => {
  const s = Core.normalizeSettings({ country: "US", lp: {
    banks: [{ name: "b", balance: 120000, monthlyDeposit: 5000, interestPct: 1.5 }],
    lumpSums: [{ age: 60, amount: 1000000 }],
  } });
  const out = Core.buildLifePlanInputs(s, "2026-08-10");
  assert.equal(out.schemaVersion, 2);
  assert.equal(out.amount_unit, "major");
  assert.equal(out.minor_unit_scale, 100);
  assert.equal(out.inputs.banks[0].balance, 1200, "セントのまま渡している");
  assert.equal(out.inputs.banks[0].monthlyDeposit, 50);
  assert.equal(out.inputs.banks[0].interestPct, 1.5, "利率まで割っている");
  assert.equal(out.inputs.lumpSums[0].amount, 10000);
  assert.equal(out.inputs.lumpSums[0].age, 60, "年齢まで割っている");
});

test("渡す数値と内部の値が食い違ったら、渡さずに止める", () => {
  /* 検算が本当に働いているか。内部の値を差し替えて、はっきり失敗すること。 */
  const snapSrc = /const M = function \(minorValue\) \{[\s\S]*?\n    \};/.exec(coreSrc);
  assert.ok(snapSrc, "検算が見つからない");
  assert.match(snapSrc[0], /Math\.round\(out \* scale\) !== Math\.round\(n\)/, "検算していない");
  assert.match(snapSrc[0], /throw new Error/, "食い違っても止めていない");
});

test("渡す金額の欄は、1つ残らず検算を通っている", () => {
  /* 検算を通さない欄が1つでもあると、そこだけ100倍で出ていく。 */
  const body = /function buildSnapshot\(settings, txs, ym\) \{[\s\S]*?\n  \}/.exec(coreSrc)[0];
  const moneyKeys = [
    "income_regular", "income_extra", "income_actual_total", "income_net",
    "fixed_cost", "variable_spend", "spend_total", "expense_total",
    "planned_set_aside", "available_to_spend",
  ];
  for (const k of moneyKeys) {
    assert.match(body, new RegExp(k + ": M\\("), k + " が検算を通っていない");
  }
  assert.match(body, /amount: M\(c\.byCat\[k\]\)/, "内訳が検算を通っていない");
  assert.match(body, /amount: M\(c\.byCatRecurring\[k\]\)/, "毎月固定の内訳が検算を通っていない");
  assert.match(body, /planned_contribution: M\(/, "先取りの予定額が検算を通っていない");
});

/* =========================================================================
   9. 壊していないことの確認
   ========================================================================= */

test("画面に出る金額は、移行の前後で同じ", () => {
  /* 利用者から見て、移行しても何も変わっていないこと。 */
  for (const [c, want] of [["JP", "¥12,345"], ["US", "$1,234.00"], ["GB", "£1,234.00"]]) {
    const amount = c === "JP" ? 12345 : 1234;
    const app = bootOld(oldDevice({
      settings: { country: c },
      tx: [{ id: "a", type: "income", amount: amount, cat: "salary", date: D(2),
             memo: "", photo: null, country: c === "JP" ? undefined : c }],
    }));
    const html = app.run(`view="home"; render(); document.getElementById("app").innerHTML`);
    assert.ok(String(html).includes(want), `${c} の表示が移行で変わった（${want} が無い）`);
  }
});

test("計算式は、これまでのまま", () => {
  const c = Core.computeMonth({ cycleStart: 1, nisaMonthly: 30000 }, [
    { id: "s", type: "income", amount: 300000, cat: "salary", date: D(25) },
    { id: "f", type: "expense", amount: 20000, cat: "food", date: D(5) },
  ], "2026-08");
  assert.equal(c.available, 300000 - 20000 - 30000);
});

test("国別プロファイルは、移行しても独立したまま", () => {
  const app = bootOld(oldDevice({
    settings: { country: "US", goalTarget: 5000 },
    moneyProfiles: { JP: { country: "JP", goalTarget: 3000000 }, US: { country: "US", goalTarget: 5000 } },
  }));
  app.run(`switchMoneyCountry("JP");`);
  assert.equal(app.run(`state.settings.goalTarget`), 3000000, "JPの設定が壊れた");
  app.run(`switchMoneyCountry("US");`);
  assert.equal(app.run(`state.settings.goalTarget`), 500000, "USの設定が壊れた");
});

test("記録・日記・健康・予定・心拍は、移行の影響を受けない", () => {
  const app = bootOld(oldDevice({
    tx: [tx({ amount: 1000 })],
    diary: { [D(1)]: { text: "あ" } },
    health: { [D(1)]: { weight: 62.5, bpHigh: 120, bpLow: 78 } },
    plans: { [D(1)]: [{ id: "p1", time: "14:00", text: "病院", done: false }] },
  }));
  const saved = JSON.parse(app.saved());
  assert.equal(saved.diary[D(1)].text, "あ");
  assert.equal(saved.health[D(1)].weight, 62.5, "体重に100を掛けている");
  assert.equal(saved.health[D(1)].bpHigh, 120, "血圧に100を掛けている");
  assert.equal(saved.plans[D(1)][0].text, "病院");
});

/* =========================================================================
   10. 画面から入れた金額も、正しい単位で保存される
   ------------------------------------------------------------------------
   移行だけ正しくても、そのあと打ち込んだ金額が主単位のまま入れば、
   同じ端末の中で単位が混ざる。そこがいちばん見つけにくい壊れ方になる。
   ========================================================================= */

const fill = (app, amount) => app.run(`
  document.getElementById("s-amt").value=${JSON.stringify(String(amount))};
  document.getElementById("s-date").value=${JSON.stringify(D(10))};
`);

test("打ち込んだ金額は、その国の最小単位で保存される", async () => {
  for (const [c, typed, want, shown] of [
    ["JP", 1234, 1234, "¥1,234"],
    ["US", 1234, 123400, "$1,234.00"],
    ["GB", 50, 5000, "£50.00"],
    ["CA", 7, 700, null],
    ["AU", 999, 99900, null],
  ]) {
    const app = bootApp({ state: { settings: { country: c }, tx: [] } });
    app.run(`openRecord(null);`);
    fill(app, typed);
    await app.run(`saveTx()`);
    const saved = JSON.parse(app.saved());
    assert.equal(saved.tx[0].amount, want, `${c}：打ち込み ${typed} が ${want} で保存されていない`);
    if (shown) {
      assert.equal(Core.formatAmount(saved.tx[0].amount, c), shown, `${c} の表示が違う`);
    }
  }
});

test("直すときも、その記録の国で換算する", async () => {
  /* US画面のまま日本の記録を直しても、100倍にしない。 */
  const app = bootApp({ state: {
    settings: { country: "US" },
    tx: [{ id: "jp1", type: "expense", amount: 12345, cat: "food", date: D(1), memo: "", photo: null }],
  } });
  app.run(`openRecord("jp1");`);
  /* 開いたときの欄には、円の金額がそのまま出ること */
  assert.equal(app.run(`sheetState.amount`), "12345", "打ち込み欄の金額が変わっている");
  fill(app, 20000);
  await app.run(`saveTx()`);
  const t = JSON.parse(app.saved()).tx[0];
  assert.equal(t.amount, 20000, "日本の記録が100倍で保存された");
  assert.equal("country" in t, false, "日本の記録がUSに変わった");
});

test("直すとき、USの記録は打ち込み欄に主単位で出て、最小単位で戻る", async () => {
  const app = bootApp({ state: {
    settings: { country: "US" },
    tx: [{ id: "us1", type: "expense", amount: 123400, cat: "food", date: D(1),
           memo: "", photo: null, country: "US" }],
  } });
  app.run(`openRecord("us1");`);
  assert.equal(app.run(`sheetState.amount`), "1234", "$1,234.00 が打ち込み欄に 1234 で出ていない");
  fill(app, 2000);
  await app.run(`saveTx()`);
  const t = JSON.parse(app.saved()).tx[0];
  assert.equal(t.amount, 200000, "$2,000.00 が最小単位で保存されていない");
  assert.equal(t.country, "US");
});

test("控えだけが置けないときも、本体は古い単位のまま守られる", async () => {
  /* 端末に空きはあるが、控えの置き場だけが確保できない、という場面。
     ここで本体を書けてしまうと、古い単位のまま上書きされ、
     次に開いたとき移行済みかどうかを判断できなくなる。 */
  const before = oldDevice({
    settings: { country: "US" },
    tx: [tx({ id: "us", amount: 1234, country: "US" })],
  });
  const raw = JSON.stringify(before);
  const app = bootOld(before, { failKeys: ["kakeibo:v1:backup-before-minor-units"] });

  assert.equal(app.run(`migrationBlocked`), true, "控えが無いのに移行しようとしている");
  assert.equal(app.run(`save()`), false, "控えが無いのに保存できてしまった");
  assert.equal(app.saved(), raw, "端末の中身が書き換わった");

  app.run(`openRecord(null);`);
  fill(app, 100);
  await app.run(`saveTx()`);
  assert.equal(app.saved(), raw, "記録の保存で端末の中身が書き換わった");
  assert.equal(JSON.parse(app.saved()).tx[0].amount, 1234, "古い単位のまま換算されてしまった");
  assert.equal("dataVersion" in JSON.parse(app.saved()), false, "印が付いてしまった");
});

test("移行を見送っている間は、何を保存しようとしても書き込まない", async () => {
  /* 古い単位のまま上書きすると、次に開いたとき移行済みかを判断できなくなる。
     だから、控えが取れるまでは1バイトも書かない。 */
  const before = oldDevice({
    settings: { country: "US" },
    tx: [tx({ id: "us", amount: 1234, country: "US" })],
  });
  const raw = JSON.stringify(before);
  const app = bootOld(before, { storageFull: true });
  assert.equal(app.run(`migrationBlocked`), true, "前提が崩れている");

  /* 端末の中身が、移行前のまま1文字も変わっていないこと */
  assert.equal(app.saved(), raw, "移行を見送ったのに端末の中身が変わった");

  /* いろいろな入口から保存しようとしても、すべて断ること */
  assert.equal(app.run(`save()`), false, "保存できてしまった");
  app.run(`openRecord(null);`);
  fill(app, 100);
  await app.run(`saveTx()`);
  assert.equal(app.saved(), raw, "記録の保存で端末の中身が変わった");
  assert.equal(app.run(`state.tx.length`), 1, "記録が増えている");
});
