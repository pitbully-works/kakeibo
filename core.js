/* =========================================================================
   かけいぼ ― 計算コア（core.js）
   ------------------------------------------------------------------------
   UIから完全に独立した「唯一の計算の正」。
   ホーム・まとめ・ライフプラン連携JSONは、すべてこのファイルの
   computeMonth() の結果だけを読む（画面ごとに式を書かない）。

   正式な計算式：
     使える額 = 通常収入 + 臨時収入 － 固定費 － 先取り貯金 － NISA積立 － 変動支出

   二重計上を防ぐ2つの原則：
     ① 固定費は「項目ごとの予定額」。その項目の実績を記録した月は、
        予定額ではなく実績を採用する（足さない・置き換える）。
     ② 給与の入力口は「記録」の収入ひとつだけ。設定に手取り収入は持たない。
        通常収入＝その月に記録した「通常給与」の合計。
        臨時収入（賞与・贈与など）だけが別枠で上乗せされる。

   ブラウザでは window.KakeiboCore、Nodeでは module.exports として使える。
   ========================================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KakeiboCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 分類の定義 ---------- */

  /* 固定費の項目（設定に「毎月の予定額」を持ち、実績記録で置き換わる） */
  const FIXED_ITEMS = [
    { k: "rent",     e: "🏠", n: "家賃・住居" },
    { k: "power",    e: "💡", n: "電気" },
    { k: "gas",      e: "🔥", n: "ガス" },
    { k: "water",    e: "🚰", n: "水道" },
    { k: "comm",     e: "📱", n: "通信" },
    { k: "subs",     e: "🔁", n: "サブスク" },
    { k: "insure",   e: "🛟", n: "保険" },
    { k: "fixother", e: "📦", n: "その他固定費" },
  ];
  const FIXED_KEYS = FIXED_ITEMS.map(function (i) { return i.k; });

  /* 変動支出のカテゴリ（記録するたびに積み上がる） */
  const VAR_CATS = [
    { k: "food",    e: "🥕", n: "食費" },
    { k: "eatout",  e: "🍜", n: "外食" },
    { k: "daily",   e: "🧴", n: "日用品" },
    { k: "transit", e: "🚃", n: "交通" },
    { k: "hobby",   e: "🎨", n: "趣味" },
    { k: "medical", e: "🏥", n: "医療" },
    { k: "social",  e: "🎁", n: "交際" },
    { k: "other",   e: "🐷", n: "その他" },
  ];

  /* 収入のカテゴリ。salary だけが「通常給与」で、上乗せしない */
  const REGULAR_INCOME_CAT = "salary";
  const INC_CATS = [
    { k: "salary", e: "💴", n: "通常給与" },
    { k: "bonus",  e: "✨", n: "臨時・賞与" },
    { k: "gift",   e: "🎁", n: "贈与" },
    { k: "other",  e: "🐷", n: "その他臨時" },
  ];

  const isFixedCat = function (k) { return FIXED_KEYS.indexOf(k) >= 0; };
  const catOf = function (type, k) {
    const pool = type === "income" ? INC_CATS : VAR_CATS.concat(FIXED_ITEMS);
    return pool.filter(function (c) { return c.k === k; })[0] || { k: k, e: "🐷", n: "その他" };
  };

  /* ---------- ヘルパ ---------- */
  function num(v) {
    const n = Number(String(v == null ? 0 : v).replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  function monthOf(iso) { return String(iso || "").slice(0, 7); }
  function sum(list, f) {
    return list.reduce(function (a, t) { return a + num(f ? f(t) : t); }, 0);
  }

  /* ---------- 設定の正規化（旧データの移行を含む） ---------- */
  function normalizeSettings(raw) {
    const s = raw || {};
    const fixed = {};
    const hasNew = s.fixed && typeof s.fixed === "object";
    FIXED_KEYS.forEach(function (k) { fixed[k] = hasNew ? num(s.fixed[k]) : 0; });
    /* 旧仕様（固定費を1つの合計欄で持っていた）からの移行。
       合計をそのまま消すと家計がずれるため「その他固定費」へ寄せる。 */
    if (!hasNew && num(s.fixedCost) > 0) fixed.fixother = num(s.fixedCost);
    return {
      /* 手取り収入は設定に持たない（給与の入力口は「記録」の収入だけ） */
      fixed: fixed,
      savingsTarget: num(s.savingsTarget),
      nisaMonthly: num(s.nisaMonthly),
      goalName: String(s.goalName || "").slice(0, 24),
      goalTarget: num(s.goalTarget),
      goalCurrent: num(s.goalCurrent),
      currency: s.currency || "JPY",
    };
  }

  /* ---------- 当月の計算（唯一の正） ---------- */
  function computeMonth(settings, txs, ym) {
    const s = normalizeSettings(settings);
    const all = Array.isArray(txs) ? txs : [];
    const month = all.filter(function (t) { return monthOf(t.date) === ym; });

    /* --- 収入：給与は「記録」だけが入力口（設定に手取りは無い） --- */
    const salaryRecs = month.filter(function (t) {
      return t.type === "income" && t.cat === REGULAR_INCOME_CAT;
    });
    const incomeRegular = sum(salaryRecs, function (t) { return t.amount; });
    const incomeRegularRecorded = salaryRecs.length > 0;
    const extraRecs = month.filter(function (t) {
      return t.type === "income" && t.cat !== REGULAR_INCOME_CAT;
    });
    const incomeExtra = sum(extraRecs, function (t) { return t.amount; });
    const incomeTotal = incomeRegular + incomeExtra;

    /* --- 固定費：項目ごとに「実績があれば実績、なければ予定額」 --- */
    const fixedDetail = FIXED_ITEMS.map(function (item) {
      const recs = month.filter(function (t) {
        return t.type === "expense" && t.cat === item.k;
      });
      const actual = sum(recs, function (t) { return t.amount; });
      const planned = s.fixed[item.k];
      return {
        key: item.k, name: item.n, emoji: item.e,
        planned: planned,
        actual: actual,
        recorded: recs.length > 0,
        amount: recs.length ? actual : planned,
        basis: recs.length ? "actual" : "planned",
      };
    });
    const fixedPlanned = sum(fixedDetail, function (d) { return d.planned; });
    const fixedActual = sum(fixedDetail, function (d) { return d.actual; });
    const fixedTotal = sum(fixedDetail, function (d) { return d.amount; });

    /* --- 変動支出：固定費カテゴリは必ず除外（二重計上の防止） --- */
    const varRecs = month.filter(function (t) {
      return t.type === "expense" && !isFixedCat(t.cat);
    });
    const variableSpend = sum(varRecs, function (t) { return t.amount; });

    /* --- 先取り（予定額） --- */
    const savingsPlanned = s.savingsTarget;
    const nisaPlanned = s.nisaMonthly;
    const setAside = savingsPlanned + nisaPlanned;

    /* --- 正式な計算式 --- */
    const available =
      incomeTotal - fixedTotal - setAside - variableSpend;

    /* --- 表示用の内訳 --- */
    const byCat = {};
    varRecs.forEach(function (t) {
      byCat[t.cat] = (byCat[t.cat] || 0) + num(t.amount);
    });
    const spendTotal = fixedTotal + variableSpend;
    const goalPct = s.goalTarget > 0
      ? Math.min(100, Math.round((s.goalCurrent / s.goalTarget) * 100))
      : null;

    return {
      ym: ym,
      currency: s.currency,
      settings: s,
      /* 収入 */
      incomeRegular: incomeRegular,
      incomeRegularRecorded: incomeRegularRecorded,
      incomeExtra: incomeExtra,
      incomeTotal: incomeTotal,
      hasIncome: incomeTotal > 0,
      /* 支出 */
      fixedDetail: fixedDetail,
      fixedPlanned: fixedPlanned,
      fixedActual: fixedActual,
      fixedTotal: fixedTotal,
      variableSpend: variableSpend,
      spendTotal: spendTotal,
      /* 先取り（予定額） */
      savingsPlanned: savingsPlanned,
      nisaPlanned: nisaPlanned,
      setAside: setAside,
      /* 結果 */
      available: available,
      /* 内訳 */
      byCat: byCat,
      goalPct: goalPct,
      monthTx: month,
    };
  }

  /* ---------- 今週つかった（記録した支出すべて） ---------- */
  function weekSpent(txs, from, to) {
    const all = Array.isArray(txs) ? txs : [];
    return sum(all.filter(function (t) {
      return t.type === "expense" && t.date >= from && t.date <= to;
    }), function (t) { return t.amount; });
  }

  /* ---------- ライフプラン連携スナップショット ---------- */
  function buildSnapshot(settings, txs, ym) {
    const c = computeMonth(settings, txs, ym);
    const accounts = [];
    if (c.savingsPlanned > 0) {
      accounts.push({
        type: "CASH_SAVINGS", local: "貯金",
        basis: "planned", planned_contribution: c.savingsPlanned,
      });
    }
    if (c.nisaPlanned > 0) {
      accounts.push({
        type: "TAX_FREE_INVEST", local: "NISA",
        basis: "planned", planned_contribution: c.nisaPlanned,
      });
    }
    return {
      schema_version: "2.1",
      country_code: "JP",
      base_currency: c.currency,
      year_month: ym,

      /* 収入：通常／臨時／当月実収入合計を分けて出力（すべて記録の実績） */
      income_regular: c.incomeRegular,
      income_regular_basis: "actual",
      income_regular_recorded: c.incomeRegularRecorded,
      income_extra: c.incomeExtra,
      income_actual_total: c.incomeTotal,
      /* 後方互換。旧 income_net は「当月の実収入合計」を指す */
      income_net: c.incomeTotal,

      /* 支出：予定・実績・採用値を分けて出力 */
      fixed_cost_planned: c.fixedPlanned,
      fixed_cost_actual: c.fixedActual,
      fixed_cost: c.fixedTotal,
      fixed_cost_items: c.fixedDetail.map(function (d) {
        return {
          key: d.key, name: d.name,
          planned: d.planned, actual: d.actual, applied: d.amount, basis: d.basis,
        };
      }),
      variable_spend: c.variableSpend,
      spend_total: c.spendTotal,

      /* 先取りは「予定額」であることを構造で明示 */
      planned_set_aside: c.setAside,
      accounts: accounts,

      available_to_spend: c.available,
    };
  }

  return {
    FIXED_ITEMS: FIXED_ITEMS,
    FIXED_KEYS: FIXED_KEYS,
    VAR_CATS: VAR_CATS,
    INC_CATS: INC_CATS,
    REGULAR_INCOME_CAT: REGULAR_INCOME_CAT,
    isFixedCat: isFixedCat,
    catOf: catOf,
    num: num,
    monthOf: monthOf,
    normalizeSettings: normalizeSettings,
    computeMonth: computeMonth,
    weekSpent: weekSpent,
    buildSnapshot: buildSnapshot,
  };
});
