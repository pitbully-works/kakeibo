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
  const APP_VERSION = "1.13.0";

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
    /* 生命保険は「ライフプランへ渡すデータ」に入力口を作ったので、記録の選択からは外す。
       同じお金を2か所から入れられると二重になるため。過去の記録はそのまま残り、集計にも出る。 */
    { k: "insure",   e: "🛟", n: "保険", hidden: true },
    { k: "transit",  e: "🚃", n: "交通" },
    { k: "car",      e: "🚗", n: "車" },
    { k: "medical",  e: "🏥", n: "医療・健康" },
    { k: "clothes",  e: "👕", n: "衣服" },
    { k: "social",   e: "🤝", n: "交際費" },
    { k: "hobby",    e: "🎨", n: "趣味" },
    { k: "pet",      e: "🐶", n: "ペット" },
    /* 私年金も同じ理由で、記録の選択からは外す（民間年金の欄が入力口）。 */
    { k: "pension",  e: "💰", n: "私年金", hidden: true },
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
  function cycleLabel(ym, startDay, settingsOrCountry) {
    if (normalizeCycleStart(startDay) === 1) return "";
    const r = cycleRange(ym, startDay);
    const country = countryOf(settingsOrCountry);
    const f = function (iso) {
      const m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
      if (country === "GB" || country === "AU") return d + "/" + m;
      if (country === "CA") return pad2(m) + "-" + pad2(d);
      return m + "/" + d;
    };
    return f(r.from) + "〜" + f(r.to);
  }

  /* ---------- 国・通貨の共通設定（将来の5カ国対応の土台） ---------- */
  const COUNTRY_RULES = Object.freeze({
    JP: Object.freeze({ country: "JP", currency: "JPY", locale: "ja-JP", symbol: "¥" }),
    US: Object.freeze({ country: "US", currency: "USD", locale: "en-US", symbol: "$" }),
    GB: Object.freeze({ country: "GB", currency: "GBP", locale: "en-GB", symbol: "£" }),
    CA: Object.freeze({ country: "CA", currency: "CAD", locale: "en-CA", symbol: "CA$" }),
    AU: Object.freeze({ country: "AU", currency: "AUD", locale: "en-AU", symbol: "A$" }),
  });

  function normalizeCountry(v) {
    const c = String(v == null ? "" : v).trim().toUpperCase();
    return COUNTRY_RULES[c] ? c : "JP";
  }

  function countryFromCurrency(v) {
    const cur = String(v == null ? "" : v).trim().toUpperCase();
    const keys = Object.keys(COUNTRY_RULES);
    for (let i = 0; i < keys.length; i++) {
      if (COUNTRY_RULES[keys[i]].currency === cur) return keys[i];
    }
    return null;
  }

  function countryRule(country) {
    return COUNTRY_RULES[normalizeCountry(country)];
  }

  /* ---------- 画面のことば・書式（5カ国の土台。画面はJPとUSだけ） ----------
     決めごと：
       ・**保存するデータは国が変わっても同じ形**にする。
         カテゴリは内部ID（food / rent …）のまま保存し、
         「食費 / Food」は表示のときだけ切り替える。
       ・国を足すときは、この下の表に1行足すだけで済むようにする。
     -------------------------------------------------------------------- */

  /* 国ごとの表示言語。日本だけ日本語、ほかは英語。 */
  const COUNTRY_LANG = Object.freeze({ JP: "ja", US: "en", GB: "en", CA: "en", AU: "en" });

  /* 通貨の小数桁。円は小数を使わない（¥1,234）。ドルは2桁（$1,234.56）。 */
  const CURRENCY_DECIMALS = Object.freeze({ JPY: 0, USD: 2, GBP: 2, CAD: 2, AUD: 2 });

  /* せっていの「国」で選べる国。土台は5カ国あるが、
     画面（ことば・カテゴリ表示）を用意できた国だけをここに出す。
     GB / CA / AU を出すときは、この配列に足して翻訳を足すだけでよい。 */
  const SUPPORTED_COUNTRIES = Object.freeze(["JP", "US", "GB", "CA", "AU"]);

  /* =======================================================================
     最小通貨単位（第1段階：内部の持ち方だけを変える）
     -----------------------------------------------------------------------
     【なぜ変えるか】
     ドルやポンドには「セント」がある。主単位（ドル）の小数で持つと、
     0.1 + 0.2 が 0.30000000000000004 になり、足すたびに1セントずれる。
     そこで内部はすべて **最小単位の整数** で持つ。
       日本   … 1 = 1円          （scale = 1。既存の金額は1円も変わらない）
       米英加豪 … 1 = 1セント/ペニー （scale = 100）

     【外との境目】
     ・画面に出すとき      … toMajor して formatMoney（＝ formatAmount）
     ・打ち込みを受けるとき … toMinor
     ・ライフプランへ渡すとき … toMajor（相手の受け取る数値はこれまでと同じ）
     境目の外では、いっさい最小単位を見せない。

     【移行の判定】
     金額の値からは絶対に判定しない。1234 は「$1,234.00（移行前）」とも
     「$12.34（移行後）」とも読めるため、推測した瞬間に誰かの金額が
     100倍か1/100になる。判定は state.dataVersion の印だけで行う。
     ======================================================================= */
  const DATA_VERSION = 2;   // 2 = 最小単位。印が無い保存データは移行前（主単位）
  const MINOR_UNIT_SCALE = Object.freeze({ JPY: 1, USD: 100, GBP: 100, CAD: 100, AUD: 100 });

  function minorScale(settingsOrCountry) {
    const cur = countryRule(countryOf(settingsOrCountry)).currency;
    const s = MINOR_UNIT_SCALE[cur];
    return s === undefined ? 1 : s;
  }

  /* 主単位 → 最小単位。$12.34 → 1234 */
  function toMinor(major, settingsOrCountry) {
    const n = Number(major);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * minorScale(settingsOrCountry));
  }

  /* 最小単位 → 主単位。1234 → 12.34（日本は 1234 のまま） */
  function toMajor(minor, settingsOrCountry) {
    const n = Number(minor);
    if (!Number.isFinite(n)) return 0;
    const s = minorScale(settingsOrCountry);
    return s === 1 ? n : n / s;
  }


  /* 設定オブジェクトでも国コードの文字列でも受け取れるようにする */
  function countryOf(settingsOrCountry) {
    const obj = settingsOrCountry && typeof settingsOrCountry === "object" ? settingsOrCountry : null;
    return normalizeCountry(obj ? obj.country : settingsOrCountry);
  }
  function countryLang(settingsOrCountry) {
    return COUNTRY_LANG[countryOf(settingsOrCountry)] || "ja";
  }
  function countryLocale(settingsOrCountry) {
    return countryRule(countryOf(settingsOrCountry)).locale;
  }
  function isSupportedCountry(v) {
    const c = String(v == null ? "" : v).trim().toUpperCase();
    return SUPPORTED_COUNTRIES.indexOf(c) >= 0;
  }
  /* 画面で選べない国が保存されていたら、選べる国へ寄せる（今は必ずJP）。
     土台としては GB/CA/AU の保存値をそのまま保つので、
     画面を用意したときに何も失われない。 */
  function pickCountry(v) {
    return isSupportedCountry(v) ? normalizeCountry(v) : SUPPORTED_COUNTRIES[0];
  }
  function currencyDecimals(currency) {
    const d = CURRENCY_DECIMALS[String(currency == null ? "" : currency).toUpperCase()];
    return d === undefined ? 0 : d;
  }

  /* ---------- 曜日・月・日付の書き方 ---------- */
  const WEEKDAY_JA = Object.freeze(["日", "月", "火", "水", "木", "金", "土"]);
  const WEEKDAY_EN = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  const MONTH_EN = Object.freeze(["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"]);
  const MONTH_ABBR_EN = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  /* グラフの下に出す短い月。JPは「8月」、USは「Aug」。 */
  function monthShort(month, settingsOrCountry) {
    const m = Math.min(12, Math.max(1, Math.floor(Number(month) || 1)));
    return countryLang(settingsOrCountry) === "en" ? MONTH_ABBR_EN[m - 1] : m + "月";
  }

  function weekdayShort(dow, settingsOrCountry) {
    const i = ((Math.floor(Number(dow)) % 7) + 7) % 7;
    return countryLang(settingsOrCountry) === "en" ? WEEKDAY_EN[i] : WEEKDAY_JA[i];
  }
  /* 曜日ぐせの棒グラフに出す見出し。JPは「月曜」、USは「Mon」。 */
  function weekdayLabel(dow, settingsOrCountry) {
    const s = weekdayShort(dow, settingsOrCountry);
    return countryLang(settingsOrCountry) === "en" ? s : s + "曜";
  }
  /* 月だけ。JPは「8月」、USは「August」。 */
  function monthName(month, settingsOrCountry) {
    const m = Math.min(12, Math.max(1, Math.floor(Number(month) || 1)));
    return countryLang(settingsOrCountry) === "en" ? MONTH_EN[m - 1] : m + "月";
  }
  /* 短い月日。JP「8/10」／US「8/10」。どちらも月/日の順で同じ。 */
  function formatMonthDay(iso, settingsOrCountry) {
    const s = String(iso || "");
    const m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
    if (!Number.isFinite(m) || !Number.isFinite(d) || !m || !d) return s;
    const country = countryOf(settingsOrCountry);
    if (country === "GB" || country === "AU") return d + "/" + m;
    if (country === "CA") return pad2(m) + "-" + pad2(d);
    return m + "/" + d;
  }
  /* 見出しの日付。JP「8月10日」／US「August 10」。 */
  function formatDateHeading(iso, settingsOrCountry) {
    const s = String(iso || "");
    const m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
    if (!Number.isFinite(m) || !Number.isFinite(d) || !m || !d) return s;
    if (["GB","AU"].includes(countryOf(settingsOrCountry))) return d + " " + MONTH_EN[m - 1];
    return countryLang(settingsOrCountry) === "en" ? MONTH_EN[m - 1] + " " + d : m + "月" + d + "日";
  }
  /* 年つきの日付。JP「2026/8/10」／US「8/10/2026」。 */
  function formatDate(iso, settingsOrCountry) {
    const s = String(iso || "");
    const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || !m || !d) return s;
    const country = countryOf(settingsOrCountry);
    if (country === "GB" || country === "AU") return d + "/" + m + "/" + y;
    if (country === "CA") return String(y).padStart(4,"0") + "-" + pad2(m) + "-" + pad2(d);
    return countryLang(settingsOrCountry) === "en" ? m + "/" + d + "/" + y : y + "/" + m + "/" + d;
  }
  /* 年月。JP「2026年8月」／US「August 2026」。 */
  function formatYearMonth(ym, settingsOrCountry) {
    const s = String(ym || "");
    const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7));
    if (!Number.isFinite(y) || !Number.isFinite(m) || !m) return s;
    return countryLang(settingsOrCountry) === "en" ? MONTH_EN[m - 1] + " " + y : y + "年 " + m + "月";
  }

  /* ---------- カテゴリの表示名（保存する内部IDは変えない） ----------
     保存されるのは food / rent などの内部IDだけ。
     ここは「その内部IDを、その国のことばで何と出すか」の表でしかない。
     だから国を切り替えても、過去の記録の中身は1バイトも変わらない。 */
  const EXP_CAT_EN = Object.freeze({
    food: "Groceries", daily: "Household", eatout: "Dining out", rent: "Housing",
    power: "Electricity", gas: "Gas", water: "Water", comm: "Phone & internet",
    insure: "Insurance", transit: "Transit", car: "Car", medical: "Health & medical",
    clothes: "Clothing", social: "Gifts & social", hobby: "Hobbies", pet: "Pet",
    pension: "Private pension", tax: "Taxes", subs: "Subscriptions",
    fixother: "Other", other: "Other",
  });
  const INC_CAT_EN = Object.freeze({
    salary: "Paycheck", bonus: "Bonus & extra", gift: "Gift", other: "Other income",
  });

  function catName(type, key, settingsOrCountry) {
    const cat = catOf(type, key);
    if (countryLang(settingsOrCountry) !== "en") return cat.n;
    const map = type === "income" ? INC_CAT_EN : EXP_CAT_EN;
    return map[key] || cat.n;
  }
  /* 絵文字つきの表示用オブジェクト。内部IDはそのまま持ち回る。 */
  function catDisplay(type, key, settingsOrCountry) {
    const cat = catOf(type, key);
    return { k: cat.k, e: cat.e, n: catName(type, key, settingsOrCountry) };
  }

  /* ライフプラン欄から出てくる毎月の行（key は保存データではなく計算結果の印） */
  const LP_ROW_EN = Object.freeze({
    gold: "Gold contribution", banks: "Bank deposit", pension: "Private pension contribution",
    ideco: "Retirement contribution", loans: "Loan repayment", insurance: "Insurance premium",
    nisa: "Tax-free investing", lump: "Lump-sum investment",
  });
  function lpRowName(key, fallback, settingsOrCountry) {
    if (countryLang(settingsOrCountry) !== "en") return fallback || key;
    return LP_ROW_EN[key] || fallback || key;
  }

  /* ---------- 画面のことば ----------
     ja は今の日本版の文言をそのまま持ってくる（見た目を変えないため）。
     {name} のような目印は t() の第3引数で差し替える。 */
  const UI_TEXT = Object.freeze({
    /* 下のタブ */
    "nav.home":     { ja: "ホーム",     en: "Home" },
    "nav.summary":  { ja: "まとめ",     en: "Summary" },
    "nav.calendar": { ja: "カレンダー", en: "Calendar" },
    "nav.diary":    { ja: "日記",       en: "Diary" },
    "nav.health":   { ja: "健康",       en: "Health" },
    "nav.calc":     { ja: "電卓",       en: "Calc" },
    "nav.pulse":    { ja: "心拍β",      en: "Pulse β" },
    "nav.settings": { ja: "せってい",   en: "Settings" },

    /* ホーム */
    "home.greet":       { ja: "こんにちは 👋", en: "Hello 👋" },
    "home.daysLeft":    { ja: "今月ののこり {n}日", en: "{n} days left this month" },
    "home.heroLabel":   { ja: "今月 あと つかえるお金", en: "Left to spend this month" },
    "home.heroNote":    { ja: "先取り貯金・NISA積立の予定額を除いています",
                          en: "Planned savings and investing contributions are excluded" },
    "home.heroEmpty":   { ja: "給料を記録すると、ここに出ます",
                          en: "Record your paycheck and it will show up here" },
    "home.over":        { ja: "今月は少し使いすぎ。来月そっと調整🍀",
                          en: "A bit over budget. Ease up next month 🍀" },
    "home.warn":        { ja: "のこりわずか。少しペース注意", en: "Running low — watch your pace" },
    "home.good":        { ja: "👍 このペースなら大丈夫", en: "👍 You're on track" },
    "home.miniIncome":  { ja: "収入",     en: "Income" },
    "home.miniSpent":   { ja: "使った",   en: "Spent" },
    "home.miniSetAside":{ ja: "先取り",   en: "Set aside" },
    "home.goal":        { ja: "目標",     en: "Goal" },
    "home.goalLeft":    { ja: "あと{n}%", en: "{n}% to go" },
    "home.goalUnset":   { ja: "未設定",   en: "Not set" },
    "home.goalTap":     { ja: "目標記入", en: "Edit goal" },
    "home.tapin":       { ja: "固定金額入力", en: "Edit amount" },
    "home.dreamLabel":  { ja: "― あなたの夢の進み ―", en: "— Progress toward your goals —" },
    "home.dreamNote":   { ja: "金額はどれも毎月ぶんです", en: "All amounts are per month" },
    "home.record":      { ja: "📸 記録する", en: "📸 Add a record" },
    "home.perMonth":    { ja: "/月", en: "/mo" },
    "home.todos":       { ja: "今日やること", en: "Today's to-do" },
    "home.todayPlan":   { ja: "今日の予定", en: "Today's schedule" },
    "home.morePlans":   { ja: "ほか {n}件 の予定があります", en: "{n} more scheduled" },
    "home.monthPlans":  { ja: "今月の予定（{month}）", en: "This month's schedule ({month})" },
    "home.planCount":   { ja: "{total}件　のこり", en: "{total} total · remaining" },
    "home.planLeft":    { ja: "{n}件", en: "{n}" },
    "home.planMore":    { ja: "ほか {n}件 をカレンダーで見る", en: "See {n} more in the calendar" },
    "home.today":       { ja: " 今日", en: " Today" },

    /* ライフプラン欄のタイル */
    "lp.nisa":      { ja: "NISA",       en: "Investing" },
    "lp.pension":   { ja: "民間年金",   en: "Private pension" },
    "lp.insurance": { ja: "各種保険",   en: "Insurance" },
    "lp.gold":      { ja: "金（きん）", en: "Gold" },
    "lp.ideco":     { ja: "iDeCo",      en: "Retirement" },
    "lp.loans":     { ja: "借入金",     en: "Loans" },
    "lp.banks":     { ja: "銀行貯金",   en: "Bank savings" },

    /* まとめ */
    "sum.tabMonth":     { ja: "今月",     en: "This month" },
    "sum.tabAnalysis":  { ja: "📈 分析",  en: "📈 Insights" },
    "sum.title":        { ja: "今月のまとめ（{month}）", en: "Summary for {month}" },
    "sum.income":       { ja: "収入",     en: "Income" },
    "sum.spend":        { ja: "支出",     en: "Spending" },
    "sum.setAside":     { ja: "先取り（予定）", en: "Set aside · planned" },
    "sum.left":         { ja: "のこり",   en: "Left over" },
    "sum.formula":      { ja: "収入 {income} － 支出 {spend} － 先取り {setAside} ＝ ",
                          en: "Income {income} − spending {spend} − set aside {setAside} = " },
    "sum.sameAsHome":   { ja: "この「のこり」は、ホームの「今月あと つかえるお金」と同じ金額です。",
                          en: "This is the same figure as ‘Left to spend this month’ on Home." },
    "sum.donutLabel":   { ja: "収入の使いみち（支出・先取り・のこり）",
                          en: "Where your income goes — spending, set aside, left over" },
    "sum.incomeBreak":  { ja: "収入の内わけ", en: "Income breakdown" },
    "sum.incomeRegular":{ ja: "通常収入（記録した給与）", en: "Regular income — recorded paycheck" },
    "sum.incomeExtra":  { ja: "臨時収入", en: "Extra income" },
    "sum.notRecorded":  { ja: "未記録",   en: "Not recorded" },
    "sum.spendBreak":   { ja: "支出の内わけ（今月）", en: "Spending breakdown — this month" },
    "sum.barNote":      { ja: "　棒は収入に対する割合", en: " · bars show share of income" },
    "sum.recurring":    { ja: "🔁 毎月固定", en: "🔁 Recurring" },
    "sum.spot":         { ja: "それ以外", en: "Everything else" },
    "sum.records":      { ja: "記録（タップで編集）", en: "Records — tap to edit" },
    "sum.empty":        { ja: "まだ記録がありません。<br>ホームの「記録する」から、はじめの一歩を。",
                          en: "No records yet.<br>Tap ‘Add a record’ on Home to get started." },
    "sum.noSpend":      { ja: "今月の支出はまだありません", en: "No spending recorded this month yet" },
    "sum.dayTotal":     { ja: "支出 {amount}", en: "Spent {amount}" },
    "sum.incomeTag":    { ja: "収入・", en: "Income · " },
    "sum.total":        { ja: "合計", en: "Total" },
    "sum.setAsideTitle":{ ja: "先取り（貯まるお金）", en: "Money you set aside" },
    "sum.setAsideNote": { ja: "毎月ひとりでに出ていくお金です。",
                          en: "Money that leaves your account every month on its own." },
    "sum.notFromRecords": { ja: "記録からは入れません", en: "Do not add these as records" },
    "sum.doubleCount":  { ja: "（二重に引かれてしまうため）", en: " (they would be counted twice)" },
    "sum.fixedTitle":   { ja: "毎月固定（支出）", en: "Recurring spending" },
    "sum.fixedNote":    { ja: "出ていって戻らないお金なので、", en: "This money is gone once paid, so it counts as " },
    "sum.asSpend":      { ja: "支出", en: "spending" },
    "sum.counted":      { ja: "として数えています。", en: "." },
    "sum.alsoNot":      { ja: "こちらも", en: "These, too, " },
    "sum.carryTitle":   { ja: "🔁 先月の毎月固定が {n}件 あります",
                          en: "🔁 {n} recurring items from last month" },
    "sum.carryTotal":   { ja: "　合計 ", en: " · total " },
    "sum.carrySkip":    { ja: "今月すでに入っている {n}件 は、はぶきます",
                          en: "{n} already added this month will be skipped" },
    "sum.carryBtn":     { ja: "今月にまとめて入れる", en: "Add them all to this month" },
    "sum.carryNote":    { ja: "金額は先月と同じで入ります。ちがうときは、入れたあとで直してください。",
                          en: "Amounts are copied from last month. Edit them afterwards if they differ." },

    /* 分析 */
    "an.title":       { ja: "{month}の分析（{elapsed}日目 / {days}日）",
                        en: "{month} insights — day {elapsed} of {days}" },
    "an.periodNote":  { ja: "この「{month}」は {period} の分です", en: "‘{month}’ here covers {period}" },
    "an.empty":       { ja: "記録がたまると、ここに気づきが出ます",
                        en: "Insights will appear once you have some records" },
    "an.pace":        { ja: "つかうペース", en: "Spending pace" },
    "an.soFar":       { ja: "これまで", en: "So far" },
    "an.perDay":      { ja: "1日あたり", en: "Per day" },
    "an.forecast":    { ja: "月末の予測", en: "End-of-month forecast" },
    "an.budgetNote":  { ja: "つかってよい額 {budget}（収入 {income} － 先取り {setAside}）。1日あたり {perDay} のペースです。",
                        en: "You can spend {budget} ({income} income − {setAside} set aside), or {perDay} per day." },
    "an.noIncome":    { ja: "給料を記録すると、予算のペース（点線）が出ます。",
                        en: "Record your paycheck to see the budget pace (dotted line)." },
    "an.days":        { ja: "記録があった日 {spend}日 ／ つかわなかった日 {none}日",
                        en: "{spend} days with spending / {none} days without" },
    "an.recurringNote":{ ja: "🔁 毎月固定の {amount} は、日割りせずそのまま数えています。",
                        en: "🔁 Recurring {amount} is counted in full, not spread across days." },
    "an.trend":       { ja: "{n}か月の推移", en: "Last {n} months" },
    "an.trendNote":   { ja: "先取り（予定額）は今の設定の金額なので、過去の月には当てはめていません。ここは収入と支出だけを並べています。",
                        en: "Set-aside amounts come from today's settings, so they are not applied to past months. Only income and spending are shown here." },
    "an.compare":     { ja: "先月とくらべる", en: "Compared with last month" },
    "an.weekday":     { ja: "曜日のくせ", en: "By day of week" },
    "an.share":       { ja: "支出の {share}% ・ 先月 {prev}", en: "{share}% of spending · last month {prev}" },
    "an.avg":         { ja: " ・ {n}か月平均 {amount}", en: " · {n}-month average {amount}" },
    "an.first":       { ja: "はじめて", en: "First time" },
    "an.forecastLine":{ ja: "月末までの予測", en: "Forecast to month end" },
    "an.budgetLine":  { ja: "予算のペース", en: "Budget pace" },
    "an.noRecords":   { ja: "まだ支出の記録がありません", en: "No spending recorded yet" },
    "an.spentLine":   { ja: "つかった累計", en: "Spent so far" },

    /* 気づき */
    "ins.noIncome": { ja: "給料をまだ記録していません。記録すると、使いすぎのペースが分かります",
                      en: "No paycheck recorded yet. Add one to see whether you're overspending" },
    "ins.paceOver": { ja: "このペースだと月末に {forecast}。つかってよい {budget} を {over} こえそうです",
                      en: "At this pace you'll reach {forecast} by month end — {over} over your {budget} budget" },
    "ins.paceOk":   { ja: "このペースなら月末に {forecast}。{left} のこりそうです",
                      en: "At this pace you'll reach {forecast} by month end, leaving {left}" },
    "ins.up":       { ja: "{emoji} {name} が先月より {amount} ふえています",
                      en: "{emoji} {name} is up {amount} from last month" },
    "ins.top":      { ja: "いちばん多いのは {emoji} {name} の {amount}（支出の {share}%）",
                      en: "Your biggest category is {emoji} {name} at {amount} ({share}% of spending)" },
    "ins.down":     { ja: "{emoji} {name} は先月より {amount} へっています",
                      en: "{emoji} {name} is down {amount} from last month" },
    "ins.noSpend":  { ja: "今月は {n}日、1円もつかいませんでした",
                      en: "You spent nothing on {n} days this month" },
    "ins.recurring":{ ja: "毎月かかるお金は {amount}（支出の {share}%）",
                      en: "Recurring costs are {amount} ({share}% of spending)" },
    "ins.weekday":  { ja: "よくつかうのは {name}曜（合計 {amount}）",
                      en: "You spend most on {name} (total {amount})" },

    /* 今日やること */
    "task.carry":       { ja: "先月の毎月固定が {n}件、まだ入っていません",
                          en: "{n} recurring items from last month are not added yet" },
    "task.carrySub":    { ja: "まとめて入れられます（合計 {amount}）",
                          en: "You can add them all at once — total {amount}" },
    "task.salary":      { ja: "今月の給料が、まだ記録されていません",
                          en: "This month's paycheck is not recorded yet" },
    "task.salarySub":   { ja: "記録すると「あと つかえるお金」が出ます",
                          en: "Record it to see what's left to spend" },
    "task.quiet":       { ja: "{n}日、支出の記録がありません", en: "No spending recorded for {n} days" },
    "task.quietSub":    { ja: "レシートが手元にあれば、いまのうちに",
                          en: "If you have a receipt handy, now is a good time" },
    "task.diary":       { ja: "今日の日記が、まだです", en: "Today's diary is still empty" },
    "task.diarySub":    { ja: "ひとことでも大丈夫です", en: "A single line is enough" },
    "task.health":      { ja: "今日の体重・血圧が、まだです", en: "Today's weight and blood pressure are not recorded" },
    "task.healthSub":   { ja: "1日1件で、あとから直せます", en: "One entry a day — you can edit it later" },

    /* 記録シート */
    "rec.title":      { ja: "記録する",     en: "Add a record" },
    "rec.titleEdit":  { ja: "記録をなおす", en: "Edit record" },
    "rec.expense":    { ja: "支出", en: "Expense" },
    "rec.income":     { ja: "収入", en: "Income" },
    "rec.amount":     { ja: "金額", en: "Amount" },
    "rec.date":       { ja: "日付", en: "Date" },
    "rec.memo":       { ja: "メモ（任意）", en: "Note — optional" },
    "rec.memoPh":     { ja: "お店・内容", en: "Store or details" },
    "rec.catExpense": { ja: "支出のカテゴリ", en: "Expense category" },
    "rec.save":       { ja: "✓ この内容で記録する", en: "✓ Save this record" },
    "rec.update":     { ja: "更新する", en: "Update" },
    "rec.delete":     { ja: "この記録を削除", en: "Delete this record" },
    "rec.recurringOn":  { ja: "オン", en: "On" },
    "rec.recurringOff": { ja: "オフ", en: "Off" },
    "rec.recurring":  { ja: "🔁 毎月固定 ", en: "🔁 Recurring " },
    "rec.recurHintOn":  { ja: "家賃・光熱費のような、毎月かかるお金として数えます",
                          en: "Counted as a monthly fixed cost, like rent or utilities" },
    "rec.recurHintOff": { ja: "家賃・光熱費など、毎月かかるものはオンにしてください",
                          en: "Turn this on for monthly costs such as rent or utilities" },
    "rec.salaryNote": { ja: "給料の入力口はここだけです。今月の通常収入になります。",
                        en: "This is the only place to enter your paycheck. It becomes this month's regular income." },
    "rec.extraNote":  { ja: "臨時の収入として、今月の収入に上のせされます。",
                        en: "Added to this month's income as extra income." },
    "rec.shoot":      { ja: "📸 レシートを撮る", en: "📸 Photograph a receipt" },
    "rec.shootSub":   { ja: "合計の行にアップで寄せて撮ってください", en: "Zoom in on the total line" },
    "rec.reshoot":    { ja: "📸 撮り直す", en: "📸 Retake" },
    "rec.readCrop":   { ja: "🔍 この枠の金額を読み取る", en: "🔍 Read the amount in the box" },
    "rec.cropHint":   { ja: "白い枠を動かして、<b>合計の金額だけ</b>を囲んでください。<br>枠の中しか読み取らないので、他の金額と混ざりません。<br>",
                        en: "Move the white box so it surrounds <b>only the total</b>.<br>Only what's inside the box is read, so other amounts can't get mixed in.<br>" },
    "rec.online":     { ja: "初回の読み取りにはインターネット接続が必要です",
                        en: "An internet connection is needed the first time you use this" },
    "rec.choices":    { ja: "タップして金額を入れます（記録はまだされません）",
                        en: "Tap to fill in the amount (nothing is saved yet)" },
    "rec.manual":     { ja: "✍️ 手入力する", en: "✍️ Enter it myself" },

    /* せってい */
    "set.title":       { ja: "せってい", en: "Settings" },
    "set.country":     { ja: "国・通貨", en: "Country & currency" },
    "set.countryLabel":{ ja: "お住まいの国", en: "Your country" },
    "set.countryHelp": { ja: "国を変えると、ことば・通貨・日付の出し方が変わります。記録したデータはそのまま残ります。",
                         en: "Changing the country switches the language, currency and date format. Your records are kept as they are." },
    "set.countryJP":   { ja: "日本（円）", en: "Japan · JPY" },
    "set.countryUS":   { ja: "アメリカ（ドル）", en: "United States · USD" },
    "set.countryGB":   { ja: "イギリス（ポンド）", en: "United Kingdom · GBP" },
    "set.countryCA":   { ja: "カナダ（カナダドル）", en: "Canada · CAD" },
    "set.countryAU":   { ja: "オーストラリア（豪ドル）", en: "Australia · AUD" },
    "set.countryMix":  { ja: "記録は国ごとに分かれています。いま選んでいる国の記録だけが集計されます。",
                         en: "Records are kept per country. Only records for the selected country are counted." },
    "set.birth":       { ja: "生年月日", en: "Date of birth" },
    "set.cycle":       { ja: "月の区切り", en: "Month cycle" },
    "set.cycleLabel":  { ja: "1か月の始まりの日", en: "Day the month starts" },
    "set.goal":        { ja: "夢・目標", en: "Goals" },
    "set.goalName":    { ja: "目標の名前", en: "Goal name" },
    "set.goalNamePh":  { ja: "例：旅行 / 車 / 緊急資金", en: "e.g. Trip / Car / Emergency fund" },
    "set.goalTarget":  { ja: "目標金額", en: "Target amount" },
    "set.goalCurrent": { ja: "いま貯まってる額", en: "Saved so far" },
    "set.data":        { ja: "データ", en: "Data" },
    "set.save":        { ja: "保存する", en: "Save" },
    "set.saved":       { ja: "保存しました ✓", en: "Saved ✓" },
    "set.saveFailed":  { ja: "設定を保存できませんでした", en: "Could not save settings" },

    /* 円グラフ */
    "donut.income": { ja: "収入", en: "Income" },
    "donut.over":   { ja: "⚠️ 収入を {amount} 超えています", en: "⚠️ {amount} over your income" },

    /* せってい（つづき） */
    "set.birthWhy":   { ja: "<b>なぜ必要か。</b>NISA積立の年齢区間を正しく計算するために使用します。ライフプラン連携時には、生年月日の食い違い確認にも使用します。ライフプラン側の生年月日を自動で変更することはありません。",
                        en: "<b>Why this is needed.</b> It is used to work out the age ranges for your investing schedule, and to flag a mismatch when data is handed to the life-plan app. It never changes the date of birth on the life-plan side." },
    "set.birthHelp":  { ja: "入れなくても家計簿は使えます。入れると、NISA積立をスケジュールから自動で計算します",
                        en: "The app works without it. With it, investing contributions are worked out from your schedule automatically." },
    "set.birthNow":   { ja: "いまは {age} です", en: "You are {age}" },
    "set.cycleWhy":   { ja: "給料日から次の給料日までを「1か月」として数えられます。<br>たとえば <b>20日</b> にすると、7月20日〜8月19日 が「7月分」になります。<br>1日のままなら、これまでどおり<b>1日〜月末</b>です。",
                        en: "You can count a month from payday to payday.<br>For example, choosing <b>the 20th</b> makes July 20 – August 19 count as July.<br>Leaving it at the 1st keeps <b>the 1st through month end</b>." },
    "set.cycleFirst": { ja: "1日（暦の月・これまでどおり）", en: "1st — calendar month" },
    "set.cycleDay":   { ja: "{d}日", en: "Day {d}" },
    "set.cycleHelp1": { ja: "1日から月末までを1か月として数えます", en: "A month runs from the 1st to the last day." },
    "set.cycleHelpN": { ja: "いまの区切りは {from}〜{to}", en: "The current period runs {from} – {to}" },
    "set.cycleTail":  { ja: "　※その日が無い月は、月末に合わせます",
                        en: " · months without that day fall back to the last day" },
    "set.usage":      { ja: "使用中のデータ：<b>{total}</b>（うち写真 {photos}／{count}枚）<br>この端末に保存できるのは<b>およそ5MB</b>までです。",
                        en: "Data in use: <b>{total}</b> (photos {photos} / {count} images)<br>This device can hold roughly <b>5MB</b>." },
    "set.nearLimit":  { ja: "空きが少なくなっています。", en: "Space is running low." },
    "set.exportBk":   { ja: "📥 バックアップを書き出す（JSON）", en: "📥 Export a backup — JSON" },
    "set.importBk":   { ja: "📤 バックアップを読み込む（JSON）", en: "📤 Restore from a backup — JSON" },
    "set.purge":      { ja: "🗑 写真をすべて消す（記録は残ります）", en: "🗑 Delete all photos — records are kept" },
    "set.reset":      { ja: "⚠️ すべて初期設定に戻す", en: "⚠️ Reset everything" },
    "set.resetHelp":  { ja: "設定・記録・日記・健康・予定など、この端末のデータをすべて消して、最初の状態に戻します。<b>元に戻せません。</b>先にバックアップを書き出してください。",
                        en: "This erases everything on this device — settings, records, diary, health and schedule — and starts over. <b>It cannot be undone.</b> Export a backup first." },
    "set.localOnly":  { ja: "データはこの端末の中だけに保存されます（外部に送信しません）。",
                        en: "Your data stays on this device and is never sent anywhere." },

    /* カレンダーの凡例 */
    "cal.diary":  { ja: "日記", en: "Diary" },
    "cal.health": { ja: "健康", en: "Health" },
    "cal.plan":   { ja: "予定", en: "Schedule" },
    "cal.dayTitle": { ja: "{date} の記録", en: "Records for {date}" },
    "cal.dayEmpty": { ja: "この日の記録はありません", en: "Nothing recorded on this day" },
    "cal.writePlan": { ja: "📝 この日の予定を書く", en: "📝 Add a plan for this day" },

    /* ライフプランへの入口 */
    "ext.title": { ja: "将来のお金を試算する", en: "Project your future finances" },
    "ext.sub":   { ja: "資産形成 総合ライフプラン", en: "Total Life Plan" },

    /* カレンダー */
    "cal.income":  { ja: "収入", en: "Income" },
    "cal.expense": { ja: "支出", en: "Expense" },

    /* 健康の項目名（保存されるのは weight などの内部IDのまま） */
    "health.weight": { ja: "体重",     en: "Weight" },
    "health.bpHigh": { ja: "血圧(上)", en: "BP upper" },
    "health.bpLow":  { ja: "血圧(下)", en: "BP lower" },
    "health.pulse":  { ja: "心拍数",   en: "Heart rate" },

    /* 心拍の測定品質。星の数はそのまま、呼び名だけ切り替える。 */
    "pulse.q5": { ja: "とても良好", en: "Very good" },
    "pulse.q4": { ja: "良好",       en: "Good" },
    "pulse.q3": { ja: "普通",       en: "Fair" },
    "pulse.q2": { ja: "やや不安定", en: "A bit unsteady" },
    "pulse.q1": { ja: "再測定推奨", en: "Measure again" },
    "pulse.fail": { ja: "測定品質が不足しています。安静にして再測定してください。",
                    en: "The reading was not steady enough. Sit still and measure again." },
    "pulse.rest":  { ja: "安静時",  en: "At rest" },
    "pulse.post":  { ja: "運動後",  en: "After exercise" },
    "pulse.other": { ja: "その他",  en: "Other" },

    /* 電卓のエラー */
    "calc.badExpr":  { ja: "式が正しくありません",   en: "That expression isn't valid" },
    "calc.parens":   { ja: "かっこが合っていません", en: "The brackets don't match" },
    "calc.divZero":  { ja: "0では割れません",       en: "You can't divide by zero" },
    "calc.notNum":   { ja: "計算できません",         en: "That can't be worked out" },
    "calc.tooLong":  { ja: "式が長すぎます",         en: "That expression is too long" },
  });

  function t(key, settingsOrCountry, vars) {
    const row = UI_TEXT[key];
    const lang = countryLang(settingsOrCountry);
    let s = row ? (row[lang] === undefined ? row.ja : row[lang]) : String(key);
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return s;
  }

  /* ---------- 記録は国ごとに分ける ----------
     国を切り替えたときに、円で記録したものがドルとして数えられてしまうと
     金額がまったく違うものになる。だから記録1件ごとに国の印を持たせ、
     いま選んでいる国のものだけを集計する。

     旧データ（印を持たない記録）は必ずJPとして扱う。
     日本のユーザーの保存データは1バイトも書き換えずに、そのまま動く。 */
  function txCountry(t2) {
    return normalizeCountry(t2 && t2.country ? t2.country : "JP");
  }
  function txsForCountry(txs, settingsOrCountry) {
    const c = countryOf(settingsOrCountry);
    return (Array.isArray(txs) ? txs : []).filter(function (t2) { return txCountry(t2) === c; });
  }

  function formatMoney(v, settingsOrCountry) {
    const rule = countryRule(countryOf(settingsOrCountry));
    const dec = currencyDecimals(rule.currency);
    /* 円は小数を使わない。ここは日本版が今まで出していた「¥1,234」と
       1文字も変えない（見た目を守るのが最優先のため、Intl に任せない）。 */
    if (dec === 0) {
      return "¥" + Math.round(Number(v) || 0).toLocaleString("en-US");
    }
    const n = Math.round((Number(v) || 0) * Math.pow(10, dec)) / Math.pow(10, dec);
    try {
      const shown = new Intl.NumberFormat(rule.locale, {
        style: "currency", currency: rule.currency,
        minimumFractionDigits: dec, maximumFractionDigits: dec,
      }).format(n);
      /* en-CA の Intl は CAD でも「$」だけを返す。多国対応画面では
         USD と見分けられるよう Canada は CA$ と明示する。 */
      if (rule.currency === "CAD") return shown.replace("$", "CA$");
      if (rule.currency === "AUD") return shown.replace("$", "A$");
      return shown;
    } catch (e) {
      const parts = Math.abs(n).toFixed(dec).split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return (n < 0 ? "-" : "") + rule.symbol + parts.join(".");
    }
  }

  /* 内部の金額（最小単位）を、そのまま画面に出せる形にする。
     画面から金額を出すときは、必ずこちらを通す。
     formatMoney は「主単位を書式にするだけ」の道具として据え置く
     （これまでの呼び出しと意味を変えないため）。 */
  function formatAmount(minorValue, settingsOrCountry) {
    return formatMoney(toMajor(minorValue, settingsOrCountry), settingsOrCountry);
  }

  /* =======================================================================
     保存データを最小単位へ移す（一度きり）
     -----------------------------------------------------------------------
     決めごとは3つ。どれか1つでも外すと、誰かの金額が100倍になる。

       ① 移行済みかは dataVersion だけで決める。金額から推測しない
       ② 記録は **その記録自身の国**（tx.country。無ければJP）で換算する
       ③ 設定は **そのプロファイル自身の国** で換算する
          （settings と moneyProfiles[国] は同じ中身を2か所に持つので、両方）

     いま選んでいる国で一括換算してはいけない。US滞在中に移行すると、
     日本の記録まで100倍になる。

     戻り値の changed が false のときは、何も変えていない（移行済み）。
     ======================================================================= */
  function needsMinorUnitMigration(state) {
    const st = state || {};
    return Number(st.dataVersion) !== DATA_VERSION;
  }

  function migrateToMinorUnits(state) {
    const st = state || {};
    if (!needsMinorUnitMigration(st)) {
      return { state: st, changed: false, txConverted: 0, profilesConverted: [] };
    }

    const out = Object.assign({}, st);
    let txConverted = 0;

    /* ② 記録：その記録自身の国で換算する */
    out.tx = (Array.isArray(st.tx) ? st.tx : []).map(function (t) {
      if (!t || typeof t !== "object") return t;
      const scale = minorScale(normalizeCountry(t.country));   // 印が無ければJP＝1
      if (scale === 1) return t;                               // 日本の記録は1円も変えない
      const n = Number(t.amount);
      if (!Number.isFinite(n)) return t;
      txConverted++;
      return Object.assign({}, t, { amount: Math.round(n * scale) });
    });

    /* ③ 設定：それぞれの国で換算する */
    const profilesConverted = [];
    if (st.settings) out.settings = settingsToMinor(st.settings);
    if (st.moneyProfiles && typeof st.moneyProfiles === "object" && !Array.isArray(st.moneyProfiles)) {
      const mp = {};
      Object.keys(st.moneyProfiles).forEach(function (c) {
        const p = st.moneyProfiles[c];
        /* 鍵の国ではなく、中身が名乗る国でもなく、**両方が一致する国**で換算する。
           食い違っていたら鍵を正とする（保存の場所が正）。 */
        const country = normalizeCountry(c);
        mp[c] = settingsToMinor(Object.assign({}, p, { country: country }));
        if (minorScale(country) !== 1) profilesConverted.push(country);
      });
      out.moneyProfiles = mp;
    }

    out.dataVersion = DATA_VERSION;
    return { state: out, changed: true, txConverted: txConverted, profilesConverted: profilesConverted };
  }

  /* ---------- 設定の正規化 ---------- */
  /* 設定に持つのは「先取り（予定額）」と「夢・目標」だけ。
     旧版の手取り収入(incomeNet)・固定費(fixedCost / fixed)は読み捨てる。
     旧固定費カテゴリ(rent/power/gas/water/comm/subs/insure/fixother)の
     「記録」はそのまま通常の支出として残る。 */
  function normalizeSettings(raw) {
    const s = raw || {};
    /* 旧データには country が無いので currency から推定し、どちらも無ければJP。
       対応5カ国では country を正として、その国の基準通貨と必ず組にする。 */
    const inferredCountry = s.country || countryFromCurrency(s.currency) || "JP";
    const country = normalizeCountry(inferredCountry);
    const out = {
      nisaMonthly: num(s.nisaMonthly),
      goalName: String(s.goalName || "").slice(0, 24),
      goalTarget: num(s.goalTarget),
      goalCurrent: num(s.goalCurrent),
      country: country,
      currency: countryRule(country).currency,
      cycleStart: normalizeCycleStart(s.cycleStart),
      /* 年齢の区間で決める積立に使う。空なら年齢は使わない。 */
      birth: normalizeBirth(s.birth),
    };
    /* ライフプランへ渡す資産。ここだけが入力口で、家計の計算には入れない。
       まだ何も入れていないうちは、設定に持たせない（保存を無駄に太らせないため）。 */
    const lp = normalizeLifePlanAssets(s.lp);
    if (lpHasAny(lp)) out.lp = lp;
    return out;
  }

  /* ---------- 国別のお金プロファイル ----------
     収入・支出記録は各記録の country で分ける。
     ここでは NISA・保険・借入・銀行など「設定として持つ金額」を国別に分離する。
     旧保存データには moneyProfiles が無いので、既存 settings は必ず JP として移行する。
     生年月日は本人共通情報なので、プロファイルを切り替えるときに現在値を上書きして共通利用する。 */
  function profileSettings(raw, country, birth) {
    const c = normalizeCountry(country);
    const src = Object.assign({}, raw || {}, { country: c, currency: countryRule(c).currency });
    if (birth !== undefined) src.birth = birth;
    return normalizeSettings(src);
  }

  function normalizeMoneyProfiles(rawProfiles, legacySettings) {
    const src = rawProfiles && typeof rawProfiles === "object" && !Array.isArray(rawProfiles) ? rawProfiles : {};
    const out = {};
    SUPPORTED_COUNTRIES.forEach(function (c) {
      if (src[c] && typeof src[c] === "object" && !Array.isArray(src[c])) {
        out[c] = profileSettings(src[c], c);
      }
    });
    /* 既存ユーザーの金額は通貨記号だけを変えてUSへ持ち込まず、必ずJPへ退避する。 */
    if (!out.JP && legacySettings && typeof legacySettings === "object") {
      out.JP = profileSettings(legacySettings, "JP");
    }
    return out;
  }

  function settingsForCountry(profiles, country, sharedBirth) {
    const c = normalizeCountry(country);
    const p = profiles && profiles[c] ? profiles[c] : {};
    return profileSettings(p, c, sharedBirth);
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
  /* 行のしるし（id）。
     ライフプラン側は「id が一致する行」を最優先で対応させ、無ければ名前で照合する。
     名前が空・同じ名前が複数あると照合できず、渡すたびに同じ行が増えてしまう。
     そこで id を持ち回る。once 付けた id は作り直さない（作り直すと別の行と見なされる）。 */
  const lpId = (v) => String(v == null ? "" : v).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  /* id は「有るときだけ」持たせる。無い行に空の id を足すと、
     これまでの保存データと形が変わってしまうため。 */
  const lpWithId = function (row, raw) {
    const id = lpId(raw && raw.id);
    if (id) row.id = id;
    return row;
  };
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
      return lpWithId({
        name: lpName(r.name),
        balance: lpNum(r.balance, 1e12),
        monthlyDeposit: lpNum(r.monthlyDeposit, 1e9),
        interestPct: lpNum(r.interestPct, 100),
      }, r);
    });
  }

  function normalizeLpLoans(list) {
    return (Array.isArray(list) ? list : []).slice(0, LP_MAX_ROWS).map(function (l) {
      const r = l || {};
      return lpWithId({
        name: lpName(r.name),
        principal: lpNum(r.principal, 1e12),
        annualRatePct: lpNum(r.annualRatePct, 100),
        monthlyPayment: lpNum(r.monthlyPayment, 1e9),
      }, r);
    });
  }

  function normalizeLpPensions(list) {
    return (Array.isArray(list) ? list : []).slice(0, LP_MAX_ROWS).map(function (p) {
      const r = p || {};
      return lpWithId({
        name: lpName(r.name),
        contribFromAge: lpAge(r.contribFromAge),
        contribToAge: lpAge(r.contribToAge),
        monthlyContribution: lpNum(r.monthlyContribution, 1e9),
        payoutFromAge: lpAge(r.payoutFromAge),
        payoutToAge: lpAge(r.payoutToAge),
        monthlyPayout: lpNum(r.monthlyPayout, 1e9),
      }, r);
    });
  }

  /* 一括投資。ライフプランの lumpSums と同じ形（年齢と金額）。
     まとまったお金なので、毎月の家計には入れない。渡すだけ。 */
  function normalizeLpLumps(list) {
    return (Array.isArray(list) ? list : []).slice(0, LP_MAX_ROWS).map(function (r) {
      const row = r || {};
      return lpWithId({ age: lpAge(row.age), amount: lpNum(row.amount, 1e12) }, row);
    });
  }

  /* 生命保険。ライフプランの insurancePolicies と同じ形（保険料の期間と月額）。
     出ていくお金なので、毎月固定の支出として数える。 */
  function normalizeLpInsurance(list) {
    return (Array.isArray(list) ? list : []).slice(0, LP_MAX_ROWS).map(function (r) {
      const row = r || {};
      return lpWithId({
        name: lpName(row.name),
        premiumFromAge: lpAge(row.premiumFromAge),
        premiumToAge: lpAge(row.premiumToAge),
        monthlyPremium: lpNum(row.monthlyPremium, 1e9),
        coverageUntilAge: lpAge(row.coverageUntilAge),
      }, row);
    });
  }

  /* iDeCo。掛金は毎月出ていくお金なので、先取りとして数える（lpSetAsideItems を見よ）。
     評価額・受取年齢などは、ライフプランへ渡すためだけに持つ。 */
  function normalizeLpIdeco(raw) {
    const i = raw || {};
    return {
      currentValue: lpNum(i.currentValue, 1e12),
      principalTotal: lpNum(i.principalTotal, 1e12),
      monthlyContribution: lpNum(i.monthlyContribution, 1e9),
      startAge: lpAge(i.startAge),
      endAge: lpAge(i.endAge),
      productName: lpName(i.productName),
      payoutStartAge: lpAge(i.payoutStartAge),
      payoutYears: lpNum(i.payoutYears, 60),
    };
  }

  /* =======================================================================
     どの欄が「お金」か
     -----------------------------------------------------------------------
     移行で100倍事故が起きるのは、ほぼここの取り違えによる。
     ライフプラン欄には、お金でない数値が混ざっている。
       ％（interestPct / annualRatePct）、年齢（fromAge …）、
       グラム（currentGrams）、年数（payoutYears）
     これらに 100 を掛けたら、利率5%が500%になる。
     そこで **お金の欄だけを、この1つの表で決める**。
     移行も検算も、必ずこの表を読む。表に無い欄は絶対に触らない。
     ======================================================================= */
  const MONEY_FIELDS = Object.freeze({
    /* 設定そのもの */
    settings: Object.freeze(["nisaMonthly", "goalTarget", "goalCurrent"]),
    /* settings.lp の中。obj = 単体、list = 配列の各行 */
    lpObj: Object.freeze({
      gold: Object.freeze(["pricePerGram", "monthlyYen"]),          // currentGrams はグラム
      ideco: Object.freeze(["currentValue", "principalTotal", "monthlyContribution"]),
    }),
    lpList: Object.freeze({
      banks: Object.freeze(["balance", "monthlyDeposit"]),          // interestPct は％
      loans: Object.freeze(["principal", "monthlyPayment"]),        // annualRatePct は％
      privatePensionPlans: Object.freeze(["monthlyContribution", "monthlyPayout"]),
      lumpSums: Object.freeze(["amount"]),
      insurancePolicies: Object.freeze(["monthlyPremium"]),
    }),
    /* 年齢の区間。中に銘柄の配列を持つ */
    lpSchedule: Object.freeze(["tsumitateSchedule", "growthSchedule"]),
    lpScheduleFields: Object.freeze(["monthlyYen"]),
    lpFundFields: Object.freeze(["amount"]),
  });

  /* 設定1つぶんのお金の欄に、同じ変換をかける。
     conv は「その欄の数をどう変えるか」だけを受け持つ純粋関数。
     元の設定は書き換えず、写しを返す。 */
  function mapSettingsMoney(settings, conv) {
    const s = JSON.parse(JSON.stringify(settings || {}));
    const at = function (obj, keys) {
      if (!obj || typeof obj !== "object") return;
      keys.forEach(function (k) { if (k in obj) obj[k] = conv(obj[k]); });
    };
    at(s, MONEY_FIELDS.settings);
    const lp = s.lp;
    if (lp && typeof lp === "object") {
      Object.keys(MONEY_FIELDS.lpObj).forEach(function (k) { at(lp[k], MONEY_FIELDS.lpObj[k]); });
      Object.keys(MONEY_FIELDS.lpList).forEach(function (k) {
        if (Array.isArray(lp[k])) lp[k].forEach(function (row) { at(row, MONEY_FIELDS.lpList[k]); });
      });
      MONEY_FIELDS.lpSchedule.forEach(function (k) {
        if (!Array.isArray(lp[k])) return;
        lp[k].forEach(function (row) {
          at(row, MONEY_FIELDS.lpScheduleFields);
          if (Array.isArray(row && row.funds)) {
            row.funds.forEach(function (f) { at(f, MONEY_FIELDS.lpFundFields); });
          }
        });
      });
    }
    return s;
  }

  /* 設定の金額を、主単位 → 最小単位へ（移行用）。
     基準にする国は **その設定自身の国**。いま画面で選んでいる国ではない。 */
  function settingsToMinor(settings) {
    const country = normalizeCountry((settings || {}).country);
    const scale = minorScale(country);
    if (scale === 1) return JSON.parse(JSON.stringify(settings || {}));   // JPは1つも変えない
    return mapSettingsMoney(settings, function (v) {
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n * scale) : v;
    });
  }

  /* 設定の金額を、最小単位 → 主単位へ（ライフプランへ渡すときだけ使う） */
  function settingsToMajor(settings) {
    const country = normalizeCountry((settings || {}).country);
    const scale = minorScale(country);
    if (scale === 1) return JSON.parse(JSON.stringify(settings || {}));
    return mapSettingsMoney(settings, function (v) {
      const n = Number(v);
      return Number.isFinite(n) ? n / scale : v;
    });
  }

  function normalizeLifePlanAssets(raw) {
    const a = raw || {};
    return {
      gold: normalizeLpGold(a.gold),
      banks: normalizeLpBanks(a.banks),
      loans: normalizeLpLoans(a.loans),
      privatePensionPlans: normalizeLpPensions(a.privatePensionPlans),
      /* NISA積立。ライフプランと同じキー名にそろえる。 */
      tsumitateSchedule: normalizeLpSchedule(a.tsumitateSchedule),
      growthSchedule: normalizeLpSchedule(a.growthSchedule),
      lumpSums: normalizeLpLumps(a.lumpSums),
      insurancePolicies: normalizeLpInsurance(a.insurancePolicies),
      ideco: normalizeLpIdeco(a.ideco),
    };
  }

  /* =======================================================================
     生年月日と、NISA積立のスケジュール
     -----------------------------------------------------------------------
     【なぜ生年月日が要るか】
     ライフプランの積立は「57歳9ヶ月〜65歳・月9万円」のように、年齢の区間で
     決める。いま何歳かが分からないと、どの区間にいるかを決められず、
     今月いくら先取りするのかも出せない。だから生年月日を1つだけ預かる。
     年齢の出し方はライフプラン側（computeAgeFromBirthDate）と同じにする。
     ずれると、渡したあとに向こうで違う金額になってしまう。

     【二重入力にしないための決めごと】
     NISA積立の月額を書ける場所は、いつでも1か所だけ。
       ・生年月日とスケジュールがそろっている → スケジュールが唯一の入力口。
         月額の欄は自動計算の表示になり、打てなくなる。
       ・どちらか欠けている → これまでどおり月額の欄に打つ。
         （前からお使いの方の金額が、ある日いきなり0にならないようにするため）
     ======================================================================= */

  /* 生年月日。妥当でなければ空にする（空なら年齢は使わない）。 */
  function normalizeBirth(v) {
    const s = String(v == null ? "" : v).slice(0, 10);
    return validateDateString(s) ? s : "";
  }

  /* 誕生日の応当日。○年後の同じ月日を返す。
     2月29日生まれのように、その年に同じ日が無いときは、その月の末日にする。
     （日本の満年齢の数え方にならい、うるう年でない年の2月29日生まれは
       2月28日を応当日として、その日に1つ年をとる扱いにする。） */
  function lastDayOfMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function anniversaryUTC(by, bm, bd, years) {
    const y = by + years;
    return Date.UTC(y, bm - 1, Math.min(bd, lastDayOfMonth(y, bm)));
  }

  /* ageFromBirth の逆。「その年齢になる日」を暦で出す。決められなければ ""。

     考え方は ageFromBirth と対（つい）にする。
       ・満年の分は応当日で進める（2月29日生まれは末日へ寄せる）
       ・小数の分は、その年の誕生日から次の誕生日までを日数で割る

     返すのは「その年齢に達する最初の日」。切り上げるのはそのため。
     切り捨てると、まだその年齢になっていない日を返してしまう。
     57.5歳のような小数の年齢にも使う。 */
  function dateAtAge(birth, age) {
    const b = normalizeBirth(birth);
    const a = Number(age);
    if (!b || !Number.isFinite(a) || a < 0) return "";
    const by = Number(b.slice(0, 4)), bm = Number(b.slice(5, 7)), bd = Number(b.slice(8, 10));
    const whole = Math.floor(a);
    const from = anniversaryUTC(by, bm, bd, whole);
    const to = anniversaryUTC(by, bm, bd, whole + 1);
    const days = (to - from) / 864e5;
    /* ごく小さな計算誤差で1日ずれないよう、ほんの少しだけ余裕を見て切り上げる */
    const add = Math.ceil((a - whole) * days - 1e-9);
    return new Date(from + add * 864e5).toISOString().slice(0, 10);
  }

  /* 生年月日と基準日から、小数の年齢を出す。決められなければ null。

     【なぜ経過日数÷365.2425 をやめたか】
     日数を平均年長で割ると、誕生日ちょうどでも 60.001... のような値になり、
     「終了年齢ちょうどは有効（age <= 終了年齢）」という決めごとの境目を
     こちら側の誤差で踏み越えてしまう。
     そこで暦で数える。まず満何年かを出し、そのうえで
     「前の誕生日から次の誕生日までの、どこまで来たか」を小数にする。

       ・誕生日の前日 → 満年齢より小さい
       ・誕生日の当日 → ちょうど整数
       ・誕生日の翌日 → 満年齢より大きい

     小数を残すのは、NISAの区間（57.5歳＝57歳6ヶ月）のように
     年の途中を指す入力があるため。整数の満年齢だけにはしない。 */
  function ageFromBirth(birth, onDate) {
    const b = normalizeBirth(birth);
    const d = validateDateString(onDate) ? onDate : null;
    if (!b || !d) return null;
    const by = Number(b.slice(0, 4)), bm = Number(b.slice(5, 7)), bd = Number(b.slice(8, 10));
    const nt = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
    const bt = Date.UTC(by, bm - 1, bd);
    if (!Number.isFinite(bt) || !Number.isFinite(nt) || nt < bt) return null;

    /* 満何年か。応当日が基準日より後なら、まだその年齢になっていない。 */
    let years = Number(d.slice(0, 4)) - by;
    if (anniversaryUTC(by, bm, bd, years) > nt) years -= 1;
    if (years < 0) years = 0;

    const from = anniversaryUTC(by, bm, bd, years);       // 直前の誕生日
    const to = anniversaryUTC(by, bm, bd, years + 1);     // 次の誕生日
    const span = to - from;
    if (!(span > 0)) return years;                        // 念のため（0除算を作らない）
    return years + (nt - from) / span;
  }

  /* 銘柄別の内訳。ライフプランの tsumitateAllocation と同じ形。 */
  function normalizeLpAllocation(list) {
    return (Array.isArray(list) ? list : []).slice(0, LP_MAX_ROWS).map(function (r) {
      const row = r || {};
      return { name: lpName(row.name), amount: lpNum(row.amount, 1e9) };
    });
  }

  /* 年齢の区間スケジュール。
     月額は<b>銘柄の合計</b>で決める（打つ場所を1か所にするため）。
     旧い保存データ（monthlyYen だけ持っていたもの）も読めるようにしてある。 */
  function normalizeLpSchedule(list) {
    return (Array.isArray(list) ? list : []).slice(0, LP_MAX_ROWS).map(function (r) {
      const row = r || {};
      const from = lpAge(row.fromAge);
      const to = lpAge(row.toAge);
      const funds = normalizeLpAllocation(row.funds);
      const sum = funds.reduce(function (a, f) { return a + f.amount; }, 0);
      return lpWithId({
        fromAge: from,
        /* 終わりが始まりより前にならないようにする */
        toAge: to < from ? from : to,
        funds: funds,
        /* 銘柄が入っていればその合計。まだ無ければ、旧データの月額をそのまま使う。 */
        monthlyYen: funds.length ? sum : lpNum(row.monthlyYen, 1e9),
      }, row);
    });
  }

  /* その年齢のときに積み立てている銘柄の内訳。
     ライフプランの tsumitateAllocation は「いまの内訳」1つぶんなので、
     いま動いている区間のものを渡す。動いていなければ、次に始まる区間のもの。 */
  function lpAllocationAt(schedule, age) {
    const rows = normalizeLpSchedule(schedule);
    if (!rows.length) return [];
    if (Number.isFinite(age)) {
      const now = rows.filter(function (r) { return age >= r.fromAge && age <= r.toAge; });
      if (now.length) {
        const merged = [];
        now.forEach(function (r) { r.funds.forEach(function (f) { merged.push(f); }); });
        return merged;
      }
      const next = rows.filter(function (r) { return r.fromAge > age; })
        .sort(function (a, b) { return a.fromAge - b.fromAge; })[0];
      if (next) return next.funds;
    }
    return rows[0].funds;
  }

  /* ある年齢のときの月額。区間が重なっていれば足す（ライフプランと同じ数え方）。 */
  function scheduledMonthly(schedule, age) {
    if (!Number.isFinite(age)) return 0;
    return normalizeLpSchedule(schedule).reduce(function (sum, r) {
      return (age >= r.fromAge && age <= r.toAge) ? sum + r.monthlyYen : sum;
    }, 0);
  }

  /* スケジュールで先取り額を決められる状態か（生年月日と区間がそろっているか）。 */
  function nisaAuto(settings) {
    const s = settings || {};
    const lp = s.lp || {};
    const hasSchedule = (Array.isArray(lp.tsumitateSchedule) && lp.tsumitateSchedule.length > 0) ||
      (Array.isArray(lp.growthSchedule) && lp.growthSchedule.length > 0);
    return !!normalizeBirth(s.birth) && hasSchedule;
  }

  /* 今月ぶんの NISA先取り額。
     基準日はその区切りの初日にする（「いま」に依らず、いつ計算しても同じ答えになる）。 */
  function nisaPlannedOn(settings, onDate) {
    const s = settings || {};
    if (!nisaAuto(s)) return num(s.nisaMonthly);
    const age = ageFromBirth(s.birth, onDate);
    if (age === null) return num(s.nisaMonthly);
    const lp = s.lp || {};
    return Math.round(scheduledMonthly(lp.tsumitateSchedule, age) + scheduledMonthly(lp.growthSchedule, age));
  }

  /* 「いつから いくら」を画面に出すための材料。まだ始まっていない区間を探す。 */
  function nisaUpcoming(settings, onDate) {
    const s = settings || {};
    if (!nisaAuto(s)) return null;
    const age = ageFromBirth(s.birth, onDate);
    if (age === null) return null;
    const lp = s.lp || {};
    const rows = normalizeLpSchedule(lp.tsumitateSchedule).concat(normalizeLpSchedule(lp.growthSchedule));
    const future = rows.filter(function (r) { return r.fromAge > age; })
      .sort(function (a, b) { return a.fromAge - b.fromAge; });
    if (!future.length) return null;
    const fromAge = future[0].fromAge;
    /* 「その日からいくら」は、その日に新しく始まる区間だけではなく、
       その時点ですでに継続中のつみたて＋成長投資枠も含めたNISA全体を出す。 */
    const monthly = scheduledMonthly(lp.tsumitateSchedule, fromAge) +
      scheduledMonthly(lp.growthSchedule, fromAge);
    /* その年齢になる日。判定に使う ageFromBirth と同じ暦の数え方で出す。 */
    return { fromAge: fromAge, monthly: Math.round(monthly), startDate: dateAtAge(s.birth, fromAge) };
  }

  /* この欄に入れた「毎月の金額」。
     決めごと：ここに入れたものは<b>記録から入れない</b>。
     毎月ひとりでに出ていくお金として、先取りに足す（NISA・貯金と同じ扱い）。
     支出には足さない。両方に足すと二重に引かれてしまう。 */
  const lpSum = function (rows) { return rows.reduce(function (s2, r) { return s2 + r.amount; }, 0); };

  /* いま払っている期間の中か。
     考え方は NISA のスケジュール（scheduledMonthly）と同じで、
     「開始年齢 <= いまの年齢 <= 終了年齢」なら払っている。

     ただし、これまで期間を見ずに足していたため、
     期間が入っていない古い保存データがそのまま残っている。
     いきなり0円にすると、これまで引かれていた分が消えて金額が変わってしまう。
     判断できないときは「払っている」側に倒す（安全側＝これまでどおり）。

       ・生年月日が未入力      → 年齢が出せないので、払っている扱い
       ・開始も終了も未入力    → 期間の指定なし。払っている扱い
       ・開始だけ入っている    → その年齢から先はずっと払っている
       ・終了だけ入っている    → その年齢までは払っている
       ・開始 > 終了（不正）   → 判断できないので、払っている扱い（勝手に直さない）
  */
  function lpInPeriod(fromAge, toAge, age) {
    const from = Number(fromAge) > 0 ? Number(fromAge) : null;
    const to = Number(toAge) > 0 ? Number(toAge) : null;
    if (!Number.isFinite(age)) return true;          // 年齢が出せない
    if (from === null && to === null) return true;   // 期間の指定なし
    if (from !== null && to !== null && from > to) return true;  // 逆さま＝不正
    if (from !== null && age < from) return false;   // まだ始まっていない
    if (to !== null && age > to) return false;       // もう終わっている
    return true;
  }

  /* 期間の中にある分だけを足す */
  function lpActiveSum(rows, fromKey, toKey, amountKey, age) {
    return (Array.isArray(rows) ? rows : []).reduce(function (s2, r) {
      if (!r) return s2;
      return lpInPeriod(r[fromKey], r[toKey], age) ? s2 + (Number(r[amountKey]) || 0) : s2;
    }, 0);
  }

  /* 貯まっていくお金 → 先取り。使えるお金から取り分けるが、支出ではない。 */
  function lpSetAsideItems(settings, age) {
    const a = normalizeLifePlanAssets((settings || {}).lp);
    const rows = [];
    if (a.gold.monthlyYen > 0) rows.push({ key: "gold", name: "金（きん）の積立", amount: a.gold.monthlyYen });
    const bank = a.banks.reduce(function (s2, b) { return s2 + b.monthlyDeposit; }, 0);
    if (bank > 0) rows.push({ key: "banks", name: "銀行への入金", amount: bank });
    /* 掛ける期間の中にある契約だけを足す */
    const pen = lpActiveSum(a.privatePensionPlans, "contribFromAge", "contribToAge", "monthlyContribution", age);
    if (pen > 0) rows.push({ key: "pension", name: "民間年金の掛金", amount: pen });
    /* iDeCoの掛金も、毎月ほんとうに出ていくお金なので先取りに入れる。
       受給年齢まで引き出せないが、それは「使えるお金」から外す理由であって、
       家計から出ていかない理由ではない。金や民間年金の掛金と同じ扱いにする。
       ただし給与から天引きされていて、記録の給与が天引き後の手取りなら、
       ここに入れると二重に引かれる。その場合は掛金を0のままにする。 */
    const ide = lpActiveSum([a.ideco], "startAge", "endAge", "monthlyContribution", age);
    if (ide > 0) rows.push({ key: "ideco", name: "iDeCoの掛金", amount: ide });
    return rows;
  }

  /* 出ていって戻らないお金 → 毎月固定の支出。借入の返済と生命保険の保険料。 */
  function lpSpendItems(settings, age) {
    const a = normalizeLifePlanAssets((settings || {}).lp);
    const rows = [];
    const loan = a.loans.reduce(function (s2, l) { return s2 + l.monthlyPayment; }, 0);
    if (loan > 0) rows.push({ key: "loans", name: "借入の返済", amount: loan });
    /* 保険料を払う期間の中にある契約だけを足す（保障が続く年齢とは別物） */
    const ins = lpActiveSum(a.insurancePolicies, "premiumFromAge", "premiumToAge", "monthlyPremium", age);
    if (ins > 0) rows.push({ key: "insurance", name: "生命保険の保険料", amount: ins });
    return rows;
  }

  function lpMonthlyItems(settings, age) { return lpSetAsideItems(settings, age).concat(lpSpendItems(settings, age)); }
  function lpMonthlyTotal(settings, age) { return lpSum(lpMonthlyItems(settings, age)); }

  /* 中身が空かどうか。空なら設定に持たせない（端末の保存領域を無駄に使わないため）。 */
  function lpHasAny(assets) {
    const a = normalizeLifePlanAssets(assets);
    return a.banks.length > 0 || a.loans.length > 0 || a.privatePensionPlans.length > 0 ||
      a.tsumitateSchedule.length > 0 || a.growthSchedule.length > 0 || a.lumpSums.length > 0 ||
      a.insurancePolicies.length > 0 || a.ideco.monthlyContribution > 0 || a.ideco.currentValue > 0 ||
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

  /* ---- 設定とホームに出す「毎月いくら」 ----
     ここは長く残高（金の評価額・預金残高・借入の元金）を出していた。
     そのため毎月の積立額や返済額を入れても画面の数字が動かず、
     「入れたのに反映されない」ように見えていた。出すのは毎月動くお金にする。

     足し算のもとは lpMonthlyItems ひとつだけにする（先取り＋毎月固定の支出）。
     ここで別に足し直すと、使えるお金の計算と画面がずれる。
     NISAだけは年齢の区間から決まるので日付が要る（nisaPlannedOn が唯一の正）。 */
  function lpMonthlyOf(settings, kind, age) {
    const rows = lpMonthlyItems(settings, age);
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].key === kind) return rows[i].amount;
    }
    return 0;
  }

  /* ---- 行のしるし（id）を、まだ無い行にだけ付ける ----
     すでに id がある行には絶対に付け替えない。
     付け替えると、ライフプラン側が別の行と見なして同じものが二重に増える。
     makeId を渡せば作り方を差し替えられる（テスト用）。 */
  let lpIdSeq = 0;
  function lpNewId() {
    lpIdSeq += 1;
    return "k" + Date.now().toString(36) + lpIdSeq.toString(36) +
      Math.floor(Math.random() * 1679616).toString(36);
  }
  function lpEnsureIds(assets, makeId) {
    const gen = typeof makeId === "function" ? makeId : lpNewId;
    const a = normalizeLifePlanAssets(assets);
    const fix = function (list) {
      return list.map(function (r) {
        return r.id ? r : Object.assign({}, r, { id: lpId(gen()) });
      });
    };
    a.banks = fix(a.banks);
    a.loans = fix(a.loans);
    a.privatePensionPlans = fix(a.privatePensionPlans);
    a.insurancePolicies = fix(a.insurancePolicies);
    a.lumpSums = fix(a.lumpSums);
    a.tsumitateSchedule = fix(a.tsumitateSchedule);
    a.growthSchedule = fix(a.growthSchedule);
    return a;
  }

  /* ---- 名前も金額も入っていない行を捨てる ----
     「＋ 足す」で作った直後の空行は残す（書いている途中だから）。
     捨てるのは「この内容で保存する」を押したときだけ。呼ぶ側で使い分ける。 */
  function lpRowIsEmpty(row) {
    if (!row) return true;
    const keys = Object.keys(row);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k === "id") continue;                    // しるしだけの行は空とみなす
      const v = row[k];
      if (Array.isArray(v)) { if (v.length > 0) return false; continue; }
      if (typeof v === "string") { if (v.trim() !== "") return false; continue; }
      if (Number(v) !== 0) return false;
    }
    return true;
  }
  function lpDropEmptyRows(assets) {
    const a = normalizeLifePlanAssets(assets);
    const keep = function (list) {
      return list.filter(function (r) { return !lpRowIsEmpty(r); });
    };
    a.banks = keep(a.banks);
    a.loans = keep(a.loans);
    a.privatePensionPlans = keep(a.privatePensionPlans);
    a.insurancePolicies = keep(a.insurancePolicies);
    a.lumpSums = keep(a.lumpSums);
    a.tsumitateSchedule = keep(a.tsumitateSchedule);
    a.growthSchedule = keep(a.growthSchedule);
    return a;
  }

  /* ライフプランアプリへ渡す形。
     向こうの「バックアップの読み込み」がそのまま受け取れる { inputs: ... } にする。
     読み込み側は差分をかぶせる作りなので、ここで渡した4つだけが入れ替わり、
     年齢や年金など向こうで入れた値は消えない。 */
  function buildLifePlanInputs(settings, onDate) {
    const s = settings || {};
    /* ライフプランへ渡す数値は、これまでどおり **主単位** にする。
       内部を最小単位にしても、相手のアプリは1行も直さなくてよい。
       日本は scale=1 なので、渡す数値は1円も変わらない。 */
    const major = settingsToMajor(s);
    const a = normalizeLifePlanAssets(major.lp);
    /* 基準日。指定が無ければ今日（銘柄の内訳は「いま積み立てている区間」のものを渡す）。 */
    const on = validateDateString(onDate) ? onDate : new Date().toISOString().slice(0, 10);
    const age = ageFromBirth(s.birth, on);
    /* ライフプラン側の区間は月額だけを持つので、銘柄は落として渡す */
    const strip = function (r) {
      const o = { fromAge: r.fromAge, toAge: r.toAge, monthlyYen: r.monthlyYen };
      /* 行のしるしは落とさない。落とすと向こうで名前照合になり、
         区間は名前を持たないので、渡すたびに同じ区間が増えてしまう。 */
      if (r.id) o.id = r.id;
      return o;
    };
    /* 空の分類は<b>渡さない</b>。
       「家計簿に登録が無い」だけで、ライフプラン側の既存データを消してはいけない。
       受け取る側は、届かなかった分類にはいっさい手を触れない。 */
    const only = function (obj) {
      const out = {};
      Object.keys(obj).forEach(function (k) {
        const v = obj[k];
        if (Array.isArray(v) ? v.length > 0 : v && Object.keys(v).length > 0) out[k] = v;
      });
      return out;
    };
    /* 中身がすべて0の gold / ideco も「未登録」とみなす */
    const filled = function (o) {
      return Object.keys(o).some(function (k) { return Number(o[k]) > 0 || (typeof o[k] === "string" && o[k]); });
    };
    return {
      /* 家計簿から来たデータだと分かるようにする。
         通常のバックアップ復元と同じ扱いにさせないための目印。 */
      source: "kakeibo",
      schemaVersion: 2,
      /* 渡している数値がどの単位かを明示する。
         受け取る側が取り違えないための宣言（値そのものは従来と同じ）。 */
      amount_unit: "major",
      minor_unit_scale: minorScale(normalizeSettings(s).country),
      appVersion: APP_VERSION,
      generatedAt: on,
      /* どの国のデータかを必ず添える。JPとUSのデータが混ざらないようにするため。 */
      countryCode: normalizeSettings(s).country,
      baseCurrency: normalizeSettings(s).currency,
      /* 生年月日。ライフプラン側は書き換えず、食い違っていたら知らせるだけに使う。
         これを渡していなかったため、その知らせが実際には出ていなかった。 */
      birth: normalizeBirth(s.birth),
      inputs: only({
        gold: filled(a.gold) ? a.gold : {},
        ideco: filled(a.ideco) ? a.ideco : {},
        banks: a.banks,
        loans: a.loans,
        privatePensionPlans: a.privatePensionPlans,
        /* ライフプランは「区間＋月額」と「いまの銘柄の内訳」を別々に持つので、
           こちらの区間（銘柄つき）から作って渡す。 */
        tsumitateSchedule: a.tsumitateSchedule.map(strip),
        growthSchedule: a.growthSchedule.map(strip),
        tsumitateAllocation: lpAllocationAt(a.tsumitateSchedule, age),
        growthAllocation: lpAllocationAt(a.growthSchedule, age),
        lumpSums: a.lumpSums,
        insurancePolicies: a.insurancePolicies,
      }),
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
    /* 国ごとに分ける。印の無い旧データはJP扱いなので、
       日本のユーザーの集計はこれまでと1円も変わらない。 */
    const all = txsForCountry(txs, s);
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
    /* ライフプラン欄の「出ていく毎月の金額」（借入の返済・生命保険）。
       記録からは入れない決めごとなので、ここで毎月固定の支出として足す。 */
    /* その月の年齢（区切りの初日で見る）。生年月日が無ければ null。 */
    const lpAgeNow = ageFromBirth(s.birth, cycleRange(ym, s.cycleStart).from);
    const lpSpend = lpSpendItems(s, lpAgeNow);
    const lpSpendSum = lpSum(lpSpend);
    const spendTotal = sum(expRecs, function (t) { return t.amount; }) + lpSpendSum;

    /* 「毎月固定」の印がついた分と、それ以外。どちらも同じように支出として引く。
       分けているのは、見せ方と、月末の見積もりを暴れさせないためだけ。 */
    const recurringSpend = sum(expRecs.filter(isRecurring), function (t) { return t.amount; }) + lpSpendSum;
    const spotSpend = spendTotal - recurringSpend;

    /* --- 先取り（予定額） --- */
    /* NISAの先取り額。スケジュールがあればそこから、無ければ打ち込んだ月額。
       基準日は区切りの初日にして、いつ計算しても同じ答えになるようにする。 */
    const nisaPlanned = nisaPlannedOn(s, cycleRange(ym, s.cycleStart).from);
    /* 貯まるもの（金・銀行・民間年金）は先取り。出ていくもの（借入・生命保険）は上で支出に足した。 */
    const lpSetAside = lpSetAsideItems(s, lpAgeNow);
    const lpSetAsideSum = lpSum(lpSetAside);
    const lpMonthly = lpSetAside.concat(lpSpend);
    const lpMonthlySum = lpSetAsideSum + lpSpendSum;
    const setAside = nisaPlanned + lpSetAsideSum;

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
      periodLabel: cycleLabel(ym, s.cycleStart, s),
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
      nisaPlanned: nisaPlanned,
      lpMonthly: lpMonthly,
      lpMonthlySum: lpMonthlySum,
      lpSetAside: lpSetAside,
      lpSetAsideSum: lpSetAsideSum,
      lpSpend: lpSpend,
      lpSpendSum: lpSpendSum,
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
  function weekSpent(txs, from, to, settingsOrCountry) {
    const all = txsForCountry(txs, settingsOrCountry);
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

  /* 「合計」など、その行の金額を採用してよい語。
     英語のレシートは書き方がまちまちなので、よく使われる言い方を足す。 */
  /* はっきり「これが合計です」と書いてある言い方。
     -----------------------------------------------------------------------
     これに当たった行は、あとの「拾ってはいけない語」より優先する。
     たとえば英国・豪州の「Total incl VAT」「Total inc GST」は、
     税の語（VAT / GST）を含むので、優先しないと丸ごと捨ててしまう。 */
  const STRONG_TOTAL_KW = /(合\s*計|お会計|ご請求(金)?額|grand\s*total|order\s*total|total\s*due|amount\s*due|balance\s*due|total\s*amount|amount\s*payable|total\s*payable|total\s*to\s*pay|total\s*pay\b|total\s*inc)/i;

  /* 「合計」など、その行の金額を採用してよい語。
     英語圏はレシートの書き方がまちまちなので、よく使われる言い方をひととおり入れる。 */
  const TOTAL_KW = /(合\s*計|お会計|お買[上げい]+\s*計|ご請求(金)?額|税込\s*計|総\s*額|grand\s*total|order\s*total|total\s*due|amount\s*due|balance\s*due|total\s*amount|amount\s*payable|total\s*payable|total\s*to\s*pay|total\s*pay\b|you\s*pay|net\s*payable|purchase\s*total|total)/i;

  /* 合計と紛らわしく、拾ってはいけない語。
     英語の Subtotal は中に total を含むので、必ずこちらで先に落とす。
     税（VAT / GST / HST / PST / QST / Sales Tax）・支払い手段・値引き・
     チップ・数量などの行は、合計ではない。 */
  const SKIP_KW = /(小\s*計|中\s*計|お預[りかり]*|預\s*り|お釣り|釣\s*銭|お返し|現\s*金|クレジット|カード|電子マネー|ポイント|point|値引|割引|外税|内税|消費税|税\s*額|対象額|sub\s*-?\s*total|change\s*due|change|cash\s*tend|tendered|cash|credit|debit|card|visa|mastercard|amex|eftpos|interac|coupon|discount|savings|you\s*saved|loyalty|reward|tip|gratuity|service\s*charge|deposit|refund|rounding|sales\s*tax|\btax\b|\bvat\b|\bgst\b|\bhst\b|\bpst\b|\bqst\b|unit\s*price|\bqty\b|quantity|\bitems?\b\s*[:：]?\s*\d)/i;

  /* 文字列から金額候補を位置つきで拾う。
     -----------------------------------------------------------------------
     戻す value は **最小通貨単位**。dec が 0 の通貨（円）では、
     これまでとまったく同じ整数になる。
     dec が 2 の通貨では "9.99" を 999 として拾う。
     ここで小数を無視すると、$9.99 が 99（＝$99.00）になり、10倍まちがえる。 */
  function amountsIn(str, dec) {
    const d = Math.max(0, Math.floor(Number(dec) || 0));
    const out = [];
    const scale = Math.pow(10, d);
    const re = d > 0
      ? /(?:[¥￥$£€]\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,7}(?:\.\d{1,2})?)(?![\d%％])/g
      : /(?:[¥￥]\s*)?(\d{1,3}(?:,\d{3})+|\d{2,7})(?![\d%％])/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const raw = m[1];
      const plain = raw.replace(/,/g, "");
      /* 小数の無い数字は、これまでどおり2桁以上だけを拾う
         （1桁の数字は品数や番号のことが多いため）。 */
      if (d > 0 && plain.indexOf(".") < 0 && plain.length < 2) continue;
      const v = d > 0 ? majorTextToMinor(plain, d) : parseInt(plain, 10);
      /* 下限は最小単位で 10（円なら10円、ドルなら$0.10）。
         ここを $10.00 にすると $9.99 のレシートが読めなくなる。 */
      if (v >= 10 && v <= 3000000 * scale) {
        out.push({ value: v, index: m.index, raw: raw, yen: /[¥￥$£€]/.test(m[0]) });
      }
    }
    return out;
  }

  function parseAmount(text, mode, dec) {
    const cleaned = stripNonAmounts(text);
    if (!cleaned.trim()) return null;
    const lines = cleaned.split(/\r?\n/);

    /* --- アップ撮影：素直にいちばん大きい金額 --- */
    if (mode === "total") {
      const all = [];
      lines.forEach(function (l) { amountsIn(l, dec).forEach(function (a) { all.push(a); }); });
      if (!all.length) return null;
      const yenOnly = all.filter(function (a) { return a.yen; });
      const pool = yenOnly.length ? yenOnly : all;
      return pool.reduce(function (a, b) { return b.value > a.value ? b : a; }).value;
    }

    /* --- 全体撮影：「合計」の右側の数字だけを拾う --- */
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      /* はっきり合計と書いてある行は、拾ってはいけない語が混ざっていても採る
         （「Total incl VAT」を税の行として捨てないため）。 */
      if (!STRONG_TOTAL_KW.test(line) && SKIP_KW.test(line)) continue;
      const kw = TOTAL_KW.exec(line);
      if (!kw) continue;
      const after = amountsIn(line, dec).filter(function (a) { return a.index >= kw.index; });
      if (after.length) { hits.push(after[after.length - 1].value); continue; }
      /* 合計の金額が次の行にあるレシートもある */
      for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
        if (SKIP_KW.test(lines[j])) continue;
        const nx = amountsIn(lines[j], dec);
        if (nx.length) { hits.push(nx[nx.length - 1].value); break; }
      }
    }
    if (hits.length) return Math.max.apply(null, hits);

    /* --- 合計が読めなかったときだけ、紛らわしい行を除いた最大値 --- */
    const rest = [];
    lines.forEach(function (l) {
      if (SKIP_KW.test(l)) return;
      amountsIn(l, dec).forEach(function (a) { rest.push(a.value); });
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

  /* 写真として受け入れてよい文字列かどうか。
     -----------------------------------------------------------------------
     ここは「先頭だけ」を見てはいけない。先頭さえ合っていれば通す作りにすると、
       data:image/png;base64,AAAA" onerror="…
     のような文字列がそのまま残り、画面が属性へ埋めたときに
     引用符が閉じて別の属性が生まれてしまう（細工したバックアップを
     1回復元させるだけで、端末内のデータを外へ出せる）。
     そこで **末尾まで** 見て、base64 に使える字だけで出来ていることを確かめる。
     画面側でもエスケープするが、そもそも変な値を持たないのが本筋。 */
  const PHOTO_MAX_CHARS = 8 * 1024 * 1024;   // 桁違いに長い文字列で正規表現を走らせない
  const PHOTO_DATA_URL = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
  function isPhotoDataUrl(v) {
    return typeof v === "string" && v.length <= PHOTO_MAX_CHARS && PHOTO_DATA_URL.test(v);
  }

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
  function amountDetails(text, dec) {
    const cleaned = stripNonAmounts(text);
    const lines = cleaned.split(/\r?\n/);
    const out = [];
    lines.forEach(function (line, i) {
      amountsIn(line, dec).forEach(function (a) {
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

  /* 1 = 主単位（移行前）。2 = 最小単位。
     読み込むときは、この版数だけで単位を決める。金額からは推測しない。 */
  const BACKUP_VERSION = 2;
  const BACKUP_VERSION_MAJOR_UNITS = 1;   // これ以下は主単位で書かれている
  const MEMO_MAX = 60;            // メモの上限文字数（記録画面と同じ）
  const AMOUNT_MAX = 999999999;   // 金額の上限（主単位。JPは円、USはドル）
  /* 内部は最小単位なので、上限も最小単位に直して比べる。
     $999,999,999.99 まで入る（JPは 999,999,999円 のまま変わらない）。 */
  function amountMax(settingsOrCountry) {
    return AMOUNT_MAX * minorScale(settingsOrCountry) + (minorScale(settingsOrCountry) - 1);
  }
  const TX_MAX = 20000;           // 記録件数の上限（読み込み時の暴走防止）

  /* 書き出す形。version と exportedAt を付ける。 */
  function buildBackup(state) {
    const st = state || {};
    return {
      version: BACKUP_VERSION,
      /* 読む側が単位を取り違えないよう、必ず明示する */
      amountUnit: "minor",
      minorUnitScale: MINOR_UNIT_SCALE,
      exportedAt: new Date().toISOString(),
      settings: normalizeSettings(st.settings),
      moneyProfiles: normalizeMoneyProfiles(st.moneyProfiles, st.settings),
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
    /* 上限はその記録の国で決める。内部は最小単位なので、
       日本は 999,999,999円、USは $999,999,999.99 が上限になる。 */
    const max = amountMax(normalizeCountry(tx.country));
    if (amount > max) amount = max;             // 巨大値は上限で止める

    if (!validateDateString(tx.date)) return null;            // 日付が不正なら捨てる

    const pool = type === "income" ? INC_CATS : EXP_CATS;
    const cat = pool.some(function (c) { return c.k === tx.cat; })
      ? tx.cat
      : (type === "income" ? "other" : "other");              // 未知のカテゴリは「その他」へ

    const memo = String(tx.memo == null ? "" : tx.memo).slice(0, MEMO_MAX);

    /* 写真は data URL の画像だけを受け入れる。それ以外は捨てる。
       末尾まで確かめる（isPhotoDataUrl のコメントを参照）。 */
    const photo = isPhotoDataUrl(tx.photo) ? tx.photo : null;

    const id = (typeof tx.id === "string" && tx.id) ? tx.id.slice(0, 64) : null;

    /* 「毎月固定」の印。支出のときだけ意味がある。 */
    const recurring = type === "expense" && tx.recurring === true;

    const out = { id: id, type: type, amount: amount, cat: cat, date: tx.date, memo: memo, photo: photo };
    if (recurring) out.recurring = true;
    /* 国の印。JPのときはキーごと持たない。
       こうすると、これまでの日本のデータと保存の形がまったく同じになる。 */
    const country = normalizeCountry(tx.country);
    if (tx.country && country !== "JP") out.country = country;
    return out;
  }

  /* 記録の並びを安全な形に整える。
     -----------------------------------------------------------------------
     復元のときも、端末から読み込むときも、必ずここを通す。
     片方だけ整える作りにすると、同じ内容の記録が経路によって
     別の中身になってしまう（金額の上限が効く／効かない、など）。
     戻り値の dropped は「捨てた件数」。 */
  function normalizeTxListWithCount(list) {
    const src = Array.isArray(list) ? list : [];
    const seen = {};
    const tx = [];
    let dropped = 0;
    src.slice(0, TX_MAX).forEach(function (raw) {
      const t = normalizeTransaction(raw);
      if (!t) { dropped++; return; }
      /* id が無い・重複しているものには新しい id を振る */
      if (!t.id || seen[t.id]) t.id = "r" + tx.length + "-" + Math.random().toString(36).slice(2, 8);
      seen[t.id] = true;
      tx.push(t);
    });
    if (src.length > TX_MAX) dropped += src.length - TX_MAX;
    return { tx: tx, dropped: dropped };
  }
  function normalizeTxList(list) { return normalizeTxListWithCount(list).tx; }

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
    /* 単位は version だけで決める。金額の値からは推測しない。
         印なし / 1 … 主単位で書かれている → JP以外を最小単位へ直す
         2         … 最小単位。そのまま
         3 以上    … このアプリより新しい。黙って誤変換せず、はっきり断る */
    const ver = Number(data.version) || 0;
    if (ver > BACKUP_VERSION) {
      throw new Error("このバックアップは新しすぎます。アプリを更新してからお試しください");
    }

    let src = {
      settings: settings,
      moneyProfiles: data.moneyProfiles,
      tx: data.tx,
    };
    if (ver <= BACKUP_VERSION_MAJOR_UNITS) {
      /* 移行前のバックアップ。端末の移行とまったく同じ決めごとで直す
         （記録は tx.country、設定は各プロファイルの国）。 */
      src = migrateToMinorUnits({
        settings: settings,
        moneyProfiles: data.moneyProfiles,
        tx: data.tx,
      }).state;
    }

    const r = normalizeTxListWithCount(src.tx);
    const tx = r.tx;
    const dropped = r.dropped;
    return {
      settings: normalizeSettings(src.settings),
      moneyProfiles: normalizeMoneyProfiles(src.moneyProfiles, src.settings),
      tx: tx,
      health: normalizeHealth(data.health),   // 旧バックアップに health が無ければ空
      diary: normalizeDiary(data.diary),       // 旧バックアップに diary が無ければ空
      plans: normalizePlans(data.plans),       // 旧バックアップに plans が無ければ空
      pulse: normalizePulseList(data.pulse),   // 旧バックアップに pulse が無ければ空
      dropped: dropped,
      version: ver,   // 旧形式は version が無い＝0
    };
  }

  /* =======================================================================
     健康記録（体重・血圧。将来 体温なども同じ形で足せる）
     -----------------------------------------------------------------------
     入れ物は日付キーの1日1件。同じ日に記録し直せば上書き。
     { "2026-07-25": { weight:62.5, bpHigh:120, bpLow:78 } }
     ======================================================================= */
  /* 健康の項目名。保存されるのは k（内部ID）だけで、n は日本語の表示名。
     英語の表示名は t("health.<k>") から取る。 */
  function healthFieldName(key, settingsOrCountry) {
    const f = HEALTH_FIELDS.filter(function (x) { return x.k === key; })[0];
    if (!f) return String(key || "");
    return UI_TEXT["health." + key] ? t("health." + key, settingsOrCountry) : f.n;
  }

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
  /* 測定状態の呼び名。保存されるのは rest / post / other という内部IDのまま。 */
  function pulseCondLabel(cond, settingsOrCountry) {
    return PULSE_CONDS[cond] ? t("pulse." + cond, settingsOrCountry) : String(cond || "");
  }
  function pulseFailMessage(settingsOrCountry) { return t("pulse.fail", settingsOrCountry); }
  const PULSE_MAX = 500;          // 履歴の上限件数（古いものから落とす）

  function pulseQualityLabel(stars, settingsOrCountry) {
    const n = Math.round(Number(stars));
    if (!PULSE_QUALITY_LABELS[n]) return "—";
    return t("pulse.q" + n, settingsOrCountry);
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
      /* 写真は画像の data URL だけ受け入れる（XSS・不正値を弾く）。
         末尾まで確かめる（isPhotoDataUrl のコメントを参照）。 */
      if (isPhotoDataUrl(raw.photo)) photo = raw.photo;
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

  /* 電卓は「打ち込む側の数（主単位）」を字で受け取り、
     計算そのものは **最小単位の整数** でやる。
       ・cur … いま打っている字。主単位のまま（"12.3" のように途中の形も持つ）
       ・acc … 計算の途中の答え。最小単位の整数
     こうすると 0.1 + 0.2 が 0.30000000000000004 にならない。
     小数の無い通貨（円）では dec = 0 になり、これまでとまったく同じ動きになる。 */
  function calcScale(c) { return Math.pow(10, (c && c.dec) || 0); }

  function newCalc(dec) {
    const d = Math.max(0, Math.min(4, Math.floor(Number(dec) || 0)));
    return { acc: null, op: "", cur: "", done: false, expr: "", error: "", dec: d };
  }

  /* その国の電卓を作る（小数の桁数を通貨から決める） */
  function newCalcFor(settingsOrCountry) {
    return newCalc(currencyDecimals(countryRule(countryOf(settingsOrCountry)).currency));
  }

  /* 打ち込みの字（主単位）→ 最小単位の整数。
     途中で小数点だけ打った "12." のような形も受ける。
     字のまま桁を組むので、掛け算・割り算の誤差が入らない。 */
  function majorTextToMinor(text, dec) {
    const d = Math.max(0, Math.floor(Number(dec) || 0));
    const t = String(text == null ? "" : text).replace(/[^\d.]/g, "");
    const m = /^(\d*)(?:\.(\d*))?/.exec(t) || [];
    const intPart = m[1] || "0";
    const fracPart = (m[2] || "").slice(0, d);
    const frac = d === 0 ? 0 : Number((fracPart + "0".repeat(d)).slice(0, d));
    return Number(intPart) * Math.pow(10, d) + frac;
  }

  /* 打ち込みの字 → 最小単位。通貨の桁より下は **四捨五入** する。
     -----------------------------------------------------------------------
     切り捨てにすると、円で "1.5" と打ったときに黙って ¥1 になる。
     打った額と残る額が違うのに何も知らされない、がいちばん困る。
     ここも字のまま桁を組むので、掛け算の誤差は入らない。 */
  function majorTextToMinorRound(text, dec) {
    const d = Math.max(0, Math.floor(Number(dec) || 0));
    const t = String(text == null ? "" : text).replace(/[^\d.]/g, "");
    const m = /^(\d*)(?:\.(\d*))?/.exec(t) || [];
    const intPart = m[1] || "0";
    const frac = m[2] || "";
    const keep = d === 0 ? 0 : Number((frac.slice(0, d) + "0".repeat(d)).slice(0, d));
    let v = Number(intPart) * Math.pow(10, d) + keep;
    if (Number(frac.charAt(d) || "0") >= 5) v += 1;   // 次の桁で繰り上げる
    return v;
  }

  /* その通貨で表せる細かさより下の桁を打っているか。
     円で "1.5"、ドルで "1.234" のような場合に true。
     四捨五入で額が変わるので、記録したあとに必ず知らせるために使う。 */
  function majorTextHasExtraDecimals(text, dec) {
    const d = Math.max(0, Math.floor(Number(dec) || 0));
    const t = String(text == null ? "" : text).replace(/[^\d.]/g, "");
    const m = /^\d*(?:\.(\d*))?/.exec(t) || [];
    const frac = m[1] || "";
    return /[1-9]/.test(frac.slice(d));
  }

  /* 最小単位の整数 → 打ち込み欄に出す字（主単位）。 */
  function minorToMajorText(value, dec) {
    const d = Math.max(0, Math.floor(Number(dec) || 0));
    const n = Math.round(Number(value) || 0);
    if (d === 0) return String(n);
    const sign = n < 0 ? "-" : "";
    const a = Math.abs(n);
    const p = Math.pow(10, d);
    return sign + Math.floor(a / p) + "." + String(a % p).padStart(d, "0");
  }

  /* 数から電卓の状態を作る（記録を直すとき・レシートから金額を入れたとき）。
     value は打ち込む側の数＝主単位（"12.34" も受ける）。 */
  function calcFrom(value, dec) {
    const c = newCalc(dec);
    const t = String(value == null ? "" : value).replace(/[^\d.]/g, "");
    if (t !== "" && t !== ".") c.cur = calcTrimEntry(t, c);
    return c;
  }

  /* 打ち込みの字を、桁数の決まりに収める。
     整数部は CALC_DIGITS_MAX 桁まで、小数部はその通貨の桁数まで。 */
  /* 打てる小数の桁数。通貨に小数が無くても2桁までは打てるようにする。
     5か国で電卓の操作を同じにするため（円は、記録するときに1円へ丸める）。 */
  const CALC_INPUT_DEC = 2;
  function calcInputDec(c) { return Math.max((c && c.dec) || 0, CALC_INPUT_DEC); }

  function calcTrimEntry(text, c) {
    const d = calcInputDec(c);
    const t = String(text).replace(/[^\d.]/g, "");
    const dot = t.indexOf(".");
    let intPart = dot < 0 ? t : t.slice(0, dot);
    let frac = dot < 0 ? null : t.slice(dot + 1).replace(/\./g, "");
    if (intPart.length > 1) intPart = intPart.replace(/^0+(?=\d)/, "");
    intPart = intPart.slice(0, CALC_DIGITS_MAX);
    if (d === 0 || frac === null) return intPart;
    return intPart + "." + frac.slice(0, d);
  }

  function calcFmt(v, c) {
    const text = minorToMajorText(v, (c && c.dec) || 0);
    const neg = text.charAt(0) === "-";
    const body = neg ? text.slice(1) : text;
    const parts = body.split(".");
    parts[0] = Number(parts[0]).toLocaleString("en-US");
    return (neg ? "-" : "") + parts.join(".");
  }

  /* ひとつ計算する。すべて最小単位の整数どうし。0で割ろうとしたときだけ null。
     掛け算・割り算は「金額 × 個数」の意味なので、倍率でならしてから丸める
     （$1.00 × 3 は $3.00。小数の無い通貨では、これまでの式とまったく同じ）。 */
  function calcApply(a, op, b, scale) {
    const s = scale || 1;
    if (op === "+") return a + b;
    if (op === "-") return a - b;
    if (op === "*") return Math.round((a * b) / s);
    if (op === "/") return b === 0 ? null : Math.round((a / b) * s);
    return b;
  }

  /* いま打ち込んでいる数（最小単位）。未入力なら acc、それも無ければ 0。 */
  function calcEntry(c) {
    if (c.cur !== "") return majorTextToMinorRound(c.cur, c.dec || 0);
    if (c.acc !== null) return c.acc;
    return 0;
  }

  /* 大きく出す字。まだ何も打っていなければ空文字（プレースホルダの 0 が出る）。 */
  function calcDisplay(c) {
    if (!c) return "";
    if (c.cur !== "") return c.cur;
    if (c.acc !== null) return minorToMajorText(c.acc, c.dec || 0);
    return "";
  }

  /* 待っている計算まで済ませた、最終的な金額（最小単位） */
  function calcValue(c) {
    if (!c) return 0;
    if (c.op && c.acc !== null && c.cur !== "") {
      const r = calcApply(c.acc, c.op, majorTextToMinorRound(c.cur, c.dec || 0), calcScale(c));
      return r === null ? c.acc : r;
    }
    return calcEntry(c);
  }

  /* キーを1つ押した結果を返す。元の状態は変えない。
     key: "0"〜"9" ／ "+" "-" "*" "/" ／ "=" ／ "C" ／ "back" ／ "00" "000" */
  function calcPress(state, key) {
    const c = Object.assign(newCalc((state || {}).dec), state || {});
    c.error = "";
    const k = String(key);
    const scale = calcScale(c);

    if (k === "C") return newCalc(c.dec);

    if (k === "back") {
      if (c.done) return newCalc(c.dec);
      c.cur = c.cur.slice(0, -1);
      return c;
    }

    /* 小数点。5か国とも同じように打てる。
       円のように小数の無い通貨では、記録するときに1円へ四捨五入する。 */
    if (k === "." || k === "．") {
      if (c.done) { c.acc = null; c.op = ""; c.cur = ""; c.done = false; c.expr = ""; }
      if (c.cur.indexOf(".") >= 0) return c;           // 2つ目の小数点は置かない
      c.cur = (c.cur === "" ? "0" : c.cur) + ".";
      return c;
    }

    if (/^0+$|^[1-9]\d*$|^\d$/.test(k) && /^\d{1,3}$/.test(k)) {
      /* 数字（"0" "7" "00" "000"） */
      if (c.done) { c.acc = null; c.op = ""; c.cur = ""; c.done = false; c.expr = ""; }
      const next = c.cur === "0" ? k : c.cur + k;
      c.cur = calcTrimEntry(next, c);
      return c;
    }

    if (CALC_OPS.indexOf(k) >= 0) {
      if (c.op && c.acc !== null && c.cur !== "") {
        const r = calcApply(c.acc, c.op, majorTextToMinorRound(c.cur, c.dec), scale);
        if (r === null) { c.error = "0では割れません"; return c; }
        c.acc = r;
      } else {
        c.acc = calcEntry(c);
      }
      c.cur = "";
      c.op = k;
      c.done = false;
      c.expr = calcFmt(c.acc, c) + " " + CALC_OP_LABEL[k];
      return c;
    }

    if (k === "=") {
      if (!c.op || c.acc === null) return c;          // 計算するものが無い
      const b = c.cur === "" ? c.acc : majorTextToMinorRound(c.cur, c.dec);
      const r = calcApply(c.acc, c.op, b, scale);
      if (r === null) { c.error = "0では割れません"; return c; }
      c.expr = calcFmt(c.acc, c) + " " + CALC_OP_LABEL[c.op] + " " + calcFmt(b, c) + " ＝";
      c.acc = null;
      c.op = "";
      c.cur = minorToMajorText(r, c.dec);
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

  /* 度で計算するとき、90の倍数は先に answer を決めてしまう。
     -----------------------------------------------------------------------
     90° を弧度へ直すと π/2 ちょうどにはならないので、そのまま Math に渡すと
       tan(90)  → 1.633124e+16   （本当は定義できない）
       sin(180) → 1.224647e-16   （本当は 0）
       cos(90)  → 6.123234e-17   （本当は 0）
     のような値が画面に出る。市販の関数電卓は Error と 0 を返すので、
     そちらに合わせる。弧度モードのときは、この分岐を通さない
     （π は近似値なので、0 に丸めてしまうとかえって嘘になる）。 */
  function sciDegSpecial(name, x) {
    const m = ((x % 360) + 360) % 360;
    if (!Number.isInteger(m)) return undefined;      // 90の倍数だけを見る
    if (name === "sin") { if (m === 0 || m === 180) return 0; if (m === 90) return 1; if (m === 270) return -1; }
    if (name === "cos") { if (m === 90 || m === 270) return 0; if (m === 0) return 1; if (m === 180) return -1; }
    if (name === "tan") { if (m === 0 || m === 180) return 0; if (m === 90 || m === 270) return NaN; }
    return undefined;
  }

  function sciCallFunc(name, x, deg) {
    if (deg && (name === "sin" || name === "cos" || name === "tan") && Number.isFinite(x)) {
      const special = sciDegSpecial(name, x);
      if (special !== undefined) return special;
    }
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
    if (!list) return { ok: false, error: "式が正しくありません", errorKey: "calc.badExpr" };
    const rpn = sciToRpn(list);
    if (!rpn) return { ok: false, error: "かっこが合っていません", errorKey: "calc.parens" };
    const r = sciRunRpn(rpn, o.deg !== false);
    if (!r) return { ok: false, error: "式が正しくありません", errorKey: "calc.badExpr" };
    if (r.divZero) return { ok: false, error: "0では割れません", errorKey: "calc.divZero" };
    if (!Number.isFinite(r.value)) return { ok: false, error: "計算できません", errorKey: "calc.notNum" };
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

    if (s.tokens.length >= SCI_TOKENS_MAX) { s.error = "式が長すぎます"; s.errorKey = "calc.tooLong"; return s; }
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

  /* 関数電卓の答えを、家計簿へ入れる金額（**最小単位**）に直す。
     -----------------------------------------------------------------------
     関数電卓は主単位のふつうの数で計算している（12.34 は $12.34）。
     記録は最小単位なので、その通貨の桁数ぶんだけ位を上げてから渡す。

     dec が 0 の通貨（円）は、これまでどおり「1円以上の整数」のときだけ。
     dec が 2 の通貨は、セントまでなら受ける（$12.34 は入る、$12.345 は入らない）。
     入れられない答えのときは null を返し、画面はボタンを出さない。 */
  function sciRecordAmount(sci, dec) {
    const v = sci && sci.result;
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    const d = Math.max(0, Math.floor(Number(dec) || 0));
    const scale = Math.pow(10, d);
    /* その通貨で表せる細かさへ丸める。
       -----------------------------------------------------------------------
       以前は「ちょうど表せる答え」しか記録させなかった。そのため日本では
       1000÷3 や √2 や sin30 のように割り切れない答えでボタンが出ず、
       関数電卓で計算した額をそのまま記録できなかった。
       いまは丸めて記録できるようにし、**丸めたあとの額をボタンに出す**ので、
       いくらで記録されるかは押す前に必ず見える。 */
    const minor = Math.round(v * scale);
    if (!(minor > 0)) return null;      // 0円以下は記録しない
    return minor;
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
    const mine = txsForCountry(st.tx, st.settings);
    const txs = mine.filter(function (t) { return t && t.date === date; });
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
    txsForCountry(st.tx, st.settings).forEach(function (t) {
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
  function budgetBreakdown(c, settingsOrCountry) {
    /* 国は、渡されなければ計算結果の設定から取る（画面が渡し忘れても正しく出る） */
    const c1 = settingsOrCountry === undefined ? ((c && c.settings) || "JP") : settingsOrCountry;
    const income = Math.max(0, Number(c && c.incomeTotal) || 0);
    const spend = Math.max(0, Number(c && c.spendTotal) || 0);
    const setAside = Math.max(0, Number(c && c.setAside) || 0);
    const remain = Math.max(0, income - spend - setAside);   // のこり（マイナスは0扱い）
    const over = Math.max(0, spend + setAside - income);     // 使いすぎ分（収入を超えた分）
    const base = income > 0 ? income : (spend + setAside);   // 収入0なら支出+先取りを基準に
    const pct = function (v) { return base > 0 ? Math.round((v / base) * 100) : 0; };
    const parts = [
      { key: "spend",    name: t("sum.spend", c1),    amount: spend,    color: "#c2694f", pct: pct(spend) },
      { key: "setAside", name: t("home.miniSetAside", c1), amount: setAside, color: "#7f9cc0", pct: pct(setAside) },
      { key: "remain",   name: t("sum.left", c1),     amount: remain,   color: "#6f9c78", pct: pct(remain) },
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
        label: monthShort(Number(m.slice(5, 7)), settings),
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
  function categoryCompare(txs, ym, n, startDay, settingsOrCountry) {
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
        name: catName("expense", k, settingsOrCountry),
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
  function weekdaySpend(txs, ym, startDay, settingsOrCountry) {
    const rows = WEEKDAY_NAMES.map(function (n, i) {
      return { dow: i, name: weekdayShort(i, settingsOrCountry), amount: 0, count: 0 };
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
  function analysisInsights(a, settingsOrCountry) {
    const out = [];
    const pace = a.pace, cats = a.cats || [];
    /* 文章はことばの表（UI_TEXT）から組み立てる。
       日本語は今までと同じ文字列になるように書いてある。 */
    const c0 = settingsOrCountry === undefined ? (a.country || "JP") : settingsOrCountry;
    const T = function (key, vars) { return t(key, c0, vars); };
    const M = function (v) { return formatMoney(v, c0); };

    if (!pace.hasIncome) {
      out.push({ level: "info", key: "no-income",
        text: T("ins.noIncome") });
    } else if (pace.spendTotal > 0 && pace.budget > 0 && pace.isCurrent) {
      if (pace.over > 0) {
        out.push({ level: "warn", key: "pace",
          text: T("ins.paceOver", { forecast: M(pace.forecast), budget: M(pace.budget), over: M(pace.over) }) });
      } else {
        out.push({ level: "good", key: "pace",
          text: T("ins.paceOk", { forecast: M(pace.forecast), left: M(-pace.over) }) });
      }
    }

    const spent = cats.filter(function (c) { return c.now > 0; });
    const up = cats.slice().sort(function (x, y) { return y.diff - x.diff; })[0];
    if (up && up.diff > 0 && up.prev > 0) {
      out.push({ level: "warn", key: "up",
        text: T("ins.up", { emoji: up.emoji, name: up.name, amount: M(up.diff) }) });
    }
    if (spent.length) {
      out.push({ level: "info", key: "top",
        text: T("ins.top", { emoji: spent[0].emoji, name: spent[0].name, amount: M(spent[0].now), share: spent[0].share }) });
    }
    const down = cats.slice().sort(function (x, y) { return x.diff - y.diff; })[0];
    if (down && down.diff < 0 && down.prev > 0) {
      out.push({ level: "good", key: "down",
        text: T("ins.down", { emoji: down.emoji, name: down.name, amount: M(-down.diff) }) });
    }
    if (pace.noSpendDays > 0 && pace.spendTotal > 0) {
      out.push({ level: "good", key: "no-spend",
        text: T("ins.noSpend", { n: pace.noSpendDays }) });
    }
    if (pace.recurringSoFar > 0 && pace.spentSoFar > 0) {
      out.push({ level: "info", key: "recurring",
        text: T("ins.recurring", { amount: M(pace.recurringSoFar),
          share: Math.round((pace.recurringSoFar / pace.spentSoFar) * 100) }) });
    }
    const busiest = (a.week || []).slice().sort(function (x, y) { return y.amount - x.amount; })[0];
    if (busiest && busiest.amount > 0) {
      out.push({ level: "info", key: "weekday",
        text: T("ins.weekday", { name: busiest.name, amount: M(busiest.amount) }) });
    }
    return out.slice(0, 5);
  }

  /* ---------- 分析ぜんぶ（画面はこれだけを読む） ---------- */
  function analyzeMonth(settings, txs, ym, opts) {
    const o = opts || {};
    const s = normalizeSettings(settings);
    const startDay = s.cycleStart;
    /* いまの国の記録だけを見る。ここで1回絞れば、下の集計は全部そろう。 */
    const mine = txsForCountry(txs, s);
    const out = {
      ym: ym,
      country: s.country,
      month: computeMonth(settings, mine, ym),
      trend: monthlyTrend(settings, mine, ym, o.trendMonths || TREND_MONTHS),
      cats: categoryCompare(mine, ym, o.compareMonths || COMPARE_MONTHS, startDay, s),
      week: weekdaySpend(mine, ym, startDay, s),
      pace: spendPace(settings, mine, ym, o.today || null),
    };
    out.insights = analysisInsights(out, s);
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
  function recurringCarryPlan(txs, ym, startDay, settingsOrCountry) {
    const all = txsForCountry(txs, settingsOrCountry);
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
        name: catName("expense", t.cat, settingsOrCountry),
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
    const s = normalizeSettings(st.settings);
    /* いまの国の記録だけを見る（印の無い旧データはJP） */
    const txs = txsForCountry(st.tx, s);
    const startDay = s.cycleStart;
    const ym = cycleOf(today, startDay);
    const out = [];
    const T = function (key, vars) { return t(key, s, vars); };

    /* 1. 先月の「毎月固定」がまだ入っていない（金額に効くので最優先） */
    const plan = recurringCarryPlan(txs, ym, startDay, s);
    if (plan.toAdd.length > 0) {
      out.push({
        key: "carry", icon: "🔁", act: "carry",
        text: T("task.carry", { n: plan.toAdd.length }),
        sub: T("task.carrySub", { amount: formatMoney(plan.total, s) }),
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
          text: T("task.salary"),
          sub: T("task.salarySub"),
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
          text: T("task.quiet", { n: gap }),
          sub: T("task.quietSub"),
        });
      }
    }

    /* 4. 続けている習慣が、今日はまだ。続けていない人には出さない。 */
    if (isHabit(st.diary, today) && !(st.diary || {})[today]) {
      out.push({
        key: "diary", icon: "📖", act: "diary",
        text: T("task.diary"), sub: T("task.diarySub"),
      });
    }
    if (isHabit(st.health, today) && !(st.health || {})[today]) {
      out.push({
        key: "health", icon: "❤️", act: "health",
        text: T("task.health"), sub: T("task.healthSub"),
      });
    }

    return out.slice(0, TASK_MAX);
  }

  /* ---------- ライフプラン連携スナップショット ---------- */
  function buildSnapshot(settings, txs, ym) {
    const c = computeMonth(settings, txs, ym);
    /* 渡す数値は主単位に戻す。日本は scale=1 なので1円も変わらない。
       内部（最小単位）と食い違っていないことを、渡す直前に必ず検算する。
       黙って100倍の数を渡すくらいなら、渡さないほうが良い。 */
    const scale = minorScale(c.settings.country);
    const M = function (minorValue) {
      const n = Number(minorValue) || 0;
      const out = scale === 1 ? n : n / scale;
      if (Math.round(out * scale) !== Math.round(n)) {
        throw new Error("金額の単位が合いません（ライフプランへ渡すのを中止しました）");
      }
      return out;
    };

    const accounts = [];
    /* 「先取り貯金」の欄は廃止した。貯金の予定額は、ライフプラン欄の
       銀行貯金（毎月の入金）から出す。書ける場所をひとつにするため。 */
    const bankPlanned = c.lpMonthly.reduce(function (t, r) {
      return r.key === "banks" ? t + r.amount : t;
    }, 0);
    if (bankPlanned > 0) {
      accounts.push({
        type: "CASH_SAVINGS", local: "貯金",
        basis: "planned", planned_contribution: M(bankPlanned),
      });
    }
    if (c.nisaPlanned > 0) {
      accounts.push({
        type: "TAX_FREE_INVEST", local: "NISA",
        basis: "planned", planned_contribution: M(c.nisaPlanned),
      });
    }
    return {
      schema_version: "2.3",
      /* この数値がどの単位かを明示する。値そのものは従来と同じ。 */
      amount_unit: "major",
      minor_unit_scale: scale,
      country_code: c.settings.country,
      base_currency: c.currency,
      locale: countryLocale(c.settings),
      year_month: ym,
      /* 月の区切り。起点が1日なら period_from/to はその月の1日と末日になる。 */
      cycle_start_day: c.cycleStart,
      period_from: c.periodFrom,
      period_to: c.periodTo,

      /* 収入：通常／臨時／当月実収入合計を分けて出力（すべて記録の実績） */
      income_regular: M(c.incomeRegular),
      income_regular_basis: "actual",
      income_regular_recorded: c.incomeRegularRecorded,
      income_extra: M(c.incomeExtra),
      income_actual_total: M(c.incomeTotal),
      /* 後方互換。旧 income_net は「当月の実収入合計」を指す */
      income_net: M(c.incomeTotal),

      /* 支出：すべて記録した実績。
         fixed_cost … 「🔁 毎月固定」の印が付いた記録の合計（印が無ければ0）
         variable_spend … それ以外
         どちらも足すと spend_total になる。 */
      fixed_cost: M(c.recurringSpend),
      fixed_cost_items: Object.keys(c.byCatRecurring).map(function (k) {
        /* key は国が変わっても同じ内部ID。name は表示用にその国のことばで添える。 */
        return { key: k, name: catName("expense", k, c.settings), amount: M(c.byCatRecurring[k]) };
      }),
      variable_spend: M(c.spotSpend),
      spend_total: M(c.spendTotal),
      expense_total: M(c.spendTotal),
      by_category: Object.keys(c.byCat).map(function (k) {
        return { key: k, name: catName("expense", k, c.settings), amount: M(c.byCat[k]) };
      }),

      /* 先取りは「予定額」であることを構造で明示 */
      planned_set_aside: M(c.setAside),
      accounts: accounts,

      available_to_spend: M(c.available),
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
    COUNTRY_RULES: COUNTRY_RULES,
    SUPPORTED_COUNTRIES: SUPPORTED_COUNTRIES,
    COUNTRY_LANG: COUNTRY_LANG,
    CURRENCY_DECIMALS: CURRENCY_DECIMALS,
    normalizeCountry: normalizeCountry,
    countryFromCurrency: countryFromCurrency,
    countryRule: countryRule,
    countryOf: countryOf,
    countryLang: countryLang,
    countryLocale: countryLocale,
    isSupportedCountry: isSupportedCountry,
    pickCountry: pickCountry,
    currencyDecimals: currencyDecimals,
    weekdayShort: weekdayShort,
    weekdayLabel: weekdayLabel,
    monthName: monthName,
    monthShort: monthShort,
    formatMonthDay: formatMonthDay,
    formatDateHeading: formatDateHeading,
    formatDate: formatDate,
    formatYearMonth: formatYearMonth,
    EXP_CAT_EN: EXP_CAT_EN,
    INC_CAT_EN: INC_CAT_EN,
    catName: catName,
    catDisplay: catDisplay,
    lpRowName: lpRowName,
    UI_TEXT: UI_TEXT,
    t: t,
    txCountry: txCountry,
    txsForCountry: txsForCountry,
    formatMoney: formatMoney,
    normalizeSettings: normalizeSettings,
    normalizeMoneyProfiles: normalizeMoneyProfiles,
    settingsForCountry: settingsForCountry,
    LP_MAX_ROWS: LP_MAX_ROWS,
    normalizeLifePlanAssets: normalizeLifePlanAssets,
    normalizeLpGold: normalizeLpGold,
    normalizeLpBanks: normalizeLpBanks,
    normalizeLpLoans: normalizeLpLoans,
    normalizeLpPensions: normalizeLpPensions,
    normalizeBirth: normalizeBirth,
    ageFromBirth: ageFromBirth,
    dateAtAge: dateAtAge,
    normalizeLpSchedule: normalizeLpSchedule,
    normalizeLpAllocation: normalizeLpAllocation,
    normalizeLpLumps: normalizeLpLumps,
    lpAllocationAt: lpAllocationAt,
    normalizeLpInsurance: normalizeLpInsurance,
    normalizeLpIdeco: normalizeLpIdeco,
    lpInPeriod: lpInPeriod,
    lpActiveSum: lpActiveSum,
    lpSetAsideItems: lpSetAsideItems,
    lpSpendItems: lpSpendItems,
    lpMonthlyItems: lpMonthlyItems,
    lpMonthlyTotal: lpMonthlyTotal,
    scheduledMonthly: scheduledMonthly,
    nisaAuto: nisaAuto,
    nisaPlannedOn: nisaPlannedOn,
    nisaUpcoming: nisaUpcoming,
    lpHasAny: lpHasAny,
    lpGoldValue: lpGoldValue,
    lpBanksTotal: lpBanksTotal,
    lpLoansTotal: lpLoansTotal,
    lpPensionMonthly: lpPensionMonthly,
    lpMonthlyOf: lpMonthlyOf,
    lpEnsureIds: lpEnsureIds,
    lpRowIsEmpty: lpRowIsEmpty,
    lpDropEmptyRows: lpDropEmptyRows,
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
    normalizeTxList: normalizeTxList,
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
    pulseCondLabel: pulseCondLabel,
    pulseFailMessage: pulseFailMessage,
    healthFieldName: healthFieldName,
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
    sciRecordAmount: sciRecordAmount,
    SCI_TOKENS_MAX: SCI_TOKENS_MAX,
    SCI_HISTORY_MAX: SCI_HISTORY_MAX,
    newCalc: newCalc,
    newCalcFor: newCalcFor,
    majorTextToMinor: majorTextToMinor,
    majorTextToMinorRound: majorTextToMinorRound,
    majorTextHasExtraDecimals: majorTextHasExtraDecimals,
    CALC_INPUT_DEC: CALC_INPUT_DEC,
    minorToMajorText: minorToMajorText,
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
    amountMax: amountMax,
    DATA_VERSION: DATA_VERSION,
    MINOR_UNIT_SCALE: MINOR_UNIT_SCALE,
    MONEY_FIELDS: MONEY_FIELDS,
    minorScale: minorScale,
    toMinor: toMinor,
    toMajor: toMajor,
    formatAmount: formatAmount,
    settingsToMinor: settingsToMinor,
    settingsToMajor: settingsToMajor,
    needsMinorUnitMigration: needsMinorUnitMigration,
    migrateToMinorUnits: migrateToMinorUnits,
    BACKUP_VERSION: BACKUP_VERSION,
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
