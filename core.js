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
       ・支出 … 固定費（家賃・電気・ガス…）も変動費（食費・外食…）も同じ記録
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

  /* ---------- 設定の正規化 ---------- */
  /* 設定に持つのは「先取り（予定額）」と「夢・目標」だけ。
     旧版の手取り収入(incomeNet)・固定費(fixedCost / fixed)は読み捨てる。 */
  function normalizeSettings(raw) {
    const s = raw || {};
    return {
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

    /* --- 支出：すべて「記録」から。予定額は持たない --- */
    const expRecs = month.filter(function (t) { return t.type === "expense"; });
    const fixedRecs = expRecs.filter(function (t) { return isFixedCat(t.cat); });
    const varRecs = expRecs.filter(function (t) { return !isFixedCat(t.cat); });
    const fixedSpend = sum(fixedRecs, function (t) { return t.amount; });
    const variableSpend = sum(varRecs, function (t) { return t.amount; });
    const spendTotal = fixedSpend + variableSpend;

    /* 固定費の内わけ（表示用。記録した分だけ） */
    const fixedDetail = FIXED_ITEMS.map(function (item) {
      const recs = fixedRecs.filter(function (t) { return t.cat === item.k; });
      return {
        key: item.k, name: item.n, emoji: item.e,
        amount: sum(recs, function (t) { return t.amount; }),
        recorded: recs.length > 0,
      };
    }).filter(function (d) { return d.recorded; });

    /* --- 先取り（予定額） --- */
    const savingsPlanned = s.savingsTarget;
    const nisaPlanned = s.nisaMonthly;
    const setAside = savingsPlanned + nisaPlanned;

    /* --- 正式な計算式 --- */
    const available = incomeTotal - spendTotal - setAside;

    /* --- 表示用の内訳 --- */
    const byCat = {};
    varRecs.forEach(function (t) {
      byCat[t.cat] = (byCat[t.cat] || 0) + num(t.amount);
    });
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
      /* 支出（すべて記録した実績） */
      fixedDetail: fixedDetail,
      fixedSpend: fixedSpend,
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
    return Math.round(Math.min(100, s));
  }

  /* 同じ金額をまとめ、点数順に並べる */
  function rankCandidates(list) {
    const byAmount = {};
    (list || []).forEach(function (c) {
      if (!c || !Number.isFinite(c.amount) || c.amount <= 0) return;
      const k = String(c.amount);
      if (!byAmount[k]) {
        byAmount[k] = { amount: c.amount, agree: 0, confidence: 0, raw: c.raw, posScore: 0 };
      }
      const b = byAmount[k];
      b.agree += 1;
      b.confidence = Math.max(b.confidence, Number(c.confidence) || 0);
      b.posScore = Math.max(b.posScore, Number.isFinite(c.posScore) ? c.posScore : 0.5);
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

      /* 支出：すべて記録した実績（予定額は持たない） */
      fixed_cost: c.fixedSpend,
      fixed_cost_items: c.fixedDetail.map(function (d) {
        return { key: d.key, name: d.name, amount: d.amount };
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
