/* =========================================================================
   かけいぼ ― JP／US の切り替え
   -------------------------------------------------------------------------
   守りたいこと：
     ① 日本版は、これまでと1文字も変わらない（見た目・計算・保存の形）
     ② 旧データ（国の印を持たない記録）は必ずJPとして扱われ、失われない
     ③ USを選ぶと、ことば・通貨・日付・カテゴリ表示だけが変わる
     ④ 保存するのは内部ID。カテゴリを英語の文字列で保存し直したりしない
     ⑤ JPとUSの記録は混ざらない
     ⑥ ライフプラン連携の country_code / base_currency が国どおりになる
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");
const { bootApp, appSrc } = require("./boot-app.cjs");

const YM = new Date().toISOString().slice(0, 7);
const D = (n) => `${YM}-${String(n).padStart(2, "0")}`;

/* 国の印を持たない、これまでの保存データ */
const OLD_TX = [
  { id: "j1", type: "income", amount: 290000, cat: "salary", date: D(25) },
  { id: "j2", type: "expense", amount: 60000, cat: "rent", date: D(1), recurring: true },
  { id: "j3", type: "expense", amount: 12345, cat: "food", date: D(3) },
];
const US_TX = [
  { id: "u1", type: "income", amount: 4200, cat: "salary", date: D(25), country: "US" },
  { id: "u2", type: "expense", amount: 1234, cat: "food", date: D(3), country: "US" },
];

function screen(settings, tx, view) {
  const app = bootApp({ state: { settings: settings, tx: tx } });
  app.run(`view=${JSON.stringify(view)}; render();`);
  return app.el("app").innerHTML;
}
const plain = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/* =======================================================================
   ① JP既存データの互換
   ======================================================================= */

test("国の印が無い旧データは、JPとして今までどおり集計される", () => {
  const c = Core.computeMonth({ country: "JP" }, OLD_TX, YM);
  assert.equal(c.incomeTotal, 290000);
  assert.equal(c.spendTotal, 72345);
  assert.equal(c.available, 290000 - 72345);
});

test("countryもcurrencyも無い旧設定は、JP／JPYへ移行する", () => {
  const s = Core.normalizeSettings({ goalName: "旅行" });
  assert.equal(s.country, "JP");
  assert.equal(s.currency, "JPY");
  assert.equal(s.goalName, "旅行");   // ほかの設定は失われない
});

test("JPの記録には国の印を持たせない（保存の形がこれまでと同じ）", () => {
  const t = Core.normalizeTransaction({ type: "expense", amount: 100, cat: "food", date: D(2) });
  assert.equal("country" in t, false);
  const t2 = Core.normalizeTransaction({ type: "expense", amount: 100, cat: "food", date: D(2), country: "JP" });
  assert.equal("country" in t2, false);
});

test("USの記録は国の印を持ち、読み直しても残る", () => {
  const t = Core.normalizeTransaction({ type: "expense", amount: 100, cat: "food", date: D(2), country: "US" });
  assert.equal(t.country, "US");
  const again = Core.normalizeTransaction(t);
  assert.equal(again.country, "US");
});

test("JPの日本語表示は、これまでの「¥1,234」のまま", () => {
  assert.equal(Core.formatMoney(1234, { country: "JP" }), "¥1,234");
  assert.equal(Core.formatMoney(0, { country: "JP" }), "¥0");
  assert.equal(Core.formatMoney(-500, { country: "JP" }), "¥-500");
});

test("JPのホームとまとめは、これまでどおり日本語で出る", () => {
  const home = plain(screen({ country: "JP" }, OLD_TX, "home"));
  assert.match(home, /今月 あと つかえるお金/);
  assert.match(home, /¥217,655/);
  const sum = plain(screen({ country: "JP" }, OLD_TX, "summary"));
  assert.match(sum, /今月のまとめ/);
  assert.match(sum, /🏠 住居/);
  assert.match(sum, /🥕 食費/);
});

/* =======================================================================
   ② 通貨・locale・日付
   ======================================================================= */

test("USはUSDで、小数2桁の米国式で出る", () => {
  assert.equal(Core.formatMoney(1234.56, { country: "US" }), "$1,234.56");
  assert.equal(Core.formatMoney(1234, "US"), "$1,234.00");
  assert.equal(Core.formatMoney(0, "US"), "$0.00");
});

test("国と基準通貨とlocaleは、必ず組で決まる", () => {
  assert.equal(Core.countryRule("JP").locale, "ja-JP");
  assert.equal(Core.countryRule("US").locale, "en-US");
  assert.equal(Core.countryLocale({ country: "US" }), "en-US");
  assert.equal(Core.countryLocale({ country: "JP" }), "ja-JP");
});

test("通貨の小数桁は円だけ0で、ドルは2", () => {
  assert.equal(Core.currencyDecimals("JPY"), 0);
  assert.equal(Core.currencyDecimals("USD"), 2);
});

test("日付はJPが日本式、USが米国式で出る", () => {
  assert.equal(Core.formatDate("2026-08-10", "JP"), "2026/8/10");
  assert.equal(Core.formatDate("2026-08-10", "US"), "8/10/2026");
  assert.equal(Core.formatDateHeading("2026-08-10", "JP"), "8月10日");
  assert.equal(Core.formatDateHeading("2026-08-10", "US"), "August 10");
  assert.equal(Core.formatYearMonth("2026-08", "JP"), "2026年 8月");
  assert.equal(Core.formatYearMonth("2026-08", "US"), "August 2026");
});

test("曜日と月の名前も国ごとに変わる", () => {
  assert.equal(Core.weekdayShort(0, "JP"), "日");
  assert.equal(Core.weekdayShort(0, "US"), "Sun");
  assert.equal(Core.monthName(8, "JP"), "8月");
  assert.equal(Core.monthName(8, "US"), "August");
  assert.equal(Core.monthShort(8, "US"), "Aug");
});

/* =======================================================================
   ③ カテゴリは内部IDのまま、表示だけ切り替える
   ======================================================================= */

test("カテゴリは内部IDを共通にして、表示名だけ国で切り替える", () => {
  assert.equal(Core.catName("expense", "food", "JP"), "食費");
  assert.equal(Core.catName("expense", "food", "US"), "Groceries");
  assert.equal(Core.catName("income", "salary", "JP"), "通常給与");
  assert.equal(Core.catName("income", "salary", "US"), "Paycheck");
  /* 内部IDそのものは、国が変わっても同じ */
  assert.equal(Core.catDisplay("expense", "food", "US").k, "food");
  assert.equal(Core.catDisplay("expense", "food", "JP").k, "food");
});

test("英語表示にしても、保存されるカテゴリは英語の文字列にならない", () => {
  const t = Core.normalizeTransaction({ type: "expense", amount: 10, cat: "food", date: D(2), country: "US" });
  assert.equal(t.cat, "food");
  assert.notEqual(t.cat, "Groceries");
});

test("表に無いカテゴリは、英語でも日本語名へ落ちて消えない", () => {
  /* 旧固定費キーも表示できる（過去の記録が消えないことの砦） */
  assert.equal(Core.catName("expense", "fixother", "US"), "Other");
  assert.equal(Core.catName("expense", "fixother", "JP"), "その他");
});

/* =======================================================================
   ④ 画面の英語化
   ======================================================================= */

test("USのホームは英語・ドル表示になる", () => {
  const home = plain(screen({ country: "US" }, US_TX, "home"));
  assert.match(home, /Left to spend this month/);
  assert.match(home, /\$2,966\.00/);
  assert.match(home, /Add a record/);
  assert.equal(/今月 あと つかえるお金/.test(home), false, "日本語が残っている");
});

test("USのまとめは英語で、カテゴリも英語で出る", () => {
  const sum = plain(screen({ country: "US" }, US_TX, "summary"));
  assert.match(sum, /Income/);
  assert.match(sum, /Groceries/);
  assert.match(sum, /\$4,200\.00/);
  assert.equal(/食費/.test(sum), false, "カテゴリが日本語のまま");
});

test("USのカレンダーは英語の曜日と月で出る", () => {
  const cal = plain(screen({ country: "US" }, US_TX, "calendar"));
  assert.match(cal, /Sun/);
  assert.match(cal, /Sat/);
  assert.equal(/日 月 火 水 木 金 土/.test(cal), false, "曜日が日本語のまま");
});

test("せっていに国の選択があり、JP・US・GBだけを出す", () => {
  const set = screen({ country: "JP" }, [], "settings");
  assert.match(set, /id="f-country"/, "国の選択欄が無い");
  assert.match(set, /value="JP"/);
  assert.match(set, /value="US"/);
  assert.match(set, /value="GB"/);
  assert.equal(set.includes('value="CA"'), false);
  assert.equal(set.includes('value="AU"'), false);
});

test("画面で選べる国はJP・US・GBの3つ（土台の5カ国は残す）", () => {
  assert.deepEqual([...Core.SUPPORTED_COUNTRIES], ["JP", "US", "GB"]);
  assert.deepEqual(Object.keys(Core.COUNTRY_RULES), ["JP", "US", "GB", "CA", "AU"]);
  assert.equal(Core.isSupportedCountry("US"), true);
  assert.equal(Core.isSupportedCountry("GB"), true);
  /* 画面に出せない国を選ぼうとしたら、安全にJPへ寄せる */
  assert.equal(Core.pickCountry("GB"), "GB");
  assert.equal(Core.pickCountry("US"), "US");
});

/* =======================================================================
   ⑤ 保存 → 読み直し
   ======================================================================= */

test("国を選び直すと保存され、開き直しても英語のまま残る", () => {
  const app = bootApp({ state: { settings: { country: "JP" }, tx: [] } });
  app.run(`view="settings"; render();`);
  app.run(`document.getElementById("f-country").value="US"; saveSettingsQuiet();`);
  const saved = JSON.parse(app.saved());
  assert.equal(saved.settings.country, "US");
  assert.equal(saved.settings.currency, "USD");

  /* 保存したものから起動し直す */
  const again = bootApp({ state: saved });
  again.run(`view="home"; render();`);
  assert.match(plain(again.el("app").innerHTML), /Left to spend this month/);
});

test("国を変えても、記録そのものは1件も消えない", () => {
  const app = bootApp({ state: { settings: { country: "JP" }, tx: OLD_TX.slice() } });
  app.run(`view="settings"; render();`);
  app.run(`document.getElementById("f-country").value="US"; saveSettingsQuiet();`);
  const saved = JSON.parse(app.saved());
  assert.equal(saved.tx.length, OLD_TX.length);
  assert.equal(saved.tx[2].cat, "food");   // カテゴリの内部IDも変わらない
});

test("USで記録すると国の印がつき、JPで記録するとつかない", () => {
  const us = bootApp({ state: { settings: { country: "US" }, tx: [] } });
  return us.record(1234).then(() => {
    const t = JSON.parse(us.saved()).tx[0];
    assert.equal(t.country, "US");
    const jp = bootApp({ state: { settings: { country: "JP" }, tx: [] } });
    return jp.record(1234).then(() => {
      const t2 = JSON.parse(jp.saved()).tx[0];
      assert.equal("country" in t2, false);
    });
  });
});

/* =======================================================================
   ⑥ JPとUSのデータが混ざらない
   ======================================================================= */

test("JPを選んでいるとき、USの記録は集計に入らない", () => {
  const c = Core.computeMonth({ country: "JP" }, OLD_TX.concat(US_TX), YM);
  assert.equal(c.incomeTotal, 290000);
  assert.equal(c.spendTotal, 72345);
});

test("USを選んでいるとき、JPの記録は集計に入らない", () => {
  const c = Core.computeMonth({ country: "US" }, OLD_TX.concat(US_TX), YM);
  assert.equal(c.incomeTotal, 4200);
  assert.equal(c.spendTotal, 1234);
});

test("まとめの記録一覧にも、ほかの国の記録は出ない", () => {
  const sum = plain(screen({ country: "US" }, OLD_TX.concat(US_TX), "summary"));
  assert.equal(/290,000/.test(sum), false, "JPの給与がUS画面に出ている");
  assert.match(sum, /\$4,200\.00/);

  const jp = plain(screen({ country: "JP" }, OLD_TX.concat(US_TX), "summary"));
  assert.match(jp, /¥290,000/);
  assert.equal(/4,200/.test(jp), false, "USの給与がJP画面に出ている");
});

test("カレンダーの印も、いまの国の記録だけを見る", () => {
  const both = OLD_TX.concat(US_TX);
  const jpMarks = Core.monthMarks({ settings: { country: "JP" }, tx: both }, YM);
  const usMarks = Core.monthMarks({ settings: { country: "US" }, tx: both }, YM);
  assert.equal(!!jpMarks[D(1)], true, "JPの記録の印が無い");
  assert.equal(!!usMarks[D(1)], false, "US画面にJPの記録の印が出ている");
});

test("その日の中身も、いまの国の記録だけを出す", () => {
  const both = OLD_TX.concat(US_TX);
  const jp = Core.dayDetail({ settings: { country: "JP" }, tx: both }, D(3));
  const us = Core.dayDetail({ settings: { country: "US" }, tx: both }, D(3));
  assert.equal(jp.expenseTotal, 12345);
  assert.equal(us.expenseTotal, 1234);
});

test("分析も国ごとに分かれる", () => {
  const both = OLD_TX.concat(US_TX);
  const jp = Core.analyzeMonth({ country: "JP" }, both, YM, { today: D(28) });
  const us = Core.analyzeMonth({ country: "US" }, both, YM, { today: D(28) });
  assert.equal(jp.month.spendTotal, 12345 + 60000);
  assert.equal(us.month.spendTotal, 1234);
  /* 気づきの文章も、その国のことばで出る */
  assert.equal(us.insights.some((i) => /[぀-ヿ一-鿿]/.test(i.text)), false, "USの気づきに日本語が混ざっている");
  assert.equal(jp.insights.length > 0, true);
});

test("先月の毎月固定を写すときも、ほかの国の記録は写さない", () => {
  const prev = Core.shiftYm(YM, -1);
  const txs = [
    { id: "a", type: "expense", amount: 60000, cat: "rent", date: prev + "-05", recurring: true },
    { id: "b", type: "expense", amount: 900, cat: "rent", date: prev + "-05", recurring: true, country: "US" },
  ];
  const jp = Core.recurringCarryPlan(txs, YM, 1, { country: "JP" });
  const us = Core.recurringCarryPlan(txs, YM, 1, { country: "US" });
  assert.equal(jp.total, 60000);
  assert.equal(us.total, 900);
});

/* =======================================================================
   ⑦ ライフプラン連携
   ======================================================================= */

test("連携スナップショットの国と通貨は、設定どおりになる", () => {
  const jp = Core.buildSnapshot({ country: "JP" }, OLD_TX, YM);
  assert.equal(jp.country_code, "JP");
  assert.equal(jp.base_currency, "JPY");
  assert.equal(jp.locale, "ja-JP");

  const us = Core.buildSnapshot({ country: "US" }, US_TX, YM);
  assert.equal(us.country_code, "US");
  assert.equal(us.base_currency, "USD");
  assert.equal(us.locale, "en-US");
});

test("連携スナップショットに、ほかの国の金額が混ざらない", () => {
  const both = OLD_TX.concat(US_TX);
  const jp = Core.buildSnapshot({ country: "JP" }, both, YM);
  const us = Core.buildSnapshot({ country: "US" }, both, YM);
  assert.equal(jp.income_actual_total, 290000);
  assert.equal(us.income_actual_total, 4200);
  assert.equal(jp.spend_total, 72345);
  assert.equal(us.spend_total, 1234);
});

test("連携スナップショットのカテゴリは、内部IDを保ったまま表示名だけ変わる", () => {
  const jp = Core.buildSnapshot({ country: "JP" }, OLD_TX, YM);
  const us = Core.buildSnapshot({ country: "US" }, US_TX, YM);
  const jpFood = jp.by_category.filter((r) => r.key === "food")[0];
  const usFood = us.by_category.filter((r) => r.key === "food")[0];
  assert.equal(jpFood.key, "food");
  assert.equal(usFood.key, "food");
  assert.equal(jpFood.name, "食費");
  assert.equal(usFood.name, "Groceries");
});

test("ライフプランへ渡す入力にも、国と基準通貨が必ず添う", () => {
  const jp = Core.buildLifePlanInputs({ country: "JP" }, "2026-08-10");
  const us = Core.buildLifePlanInputs({ country: "US" }, "2026-08-10");
  assert.equal(jp.countryCode, "JP");
  assert.equal(jp.baseCurrency, "JPY");
  assert.equal(us.countryCode, "US");
  assert.equal(us.baseCurrency, "USD");
});

/* =======================================================================
   ⑧ 壊れた値でも安全に倒れる
   ======================================================================= */

test("知らない国コードの記録は、JPのものとして扱う（消えない）", () => {
  const txs = [{ id: "x", type: "expense", amount: 500, cat: "food", date: D(4), country: "ZZ" }];
  assert.equal(Core.txCountry(txs[0]), "JP");
  const c = Core.computeMonth({ country: "JP" }, txs, YM);
  assert.equal(c.spendTotal, 500);
});

test("ことばの表に無いキーは、キーそのものを返して画面を落とさない", () => {
  assert.equal(Core.t("no.such.key", "US"), "no.such.key");
});

test("すべてのことばに、日本語と英語の両方がそろっている", () => {
  const missing = Object.keys(Core.UI_TEXT).filter(function (k) {
    const row = Core.UI_TEXT[k];
    return typeof row.ja !== "string" || typeof row.en !== "string";
  });
  assert.deepEqual(missing, [], `訳の抜け: ${missing.join(", ")}`);
});

/* =======================================================================
   ⑦ 国の切り替えのつなぎ（保存されるか・その場で切り替わるか）
   ----------------------------------------------------------------------
   ここが切れていると「選んだのに何も変わらない」という形で壊れる。
   ======================================================================= */

test("せっての「保存する」でも、国の選択が保存される", () => {
  const app = bootApp({ state: { settings: { country: "JP" }, tx: [] } });
  app.run(`view="settings"; render();`);
  app.run(`document.getElementById("f-country").value="US"; saveSettings();`);
  const saved = JSON.parse(app.saved());
  assert.equal(saved.settings.country, "US", "保存するボタンで国が保存されていない");
  assert.equal(saved.settings.currency, "USD");
});

test("国を選び直すと、その場で保存されて画面も英語に切り替わる", () => {
  const app = bootApp({ state: { settings: { country: "JP" }, tx: [] } });
  app.run(`view="settings"; render();`);
  assert.match(plain(app.el("app").innerHTML), /お住まいの国/, "はじめは日本語で出ていない");
  const changed = app.run(
    `document.getElementById("f-country").value="US";` +
    ` onCountryPicked(document.getElementById("f-country"));`
  );
  assert.equal(changed, true, "国の選択として受け取られていない");
  assert.equal(JSON.parse(app.saved()).settings.country, "US", "選んだのに保存されていない");
  assert.match(plain(app.el("app").innerHTML), /Your country/, "選んだのに画面が英語へ切り替わらない");
});

test("国と関係ない欄では、国の切り替えは動かない", () => {
  const app = bootApp({ state: { settings: { country: "JP" }, tx: [] } });
  app.run(`view="settings"; render();`);
  assert.equal(app.run(`onCountryPicked(document.getElementById("f-birth"))`), false);
  assert.equal(app.run(`onCountryPicked(null)`), false);
});

test("国の選択は、選ぶ操作（change）につながっている", () => {
  /* 押す操作ではないので、つなぎが外れても画面は見た目どおりに出てしまう。
     つなぎそのものを、ソースの形で見張る。 */
  assert.match(appSrc, /if\(onCountryPicked\(el\)\) return;/,
    "change でひろうつなぎが無い");
});

test("下のタブも、国のことばで出る", () => {
  const jp = bootApp({ state: { settings: { country: "JP" }, tx: [] } });
  jp.run(`view="home"; render();`);
  const jpNav = jp.nav().map((b) => b.innerHTML).join(" ");
  assert.match(jpNav, /ホーム/, "日本語のタブが出ていない");
  assert.match(jpNav, /まとめ/);
  assert.equal(jp.htmlLang(), "ja");

  const us = bootApp({ state: { settings: { country: "US" }, tx: [] } });
  us.run(`view="home"; render();`);
  const usNav = us.nav().map((b) => b.innerHTML).join(" ");
  assert.match(usNav, /Home/, "英語のタブになっていない");
  assert.match(usNav, /Summary/);
  assert.doesNotMatch(usNav, /ホーム/, "日本語のタブが残っている");
  assert.equal(us.htmlLang(), "en", "ページの言語が英語になっていない");
});
