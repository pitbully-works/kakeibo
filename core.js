/* =========================================================================
   かけいぼ ― 計算コア（core.js）
   ------------------------------------------------------------------------
   UIから完全に独立した「唯一の計算の正」。
   ホーム・まとめ・ライフプラン連携JSONは、すべてこのファイルの
   computeMonth() の結果だけを読む（画面ごとに式を書かない）。

   正式な計算式：
     使える額 = 通常収入 + 臨時収入 － 支出 － 先取り貯金 － NISA積立

   ただひとつの原則：**入力口はひとつだけ**
     お金の出入りは、すべて「記録」から入れる。設定には持たない。
       ・収入 … 通常給与／臨時・賞与／贈与／その他臨時
       ・支出 … すべて同じ「支出」の記録（固定費／変動費の区分は無い）
     同じ金額を2か所に書ける作りにしない。だから二重計上が起きない。

     設定に残すのは「まだ出ていないお金」だけ：
       先取り貯金・NISA積立（予定額）と、夢・目標。

   ブラウザでは window.KakeiboCore、Nodeでは module.exports として使える。
   ========================================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KakeiboCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- アプリの版数 ---------- */

  /* 画面の「アプリ情報」に出す版数。上げるときはここだけを書き換える。
     （service worker のキャッシュ名 kakeibo-vNN とは別のもの） */
  const APP_VERSION = "1.4.0";

  /* ---------- 分類の定義 ---------- */

  /* 支出カテゴリ（固定費／変動費の区分は廃止。すべて通常の支出）。
     電気・ガス・水道は分析で個別に見たいので3つのまま維持する。
     旧固定費のキー（rent/power/gas/water/comm/subs/insure/fixother）は
     そのまま残すので、保存済みデータは移行なしでそのまま表示・集計できる。 */
  const EXP_CATS = [
    { k: "food",     e: "🥕", n: "食費" },
    { k: "daily",    e: "🧴", n: "日用品" },
    { k: "eatout",   e: "🍜", n: "外食" },
    { k: "rent",     e: "🏠", n: "住居" },
    { k: "power",    e: "💡", n: "電気" },
    { k: "gas",      e: "🔥", n: "ガス" },
    { k: "water",    e: "🚰", n: "水道" },
    { k: "comm",     e: "📱", n: "通信" },
    { k: "insure",   e: "🛟", n: "保険" },
    { k: "transit",  e: "🚃", n: "交通" },
    { k: "car",      e: "🚗", n: "車" },
    { k: "medical",  e: "🏥", n: "医療・健康" },
    { k: "clothes",  e: "👕", n: "衣服" },
    { k: "social",   e: "🤝", n: "交際費" },
    { k: "hobby",    e: "🎨", n: "趣味" },
    { k: "pet",      e: "🐶", n: "ペット" },
    { k: "pension",  e: "💰", n: "私年金" },
    { k: "tax",      e: "📋", n: "税金" },
    { k: "subs",     e: "🔁", n: "サブスク" },
    { k: "fixother", e: "📦", n: "その他", hidden: true },
    { k: "other",    e: "🐷", n: "その他" },
  ];

  /* 記録シートの選択ボタンに出すカテゴリ。
     旧「その他固定費」(fixother) は「その他」が2つ並んで紛らわしいので、選べなくする。
     EXP_CATS には残すので、過去に fixother で記録したものは、
     これまでどおり表示・集計され、消えたり「その他」に化けたりしない。 */
  const EXP_PICK_CATS = EXP_CATS.filter(function (c) { return !c.hidden; });

  const REGULAR_INCOME_CAT = "salary";
  const INC_CATS = [
    { k: "salary", e: "💴", n: "通常給与" },
    { k: "bonus",  e: "✨", n: "臨時・賞与" },
    { k: "gift",   e: "🎁", n: "贈与" },
    { k: "other",  e: "🐷", n: "その他臨時" },
  ];

  const catOf = function (type, k) {
    const pool = type === "income" ? INC_CATS : EXP_CATS;
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
  function pad2(n) { return String(n).padStart(2, "0"); }

  /* =======================================================================
     月の区切り（給料日起点）
     -----------------------------------------------------------------------
     起点日を 20 にすると、7/20〜8/19 がひと区切りになる。
     呼び名は「始まりの月」に合わせるので、この区切りのキーは "2026-07"。
     つまり ym（"YYYY-MM"）の意味は今までどおり保たれ、
     変わるのは「どの記録がその ym に入るか」だけ。

     起点日が 1 のときは、暦の月（1日〜月末）とまったく同じ結果になる。
     これまでの保存データは cycleStart を持たないので、必ず 1 として扱われる。

     31日のように無い月がある起点日は、その月の末日へ寄せる。
     （例：起点31 なら 1/31〜2/27、2/28〜3/30。すき間も重なりも出ない）
     ======================================================================= */

  const CYCLE_START_MIN = 1;
  const CYCLE_START_MAX = 31;

  function normalizeCycleStart(v) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return 1;
    return Math.min(CYCLE_START_MAX, Math.max(CYCLE_START_MIN, n));
  }

  /* その年月に実際にある起点日（無い日は末日へ寄せる） */
  function cycleStartDay(ym, startDay) {
    return Math.min(normalizeCycleStart(startDay), daysInMonth(ym));
  }

  /* 区切りの範囲。to は次の区切りの前日。 */
  function cycleRange(ym, startDay) {
    const from = ym + "-" + pad2(cycleStartDay(ym, startDay));
    const nextYm = shiftYm(ym, 1);
    const to = shiftDate(nextYm + "-" + pad2(cycleStartDay(nextYm, startDay)), -1);
    return { from: from, to: to, days: daysApart(from, to) + 1 };
  }

  /* その日付が入る区切りのキー（始まりの月の "YYYY-MM"） */
  function cycleOf(iso, startDay) {
    const s = normalizeCycleStart(startDay);
    if (s === 1 || !validateDateString(iso)) return monthOf(iso);
    const ym = monthOf(iso);
    return Number(String(iso).slice(8, 10)) >= cycleStartDay(ym, s) ? ym : shiftYm(ym, -1);
  }

  /* 区切りの中で何日目か（1始まり）。範囲の外なら 0。 */
  function cycleDayIndex(iso, ym, startDay) {
    if (!validateDateString(iso)) return 0;
    const r = cycleRange(ym, startDay);
    if (iso < r.from || iso > r.to) return 0;
    return daysApart(r.from, iso) + 1;
  }

  /* 「毎月◯日」を、その区切りの中の日付に置きかえる。
     起点より前の日は次の月の側にある（起点20なら 1日 は翌月1日）。
     無い日（2月31日など）はその月の末日へ寄せる。 */
  function dateInCycle(ym, startDay, dayOfMonth) {
    const s = cycleStartDay(ym, startDay);
    const d = Math.min(31, Math.max(1, Math.floor(Number(dayOfMonth)) || 1));
    const target = d >= s ? ym : shiftYm(ym, 1);
    let iso = target + "-" + pad2(Math.min(d, daysInMonth(target)));
    const r = cycleRange(ym, startDay);
    if (iso < r.from) iso = r.from;
    if (iso > r.to) iso = r.to;
    return iso;
  }

  /* 画面に出す期間の文字（例 "7/20〜8/19"）。起点が1日なら空文字。 */
  function cycleLabel(ym, startDay) {
    if (normalizeCycleStart(startDay) === 1) return "";
    const r = cycleRange(ym, startDay);
    const f = function (iso) { return Number(iso.slice(5, 7)) + "/" + Number(iso.slice(8, 10)); };
    return f(r.from) + "〜" + f(r.to);
  }

  /* ---------- 設定の正規化 ---------- */
  /* 設定に持つのは「先取り（予定額）」と「夢・目標」だけ。
     旧版の手取り収入(incomeNet)・固定費(fixedCost / fixed)は読み捨てる。
     旧固定費カテゴリ(rent/power/gas/water/comm/subs/insure/fixother)の
     「記録」はそのまま通常の支出として残る。 */
  function normalizeSettings(raw) {
    const s = raw || {};
    const out = {
      savingsTarget: num(s.savingsTarget),
      nisaMonthly: num(s.nisaMonthly),
      goalName: String(s.goalName || "").slice(0, 24),
      goalTarget: num(s.goalTarget),
      goalCurrent: num(s.goalCurrent),
      currency: s.currency || "JPY",
      cycleStart: normalizeCycleStart(s.cycleStart),
    };
    /* ライフプランへ渡す資産。ここだけが入力口で、家計の計算には入れない。
       まだ何も入れていないうちは、設定に持たせない（保存を無駄に太らせないため）。 */
    const lp = normalizeLifePlanAssets(s.lp);
    if (lpHasAny(lp)) out.lp = lp;
    return out;
  }

  /* =======================================================================
     ライフプランへ渡す資産（金・銀行貯金・借入金・民間年金）
     -----------------------------------------------------------------------
     ねらいは「ライフプランアプリへ入れ直す手間をなくす」こと。
     そのため、キー名も並びも **ライフプラン側の inputs にそのまま合わせる**。
     ここで名前を言い換えると、渡すたびに対応表が要り、ズレの元になる。

     二重入力にしないための決めごと：
       ・この4つは家計簿のほかの画面には無い。ここだけが入力口。
       ・毎月の記録（支出・収入）とは別物。使えるお金の計算には一切入れない。
         例）借入の毎月返済は、実際に払ったときに「記録」から入れる。
            ここに入れる monthlyPayment は、ライフプランが将来を見通すための
            予定額であって、今月の家計には足さない。
     ======================================================================= */

  const LP_MAX_ROWS = 20;        // 1種類あたりの行数の上限
  const LP_MAX_NAME = 24;        // 名前の長さ

  const lpNum = (v, max) => {
    const n = Number(String(v == null ? "" : v).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, max === undefined ? 1e12 : max);
  };
  const lpName = (v) => String(v == null ? "" : v).slice(0, LP_MAX_NAME);
  /* 年齢は0〜120。ライフプラン側と同じく小数（57.5＝57歳6ヶ月）を許す。 */
  const lpAge = (v) => Math.round(lpNum(v, 120) * 12) / 12;

  function normalizeLpGold(raw) {
    const g = raw || {};
    return {
      currentGrams: lpNum(g.currentGrams, 1e6),
      pricePerGram: lpNum(g.pricePerGram, 1e7),
      monthlyYen: lpNum(g.monthlyYen, 1e9),
    };
  }

  function normalizeLpBanks(list) {
    return (Array.isArray(list) ? list : []).slice(0, LP_MAX_ROWS).map(function (b) {
      const r = b || {};
      return {
        name: lpName(r.name),
        balance: lpNum(r.balance, 1e12),
        monthlyDeposit: lpNum(r.monthlyDeposit, 1e9),
        interestPct: lpNum(r.interestPct, 100),
      };
    });
  }

  function normalizeLpLoans(list) {
    return (Array.isArray(list) ? list : []).slice(0, LP_MAX_ROWS).map(function (l) {
      const r = l || {};
      return {
        name: lpName(r.name),
        principal: lpNum(r.principal, 1e12),
        annualRatePct: lpNum(r.annualRatePct, 100),
        monthlyPayment: lpNum(r.monthlyPayment, 1e9),
      };
    });
  }

  function normalizeLpPensions(list) {
    return (Array.isArray(list) ? list : []).slice(0, LP_MAX_ROWS).map(function (p) {
      const r = p || {};
      return {
        name: lpName(r.name),
        contribFromAge: lpAge(r.contribFromAge),
        contribToAge: lpAge(r.contribToAge),
        monthlyContribution: lpNum(r.monthlyContribution, 1e9),
        payoutFromAge: lpAge(r.payoutFromAge),
        payoutToAge: lpAge(r.payoutToAge),
        monthlyPayout: lpNum(r.monthlyPayout, 1e9),
      };
    });
  }

  function normalizeLifePlanAssets(raw) {
    const a = raw || {};
    return {
      gold: normalizeLpGold(a.gold),
      banks: normalizeLpBanks(a.banks),
      loans: normalizeLpLoans(a.loans),
      privatePensionPlans: normalizeLpPensions(a.privatePensionPlans),
    };
  }

  /* 中身が空かどうか。空なら設定に持たせない（端末の保存領域を無駄に使わないため）。 */
  function lpHasAny(assets) {
    const a = normalizeLifePlanAssets(assets);
    return a.banks.length > 0 || a.loans.length > 0 || a.privatePensionPlans.length > 0 ||
      a.gold.currentGrams > 0 || a.gold.pricePerGram > 0 || a.gold.monthlyYen > 0;
  }

  /* ---- 設定の一覧に出す「合計」 ---- */
  function lpGoldValue(gold) {
    const g = normalizeLpGold(gold);
    return Math.round(g.currentGrams * g.pricePerGram);
  }
  function lpBanksTotal(list) {
    return normalizeLpBanks(list).reduce(function (s, b) { return s + b.balance; }, 0);
  }
  function lpLoansTotal(list) {
    return normalizeLpLoans(list).reduce(function (s, l) { return s + l.principal; }, 0);
  }
  function lpPensionMonthly(list) {
    return normalizeLpPensions(list).reduce(function (s, p) { return s + p.monthlyContribution; }, 0);
  }

  /* ライフプランアプリへ渡す形。
     向こうの「バックアップの読み込み」がそのまま受け取れる { inputs: ... } にする。
     読み込み側は差分をかぶせる作りなので、ここで渡した4つだけが入れ替わり、
     年齢や年金など向こうで入れた値は消えない。 */
  function buildLifePlanInputs(settings) {
    const a = normalizeLifePlanAssets(settings && settings.lp);
    return {
      inputs: {
        gold: a.gold,
        banks: a.banks,
        loans: a.loans,
        privatePensionPlans: a.privatePensionPlans,
      },
    };
  }

  /* 「毎月固定」の印がついた支出か。
     設定に予定額を持つのではなく、記録した1件ごとに印をつける。
     入力口はひとつだけ、という決めごとはそのまま。 */
  function isRecurring(t) {
    return !!(t && t.type === "expense" && t.recurring === true);
  }

  /* ---------- 当月の計算（唯一の正） ---------- */
  function computeMonth(settings, txs, ym) {
    const s = normalizeSettings(settings);
    const all = Array.isArray(txs) ? txs : [];
    const month = all.filter(function (t) { return cycleOf(t.date, s.cycleStart) === ym; });

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

    /* --- 支出：すべて「記録」から。固定費／変動費の区分は無い --- */
    const expRecs = month.filter(function (t) { return t.type === "expense"; });
    const spendTotal = sum(expRecs, function (t) { return t.amount; });

    /* 「毎月固定」の印がついた分と、それ以外。どちらも同じように支出として引く。
       分けているのは、見せ方と、月末の見積もりを暴れさせないためだけ。 */
    const recurringSpend = sum(expRecs.filter(isRecurring), function (t) { return t.amount; });
    const spotSpend = spendTotal - recurringSpend;

    /* --- 先取り（予定額） --- */
    const savingsPlanned = s.savingsTarget;
    const nisaPlanned = s.nisaMonthly;
    const setAside = savingsPlanned + nisaPlanned;

    /* --- 正式な計算式 --- */
    const available = incomeTotal - spendTotal - setAside;

    /* --- 表示用の内訳（すべての支出カテゴリ） --- */
    const byCat = {};
    expRecs.forEach(function (t) {
      byCat[t.cat] = (byCat[t.cat] || 0) + num(t.amount);
    });
    const byCatRecurring = {};
    expRecs.filter(isRecurring).forEach(function (t) {
      byCatRecurring[t.cat] = (byCatRecurring[t.cat] || 0) + num(t.amount);
    });
    const goalPct = s.goalTarget > 0
      ? Math.min(100, Math.round((s.goalCurrent / s.goalTarget) * 100))
      : null;

    return {
      ym: ym,
      currency: s.currency,
      settings: s,
      /* 月の区切り（起点が1日なら、暦の月そのもの） */
      cycleStart: s.cycleStart,
      periodFrom: cycleRange(ym, s.cycleStart).from,
      periodTo: cycleRange(ym, s.cycleStart).to,
      periodDays: cycleRange(ym, s.cycleStart).days,
      periodLabel: cycleLabel(ym, s.cycleStart),
      /* 収入 */
      incomeRegular: incomeRegular,
      incomeRegularRecorded: incomeRegularRecorded,
      incomeExtra: incomeExtra,
      incomeTotal: incomeTotal,
      hasIncome: incomeTotal > 0,
      /* 支出（すべて記録した実績） */
      spendTotal: spendTotal,
      recurringSpend: recurringSpend,   // うち「毎月固定」の印がついたもの
      spotSpend: spotSpend,             // それ以外
      /* 先取り（予定額） */
      savingsPlanned: savingsPlanned,
      nisaPlanned: nisaPlanned,
      setAside: setAside,
      /* 結果 */
      available: available,
      /* 内訳 */
      byCat: byCat,
      byCatRecurring: byCatRecurring,
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


  /* =======================================================================
     レシートの金額読み取り（OCRテキストの解釈）
     -----------------------------------------------------------------------
     mode:
       "total" … 合計の行だけをアップで撮った写真。候補がほぼ1つなので、
                 いちばん大きい金額を素直に採用する（読み違いが起きにくい）。
       "full"  … レシート全体。「合計」の語の“右側”の数字だけを拾い、
                 小計・お預り・お釣りなど紛らわしい行は最初から捨てる。
     ======================================================================= */

  /* 金額と紛らわしいものを先に消す（日付・時刻・電話・郵便番号・登録番号） */
  function stripNonAmounts(text) {
    return String(text || "")
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
      .replace(/[，]/g, ",")
      .replace(/\d{4}\s*[/年.\-]\s*\d{1,2}\s*[/月.\-]\s*\d{1,2}\s*日?/g, " ")
      .replace(/\d{1,2}\s*[/月]\s*\d{1,2}\s*日?/g, " ")
      .replace(/\d{1,2}\s*:\s*\d{2}(\s*:\s*\d{2})?/g, " ")
      .replace(/(TEL|Tel|電話)[^\n]*/g, " ")
      .replace(/〒\s*\d{3}\s*-?\s*\d{4}/g, " ")
      .replace(/(登録番号|No\.?|NO\.?|伝票)\s*[:：]?\s*T?\d+/g, " ");
  }

  /* 「合計」など、その行の金額を採用してよい語 */
  const TOTAL_KW = /(合\s*計|お会計|お買[上げい]+\s*計|ご請求(金)?額|税込\s*計|総\s*額|total)/i;
  /* 合計と紛らわしく、拾ってはいけない語 */
  const SKIP_KW = /(小\s*計|中\s*計|お預[りかり]*|預\s*り|お釣り|釣\s*銭|お返し|現\s*金|クレジット|カード|電子マネー|ポイント|point|値引|割引|外税|内税|消費税|税\s*額|対象額)/i;

  /* 文字列から金額候補を位置つきで拾う */
  function amountsIn(str) {
    const out = [];
    const re = /(?:[¥￥]\s*)?(\d{1,3}(?:,\d{3})+|\d{2,7})(?![\d%％])/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const v = parseInt(m[1].replace(/,/g, ""), 10);
      if (v >= 10 && v <= 3000000) out.push({ value: v, index: m.index, raw: m[1], yen: /[¥￥]/.test(m[0]) });
    }
    return out;
  }

  function parseAmount(text, mode) {
    const cleaned = stripNonAmounts(text);
    if (!cleaned.trim()) return null;
    const lines = cleaned.split(/\r?\n/);

    /* --- アップ撮影：素直にいちばん大きい金額 --- */
    if (mode === "total") {
      const all = [];
      lines.forEach(function (l) { amountsIn(l).forEach(function (a) { all.push(a); }); });
      if (!all.length) return null;
      const yenOnly = all.filter(function (a) { return a.yen; });
      const pool = yenOnly.length ? yenOnly : all;
      return pool.reduce(function (a, b) { return b.value > a.value ? b : a; }).value;
    }

    /* --- 全体撮影：「合計」の右側の数字だけを拾う --- */
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (SKIP_KW.test(line)) continue;
      const kw = TOTAL_KW.exec(line);
      if (!kw) continue;
      const after = amountsIn(line).filter(function (a) { return a.index >= kw.index; });
      if (after.length) { hits.push(after[after.length - 1].value); continue; }
      /* 合計の金額が次の行にあるレシートもある */
      for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
        if (SKIP_KW.test(lines[j])) continue;
        const nx = amountsIn(lines[j]);
        if (nx.length) { hits.push(nx[nx.length - 1].value); break; }
      }
    }
    if (hits.length) return Math.max.apply(null, hits);

    /* --- 合計が読めなかったときだけ、紛らわしい行を除いた最大値 --- */
    const rest = [];
    lines.forEach(function (l) {
      if (SKIP_KW.test(l)) return;
      amountsIn(l).forEach(function (a) { rest.push(a.value); });
    });
    if (!rest.length) return null;
    return Math.max.apply(null, rest);
  }


  /* =======================================================================
     切り取り範囲の計算と、読み取り前の画像の下ごしらえ（純粋関数）
     ======================================================================= */
  function clamp01(v) { const n = Number(v); return !Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n; }

  /* 枠（画像に対する 0〜1 の割合）→ 元画像のピクセル座標 */
  function cropRect(crop, nat) {
    const NW = Math.max(1, Math.round(nat.w)), NH = Math.max(1, Math.round(nat.h));
    const c = crop || {};
    let x = Math.round(clamp01(c.x) * NW);
    let y = Math.round(clamp01(c.y) * NH);
    let w = Math.round(clamp01(c.w === undefined ? 1 : c.w) * NW);
    let h = Math.round(clamp01(c.h === undefined ? 1 : c.h) * NH);
    if (w < 1) w = 1;
    if (h < 1) h = 1;
    if (x > NW - 1) x = NW - 1;
    if (y > NH - 1) y = NH - 1;
    if (x + w > NW) w = NW - x;
    if (y + h > NH) h = NH - y;
    return { x: x, y: y, w: w, h: h };
  }

  /* 小さすぎる切り抜きは拡大してから読ませると精度が上がる */
  function cropOutputSize(w, h, minW, maxW) {
    const MIN = minW || 1200, MAX = maxW || 2400;
    let scale = 1;
    if (w < MIN) scale = MIN / w;
    if (w * scale > MAX) scale = MAX / w;
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
  }

  /* 白黒にしてコントラストを目いっぱい伸ばす（レシートの薄い印字対策） */
  function enhanceForOcr(data) {
    let min = 255, max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const g = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      data[i] = data[i + 1] = data[i + 2] = g;
      if (g < min) min = g;
      if (g > max) max = g;
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < data.length; i += 4) {
      const v = Math.round(((data[i] - min) * 255) / range);
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    return data;
  }

  /* 枠の既定位置（真ん中の横帯）と、動かすときの最小サイズ */
  const CROP_DEFAULT = { x: 0.06, y: 0.34, w: 0.88, h: 0.30 };
  const CROP_MIN = 0.08;

  /* 枠を動かす／広げるの計算。UIから切り離してテストできるようにする */
  function moveCrop(start, dx, dy, mode) {
    const MIN = CROP_MIN;
    const c = { x: start.x, y: start.y, w: start.w, h: start.h };
    const cl = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
    if (mode === "move") {
      c.x = cl(start.x + dx, 0, 1 - start.w);
      c.y = cl(start.y + dy, 0, 1 - start.h);
    } else if (mode === "br") {
      c.w = cl(start.w + dx, MIN, 1 - start.x);
      c.h = cl(start.h + dy, MIN, 1 - start.y);
    } else if (mode === "tl") {
      const nx = cl(start.x + dx, 0, start.x + start.w - MIN);
      const ny = cl(start.y + dy, 0, start.y + start.h - MIN);
      c.w = start.w + (start.x - nx);
      c.h = start.h + (start.y - ny);
      c.x = nx; c.y = ny;
    }
    return c;
  }


  /* =======================================================================
     写真の保存サイズ（純粋計算）
     -----------------------------------------------------------------------
     スマホの写真は1枚数MBあり、ブラウザの保存領域（およそ5MB）をすぐ超える。
     超えた瞬間に保存が失敗し、「記録したのに残らない」状態になるため、
     ・読み取り用は 1600px まで
     ・保存用は 900px まで
     に縮めてから扱う。
     ======================================================================= */
  const PHOTO_OCR_MAX = 3500;    // 読み取り専用（メモリ内だけ・保存しない）
  const PHOTO_VIEW_MAX = 1600;   // 画面表示に使う長辺
  const PHOTO_STORE_MAX = 900;   // 保存する長辺
  const STORE_SOFT_LIMIT = 3.6 * 1024 * 1024; // これを超えたら警告

  /* 長辺を maxEdge に収めた寸法（拡大はしない） */
  function fitSize(w, h, maxEdge) {
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
    const long = Math.max(W, H);
    if (long <= maxEdge) return { w: W, h: H };
    const s = maxEdge / long;
    return { w: Math.max(1, Math.round(W * s)), h: Math.max(1, Math.round(H * s)) };
  }

  /* 文字列がだいたい何バイトか（保存量の見積もり） */
  function approxBytes(str) {
    const t = String(str || "");
    // dataURL は base64。4文字で3バイト。
    const m = /^data:[^,]*;base64,/.exec(t);
    if (m) return Math.round(((t.length - m[0].length) * 3) / 4);
    let n = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      n += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
    }
    return n;
  }

  /* 保存データ全体の見積もりと、危険水域かどうか */
  function storageUsage(state) {
    const tx = (state && Array.isArray(state.tx)) ? state.tx : [];
    let photos = 0, photoCount = 0;
    tx.forEach(function (t) {
      if (t && t.photo) { photos += approxBytes(t.photo); photoCount++; }
    });
    let total;
    try { total = approxBytes(JSON.stringify(state)); } catch (e) { total = photos; }
    return {
      total: total, photos: photos, photoCount: photoCount,
      limit: STORE_SOFT_LIMIT,
      nearLimit: total > STORE_SOFT_LIMIT,
    };
  }


  /* =======================================================================
     読み取り精度を上げるための画像処理と、複数回読んだ結果の選び方
     ======================================================================= */

  /* 大津の二値化：明るさの境目を自動で決めて、白黒はっきりさせる。
     レシートの薄い感熱印字に効く。 */
  function otsuThreshold(histogram, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * histogram[i];
    let sumB = 0, wB = 0, best = 0, threshold = 128;
    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * histogram[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; threshold = t; }
    }
    return threshold;
  }

  /* RGBAの配列を、白黒くっきりに変える */
  function binarizeForOcr(data) {
    const hist = new Array(256).fill(0);
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const g = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      data[i] = data[i + 1] = data[i + 2] = g;
      hist[g]++;
    }
    const t = otsuThreshold(hist, n);
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i] > t ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    return data;
  }

  /* 軽いグレースケール＋ゆるいコントラスト。
     二値化すると細い線が消えてしまう薄い印字のための保険。
     端5%を外れ値として無視し、残りを 20〜235 に伸ばすだけに留める。 */
  function softenForOcr(data) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      const g = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      data[i] = data[i + 1] = data[i + 2] = g;
      hist[g]++;
    }
    const total = data.length / 4;
    const cut = Math.max(1, Math.floor(total * 0.05));
    let lo = 0, hi = 255, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= cut) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= cut) { hi = i; break; } }
    /* 濃淡の幅が極端に狭いときに無理やり伸ばすと、明暗が逆転しかねない。
       その場合はグレースケールのままにしておく。 */
    if (hi - lo < 8) return data;
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < data.length; i += 4) {
      let v = ((data[i] - lo) * 215) / range + 20;
      v = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    return data;
  }

  /* もう次の段階に進まなくてよいか。
     条件はただ一つ：**異なる読み取り実行で同じ金額が2回以上出たこと**。
     Tesseractは誤読にも高い信頼度を付けることがあるため、
     1件だけの結果では——信頼度がいくら高くても——打ち切らない。 */
  function ocrEnough(candidates) {
    const ok = (candidates || []).filter(function (c) {
      return c && Number.isFinite(c.amount) && c.amount > 0;
    });
    if (ok.length < 2) return false;
    const votes = {};
    for (const c of ok) {
      const k = String(c.amount);
      votes[k] = (votes[k] || 0) + 1;
      if (votes[k] >= 2) return true;
    }
    return false;
  }

  /* 何回か読んだ結果から、いちばん確からしい金額を選ぶ。
     ・同じ金額が複数回出たら、それを最優先（偶然は重ならない）
     ・そうでなければ読み取り信頼度の高い方
     ・並んだら大きい方（合計は小計より大きい） */
  function pickBestAmount(candidates) {
    const ok = (candidates || []).filter(function (c) {
      return c && Number.isFinite(c.amount) && c.amount > 0;
    });
    if (!ok.length) return null;
    const votes = {};
    ok.forEach(function (c) {
      const k = String(c.amount);
      if (!votes[k]) votes[k] = { amount: c.amount, count: 0, conf: 0 };
      votes[k].count++;
      votes[k].conf = Math.max(votes[k].conf, Number(c.confidence) || 0);
    });
    const list = Object.keys(votes).map(function (k) { return votes[k]; });
    list.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      if (b.conf !== a.conf) return b.conf - a.conf;
      return b.amount - a.amount;
    });
    return list[0].amount;
  }


  /* =======================================================================
     枠のふくらませ／縮め（0〜1の比率のまま、画像からはみ出さない）
     ======================================================================= */
  /* pad は枠の大きさに対する割合。上下左右それぞれに加える。
     pad=0.05 → 各辺5%広げる（幅は1.10倍）／ pad=-0.10 → 各辺10%狭める */
  function padCrop(crop, pad) {
    const c = crop || CROP_DEFAULT;
    const dx = c.w * pad, dy = c.h * pad;
    let x = c.x - dx, y = c.y - dy, w = c.w + dx * 2, h = c.h + dy * 2;
    if (w < CROP_MIN) { x = c.x + c.w / 2 - CROP_MIN / 2; w = CROP_MIN; }
    if (h < CROP_MIN) { y = c.y + c.h / 2 - CROP_MIN / 2; h = CROP_MIN; }
    if (x < 0) { x = 0; }
    if (y < 0) { y = 0; }
    if (x + w > 1) { w = 1 - x; }
    if (y + h > 1) { h = 1 - y; }
    if (w > 1) { x = 0; w = 1; }
    if (h > 1) { y = 0; h = 1; }
    return { x: x, y: y, w: w, h: h };
  }

  /* 使う枠は3種類：そのまま／5%広げ／10%狭め */
  const CROP_VARIANTS = [
    { key: "base",  pad: 0 },
    { key: "wide",  pad: 0.05 },
    { key: "tight", pad: -0.10 },
  ];
  function cropVariant(crop, key) {
    const v = CROP_VARIANTS.filter(function (x) { return x.key === key; })[0] || CROP_VARIANTS[0];
    return padCrop(crop, v.pad);
  }

  /* =======================================================================
     画像処理の候補
     ======================================================================= */

  /* グレースケール＋シャープ化（にじんだ感熱印字の輪郭を立てる） */
  function sharpenForOcr(data, w, h) {
    const g = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      g[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        let v;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) v = g[p];
        else v = 5 * g[p] - g[p - 1] - g[p + 1] - g[p - w] - g[p + w];
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        const i = p * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
      }
    }
    return data;
  }

  /* 適応的二値化（照明ムラ・影に強い。周辺の平均より暗ければ黒） */
  function adaptiveBinarize(data, w, h, block, cVal) {
    const B = Math.max(3, block || Math.max(15, Math.round(Math.min(w, h) / 8) | 1));
    const C = typeof cVal === "number" ? cVal : 10;
    const g = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      g[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    }
    /* 積分画像で高速に周辺平均を求める */
    const sum = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += g[y * w + x];
        sum[(y + 1) * (w + 1) + (x + 1)] = sum[y * (w + 1) + (x + 1)] + row;
      }
    }
    const r = B >> 1;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const tot = sum[(y1 + 1) * (w + 1) + (x1 + 1)] - sum[y0 * (w + 1) + (x1 + 1)]
                  - sum[(y1 + 1) * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
        const mean = tot / area;
        const i = (y * w + x) * 4;
        const v = g[y * w + x] < mean - C ? 0 : 255;
        data[i] = data[i + 1] = data[i + 2] = v;
      }
    }
    return data;
  }

  /* 読み取り前の下ごしらえを1か所にまとめる。
     ここでだけ反転を判断するので、二重に反転して元へ戻ることが起きない。
     出来上がりは必ず「明るい背景・暗い文字」。 */
  function prepareForOcr(data, w, h, style) {
    if (shouldInvert(data)) invertForOcr(data);   // 白抜き文字のときだけ、ここで1回
    if (style === "bw") binarizeForOcr(data);
    else if (style === "soft") softenForOcr(data);
    else if (style === "sharp") sharpenForOcr(data, w, h);
    else if (style === "adaptive") adaptiveBinarize(data, w, h);
    else enhanceForOcr(data);
    return data;
  }

  /* 白黒反転が必要か（背景が暗い＝白抜き文字のとき） */
  function shouldInvert(data) {
    let total = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      n++;
    }
    return n > 0 && total / n < 110;
  }
  function invertForOcr(data) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i]; data[i + 1] = 255 - data[i + 1]; data[i + 2] = 255 - data[i + 2];
    }
    return data;
  }


  /* =======================================================================
     先頭の桁が欠けた読み取りの補正
     -----------------------------------------------------------------------
     「¥3,555」を「555」としか読めないことがある。
     カンマが見えているなら、その金額は4桁以上のはず——という手がかりを使う。
     やみくもに1〜9を付けて候補を増やすことはしない。
     ======================================================================= */

  /* 合計らしさの手がかり（カンマ・¥・円・合計・TOTAL など） */
  const TOTAL_HINT = /([¥￥]|円|合\s*計|お会計|ご請求|総\s*額|total)/i;
  function totalHint(d) {
    if (!d) return false;
    if (d.yen) return true;
    if (String(d.raw || "").indexOf(",") >= 0) return true;
    return TOTAL_HINT.test(String(d.lineText || "") + String(d.prefix || ""));
  }

  /* 先頭が欠けている疑いがあるか。
     戻り値 null＝疑いなし ／ {digits} ＝文字として先頭が残っている
             {digits:null} ＝欠けは分かるが数字は不明（画像から読み直す） */
  function truncatedLeading(d) {
    if (!d || !Number.isFinite(d.amount)) return null;
    if (d.amount < 100 || d.amount > 999) return null;        // 3桁のときだけ
    if (String(d.raw || "").indexOf(",") >= 0) return null;    // すでにカンマ付きなら欠けていない
    const pre = String(d.prefix || "");
    const withDigit = /(\d{1,3})\s*[,.]\s*$/.exec(pre);       // 例: "3," が残っている
    if (withDigit) return { digits: withDigit[1], evidence: "text" };
    if (/[,.]\s*$/.test(pre)) return { digits: null, evidence: "comma" };  // 例: ",555"
    return null;
  }

  /* 欠けた先頭の数字がありそうな場所を、枠の中の細い帯として求める。
     文字の位置（col）と行の長さ（lineLen）から1文字ぶんの幅を見積もり、
     数字の左側「数字＋カンマ」ぶんだけを切り出す。 */
  function leadingStripCrop(crop, d) {
    const c = crop || CROP_DEFAULT;
    const len = Math.max(1, Number(d && d.lineLen) || 1);
    const charW = 1 / len;
    let start = Math.min(1, Math.max(0, (Number(d && d.col) || 0) / len));
    let x0, w;
    if (start < 0.15) {
      /* 行の先頭に見えている＝欠けた文字は認識されていない。枠の左側を広めに見る。 */
      x0 = 0; w = 0.4;
    } else {
      const pad = Math.min(0.5, charW * 2.5);
      x0 = Math.max(0, start - pad);
      w = Math.min(1 - x0, (start - x0) + charW * 0.5);
      if (w < 0.08) w = Math.min(1 - x0, 0.08);
    }
    return {
      x: Math.min(1, Math.max(0, c.x + c.w * x0)),
      y: c.y,
      w: Math.max(0.02, Math.min(c.w * w, 1 - (c.x + c.w * x0))),
      h: c.h,
    };
  }

  /* 補正の作戦を立てる。候補が無ければ null。 */
  function reconstructionPlan(details, crop) {
    const list = (details || []).filter(function (d) { return truncatedLeading(d); });
    if (!list.length) return null;
    /* 合計らしい手がかりがある行を優先する */
    list.sort(function (a, b) { return (totalHint(b) ? 1 : 0) - (totalHint(a) ? 1 : 0); });
    const d = list[0];
    const t = truncatedLeading(d);
    if (t.digits) {
      return { kind: "text", digits: t.digits, base: d.amount, detail: d };
    }
    return { kind: "strip", strip: leadingStripCrop(crop, d), base: d.amount, detail: d };
  }

  /* 帯を読んだ結果から、先頭の1文字だけを取り出す。
     複数出たら、いちばん信頼度の高いものの先頭の数字。 */
  function firstDigit(results) {
    const list = (results || [])
      .map(function (r) {
        const m = /[1-9]/.exec(String((r && r.text) || "").replace(/\s/g, ""));
        return m ? { digit: m[0], confidence: Number(r.confidence) || 0 } : null;
      })
      .filter(Boolean);
    if (!list.length) return null;
    list.sort(function (a, b) { return b.confidence - a.confidence; });
    return list[0].digit;
  }

  const RECON_MAX_CONF = 60;   // 推測で作った候補の信頼度の上限（直接読めたものと区別する）

  /* 先頭の数字が分かったら、候補を1つだけ作る。1〜9を総当たりしない。 */
  function buildReconstructed(base, digit, opts) {
    const b = Number(base);
    const dg = String(digit == null ? "" : digit).replace(/\D/g, "");
    if (!Number.isFinite(b) || b < 100 || b > 999) return null;
    if (!dg) return null;
    const head = dg.slice(-3).replace(/^0+/, "");     // 先頭の0は意味がない
    if (!head) return null;
    const amount = Number(head) * 1000 + b;
    if (amount < 1 || amount > 999999) return null;
    const o = opts || {};
    return {
      amount: amount,
      raw: head + "," + String(b).padStart(3, "0"),
      confidence: Math.min(RECON_MAX_CONF, Number(o.confidence) || 0),
      agree: Number(o.agree) || 1,
      posScore: Number.isFinite(o.posScore) ? o.posScore : 0.5,
      context: true,
      source: "reconstructed",
    };
  }

  /* =======================================================================
     読み取り結果の採点
     ======================================================================= */

  /* テキストから、金額候補を位置つきで全部拾う */
  function amountDetails(text) {
    const cleaned = stripNonAmounts(text);
    const lines = cleaned.split(/\r?\n/);
    const out = [];
    lines.forEach(function (line, i) {
      amountsIn(line).forEach(function (a) {
        out.push({
          amount: a.value, raw: a.raw, yen: a.yen,
          line: i, lineCount: lines.length,
          col: a.index, lineLen: line.length,
          prefix: line.slice(Math.max(0, a.index - 8), a.index),
          lineText: line,
        });
      });
    });
    return out;
  }

  /* OCRが返した「文字列の中で」中央寄りかを0〜1で返す。
     画像座標ではない。bbox を使っていないため、画像上の位置は分からない。
     行の中ほど・行内の中ほどに現れた数字をわずかに優遇するだけの弱い手がかり。 */
  function textPositionScore(d) {
    if (!d) return 0.5;
    const vy = d.lineCount > 1 ? d.line / (d.lineCount - 1) : 0.5;
    const rawLen = String(d.raw || "").length;
    const vx = d.lineLen > 0 ? (d.col + rawLen / 2) / d.lineLen : 0.5;
    const dist = Math.min(1, Math.max(Math.abs(vy - 0.5), Math.abs(vx - 0.5)) * 2);
    return 1 - dist;
  }

  /* カンマの打ち方が自然か。1,285 は自然、12,85 や 1,2,85 は不自然。 */
  function commaScore(raw) {
    const s = String(raw || "");
    if (!s) return 0;
    if (s.indexOf(",") < 0) return s.length <= 3 ? 1 : 0.5;   // 4桁以上でカンマ無しは弱い
    const parts = s.split(",");
    if (parts[0].length < 1 || parts[0].length > 3) return 0;
    for (let i = 1; i < parts.length; i++) if (parts[i].length !== 3) return 0;
    return 1;
  }

  const SCORE_CONFIRM = 60;   // これ未満なら利用者に選んでもらう
  const SCORE_GAP = 12;       // 1位と2位の差がこれ未満なら選んでもらう

  /* 候補1件の点数（0〜100） */
  function scoreCandidate(c) {
    if (!c || !Number.isFinite(c.amount)) return 0;
    if (c.amount < 1 || c.amount > 999999) return 0;              // 範囲外は0点
    if (commaScore(c.raw) === 0) return 0;                        // 桁区切りが壊れている
    let s = 5;                                                     // 範囲内であること
    s += Math.min(40, (Number(c.confidence) || 0) * 0.4);          // 読み取り信頼度：最大40
    s += Math.min(30, Math.max(0, (Number(c.agree) || 1) - 1) * 15); // 一致数：最大30
    s += commaScore(c.raw) * 15;                                   // 桁区切り：最大15
    s += (Number.isFinite(c.posScore) ? c.posScore : 0.5) * 10;    // 文字列内で中央寄り：最大10
    if (c.context) s += 10;                                        // 合計らしい手がかり：最大10
    if (c.truncated) s -= 40;      // カンマが見えている＝4桁以上のはず。3桁の読みは怪しい
    if (c.source === "reconstructed") s -= 8;   // 推測ぶんは控えめに
    return Math.round(Math.max(0, Math.min(100, s)));
  }

  /* 同じ金額をまとめ、点数順に並べる */
  function rankCandidates(list) {
    const byAmount = {};
    (list || []).forEach(function (c) {
      if (!c || !Number.isFinite(c.amount) || c.amount <= 0) return;
      const k = String(c.amount);
      if (!byAmount[k]) {
        byAmount[k] = {
          amount: c.amount, agree: 0, confidence: 0, raw: c.raw, posScore: 0,
          context: false, truncated: false, source: "ocr",
        };
      }
      const b = byAmount[k];
      b.agree += 1;
      b.confidence = Math.max(b.confidence, Number(c.confidence) || 0);
      b.posScore = Math.max(b.posScore, Number.isFinite(c.posScore) ? c.posScore : 0.5);
      if (c.context) b.context = true;
      if (c.truncated) b.truncated = true;
      if (c.source === "reconstructed" && b.source === "ocr" && b.agree === 1) b.source = "reconstructed";
      if (c.source === "ocr") b.source = "ocr";      // 一度でも直接読めていれば推測ではない
      if (commaScore(c.raw) > commaScore(b.raw)) b.raw = c.raw;
    });
    const ranked = Object.keys(byAmount).map(function (k) {
      const b = byAmount[k];
      b.score = scoreCandidate(b);
      return b;
    }).filter(function (b) { return b.score > 0; });
    ranked.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.agree !== a.agree) return b.agree - a.agree;
      return b.amount - a.amount;
    });
    return ranked;
  }

  /* 自動で入れてよいか、利用者に選んでもらうか */
  function needsConfirmation(ranked) {
    if (!ranked || !ranked.length) return false;          // 候補ゼロ＝手入力へ
    if (ranked[0].source === "reconstructed") return true; // 推測は必ず選んでもらう（自動入力しない）
    if (ranked[0].score < SCORE_CONFIRM) return true;
    if (ranked.length > 1 && ranked[0].score - ranked[1].score < SCORE_GAP) return true;
    return false;
  }

  /* 読み取りの手順（枠 × 画像処理 × 読み取り方）。速い順に3段階、最大9回。 */
  const OCR_PLAN = [
    [ { crop: "base",  image: "soft",     psm: "7" },
      { crop: "base",  image: "bw",       psm: "7" } ],
    [ { crop: "wide",  image: "bw",       psm: "7" },
      { crop: "tight", image: "bw",       psm: "8" },
      { crop: "base",  image: "adaptive", psm: "7" } ],
    [ { crop: "base",  image: "sharp",    psm: "13" },
      { crop: "wide",  image: "adaptive", psm: "6" },
      { crop: "tight", image: "soft",     psm: "8" },
      { crop: "wide",  image: "sharp",    psm: "7" } ],
  ];
  const OCR_MAX_RUNS = OCR_PLAN.reduce(function (a, st) { return a + st.length; }, 0);


  /* =======================================================================
     バックアップの書き出しと読み込み（純粋関数）
     -----------------------------------------------------------------------
     読み込みは「他人が作ったかもしれないファイル」を相手にする。
     壊れた値・悪意のある値が来てもアプリが壊れないよう、ここで必ず正規化する。
     ======================================================================= */

  const BACKUP_VERSION = 1;
  const MEMO_MAX = 60;            // メモの上限文字数（記録画面と同じ）
  const AMOUNT_MAX = 999999999;   // 金額の上限（これ以上は切り詰める）
  const TX_MAX = 20000;           // 記録件数の上限（読み込み時の暴走防止）

  /* 書き出す形。version と exportedAt を付ける。 */
  function buildBackup(state) {
    const st = state || {};
    return {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: normalizeSettings(st.settings),
      tx: (Array.isArray(st.tx) ? st.tx : []).map(normalizeTransaction).filter(Boolean),
      health: normalizeHealth(st.health),
      diary: normalizeDiary(st.diary),
      plans: normalizePlans(st.plans),
      pulse: normalizePulseList(st.pulse),
    };
  }

  /* JSONとして読めるか。読めなければ理由つきで投げる。 */
  function parseBackupJson(text) {
    const t = String(text == null ? "" : text).trim();
    if (!t) throw new Error("ファイルが空です");
    let data;
    try {
      data = JSON.parse(t);
    } catch (e) {
      throw new Error("バックアップの中身を読み取れませんでした（JSONではありません）");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("バックアップの形が違います");
    }
    return data;
  }

  /* YYYY-MM-DD として妥当か（2026-02-31 のような存在しない日付も弾く） */
  function validateDateString(value) {
    const v = String(value == null ? "" : value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const y = Number(v.slice(0, 4)), m = Number(v.slice(5, 7)), d = Number(v.slice(8, 10));
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  /* 記録1件を安全な形に整える。整えられなければ null。 */
  function normalizeTransaction(tx) {
    if (!tx || typeof tx !== "object" || Array.isArray(tx)) return null;

    const type = tx.type === "income" ? "income" : tx.type === "expense" ? "expense" : null;
    if (!type) return null;                                   // 不明な種別は捨てる

    let amount = Number(tx.amount);
    if (!Number.isFinite(amount)) return null;                // 文字列・NaN・Infinity は捨てる
    amount = Math.floor(Math.abs(amount));                    // 負数・小数は整数の絶対値へ
    if (amount > AMOUNT_MAX) amount = AMOUNT_MAX;             // 巨大値は上限で止める

    if (!validateDateString(tx.date)) return null;            // 日付が不正なら捨てる

    const pool = type === "income" ? INC_CATS : EXP_CATS;
    const cat = pool.some(function (c) { return c.k === tx.cat; })
      ? tx.cat
      : (type === "income" ? "other" : "other");              // 未知のカテゴリは「その他」へ

    const memo = String(tx.memo == null ? "" : tx.memo).slice(0, MEMO_MAX);

    /* 写真は data URL の画像だけを受け入れる。それ以外は捨てる。 */
    let photo = null;
    if (typeof tx.photo === "string" && /^data:image\/[a-z+.-]+;base64,/i.test(tx.photo)) {
      photo = tx.photo;
    }

    const id = (typeof tx.id === "string" && tx.id) ? tx.id.slice(0, 64) : null;

    /* 「毎月固定」の印。支出のときだけ意味がある。 */
    const recurring = type === "expense" && tx.recurring === true;

    const out = { id: id, type: type, amount: amount, cat: cat, date: tx.date, memo: memo, photo: photo };
    if (recurring) out.recurring = true;
    return out;
  }

  /* バックアップ全体を安全な形に整える。形が違えば理由つきで投げる。 */
  function normalizeBackup(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("バックアップの形が違います");
    }
    const settings = data.settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new Error("設定が入っていません");
    }
    if (!Array.isArray(data.tx)) {
      throw new Error("記録が入っていません");
    }
    const seen = {};
    const tx = [];
    let dropped = 0;
    data.tx.slice(0, TX_MAX).forEach(function (raw) {
      const t = normalizeTransaction(raw);
      if (!t) { dropped++; return; }
      /* id が無い・重複しているものには新しい id を振る */
      if (!t.id || seen[t.id]) t.id = "r" + tx.length + "-" + Math.random().toString(36).slice(2, 8);
      seen[t.id] = true;
      tx.push(t);
    });
    if (data.tx.length > TX_MAX) dropped += data.tx.length - TX_MAX;
    return {
      settings: normalizeSettings(settings),
      tx: tx,
      health: normalizeHealth(data.health),   // 旧バックアップに health が無ければ空
      diary: normalizeDiary(data.diary),       // 旧バックアップに diary が無ければ空
      plans: normalizePlans(data.plans),       // 旧バックアップに plans が無ければ空
      pulse: normalizePulseList(data.pulse),   // 旧バックアップに pulse が無ければ空
      dropped: dropped,
      version: Number(data.version) || 0,   // 旧形式は version が無い＝0
    };
  }

  /* =======================================================================
     健康記録（体重・血圧。将来 体温なども同じ形で足せる）
     -----------------------------------------------------------------------
     入れ物は日付キーの1日1件。同じ日に記録し直せば上書き。
     { "2026-07-25": { weight:62.5, bpHigh:120, bpLow:78 } }
     ======================================================================= */
  const HEALTH_FIELDS = [
    { k: "weight", n: "体重",   unit: "kg",   min: 0,   max: 500, decimals: 1 },
    { k: "bpHigh", n: "血圧(上)", unit: "mmHg", min: 0,   max: 300, decimals: 0 },
    { k: "bpLow",  n: "血圧(下)", unit: "mmHg", min: 0,   max: 300, decimals: 0 },
    /* 心拍数。範囲はPPG検証ページと同じ 30〜220bpm（整数）。 */
    { k: "pulse",  n: "心拍数", unit: "bpm",  min: 30,  max: 220, decimals: 0 },
    /* 将来ここに { k:"temp", n:"体温", unit:"℃", min:30, max:45, decimals:1 } などを足せる */
  ];

  /* 1件を安全な形に整える。数値でない・範囲外は捨てる（その項目だけ無視）。
     体温などを足しても、この関数は HEALTH_FIELDS を見るだけで動く。 */
  function normalizeHealthEntry(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const out = {};
    HEALTH_FIELDS.forEach(function (f) {
      const raw = entry[f.k];
      if (raw === "" || raw === null || raw === undefined) return;  // 未入力はその項目を入れない
      let v = Number(raw);
      if (!Number.isFinite(v)) return;                 // 数値でなければその項目は入れない
      if (v < f.min || v > f.max) return;              // 範囲外は捨てる
      const p = Math.pow(10, f.decimals);
      out[f.k] = Math.round(v * p) / p;                // 小数の桁をそろえる
    });
    return Object.keys(out).length ? out : null;       // 中身が空なら記録しない
  }

  /* 健康記録ぜんぶを安全な形に整える（読み込み時に使う）。
     日付キーが妥当で中身が有効なものだけ残す。 */
  function normalizeHealth(health) {
    const out = {};
    if (!health || typeof health !== "object" || Array.isArray(health)) return out;
    Object.keys(health).forEach(function (date) {
      if (!validateDateString(date)) return;
      const e = normalizeHealthEntry(health[date]);
      if (e) out[date] = e;
    });
    return out;
  }

  /* グラフ用：ある項目（weight など）の推移を日付順で返す。
     from/to は "YYYY-MM-DD"（省略可）。 */
  function healthSeries(health, field, from, to) {
    const h = health || {};
    const lo = from && validateDateString(from) ? from : null;
    const hi = to && validateDateString(to) ? to : null;
    return Object.keys(h)
      .filter(function (d) {
        if (lo && d < lo) return false;
        if (hi && d > hi) return false;
        return h[d] && Number.isFinite(h[d][field]);
      })
      .sort()
      .map(function (d) { return { date: d, value: h[d][field] }; });
  }

  /* =======================================================================
     横スワイプでの画面切り替え ― どこへ移るかを決めるだけ
     -----------------------------------------------------------------------
     下のタブと同じ並び。指を動かした向き（dx）から、次の画面を返す。
     端（ホーム／心拍）では行き止まりにして、ぐるっと回り込ませない。
     せっていは右上のボタン専用なので、この並びには入れない。
     ======================================================================= */
  const SWIPE_VIEWS = ["home", "summary", "calendar", "diary", "health", "calc", "pulse"];

  function swipeNextView(view, dx) {
    const i = SWIPE_VIEWS.indexOf(view);
    if (i < 0) return null;                     // せってい画面などは対象外
    if (!Number.isFinite(Number(dx)) || Number(dx) === 0) return null;
    const next = i + (Number(dx) < 0 ? 1 : -1); // 左へ払えば次、右へ払えば前
    if (next < 0 || next >= SWIPE_VIEWS.length) return null;   // 端では動かさない
    return SWIPE_VIEWS[next];
  }

  /* =======================================================================
     カメラ（PPG）で測る心拍数 ― 数の決め方だけ（UI非依存・唯一の正）
     -----------------------------------------------------------------------
     カメラの制御・プレビュー・描画は画面側(index.html)。ここは計算だけを持つ。
     映像も画像も一切扱わない。受け取るのは1コマぶんの平均色などの数値だけで、
     フレームそのものはどこにも残さない。

     しきい値は試験ページ(kakeibo-ppg-test)で実機検証したものをそのまま移した。
     市販の血圧計との比較22件で 平均絶対誤差 約1.9bpm／最大3bpm／相関 約0.95。
     ここの数値を動かすと、その検証がやり直しになる。動かすときは再検証すること。

     ※ 医療機器ではない。健康管理の参考値。
     ======================================================================= */
  const PULSE_CFG = {
    TOTAL_SEC: 60,        // 測定の長さ（秒）
    PREP_SEC: 10,         // 最初の準備時間。この区間は計算に使わない
    FS: 30,               // 解析用に並べ直すサンプリング周波数(Hz)
    WIN_SEC: 10,          // 窓の長さ（秒）
    HOP_SEC: 5,           // 窓をずらす幅（秒）
    GRID: 16,             // 1コマを 16×16 に縮めて平均を取る（画面側で使う）
    /* 探す心拍数の範囲。試験ページで検証したときと同じ 40〜180 のまま。
       「保存してよい心拍数」は PULSE_SAVE.bpmMin/Max（35〜200）で別に見る。
       探索範囲を広げると自己相関が半分・2倍の山を拾いやすくなり、
       検証済みの精度が変わってしまうため、ここは動かさない。 */
    BPM_MIN: 40, BPM_MAX: 180,
    minRedRatio: 1.15,    // 赤みの強さ（指が当たっていれば赤が突出する）
    minBright: 12, maxBright: 246,
    maxSpatialSd: 34,     // 画面内のばらつき（指で覆えていれば平らになる）
    minAcDc: 0.0012,      // 脈の振幅／全体の明るさ（信号の強さ）
    minQuality: 0.45,     // 自己相関のピークの高さ（0〜1）
    minValidWin: 5,       // 使える窓の最低数（全9窓中）
    maxSpread: 10,        // 使えた窓どうしの心拍数の開き（bpm）
    maxBadFrameRate: 0.15,// 準備後に「指が外れた」と判定したコマの割合
    minFps: 15,
  };

  /* 全部で何窓とれるか（60秒−準備10秒＝50秒、10秒窓を5秒ずつ → 9窓） */
  const PULSE_WINDOWS = Math.floor(
    ((PULSE_CFG.TOTAL_SEC - PULSE_CFG.PREP_SEC) - PULSE_CFG.WIN_SEC) / PULSE_CFG.HOP_SEC
  ) + 1;

  /* 正式な記録として保存してよい条件。
     ここを満たさない測定は「参考にもならない」ので、履歴に残さない。

     ライトの点灯は条件に入れない。点けられる端末では点けて信号を強くするが、
     ライトを制御できない端末・ブラウザでも測定は続け、
     保存してよいかは「測定品質・採用窓・fps」だけで判断する。
     ライトのON/OFFは、あとから見返せるよう記録には残す。 */
  const PULSE_SAVE = {
    minKept: 6,             // 採用窓 6/9 以上
    minFps: 25,             // 25fps 以上
    minStars: 3,            // 測定品質 ★3（普通）以上
    maxBadFrameRate: 0.15,  // 指が途中で離れていない
    bpmMin: 35, bpmMax: 200,
  };

  /* 条件を満たさなかったときに画面へ出す文言（1か所に持つ） */
  const PULSE_FAIL_MSG = "測定品質が不足しています。安静にして再測定してください。";

  /* 測定品質（★5段階）。呼び名は「測定品質」で統一する。 */
  const PULSE_QUALITY_LABELS = {
    5: "とても良好",
    4: "良好",
    3: "普通",
    2: "やや不安定",
    1: "再測定推奨",
  };
  const PULSE_CONDS = { rest: "安静時", post: "運動後", other: "その他" };
  const PULSE_MAX = 500;          // 履歴の上限件数（古いものから落とす）

  function pulseQualityLabel(stars) {
    const n = Math.round(Number(stars));
    return PULSE_QUALITY_LABELS[n] || "—";
  }
  /* ★★★☆☆ の形。画面はこれを出すだけでよい。 */
  function pulseStarText(stars) {
    const n = Math.max(0, Math.min(5, Math.round(Number(stars)) || 0));
    let s = "";
    for (let i = 1; i <= 5; i++) s += (i <= n ? "★" : "☆");
    return s;
  }

  /* 測定品質を★1〜5で決める。既にある指標を並べ替えて見せるだけで、
     心拍数の計算そのものには使わない。 */
  function pulseStars(kept, wins, spread, quality) {
    const ratio = wins ? kept / wins : 0;
    const sp = Number.isFinite(spread) ? spread : 999;
    const q = Number.isFinite(quality) ? quality : 0;
    if (ratio >= 0.99 && sp <= 2 && q >= 0.85) return 5;
    if (ratio >= 0.85 && sp <= 4 && q >= 0.70) return 4;
    if (ratio >= 0.65 && sp <= 7 && q >= 0.55) return 3;
    if (ratio >= 0.50 && sp <= 10 && q >= 0.40) return 2;
    return 1;
  }

  /* 1コマが「指がちゃんと当たっている」と言えるか。
     画面側のリアルタイム表示と、あとの解析で同じ判定を使う。 */
  function pulseFrameOk(s) {
    if (!s || typeof s !== "object") return false;
    const rr = Number.isFinite(s.redRatio) ? s.redRatio : (s.r / ((s.g + s.b) / 2 + 1));
    const br = Number.isFinite(s.bright) ? s.bright : (s.r + s.g + s.b) / 3;
    const sd = Number(s.sd);
    if (!Number.isFinite(rr) || !Number.isFinite(br) || !Number.isFinite(sd)) return false;
    return rr >= PULSE_CFG.minRedRatio && br >= PULSE_CFG.minBright &&
      br <= PULSE_CFG.maxBright && sd <= PULSE_CFG.maxSpatialSd;
  }

  /* ---- 信号処理（試験ページと同じ） ---- */

  /* コマの間隔はばらつくので、一定間隔に並べ直す */
  function pulseResample(ts, vs, fs) {
    if (!ts || ts.length < 4) return null;
    const a0 = ts[0], a1 = ts[ts.length - 1];
    const n = Math.floor(((a1 - a0) / 1000) * fs);
    if (n < 10) return null;
    const out = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = a0 + (i / fs) * 1000;
      while (j < ts.length - 2 && ts[j + 1] < t) j++;
      const a = ts[j], b = ts[j + 1];
      const w = b > a ? (t - a) / (b - a) : 0;
      out[i] = vs[j] + (vs[j + 1] - vs[j]) * Math.max(0, Math.min(1, w));
    }
    return out;
  }

  /* 決まった時間の枠へ並べ直す。窓の数（9窓）が測定のわずかな長さの差で
     8窓になったり9窓になったりしないよう、解析はいつも同じ長さで行う。
     端をはみ出す時刻は、いちばん近い実測値でそのまま埋める（外挿はしない）。 */
  function pulseResampleFixed(ts, vs, fs, from, to) {
    if (!ts || ts.length < 4) return null;
    const n = Math.floor(((to - from) / 1000) * fs);
    if (n < 10) return null;
    const out = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = from + (i / fs) * 1000;
      while (j < ts.length - 2 && ts[j + 1] < t) j++;
      const a = ts[j], b = ts[j + 1];
      const w = b > a ? (t - a) / (b - a) : 0;
      out[i] = vs[j] + (vs[j + 1] - vs[j]) * Math.max(0, Math.min(1, w));
    }
    return out;
  }

  function pulseMovAvg(x, k) {
    const n = x.length, out = new Float64Array(n);
    let sum = 0;
    const half = Math.floor(k / 2);
    for (let i = 0; i < n; i++) {
      sum += x[i];
      if (i >= k) sum -= x[i - k];
      out[Math.max(0, Math.min(n - 1, i - half))] = sum / Math.min(k, i + 1);
    }
    /* 上のループは末尾 half 個ぶんを書き残す（0のまま残る）。
       0 のままだと「土台の揺れ」を引いた差が明るさそのものになり、
       最後の窓だけ巨大な段差になって使えなくなる。
       残っている分だけの平均で埋める（真ん中の値は上のループのまま変えない）。 */
    for (let j = Math.max(1, n - half); j < n; j++) {
      let s = 0, c = 0;
      for (let i = Math.max(0, j - half + 1); i < n; i++) { s += x[i]; c++; }
      out[j] = c ? s / c : x[n - 1];
    }
    return out;
  }

  /* 移動平均で「ゆっくりした揺れ」と「細かいノイズ」を落とす（簡易バンドパス） */
  function pulseBandpass(x, fs) {
    const slow = pulseMovAvg(x, Math.round(fs * 1.2));
    const d = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) d[i] = x[i] - slow[i];
    return pulseMovAvg(d, Math.max(2, Math.round(fs * 0.12)));
  }

  function pulseRms(x) {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    return Math.sqrt(s / x.length);
  }

  /* 自己相関で周期を探す。q は 0〜1（波形の繰り返しの良さ）。 */
  function pulseAutocorrBpm(x, fs) {
    const n = x.length;
    if (n < 8) return { bpm: null, q: 0 };
    let mean = 0;
    for (let i = 0; i < n; i++) mean += x[i];
    mean /= n;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = x[i] - mean;

    const minLag = Math.floor((60 / PULSE_CFG.BPM_MAX) * fs);
    const maxLag = Math.min(n - 1, Math.ceil((60 / PULSE_CFG.BPM_MIN) * fs));
    let best = { lag: 0, v: 0 };
    const corr = new Float64Array(maxLag + 2);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0, a = 0, b = 0;
      for (let i = 0; i + lag < n; i++) { s += y[i] * y[i + lag]; a += y[i] * y[i]; b += y[i + lag] * y[i + lag]; }
      const v = (a > 0 && b > 0) ? s / Math.sqrt(a * b) : 0;
      corr[lag] = v;
      if (v > best.v) best = { lag: lag, v: v };
    }
    if (!best.lag || best.v <= 0) return { bpm: null, q: 0 };

    /* 自己相関は 2倍・3倍の周期にも山ができる。いちばん短い（＝速い）山を本命にする。 */
    for (let lag = minLag + 1; lag < best.lag - 1; lag++) {
      if (corr[lag] >= best.v * 0.85 && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
        best = { lag: lag, v: corr[lag] };
        break;
      }
    }
    /* 山の頂点を放物線で補間して細かい精度を出す */
    const l = corr[best.lag - 1] || 0, c = corr[best.lag], r = corr[best.lag + 1] || 0;
    const denom = (l - 2 * c + r);
    const shift = denom !== 0 ? (0.5 * (l - r)) / denom : 0;
    const lag = best.lag + Math.max(-1, Math.min(1, shift));
    const bpm = (60 * fs) / lag;
    if (bpm < PULSE_CFG.BPM_MIN || bpm > PULSE_CFG.BPM_MAX) return { bpm: null, q: 0 };
    return { bpm: bpm, q: Math.max(0, Math.min(1, best.v)) };
  }

  /* 測定1回ぶんの解析（純粋関数）。
     samples は [{ t:経過ミリ秒, r,g,b, bright, sd, redRatio }, ...]。
     戻り値は必ず同じ形にして、画面側が分岐しやすいようにする。 */
  function analyzePulse(samples) {
    const C = PULSE_CFG;
    const all = Array.isArray(samples) ? samples : [];
    const use = all.filter(function (s) { return s && Number.isFinite(s.t) && s.t >= C.PREP_SEC * 1000; });
    const total = use.length;
    const bad = use.filter(function (s) { return !pulseFrameOk(s); }).length;
    const badRate = total ? bad / total : 1;
    const fps = total / (C.TOTAL_SEC - C.PREP_SEC);

    const ng = function (reason) {
      return {
        ok: false, reason: reason, bpm: null, stars: 0, quality: 0,
        kept: 0, wins: PULSE_WINDOWS, spread: null, fps: fps, badRate: badRate,
      };
    };

    if (total < 100) return ng("コマ数が足りませんでした。もう一度測ってください。");
    if (fps < C.minFps) return ng("コマ数が足りません（" + fps.toFixed(0) + "fps）。ほかのアプリを閉じて、もう一度測ってください。");
    if (badRate > C.maxBadFrameRate) return ng("測定中に指が外れたか、明るさが変わりました。指を動かさずに、もう一度測ってください。");

    /* 最後まで測れているか（途中で止めた測定を、短いまま解析しない） */
    if (use[use.length - 1].t < (C.TOTAL_SEC - 1) * 1000) {
      return ng("測定が最後まで終わりませんでした。もう一度測ってください。");
    }
    const sig = pulseResampleFixed(
      use.map(function (s) { return s.t; }), use.map(function (s) { return s.g; }),
      C.FS, C.PREP_SEC * 1000, C.TOTAL_SEC * 1000
    );
    if (!sig || sig.length < C.FS * C.WIN_SEC) return ng("信号が足りませんでした。もう一度測ってください。");

    /* 明るさに対する脈の振幅（信号の強さ） */
    const dcMean = use.reduce(function (a, s) { return a + s.g; }, 0) / use.length;
    const filt = pulseBandpass(sig, C.FS);
    const acdc = (pulseRms(filt) * 2) / Math.max(1, dcMean);
    if (acdc < C.minAcDc) return ng("脈の信号が弱すぎます。レンズを指の腹でしっかりふさぎ、明るい場所でもう一度測ってください。");

    /* 10秒の窓を5秒ずつずらして、それぞれの心拍数と波形の良さを出す */
    const win = C.WIN_SEC * C.FS, hop = C.HOP_SEC * C.FS;
    const wins = [];
    for (let s = 0; s + win <= filt.length; s += hop) {
      const r = pulseAutocorrBpm(filt.slice(s, s + win), C.FS);
      wins.push({ at: C.PREP_SEC + s / C.FS, bpm: r.bpm, q: r.q });
    }
    const good = wins.filter(function (w) { return w.bpm && w.q >= C.minQuality; });
    if (good.length < C.minValidWin) {
      return ng("波形が安定しませんでした。指を動かさず、力を抜いて、もう一度測ってください。");
    }
    const bpms = good.map(function (w) { return w.bpm; }).sort(function (a, b) { return a - b; });
    const med = bpms[Math.floor(bpms.length / 2)];
    /* 中央値から離れすぎた窓は外れ値として捨て、残りで平均する */
    const kept = bpms.filter(function (b) { return Math.abs(b - med) <= C.maxSpread / 2; });
    const spread = kept.length ? kept[kept.length - 1] - kept[0] : 999;
    if (kept.length < C.minValidWin || spread > C.maxSpread) {
      return ng("測定が不安定でした（値のばらつきが大きい）。落ち着いた姿勢で、もう一度測ってください。");
    }
    const bpm = Math.round(kept.reduce(function (a, b) { return a + b; }, 0) / kept.length);
    const quality = good.reduce(function (a, w) { return a + w.q; }, 0) / good.length;
    return {
      ok: true, reason: "",
      bpm: bpm,
      stars: pulseStars(kept.length, wins.length, spread, quality),
      quality: Math.round(quality * 1000) / 1000,
      kept: kept.length,
      wins: wins.length,
      spread: Math.round(spread * 10) / 10,
      fps: Math.round(fps * 10) / 10,
      badRate: Math.round(badRate * 1000) / 1000,
    };
  }

  /* 正式な記録として保存してよいか。
     ダメな理由は detail に持ち、画面に出す文言（msg）は常に同じにする。 */
  function pulseSaveCheck(result) {
    const S = PULSE_SAVE;
    const no = function (detail) { return { ok: false, msg: PULSE_FAIL_MSG, detail: detail }; };
    if (!result || !result.ok) return no((result && result.reason) || "測定できませんでした");
    if (!Number.isFinite(result.bpm) || result.bpm < S.bpmMin || result.bpm > S.bpmMax) {
      return no("心拍数が " + S.bpmMin + "〜" + S.bpmMax + "bpm の範囲から外れています");
    }
    if (!(result.kept >= S.minKept)) return no("安定した区間が足りません（採用窓 " + result.kept + "/" + result.wins + "・" + S.minKept + "以上が必要）");
    if (!(result.fps >= S.minFps)) return no("コマ数が足りません（" + Math.round(result.fps) + "fps・" + S.minFps + "以上が必要）");
    if (!(result.stars >= S.minStars)) return no("測定品質が ★" + result.stars + " でした（★" + S.minStars + "以上が必要）");
    if (result.badRate > S.maxBadFrameRate) return no("測定中に指が離れました");
    return { ok: true, msg: "", detail: "" };
  }

  /* ---- 履歴（保存するのは数値だけ。映像・画像は保存しない） ---- */

  /* "HH:MM" として妥当か（健康記録の時刻表示用） */
  function pulseTimeString(value) {
    const v = String(value == null ? "" : value);
    if (!/^\d{2}:\d{2}$/.test(v)) return null;
    const h = Number(v.slice(0, 2)), m = Number(v.slice(3, 5));
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return v;
  }

  /* 測定1件を安全な形に整える。整えられなければ null。 */
  function normalizePulseEntry(rec) {
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) return null;
    const bpm = Math.round(Number(rec.bpm));
    if (!Number.isFinite(bpm) || bpm < PULSE_SAVE.bpmMin || bpm > PULSE_SAVE.bpmMax) return null;
    if (!validateDateString(rec.date)) return null;

    const num = function (v, min, max, dec) {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      if (n < min || n > max) return null;
      const p = Math.pow(10, dec);
      return Math.round(n * p) / p;
    };
    const str = function (v, max) { return String(v == null ? "" : v).slice(0, max); };

    const stars = num(rec.stars, 1, 5, 0);
    const out = {
      id: (typeof rec.id === "string" && rec.id) ? rec.id.slice(0, 64) : null,
      date: rec.date,
      time: pulseTimeString(rec.time) || "00:00",
      ts: str(rec.ts, 40),
      bpm: bpm,
      stars: stars === null ? 1 : stars,
      quality: num(rec.quality, 0, 1, 3),
      kept: num(rec.kept, 0, 99, 0),
      wins: num(rec.wins, 0, 99, 0),
      spread: num(rec.spread, 0, 999, 1),
      fps: num(rec.fps, 0, 999, 1),
      cond: PULSE_CONDS[rec.cond] ? rec.cond : "rest",
      device: str(rec.device, 60),
      cam: str(rec.cam, 40),
      torch: rec.torch === true,
    };
    return out;
  }

  /* 履歴ぜんぶを安全な形に整える。新しい順ではなく、日時の古い順に並べる。 */
  function normalizePulseList(list) {
    if (!Array.isArray(list)) return [];
    const seen = {};
    const out = [];
    list.forEach(function (raw) {
      const r = normalizePulseEntry(raw);
      if (!r) return;
      if (!r.id || seen[r.id]) r.id = "p" + out.length + "-" + Math.random().toString(36).slice(2, 8);
      seen[r.id] = true;
      out.push(r);
    });
    out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.time < b.time ? -1 : (a.time > b.time ? 1 : 0);
    });
    /* 上限を超えたら、古いものから落とす */
    return out.length > PULSE_MAX ? out.slice(out.length - PULSE_MAX) : out;
  }

  /* いちばん新しい測定（無ければ null） */
  function pulseLatest(list) {
    const rows = Array.isArray(list) ? list : [];
    return rows.length ? rows[rows.length - 1] : null;
  }

  /* グラフ用：日ごとの平均を日付順で返す。
     1日に何回でも測れるので、同じ日は平均して1点にする（線が縦に往復しないため）。 */
  function pulseSeries(list, from, to) {
    const rows = Array.isArray(list) ? list : [];
    const lo = from && validateDateString(from) ? from : null;
    const hi = to && validateDateString(to) ? to : null;
    const byDate = {};
    rows.forEach(function (r) {
      if (!r || !Number.isFinite(r.bpm)) return;
      if (lo && r.date < lo) return;
      if (hi && r.date > hi) return;
      const b = byDate[r.date] || (byDate[r.date] = { sum: 0, n: 0 });
      b.sum += r.bpm; b.n++;
    });
    return Object.keys(byDate).sort().map(function (d) {
      return { date: d, value: Math.round(byDate[d].sum / byDate[d].n) };
    });
  }

  /* CSV。保存している項目をすべて出す（依頼どおり）。 */
  function pulseCsv(list) {
    const rows = Array.isArray(list) ? list : [];
    const head = ["日時", "心拍数(bpm)", "測定品質(★)", "測定品質", "採用窓", "ばらつき(bpm)", "fps", "測定状態", "使用端末", "カメラ解像度", "ライト"];
    const q = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
    const body = rows.map(function (r) {
      return [
        r.ts || (r.date + " " + r.time),
        r.bpm,
        r.stars,
        pulseQualityLabel(r.stars),
        (r.kept == null ? "" : r.kept) + "/" + (r.wins == null ? "" : r.wins),
        r.spread == null ? "" : r.spread,
        r.fps == null ? "" : r.fps,
        PULSE_CONDS[r.cond] || r.cond,
        r.device,
        r.cam,
        r.torch ? "ON" : "OFF",
      ].map(q).join(",");
    });
    return [head.map(q).join(","), ...body].join("\n");
  }

  /* =======================================================================
     グラフの目もり（体重・血圧の推移）
     -----------------------------------------------------------------------
     折れ線だけでは「いつ・いくつ・どれだけ変わったか」が読めないので、
     縦の目もり（切りのよい数値）と、最初から最新までの変化量をここで出す。
     描画そのものは画面側。数の決め方はこのファイルだけを正とする。
     ======================================================================= */
  const CHART_TICKS = 4;        // 縦の目もりの本数の目安
  const CHART_XLABELS = 4;      // 横（日付）のラベルの最大数

  function round6(v) { return Math.round(v * 1e6) / 1e6; }

  /* 目もりの間隔を「1・2・2.5・5・10」の切りのよい数から選ぶ。
     例：幅1.5を4分割 → 0.5 きざみ／幅35を4分割 → 10 きざみ */
  function chartNiceStep(span, count) {
    const c = Math.max(1, Math.round(count) || 1);
    if (!Number.isFinite(span) || span <= 0) return 1;
    const rough = span / c;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const n = rough / mag;
    let m = 10;
    if (n <= 1) m = 1;
    else if (n <= 2) m = 2;
    else if (n <= 2.5) m = 2.5;
    else if (n <= 5) m = 5;
    return round6(m * mag);
  }

  /* 値の並びから、上下の端と目もりの位置を決める。
     端は必ず目もりに合わせるので、軸の数字が半端にならない。 */
  function chartScale(values, count) {
    const nums = (values || []).filter(function (v) { return Number.isFinite(v); });
    if (!nums.length) return null;
    const want = Math.max(2, Math.min(6, Math.round(count) || CHART_TICKS));
    let min = Math.min.apply(null, nums);
    let max = Math.max.apply(null, nums);
    if (min === max) {                       // 1件だけ・同じ値ばかり：上下に少し余白を作る
      const pad = Math.max(Math.abs(min) * 0.02, 0.5);
      min -= pad; max += pad;
    }
    const step = chartNiceStep(max - min, want);
    const lo = round6(Math.floor(round6(min / step)) * step);
    const hi = round6(Math.ceil(round6(max / step)) * step);
    const n = Math.min(24, Math.max(1, Math.round((hi - lo) / step)));
    const ticks = [];
    for (let i = 0; i <= n; i++) ticks.push(round6(lo + step * i));
    return { lo: lo, hi: round6(Math.max(hi, ticks[ticks.length - 1])), step: step, ticks: ticks };
  }

  /* 横軸に日付を出す位置。点が多い月でも文字が重ならないよう間引く。 */
  function chartLabelIndexes(len, max) {
    const n = Math.max(0, Math.round(len) || 0);
    if (!n) return [];
    const m = Math.max(2, Math.round(max) || CHART_XLABELS);
    const out = [];
    if (n <= m) {
      for (let i = 0; i < n; i++) out.push(i);
      return out;
    }
    for (let i = 0; i < m; i++) {
      const v = Math.round((i * (n - 1)) / (m - 1));
      if (out.indexOf(v) === -1) out.push(v);
    }
    return out;
  }

  /* 最初の記録から最新までで、どれだけ変わったか。 */
  function seriesChange(series) {
    if (!Array.isArray(series) || !series.length) return null;
    const a = series[0], b = series[series.length - 1];
    if (!a || !b || !Number.isFinite(a.value) || !Number.isFinite(b.value)) return null;
    return {
      fromDate: a.date, toDate: b.date,
      first: round6(a.value), last: round6(b.value),
      diff: round6(b.value - a.value),
      count: series.length,
    };
  }


  /* =======================================================================
     日記（日付ごとに1件・後から編集）
     { "2026-07-25": "今日はよく歩いた" }
     ======================================================================= */
  const DIARY_MAX = 2000;   // 1日の本文の上限文字数

  /* 日記1件を安全な形に整える。
     旧形式（本文の文字列だけ）も新形式（{text, photo}）も受け入れる。
     戻り値は必ず {text, photo?} か null。 */
  function normalizeDiaryEntry(raw) {
    let text = "", photo = null;
    if (typeof raw === "string") {
      text = raw;                                    // 旧形式：文字列だけ
    } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      if (typeof raw.text === "string") text = raw.text;
      /* 写真は画像の data URL だけ受け入れる（XSS・不正値を弾く） */
      if (typeof raw.photo === "string" && /^data:image\/[a-z+.-]+;base64,/i.test(raw.photo)) {
        photo = raw.photo;
      }
    } else {
      return null;
    }
    text = text.slice(0, DIARY_MAX);
    /* 本文も写真も無ければ、その日の日記は残さない */
    if (text.trim() === "" && !photo) return null;
    const out = { text: text };
    if (photo) out.photo = photo;
    return out;
  }

  /* 日記ぜんぶを安全な形に整える。日付が妥当で中身のあるものだけ残す。 */
  function normalizeDiary(diary) {
    const out = {};
    if (!diary || typeof diary !== "object" || Array.isArray(diary)) return out;
    Object.keys(diary).forEach(function (date) {
      if (!validateDateString(date)) return;
      const e = normalizeDiaryEntry(diary[date]);
      if (e) out[date] = e;
    });
    return out;
  }

  /* 一覧用：日付の新しい順に返す。text と photo を持つ。 */
  function diaryList(diary) {
    const d = diary || {};
    return Object.keys(d).sort().reverse().map(function (date) {
      const e = d[date] || {};
      return { date: date, text: e.text || "", photo: e.photo || null };
    });
  }

  /* =======================================================================
     金額の電卓
     -----------------------------------------------------------------------
     記録シートの金額欄で使う。円なので、扱うのは整数だけ。
     押されたキーから「次の状態」を作る純粋関数だけを置き、
     画面はその状態を映すだけにする（計算式を画面側に書かない）。

     状態： { acc, op, cur, done, expr, error }
       acc  … 確定している左側の数（まだ無ければ null）
       op   … 待っている演算子（"" なら無し）
       cur  … いま打ち込んでいる数の文字列（"" なら未入力）
       done … 直前に ＝ を押した（次に数字を押したら新しく打ち直す）
       expr … 画面に小さく出す式（"1,200 ＋" など）
     ======================================================================= */

  const CALC_DIGITS_MAX = 9;    // 一度に打ち込める桁数
  const CALC_OPS = ["+", "-", "*", "/"];
  const CALC_OP_LABEL = { "+": "＋", "-": "－", "*": "×", "/": "÷" };

  function newCalc() {
    return { acc: null, op: "", cur: "", done: false, expr: "", error: "" };
  }

  /* 数から電卓の状態を作る（記録を直すとき・レシートから金額を入れたとき） */
  function calcFrom(value) {
    const c = newCalc();
    const digits = String(value == null ? "" : value).replace(/[^\d]/g, "");
    if (digits !== "") c.cur = String(Number(digits)).slice(0, CALC_DIGITS_MAX);
    return c;
  }

  function calcFmt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString("en-US") : String(v);
  }

  /* ひとつ計算する。0で割ろうとしたときだけ null を返す。 */
  function calcApply(a, op, b) {
    if (op === "+") return a + b;
    if (op === "-") return a - b;
    if (op === "*") return a * b;
    if (op === "/") return b === 0 ? null : Math.round(a / b);
    return b;
  }

  /* いま打ち込んでいる数（未入力なら acc、それも無ければ 0） */
  function calcEntry(c) {
    if (c.cur !== "") return Number(c.cur);
    if (c.acc !== null) return c.acc;
    return 0;
  }

  /* 大きく出す数。まだ何も打っていなければ空文字（プレースホルダの 0 が出る）。 */
  function calcDisplay(c) {
    if (!c) return "";
    if (c.cur !== "") return c.cur;
    if (c.acc !== null) return String(c.acc);
    return "";
  }

  /* 待っている計算まで済ませた、最終的な金額 */
  function calcValue(c) {
    if (!c) return 0;
    if (c.op && c.acc !== null && c.cur !== "") {
      const r = calcApply(c.acc, c.op, Number(c.cur));
      return r === null ? c.acc : r;
    }
    return calcEntry(c);
  }

  /* キーを1つ押した結果を返す。元の状態は変えない。
     key: "0"〜"9" ／ "+" "-" "*" "/" ／ "=" ／ "C" ／ "back" ／ "00" "000" */
  function calcPress(state, key) {
    const c = Object.assign(newCalc(), state || {});
    c.error = "";
    const k = String(key);

    if (k === "C") return newCalc();

    if (k === "back") {
      if (c.done) return newCalc();
      c.cur = c.cur.slice(0, -1);
      return c;
    }

    if (/^0+$|^[1-9]\d*$|^\d$/.test(k) && /^\d{1,3}$/.test(k)) {
      /* 数字（"0" "7" "00" "000"） */
      if (c.done) { c.acc = null; c.op = ""; c.cur = ""; c.done = false; c.expr = ""; }
      let next = c.cur === "0" ? k : c.cur + k;
      if (next.length > 1) next = next.replace(/^0+(?=\d)/, "");
      c.cur = next.slice(0, CALC_DIGITS_MAX);
      return c;
    }

    if (CALC_OPS.indexOf(k) >= 0) {
      if (c.op && c.acc !== null && c.cur !== "") {
        const r = calcApply(c.acc, c.op, Number(c.cur));
        if (r === null) { c.error = "0では割れません"; return c; }
        c.acc = r;
      } else {
        c.acc = calcEntry(c);
      }
      c.cur = "";
      c.op = k;
      c.done = false;
      c.expr = calcFmt(c.acc) + " " + CALC_OP_LABEL[k];
      return c;
    }

    if (k === "=") {
      if (!c.op || c.acc === null) return c;          // 計算するものが無い
      const b = c.cur === "" ? c.acc : Number(c.cur);
      const r = calcApply(c.acc, c.op, b);
      if (r === null) { c.error = "0では割れません"; return c; }
      c.expr = calcFmt(c.acc) + " " + CALC_OP_LABEL[c.op] + " " + calcFmt(b) + " ＝";
      c.acc = null;
      c.op = "";
      c.cur = String(r);
      c.done = true;
      return c;
    }

    return c;                                          // 知らないキーは何もしない
  }

  /* =======================================================================
     関数電卓
     -----------------------------------------------------------------------
     押したキーを「字」の並び（tokens）としてためて、＝ のときだけ計算する。
     eval は使わない。字を式に組み直して、逆ポーランド記法へ並べ替えてから解く。

     状態： { tokens, result, expr, error, ans, deg, history }
       tokens … 押した順の字の並び（"1" "+" "sin(" など）
       result … ＝ を押した答え（まだなら null）
       deg    … 三角関数を度で計算する（false なら弧度）
     ======================================================================= */

  const SCI_TOKENS_MAX = 120;      // 1つの式に入れられる字数
  const SCI_HISTORY_MAX = 30;      // 残しておく計算の数
  const SCI_DIGITS = 10;           // 答えの有効桁数

  /* 関数のキー。押すと、開きかっこも一緒に置いたことになる。 */
  const SCI_FUNCS = { sin: "sin", cos: "cos", tan: "tan", log: "log", ln: "ln", "√": "sqrt" };
  const SCI_CONSTS = { "π": Math.PI, "e": Math.E };
  const SCI_OPS = {
    "+": { prec: 1, right: false },
    "-": { prec: 1, right: false },
    "*": { prec: 2, right: false },
    "/": { prec: 2, right: false },
    "^": { prec: 4, right: true },
  };
  const SCI_UNARY_PREC = 3;        // −2^2 は −(2^2) になる

  function newSci() {
    return { tokens: [], result: null, error: "", ans: 0, deg: true, history: [] };
  }

  function isSciDigit(t) { return /^[0-9.]$/.test(t); }

  /* 画面に出す式の文字列。関数のうしろには開きかっこを見せる。 */
  function sciExpr(sci) {
    return ((sci && sci.tokens) || []).map(function (t) {
      return SCI_FUNCS[t] ? t + "(" : t;
    }).join("");
  }

  /* 答えの見せかた。長すぎる小数は丸め、末尾の0は落とす。 */
  function sciFormat(n) {
    if (!Number.isFinite(n)) return "";
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
    const r = Number(n.toPrecision(SCI_DIGITS));
    if (Math.abs(r) >= 1e15 || (r !== 0 && Math.abs(r) < 1e-9)) return r.toExponential(6);
    return String(r);
  }

  /* 字の並びを、数・関数・記号の並びへ組み直す。掛ける記号の省略もここで補う。 */
  function sciTokenize(tokens, ans) {
    const out = [];
    let num = "";
    const pushNum = function () {
      if (num === "") return true;
      if ((num.match(/\./g) || []).length > 1) return false;
      if (num === ".") return false;
      out.push({ t: "num", v: Number(num) });
      num = "";
      return true;
    };
    /* 直前が「値」なら、次に値や関数が来たとき掛け算を補う */
    const needsTimes = function (next) {
      const last = out[out.length - 1];
      if (!last) return false;
      const lastIsValue = last.t === "num" || last.t === "rparen";
      const nextIsValue = next === "num" || next === "func" || next === "lparen";
      return lastIsValue && nextIsValue;
    };

    for (const tk of tokens) {
      if (isSciDigit(tk)) {
        if (num === "" && needsTimes("num")) out.push({ t: "op", v: "*" });
        num += tk;
        continue;
      }
      if (!pushNum()) return null;

      if (SCI_FUNCS[tk]) {
        if (needsTimes("func")) out.push({ t: "op", v: "*" });
        out.push({ t: "func", v: SCI_FUNCS[tk] });
        out.push({ t: "lparen" });
      } else if (Object.prototype.hasOwnProperty.call(SCI_CONSTS, tk)) {
        if (needsTimes("num")) out.push({ t: "op", v: "*" });
        out.push({ t: "num", v: SCI_CONSTS[tk] });
      } else if (tk === "Ans") {
        if (needsTimes("num")) out.push({ t: "op", v: "*" });
        out.push({ t: "num", v: Number(ans) || 0 });
      } else if (tk === "(") {
        if (needsTimes("lparen")) out.push({ t: "op", v: "*" });
        out.push({ t: "lparen" });
      } else if (tk === ")") {
        out.push({ t: "rparen" });
      } else if (SCI_OPS[tk]) {
        out.push({ t: "op", v: tk });
      } else {
        return null;
      }
    }
    return pushNum() ? out : null;
  }

  /* 逆ポーランド記法へ並べ替える（操車場アルゴリズム） */
  function sciToRpn(list) {
    const out = [], stack = [];
    let prev = null;
    for (const tk of list) {
      if (tk.t === "num") { out.push(tk); }
      else if (tk.t === "func") { stack.push(tk); }
      else if (tk.t === "op") {
        /* 式の頭・記号の直後・( の直後の「−」は、符号のマイナス */
        const unary = (tk.v === "-" || tk.v === "+")
          && (prev === null || prev.t === "op" || prev.t === "lparen" || prev.t === "unary");
        if (unary) {
          stack.push({ t: "unary", v: tk.v });
          prev = { t: "unary" };
          continue;
        }
        while (stack.length) {
          const top = stack[stack.length - 1];
          const topPrec = top.t === "unary" ? SCI_UNARY_PREC : (top.t === "func" ? 9 : (SCI_OPS[top.v] || {}).prec);
          if (top.t === "lparen" || topPrec === undefined) break;
          const me = SCI_OPS[tk.v];
          if (topPrec > me.prec || (topPrec === me.prec && !me.right)) out.push(stack.pop());
          else break;
        }
        stack.push(tk);
      }
      else if (tk.t === "lparen") { stack.push(tk); }
      else if (tk.t === "rparen") {
        let found = false;
        while (stack.length) {
          const top = stack.pop();
          if (top.t === "lparen") { found = true; break; }
          out.push(top);
        }
        if (!found) return null;
        if (stack.length && stack[stack.length - 1].t === "func") out.push(stack.pop());
      }
      prev = tk;
    }
    while (stack.length) {
      const top = stack.pop();
      if (top.t === "lparen") return null;
      out.push(top);
    }
    return out;
  }

  function sciCallFunc(name, x, deg) {
    const a = deg ? (x * Math.PI) / 180 : x;
    if (name === "sin") return Math.sin(a);
    if (name === "cos") return Math.cos(a);
    if (name === "tan") return Math.tan(a);
    if (name === "log") return x > 0 ? Math.log10(x) : NaN;
    if (name === "ln") return x > 0 ? Math.log(x) : NaN;
    if (name === "sqrt") return x >= 0 ? Math.sqrt(x) : NaN;
    return NaN;
  }

  function sciRunRpn(rpn, deg) {
    const st = [];
    for (const tk of rpn) {
      if (tk.t === "num") { st.push(tk.v); continue; }
      if (tk.t === "unary") {
        if (!st.length) return null;
        st.push(tk.v === "-" ? -st.pop() : st.pop());
        continue;
      }
      if (tk.t === "func") {
        if (!st.length) return null;
        st.push(sciCallFunc(tk.v, st.pop(), deg));
        continue;
      }
      if (tk.t === "op") {
        if (st.length < 2) return null;
        const b = st.pop(), a = st.pop();
        if (tk.v === "+") st.push(a + b);
        else if (tk.v === "-") st.push(a - b);
        else if (tk.v === "*") st.push(a * b);
        else if (tk.v === "/") { if (b === 0) return { divZero: true }; st.push(a / b); }
        else if (tk.v === "^") st.push(Math.pow(a, b));
        continue;
      }
      return null;
    }
    return st.length === 1 ? { value: st[0] } : null;
  }

  /* 式をひとつ解く。答えか、理由つきの失敗を返す。 */
  function sciEvaluate(tokens, opts) {
    const o = opts || {};
    if (!Array.isArray(tokens) || !tokens.length) return { ok: false, error: "" };
    const list = sciTokenize(tokens, o.ans || 0);
    if (!list) return { ok: false, error: "式が正しくありません" };
    const rpn = sciToRpn(list);
    if (!rpn) return { ok: false, error: "かっこが合っていません" };
    const r = sciRunRpn(rpn, o.deg !== false);
    if (!r) return { ok: false, error: "式が正しくありません" };
    if (r.divZero) return { ok: false, error: "0では割れません" };
    if (!Number.isFinite(r.value)) return { ok: false, error: "計算できません" };
    return { ok: true, value: r.value };
  }

  /* キーを1つ押した結果を返す。元の状態は変えない。 */
  function sciPress(state, key) {
    const s = Object.assign(newSci(), state || {});
    s.tokens = (s.tokens || []).slice();
    s.history = (s.history || []).slice();
    s.error = "";
    const k = String(key);

    if (k === "AC") { const keep = { ans: s.ans, deg: s.deg, history: s.history }; return Object.assign(newSci(), keep); }
    if (k === "deg") { s.deg = !s.deg; return s; }

    if (k === "DEL") {
      if (s.result !== null) { s.result = null; return s; }
      s.tokens.pop();
      return s;
    }

    if (k === "=") {
      const r = sciEvaluate(s.tokens, { ans: s.ans, deg: s.deg });
      if (!r.ok) { s.error = r.error; return s; }
      s.result = r.value;
      s.ans = r.value;
      s.history = [{ expr: sciExpr(s), value: r.value }].concat(s.history).slice(0, SCI_HISTORY_MAX);
      return s;
    }

    /* 答えを出したあとに数字や関数を押したら、新しい式として打ち直す */
    const isValueKey = isSciDigit(k) || SCI_FUNCS[k] || Object.prototype.hasOwnProperty.call(SCI_CONSTS, k) || k === "(" || k === "Ans";
    if (s.result !== null) {
      if (isValueKey) { s.tokens = []; }
      else { s.tokens = String(sciFormat(s.result)).split(""); }
      s.result = null;
    }

    if (s.tokens.length >= SCI_TOKENS_MAX) { s.error = "式が長すぎます"; return s; }
    if (!isSciDigit(k) && !SCI_FUNCS[k] && !SCI_OPS[k] && k !== "(" && k !== ")"
        && !Object.prototype.hasOwnProperty.call(SCI_CONSTS, k) && k !== "Ans") return s;
    s.tokens.push(k);
    return s;
  }

  /* 端末に保存してある履歴を、安全な形に整えて読み込む */
  function normalizeSciHistory(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (h) {
      if (!h || typeof h !== "object") return null;
      const expr = String(h.expr == null ? "" : h.expr).slice(0, SCI_TOKENS_MAX * 4);
      const value = Number(h.value);
      if (expr === "" || !Number.isFinite(value)) return null;
      return { expr: expr, value: value };
    }).filter(Boolean).slice(0, SCI_HISTORY_MAX);
  }

  /* 履歴を消す */
  function sciClearHistory(state) {
    const s = Object.assign(newSci(), state || {});
    s.history = [];
    return s;
  }

  /* 家計簿に渡せる金額かどうか（0より大きい整数だけ） */
  function sciAmount(sci) {
    const v = sci && sci.result;
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    const n = Math.round(v);
    return n > 0 && Math.abs(v - n) < 1e-9 ? n : null;
  }

  /* =======================================================================
     予定（スケジュール）
     -----------------------------------------------------------------------
     日付ごとに何件でも持てる。時刻は任意（"14:00" か 空文字）。
     { "2026-08-03": [ { id, time, text, done } ] }

     日記が「あったこと」、予定が「これからのこと」。
     お金の計算にはいっさい関わらない（computeMonth は tx しか見ない）。
     ======================================================================= */

  const PLAN_TEXT_MAX = 60;      // 予定1件の文字数
  const PLAN_PER_DAY_MAX = 20;   // 1日に入れられる予定の数
  const PLAN_SHOW_MAX = 3;       // ホームに出す「今日の予定」の上限
  const PLAN_HOME_MAX = 20;      // ホームの「今月の予定」に出す行数の上限

  /* "14:00" のような時刻だけを通す。空文字（時刻なし）も正しい値。 */
  function normalizeTimeString(v) {
    const s = String(v == null ? "" : v).trim();
    if (s === "") return "";
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return "";
    const h = Number(m[1]), mi = Number(m[2]);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return "";
    return String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
  }

  /* 予定1件を安全な形に整える。中身が無いものは残さない。 */
  function normalizePlanEntry(raw, i) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const text = String(raw.text == null ? "" : raw.text).slice(0, PLAN_TEXT_MAX);
    if (text.trim() === "") return null;
    return {
      id: String(raw.id || ("p" + i + "-" + Math.random().toString(36).slice(2, 8))),
      time: normalizeTimeString(raw.time),
      text: text,
      done: raw.done === true,
    };
  }

  /* 時刻の早い順。時刻を入れていないものは、その日の最後に置く。 */
  function sortPlans(list) {
    return (Array.isArray(list) ? list.slice() : []).sort(function (a, b) {
      const at = a.time || "99:99", bt = b.time || "99:99";
      if (at !== bt) return at < bt ? -1 : 1;
      return 0;
    });
  }

  function normalizePlans(plans) {
    const out = {};
    if (!plans || typeof plans !== "object" || Array.isArray(plans)) return out;
    Object.keys(plans).forEach(function (date) {
      if (!validateDateString(date)) return;
      const list = (Array.isArray(plans[date]) ? plans[date] : [])
        .slice(0, PLAN_PER_DAY_MAX)
        .map(normalizePlanEntry)
        .filter(Boolean);
      if (list.length) out[date] = sortPlans(list);
    });
    return out;
  }

  /* その日の予定（時刻の早い順） */
  function dayPlans(state, date) {
    const st = state || {};
    return sortPlans(((st.plans || {})[date] || []).map(normalizePlanEntry).filter(Boolean));
  }

  /* 今日の、まだ済んでいない予定 */
  function todayPlans(state, today) {
    if (!validateDateString(today)) return [];
    return dayPlans(state, today).filter(function (p) { return !p.done; });
  }

  /* 一覧用：今日より後ろの予定を、日付の早い順に返す */
  function upcomingPlans(state, today, limit) {
    const st = state || {};
    const max = Math.max(1, Math.floor(Number(limit) || 20));
    const out = [];
    Object.keys(st.plans || {}).sort().forEach(function (date) {
      if (!validateDateString(date) || date < today) return;
      dayPlans(st, date).forEach(function (p) { out.push({ date: date, plan: p }); });
    });
    return out.slice(0, max);
  }

  /* 一覧用：暦の月（1日〜月末）の予定を、日付ごとにまとめて早い順に返す。
     済んだ予定も残す（画面ではグレーで出す）。
     月の区切り（給料日起点）は使わない。カレンダー画面と同じ暦の月で見る。 */
  function monthPlans(state, ym) {
    const st = state || {};
    const days = [];
    let total = 0, done = 0;
    Object.keys(st.plans || {}).sort().forEach(function (date) {
      if (!validateDateString(date) || monthOf(date) !== ym) return;
      const list = dayPlans(st, date);
      if (!list.length) return;
      total += list.length;
      done += list.filter(function (p) { return p.done; }).length;
      days.push({ date: date, plans: list });
    });
    return { ym: ym, days: days, total: total, done: done, left: total - done };
  }



  /* =======================================================================
     カレンダー用：ある1日の全データ（支出・収入・日記・健康）をまとめる
     ======================================================================= */
  function dayDetail(state, date) {
    const st = state || {};
    const txs = (Array.isArray(st.tx) ? st.tx : []).filter(function (t) { return t && t.date === date; });
    const expense = txs.filter(function (t) { return t.type === "expense"; });
    const income = txs.filter(function (t) { return t.type === "income"; });
    const sum = function (a) { return a.reduce(function (s, t) { return s + (Number(t.amount) || 0); }, 0); };
    const dEntry = (st.diary || {})[date] || null;
    const hEntry = (st.health || {})[date] || null;
    return {
      date: date,
      expense: expense, income: income,
      expenseTotal: sum(expense), incomeTotal: sum(income),
      diary: dEntry ? { text: dEntry.text || (typeof dEntry === "string" ? dEntry : ""), photo: (dEntry && dEntry.photo) || null } : null,
      health: hEntry || null,
      plans: dayPlans(st, date),
      hasAny: !!(txs.length || dEntry || hEntry || dayPlans(st, date).length),
    };
  }

  /* その月のうち、何か記録がある日付の集合を返す（カレンダーの印つけ用） */
  function monthMarks(state, ym) {
    const st = state || {};
    const marks = {};
    (Array.isArray(st.tx) ? st.tx : []).forEach(function (t) {
      if (t && typeof t.date === "string" && t.date.slice(0, 7) === ym) {
        marks[t.date] = marks[t.date] || {};
        marks[t.date][t.type === "income" ? "income" : "expense"] = true;
      }
    });
    Object.keys(st.diary || {}).forEach(function (d) { if (d.slice(0, 7) === ym) { marks[d] = marks[d] || {}; marks[d].diary = true; } });
    Object.keys(st.health || {}).forEach(function (d) { if (d.slice(0, 7) === ym) { marks[d] = marks[d] || {}; marks[d].health = true; } });
    Object.keys(st.plans || {}).forEach(function (d) {
      if (d.slice(0, 7) === ym && dayPlans(st, d).length) { marks[d] = marks[d] || {}; marks[d].plan = true; }
    });
    return marks;
  }


  /* =======================================================================
     まとめの円グラフ用：収入を100%として、支出・先取り・のこりの割合を返す
     ======================================================================= */
  function budgetBreakdown(c) {
    const income = Math.max(0, Number(c && c.incomeTotal) || 0);
    const spend = Math.max(0, Number(c && c.spendTotal) || 0);
    const setAside = Math.max(0, Number(c && c.setAside) || 0);
    const remain = Math.max(0, income - spend - setAside);   // のこり（マイナスは0扱い）
    const over = Math.max(0, spend + setAside - income);     // 使いすぎ分（収入を超えた分）
    const base = income > 0 ? income : (spend + setAside);   // 収入0なら支出+先取りを基準に
    const pct = function (v) { return base > 0 ? Math.round((v / base) * 100) : 0; };
    const parts = [
      { key: "spend",    name: "支出",   amount: spend,    color: "#c2694f", pct: pct(spend) },
      { key: "setAside", name: "先取り", amount: setAside, color: "#7f9cc0", pct: pct(setAside) },
      { key: "remain",   name: "のこり", amount: remain,   color: "#6f9c78", pct: pct(remain) },
    ];
    return { income: income, base: base, over: over, parts: parts };
  }

  /* =======================================================================
     詳細分析（まとめ画面の「分析」タブ）
     -----------------------------------------------------------------------
     ここでも金額の式は書かない。月の合計は必ず computeMonth() から取る。
     すべて純粋関数：UIに依存せず、時計も読まない。
     「今日」は引数で受け取る（テストで固定できるようにするため）。
     ======================================================================= */

  const TREND_MONTHS = 6;     // 推移グラフに出す月数
  const COMPARE_MONTHS = 3;   // 平均を出すのに使う「過去」の月数（当月は含めない）
  const WEEKDAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

  /* 金額の表し方（画面と同じ「¥1,234」）。気づきの文章づくりに使う。 */
  function fmtYen(v) {
    return "¥" + Math.round(Number(v) || 0).toLocaleString("en-US");
  }

  /* "YYYY-MM" を delta か月ずらす */
  function shiftYm(ym, delta) {
    const y = Number(String(ym).slice(0, 4));
    const m = Number(String(ym).slice(5, 7));
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return String(ym);
    const t = y * 12 + (m - 1) + (Number(delta) || 0);
    const ny = Math.floor(t / 12);
    const nm = t - ny * 12 + 1;
    return String(ny).padStart(4, "0") + "-" + String(nm).padStart(2, "0");
  }

  /* 直近 n か月を古い順に返す（最後が ym） */
  function recentMonths(ym, n) {
    const count = Math.max(1, Math.min(24, Math.floor(Number(n) || 1)));
    const out = [];
    for (let i = count - 1; i >= 0; i--) out.push(shiftYm(ym, -i));
    return out;
  }

  /* その月の日数（月末日） */
  function daysInMonth(ym) {
    const y = Number(String(ym).slice(0, 4));
    const m = Number(String(ym).slice(5, 7));
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return 30;
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  /* ---------- 月ごとの推移 ---------- */
  /* 金額は computeMonth() の結果だけを読む（式をここで書き直さない）。
     先取り（予定額）は「今の設定」なので過去の月には当てはめない。
     そのため推移で見せるのは 収入・支出・その差だけにする。 */
  function monthlyTrend(settings, txs, ym, n) {
    return recentMonths(ym, n || TREND_MONTHS).map(function (m) {
      const c = computeMonth(settings, txs, m);
      return {
        ym: m,
        label: String(Number(m.slice(5, 7))) + "月",
        income: c.incomeTotal,
        spend: c.spendTotal,
        net: c.incomeTotal - c.spendTotal,
        hasRecord: c.incomeTotal > 0 || c.spendTotal > 0,
      };
    });
  }

  /* ---------- カテゴリ別の支出 ---------- */
  function categorySpend(txs, ym, startDay) {
    const out = {};
    (Array.isArray(txs) ? txs : []).forEach(function (t) {
      if (!t || t.type !== "expense" || cycleOf(t.date, startDay) !== ym) return;
      out[t.cat] = (out[t.cat] || 0) + num(t.amount);
    });
    return out;
  }

  /* 当月・前月・過去n か月の平均をカテゴリごとに並べる。
     平均は「記録のあった月」だけで割る（使いはじめの月に薄まらないように）。 */
  function categoryCompare(txs, ym, n, startDay) {
    const back = Math.max(1, Math.floor(Number(n) || COMPARE_MONTHS));
    const pastYms = recentMonths(shiftYm(ym, -1), back);      // 当月は含めない
    const now = categorySpend(txs, ym, startDay);
    const prev = categorySpend(txs, shiftYm(ym, -1), startDay);
    const past = pastYms.map(function (m) { return categorySpend(txs, m, startDay); });
    const activeMonths = past.filter(function (map) {
      return Object.keys(map).some(function (k) { return map[k] > 0; });
    }).length;

    const keys = {};
    [now, prev].concat(past).forEach(function (map) {
      Object.keys(map).forEach(function (k) { if (map[k] > 0) keys[k] = true; });
    });
    const nowTotal = Object.keys(now).reduce(function (a, k) { return a + now[k]; }, 0);

    return Object.keys(keys).map(function (k) {
      const cat = catOf("expense", k);
      const sumPast = past.reduce(function (a, map) { return a + (map[k] || 0); }, 0);
      return {
        key: k,
        name: cat.n,
        emoji: cat.e,
        now: now[k] || 0,
        prev: prev[k] || 0,
        avg: activeMonths > 0 ? Math.round(sumPast / activeMonths) : null,
        diff: (now[k] || 0) - (prev[k] || 0),
        share: nowTotal > 0 ? Math.round(((now[k] || 0) / nowTotal) * 100) : 0,
      };
    }).sort(function (a, b) { return b.now - a.now || b.prev - a.prev; });
  }

  /* ---------- 曜日ぐせ ---------- */
  /* 日付はUTC固定で読む。端末のタイムゾーンで曜日がずれないようにするため。 */
  function weekdaySpend(txs, ym, startDay) {
    const rows = WEEKDAY_NAMES.map(function (n, i) {
      return { dow: i, name: n, amount: 0, count: 0 };
    });
    (Array.isArray(txs) ? txs : []).forEach(function (t) {
      if (!t || t.type !== "expense" || cycleOf(t.date, startDay) !== ym) return;
      if (!validateDateString(t.date)) return;
      const d = new Date(t.date + "T00:00:00Z");
      const row = rows[d.getUTCDay()];
      row.amount += num(t.amount);
      row.count += 1;
    });
    return rows;
  }

  /* ---------- 使うペース ---------- */
  /* today は "YYYY-MM-DD"。当月なら経過日数までで見る。
     過去の月（today が別の月）は、その月をまるごと見る。 */
  function spendPace(settings, txs, ym, today) {
    const c = computeMonth(settings, txs, ym);
    const startDay = c.cycleStart;
    /* 日にちは「区切りの何日目か」で数える。起点が1日なら、そのまま暦の日と同じ。 */
    const days = c.periodDays;
    const isCurrent = validateDateString(today) && cycleOf(today, startDay) === ym;
    const elapsed = isCurrent ? Math.min(days, cycleDayIndex(today, ym, startDay)) : days;

    const perDayAmount = [];
    for (let i = 0; i <= days; i++) perDayAmount.push(0);
    (Array.isArray(txs) ? txs : []).forEach(function (t) {
      if (!t || t.type !== "expense" || cycleOf(t.date, startDay) !== ym) return;
      const d = cycleDayIndex(t.date, ym, startDay);
      if (d >= 1 && d <= days) perDayAmount[d] += num(t.amount);
    });

    /* 毎月固定と、それ以外を日ごとに分けて持つ */
    const perDayRecurring = [];
    for (let i = 0; i <= days; i++) perDayRecurring.push(0);
    (Array.isArray(txs) ? txs : []).forEach(function (t) {
      if (!isRecurring(t) || cycleOf(t.date, startDay) !== ym) return;
      const d = cycleDayIndex(t.date, ym, startDay);
      if (d >= 1 && d <= days) perDayRecurring[d] += num(t.amount);
    });

    const daily = [];
    let cum = 0, noSpend = 0, spendDays = 0, recurringSoFar = 0;
    for (let d = 1; d <= elapsed; d++) {
      cum += perDayAmount[d];
      recurringSoFar += perDayRecurring[d];
      daily.push({ day: d, amount: perDayAmount[d], cum: cum });
      if (perDayAmount[d] > 0) spendDays += 1; else noSpend += 1;
    }
    /* ペースの計算は「経過日数までに記録した分」で見る。
       月の後ろの方に日付を入れた記録を、まだ使ったことにしないため。 */
    const spentSoFar = cum;
    const spotSoFar = spentSoFar - recurringSoFar;

    /* つかってよい額 ＝ 収入 － 先取り（予定額）。ホームの式と同じ形。 */
    const budget = c.incomeTotal - c.setAside;
    const perDay = elapsed > 0 ? Math.round(spentSoFar / elapsed) : 0;
    /* 毎月固定（家賃など）は月に1回まとめて出ていくので、日割りにすると
       月初だけ予測が跳ね上がる。固定は実績のまま置き、それ以外だけを日割りする。
       印を1つも付けていない場合は recurringSoFar が0なので、これまでと同じ式になる。 */
    const forecast = elapsed > 0
      ? recurringSoFar + Math.round((spotSoFar / elapsed) * days) : 0;

    return {
      ym: ym,
      days: days,
      elapsed: elapsed,
      isCurrent: isCurrent,
      periodFrom: c.periodFrom,
      periodTo: c.periodTo,
      periodLabel: c.periodLabel,
      daily: daily,
      spendTotal: c.spendTotal,       // 当月ぜんぶ（未来の日付の記録も含む）
      spentSoFar: spentSoFar,         // 経過日数までに記録した分
      recurringSoFar: recurringSoFar, // うち「毎月固定」
      spotSoFar: spotSoFar,           // それ以外
      hasIncome: c.hasIncome,
      budget: budget,
      budgetPerDay: budget > 0 ? Math.round(budget / days) : 0,
      perDay: perDay,
      forecast: forecast,
      /* 予測が予算をいくら超えそうか（マイナスなら のこりそうな額）。収入未記録なら null */
      over: c.hasIncome ? forecast - budget : null,
      spendDays: spendDays,
      noSpendDays: noSpend,
    };
  }

  /* ---------- 気づき（ことばにする） ---------- */
  /* level: "good" ほめる ／ "warn" 気をつける ／ "info" ただの事実 */
  function analysisInsights(a) {
    const out = [];
    const pace = a.pace, cats = a.cats || [];

    if (!pace.hasIncome) {
      out.push({ level: "info", key: "no-income",
        text: "給料をまだ記録していません。記録すると、使いすぎのペースが分かります" });
    } else if (pace.spendTotal > 0 && pace.budget > 0 && pace.isCurrent) {
      if (pace.over > 0) {
        out.push({ level: "warn", key: "pace",
          text: "このペースだと月末に " + fmtYen(pace.forecast) + "。つかってよい "
            + fmtYen(pace.budget) + " を " + fmtYen(pace.over) + " こえそうです" });
      } else {
        out.push({ level: "good", key: "pace",
          text: "このペースなら月末に " + fmtYen(pace.forecast) + "。"
            + fmtYen(-pace.over) + " のこりそうです" });
      }
    }

    const spent = cats.filter(function (c) { return c.now > 0; });
    const up = cats.slice().sort(function (x, y) { return y.diff - x.diff; })[0];
    if (up && up.diff > 0 && up.prev > 0) {
      out.push({ level: "warn", key: "up",
        text: up.emoji + " " + up.name + " が先月より " + fmtYen(up.diff) + " ふえています" });
    }
    if (spent.length) {
      out.push({ level: "info", key: "top",
        text: "いちばん多いのは " + spent[0].emoji + " " + spent[0].name + " の "
          + fmtYen(spent[0].now) + "（支出の " + spent[0].share + "%）" });
    }
    const down = cats.slice().sort(function (x, y) { return x.diff - y.diff; })[0];
    if (down && down.diff < 0 && down.prev > 0) {
      out.push({ level: "good", key: "down",
        text: down.emoji + " " + down.name + " は先月より " + fmtYen(-down.diff) + " へっています" });
    }
    if (pace.noSpendDays > 0 && pace.spendTotal > 0) {
      out.push({ level: "good", key: "no-spend",
        text: "今月は " + pace.noSpendDays + "日、1円もつかいませんでした" });
    }
    if (pace.recurringSoFar > 0 && pace.spentSoFar > 0) {
      out.push({ level: "info", key: "recurring",
        text: "毎月かかるお金は " + fmtYen(pace.recurringSoFar)
          + "（支出の " + Math.round((pace.recurringSoFar / pace.spentSoFar) * 100) + "%）" });
    }
    const busiest = (a.week || []).slice().sort(function (x, y) { return y.amount - x.amount; })[0];
    if (busiest && busiest.amount > 0) {
      out.push({ level: "info", key: "weekday",
        text: "よくつかうのは " + busiest.name + "曜（合計 " + fmtYen(busiest.amount) + "）" });
    }
    return out.slice(0, 5);
  }

  /* ---------- 分析ぜんぶ（画面はこれだけを読む） ---------- */
  function analyzeMonth(settings, txs, ym, opts) {
    const o = opts || {};
    const startDay = normalizeSettings(settings).cycleStart;
    const out = {
      ym: ym,
      month: computeMonth(settings, txs, ym),
      trend: monthlyTrend(settings, txs, ym, o.trendMonths || TREND_MONTHS),
      cats: categoryCompare(txs, ym, o.compareMonths || COMPARE_MONTHS, startDay),
      week: weekdaySpend(txs, ym, startDay),
      pace: spendPace(settings, txs, ym, o.today || null),
    };
    out.insights = analysisInsights(out);
    return out;
  }

  /* =======================================================================
     先月の「🔁 毎月固定」を今月へ写す（下ごしらえ）
     -----------------------------------------------------------------------
     家賃や保険のように毎月まったく同じものを、打ち直さずに済ませるため。
     ここは純粋関数で「何を入れるか」を決めるだけ。実際の追加は画面側が行う。

     二重計上を防ぐ決めごと：
       今月にすでに同じカテゴリの🔁がある項目は入れない（already の印を付ける）。
       金額がちがっても入れない。電気代のように額が変わるものを
       2件に増やすより、1件を直してもらうほうが安全なため。
     ======================================================================= */
  function recurringCarryPlan(txs, ym, startDay) {
    const all = Array.isArray(txs) ? txs : [];
    const prevYm = shiftYm(ym, -1);

    const prev = all.filter(function (t) {
      return isRecurring(t) && cycleOf(t.date, startDay) === prevYm;
    });
    /* すでに今月に入っている🔁のカテゴリ */
    const done = {};
    all.forEach(function (t) {
      if (isRecurring(t) && cycleOf(t.date, startDay) === ym) done[t.cat] = true;
    });

    const items = prev.map(function (t) {
      const cat = catOf("expense", t.cat);
      /* 「毎月◯日」をそろえる。無い日は月末へ丸め、区切りからはみ出す日は端へ寄せる。 */
      const date = dateInCycle(ym, startDay, Number(String(t.date).slice(8, 10)));
      return {
        cat: t.cat,
        name: cat.n,
        emoji: cat.e,
        amount: num(t.amount),
        memo: String(t.memo || "").slice(0, MEMO_MAX),
        date: date,
        already: done[t.cat] === true,
      };
    }).sort(function (a, b) { return b.amount - a.amount; });

    const toAdd = items.filter(function (i) { return !i.already; });
    return {
      ym: ym,
      from: prevYm,
      items: items,
      toAdd: toAdd,
      skipped: items.length - toAdd.length,
      total: sum(toAdd, function (i) { return i.amount; }),
    };
  }

  /* =======================================================================
     今日やることカード（ホームの上に出る、最大2件のうながし）
     -----------------------------------------------------------------------
     方針：**やることを増やさない**。
       ・出すのは最大2件。多いと重荷になって、アプリ自体を閉じてしまう
       ・「まだ使っていない機能」は催促しない。
         給料は先月までに記録した日を過ぎてから、日記・健康は
         続けている人にだけ声をかける
       ・済んだ項目は自動で消える（チェックを付ける操作は要らない）
     すべて純粋関数。「今日」は引数で受け取る。
     ======================================================================= */

  const TASK_MAX = 2;            // 一度に出すやることの上限
  const TASK_QUIET_DAYS = 3;     // 支出の記録が何日とだえたら声をかけるか
  const HABIT_WINDOW = 14;       // 習慣とみなすために見る日数
  const HABIT_MIN = 3;           // その中で何日つけていれば習慣とみなすか

  /* 2つの日付が何日はなれているか（UTC固定。端末のタイムゾーンで狂わせない） */
  function daysApart(fromIso, toIso) {
    const a = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
    const b = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
    return Math.round((b - a) / 86400000);
  }

  /* 日付をずらす（"YYYY-MM-DD"） */
  function shiftDate(iso, delta) {
    const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + Number(delta || 0)));
    return d.toISOString().slice(0, 10);
  }

  /* 先月までに通常給与を記録した「日」。無ければ null（はじめての人は催促しない）。 */
  function salaryDayHint(txs, ym, startDay) {
    const past = (Array.isArray(txs) ? txs : []).filter(function (t) {
      return t && t.type === "income" && t.cat === REGULAR_INCOME_CAT
        && validateDateString(t.date) && cycleOf(t.date, startDay) < ym;
    }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return past.length ? Number(past[0].date.slice(8, 10)) : null;
  }

  /* 今日より前で、最後に支出を記録した日。無ければ null。
     まだ来ていない日付の記録は「最後の記録」に数えない。 */
  function lastExpenseDate(txs, today) {
    const past = (Array.isArray(txs) ? txs : []).filter(function (t) {
      return t && t.type === "expense" && validateDateString(t.date) && t.date <= today;
    }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return past.length ? past[0].date : null;
  }

  /* 続けている習慣か（今日を除く直近 HABIT_WINDOW 日のうち HABIT_MIN 日以上ついている） */
  function isHabit(map, today) {
    const m = map || {};
    const from = shiftDate(today, -HABIT_WINDOW);
    let n = 0;
    Object.keys(m).forEach(function (d) {
      if (d >= from && d < today) n += 1;
    });
    return n >= HABIT_MIN;
  }

  /* やることを組み立てる（優先度の高い順） */
  function todayTasks(state, today) {
    const st = state || {};
    if (!validateDateString(today)) return [];
    const txs = Array.isArray(st.tx) ? st.tx : [];
    const startDay = normalizeSettings(st.settings).cycleStart;
    const ym = cycleOf(today, startDay);
    const out = [];

    /* 1. 先月の「毎月固定」がまだ入っていない（金額に効くので最優先） */
    const plan = recurringCarryPlan(txs, ym, startDay);
    if (plan.toAdd.length > 0) {
      out.push({
        key: "carry", icon: "🔁", act: "carry",
        text: "先月の毎月固定が " + plan.toAdd.length + "件、まだ入っていません",
        sub: "まとめて入れられます（合計 " + fmtYen(plan.total) + "）",
      });
    }

    /* 2. 今月の給料がまだ。ただし、先月までに記録した給料日を過ぎてから。
          はじめて使う人（履歴が無い人）には催促しない。 */
    const c = computeMonth(st.settings, txs, ym);
    if (!c.incomeRegularRecorded) {
      const hint = salaryDayHint(txs, ym, startDay);
      if (hint !== null && today >= dateInCycle(ym, startDay, hint)) {
        out.push({
          key: "salary", icon: "💴", act: "salary",
          text: "今月の給料が、まだ記録されていません",
          sub: "記録すると「あと つかえるお金」が出ます",
        });
      }
    }

    /* 3. 支出の記録がとだえている。1件も記録が無い人には出さない。 */
    const last = lastExpenseDate(txs, today);
    if (last) {
      const gap = daysApart(last, today);
      if (gap >= TASK_QUIET_DAYS) {
        out.push({
          key: "quiet", icon: "🧾", act: "record",
          text: gap + "日、支出の記録がありません",
          sub: "レシートが手元にあれば、いまのうちに",
        });
      }
    }

    /* 4. 続けている習慣が、今日はまだ。続けていない人には出さない。 */
    if (isHabit(st.diary, today) && !(st.diary || {})[today]) {
      out.push({
        key: "diary", icon: "📖", act: "diary",
        text: "今日の日記が、まだです", sub: "ひとことでも大丈夫です",
      });
    }
    if (isHabit(st.health, today) && !(st.health || {})[today]) {
      out.push({
        key: "health", icon: "❤️", act: "health",
        text: "今日の体重・血圧が、まだです", sub: "1日1件で、あとから直せます",
      });
    }

    return out.slice(0, TASK_MAX);
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
      schema_version: "2.2",
      country_code: "JP",
      base_currency: c.currency,
      year_month: ym,
      /* 月の区切り。起点が1日なら period_from/to はその月の1日と末日になる。 */
      cycle_start_day: c.cycleStart,
      period_from: c.periodFrom,
      period_to: c.periodTo,

      /* 収入：通常／臨時／当月実収入合計を分けて出力（すべて記録の実績） */
      income_regular: c.incomeRegular,
      income_regular_basis: "actual",
      income_regular_recorded: c.incomeRegularRecorded,
      income_extra: c.incomeExtra,
      income_actual_total: c.incomeTotal,
      /* 後方互換。旧 income_net は「当月の実収入合計」を指す */
      income_net: c.incomeTotal,

      /* 支出：すべて記録した実績。
         fixed_cost … 「🔁 毎月固定」の印が付いた記録の合計（印が無ければ0）
         variable_spend … それ以外
         どちらも足すと spend_total になる。 */
      fixed_cost: c.recurringSpend,
      fixed_cost_items: Object.keys(c.byCatRecurring).map(function (k) {
        return { key: k, name: catOf("expense", k).n, amount: c.byCatRecurring[k] };
      }),
      variable_spend: c.spotSpend,
      spend_total: c.spendTotal,
      expense_total: c.spendTotal,
      by_category: Object.keys(c.byCat).map(function (k) {
        return { key: k, name: catOf("expense", k).n, amount: c.byCat[k] };
      }),

      /* 先取りは「予定額」であることを構造で明示 */
      planned_set_aside: c.setAside,
      accounts: accounts,

      available_to_spend: c.available,
    };
  }

  return {
    EXP_CATS: EXP_CATS,
    VAR_CATS: EXP_CATS,   // 旧名の互換（中身は全支出カテゴリ）
    EXP_PICK_CATS: EXP_PICK_CATS,
    recurringCarryPlan: recurringCarryPlan,
    todayTasks: todayTasks,
    salaryDayHint: salaryDayHint,
    lastExpenseDate: lastExpenseDate,
    isHabit: isHabit,
    daysApart: daysApart,
    shiftDate: shiftDate,
    TASK_MAX: TASK_MAX,
    TASK_QUIET_DAYS: TASK_QUIET_DAYS,
    HABIT_WINDOW: HABIT_WINDOW,
    HABIT_MIN: HABIT_MIN,
    isRecurring: isRecurring,
    INC_CATS: INC_CATS,
    REGULAR_INCOME_CAT: REGULAR_INCOME_CAT,
    catOf: catOf,
    num: num,
    monthOf: monthOf,
    normalizeCycleStart: normalizeCycleStart,
    cycleStartDay: cycleStartDay,
    cycleRange: cycleRange,
    cycleOf: cycleOf,
    cycleDayIndex: cycleDayIndex,
    dateInCycle: dateInCycle,
    cycleLabel: cycleLabel,
    CYCLE_START_MIN: CYCLE_START_MIN,
    CYCLE_START_MAX: CYCLE_START_MAX,
    normalizeSettings: normalizeSettings,
    LP_MAX_ROWS: LP_MAX_ROWS,
    normalizeLifePlanAssets: normalizeLifePlanAssets,
    normalizeLpGold: normalizeLpGold,
    normalizeLpBanks: normalizeLpBanks,
    normalizeLpLoans: normalizeLpLoans,
    normalizeLpPensions: normalizeLpPensions,
    lpHasAny: lpHasAny,
    lpGoldValue: lpGoldValue,
    lpBanksTotal: lpBanksTotal,
    lpLoansTotal: lpLoansTotal,
    lpPensionMonthly: lpPensionMonthly,
    buildLifePlanInputs: buildLifePlanInputs,
    computeMonth: computeMonth,
    weekSpent: weekSpent,
    buildSnapshot: buildSnapshot,
    parseAmount: parseAmount,
    cropRect: cropRect,
    cropOutputSize: cropOutputSize,
    enhanceForOcr: enhanceForOcr,
    softenForOcr: softenForOcr,
    otsuThreshold: otsuThreshold,
    binarizeForOcr: binarizeForOcr,
    pickBestAmount: pickBestAmount,
    ocrEnough: ocrEnough,
    padCrop: padCrop,
    cropVariant: cropVariant,
    CROP_VARIANTS: CROP_VARIANTS,
    sharpenForOcr: sharpenForOcr,
    adaptiveBinarize: adaptiveBinarize,
    prepareForOcr: prepareForOcr,
    shouldInvert: shouldInvert,
    invertForOcr: invertForOcr,
    amountDetails: amountDetails,
    textPositionScore: textPositionScore,
    commaScore: commaScore,
    scoreCandidate: scoreCandidate,
    rankCandidates: rankCandidates,
    needsConfirmation: needsConfirmation,
    totalHint: totalHint,
    truncatedLeading: truncatedLeading,
    leadingStripCrop: leadingStripCrop,
    reconstructionPlan: reconstructionPlan,
    buildReconstructed: buildReconstructed,
    firstDigit: firstDigit,
    RECON_MAX_CONF: RECON_MAX_CONF,
    MAX_CHOICES: 5,
    buildBackup: buildBackup,
    parseBackupJson: parseBackupJson,
    validateDateString: validateDateString,
    normalizeTransaction: normalizeTransaction,
    normalizeBackup: normalizeBackup,
    HEALTH_FIELDS: HEALTH_FIELDS,
    normalizeHealthEntry: normalizeHealthEntry,
    normalizeHealth: normalizeHealth,
    healthSeries: healthSeries,
    SWIPE_VIEWS: SWIPE_VIEWS,
    swipeNextView: swipeNextView,
    PULSE_CFG: PULSE_CFG,
    PULSE_SAVE: PULSE_SAVE,
    PULSE_WINDOWS: PULSE_WINDOWS,
    PULSE_FAIL_MSG: PULSE_FAIL_MSG,
    PULSE_QUALITY_LABELS: PULSE_QUALITY_LABELS,
    PULSE_CONDS: PULSE_CONDS,
    PULSE_MAX: PULSE_MAX,
    pulseQualityLabel: pulseQualityLabel,
    pulseStarText: pulseStarText,
    pulseStars: pulseStars,
    pulseFrameOk: pulseFrameOk,
    pulseResample: pulseResample,
    pulseResampleFixed: pulseResampleFixed,
    pulseBandpass: pulseBandpass,
    pulseAutocorrBpm: pulseAutocorrBpm,
    analyzePulse: analyzePulse,
    pulseSaveCheck: pulseSaveCheck,
    normalizePulseEntry: normalizePulseEntry,
    normalizePulseList: normalizePulseList,
    pulseLatest: pulseLatest,
    pulseSeries: pulseSeries,
    pulseCsv: pulseCsv,
    pulseTimeString: pulseTimeString,
    chartNiceStep: chartNiceStep,
    chartScale: chartScale,
    chartLabelIndexes: chartLabelIndexes,
    seriesChange: seriesChange,
    CHART_TICKS: CHART_TICKS,
    CHART_XLABELS: CHART_XLABELS,
    DIARY_MAX: DIARY_MAX,
    normalizeDiary: normalizeDiary,
    normalizeDiaryEntry: normalizeDiaryEntry,
    diaryList: diaryList,
    newSci: newSci,
    sciPress: sciPress,
    sciExpr: sciExpr,
    sciFormat: sciFormat,
    sciEvaluate: sciEvaluate,
    sciClearHistory: sciClearHistory,
    normalizeSciHistory: normalizeSciHistory,
    sciAmount: sciAmount,
    SCI_TOKENS_MAX: SCI_TOKENS_MAX,
    SCI_HISTORY_MAX: SCI_HISTORY_MAX,
    newCalc: newCalc,
    calcFrom: calcFrom,
    calcPress: calcPress,
    calcDisplay: calcDisplay,
    calcValue: calcValue,
    CALC_DIGITS_MAX: CALC_DIGITS_MAX,
    normalizePlans: normalizePlans,
    normalizeTimeString: normalizeTimeString,
    sortPlans: sortPlans,
    dayPlans: dayPlans,
    todayPlans: todayPlans,
    upcomingPlans: upcomingPlans,
    monthPlans: monthPlans,
    PLAN_HOME_MAX: PLAN_HOME_MAX,
    PLAN_TEXT_MAX: PLAN_TEXT_MAX,
    PLAN_PER_DAY_MAX: PLAN_PER_DAY_MAX,
    PLAN_SHOW_MAX: PLAN_SHOW_MAX,
    dayDetail: dayDetail,
    monthMarks: monthMarks,
    budgetBreakdown: budgetBreakdown,
    fmtYen: fmtYen,
    shiftYm: shiftYm,
    recentMonths: recentMonths,
    daysInMonth: daysInMonth,
    monthlyTrend: monthlyTrend,
    categorySpend: categorySpend,
    categoryCompare: categoryCompare,
    weekdaySpend: weekdaySpend,
    spendPace: spendPace,
    analysisInsights: analysisInsights,
    analyzeMonth: analyzeMonth,
    TREND_MONTHS: TREND_MONTHS,
    COMPARE_MONTHS: COMPARE_MONTHS,
    WEEKDAY_NAMES: WEEKDAY_NAMES,
    BACKUP_VERSION: BACKUP_VERSION,
    APP_VERSION: APP_VERSION,
    MEMO_MAX: MEMO_MAX,
    AMOUNT_MAX: AMOUNT_MAX,
    TX_MAX: TX_MAX,
    OCR_PLAN: OCR_PLAN,
    OCR_MAX_RUNS: OCR_MAX_RUNS,
    SCORE_CONFIRM: SCORE_CONFIRM,
    SCORE_GAP: SCORE_GAP,
    moveCrop: moveCrop,
    fitSize: fitSize,
    approxBytes: approxBytes,
    storageUsage: storageUsage,
    PHOTO_OCR_MAX: PHOTO_OCR_MAX,
    PHOTO_VIEW_MAX: PHOTO_VIEW_MAX,
    PHOTO_STORE_MAX: PHOTO_STORE_MAX,
    STORE_SOFT_LIMIT: STORE_SOFT_LIMIT,
    CROP_DEFAULT: CROP_DEFAULT,
    CROP_MIN: CROP_MIN,
  };
});
