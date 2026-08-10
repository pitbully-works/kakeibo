/* =========================================================================
   かけいぼ ― 2026-08 の検査で見つかった不具合の再発防止テスト
   -------------------------------------------------------------------------
   守りたいこと：
     ① 写真の data URL が属性を抜け出せない（入口で弾き、出口でも逃がす）
     ②③ グラフの左端の日付が、月末でも時差でもずれない
     ④ 記録の金額が、保存経路・再起動・復元のどれを通っても変わらない
     ⑦ カメラの許可を待っている最中に離れても、必ず止まる

     どれも「壊れても画面上は動いて見える」たぐいなので、
     気づけるのはテストだけ。1件も外さないこと。

   ここで直したことのうち、5カ国対応・国別プロファイル・
   ライフプラン連携・既存の金額計算には手を入れていない。
   それを確かめるテストもこのファイルの最後に置く。

   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

const appSrc = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const swSrc = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");

const D = (d) => "2026-08-" + String(d).padStart(2, "0");

/* =========================================================================
   ① 写真の data URL ― 入口で弾き、出口でも逃がす（二重の守り）
   ========================================================================= */

/* 属性を抜け出すための細工。先頭だけ見る検証では素通りしてしまう。 */
const BREAKOUT = 'data:image/png;base64,AAAA" onerror="x()" a="';
const OK_PHOTO = "data:image/png;base64,AAAA";

test("①入口：記録の写真は、data URL を末尾まで確かめる", () => {
  const tx = (photo) => Core.normalizeTransaction({
    type: "expense", amount: 100, cat: "food", date: D(10), photo });

  assert.equal(tx(BREAKOUT).photo, null, "引用符を含む写真を受け入れている");
  assert.equal(tx(OK_PHOTO).photo, OK_PHOTO, "まっとうな写真まで捨てている");
});

test("①入口：日記の写真も、data URL を末尾まで確かめる", () => {
  const one = (photo) => Core.normalizeDiary({ [D(10)]: { text: "あ", photo } })[D(10)];

  assert.equal("photo" in one(BREAKOUT), false, "引用符を含む写真を受け入れている");
  assert.equal(one(OK_PHOTO).photo, OK_PHOTO, "まっとうな写真まで捨てている");
});

test("①入口：抜け出しに使える字は、どれも通さない", () => {
  const bad = [
    'data:image/png;base64,AA" onerror="x()',      // 二重引用符
    "data:image/png;base64,AA' onerror='x()",      // 一重引用符
    "data:image/png;base64,AA><script>x()</script>",
    "data:image/png;base64,AA javascript:x()",
    "data:image/svg+xml;base64,AAAA",              // SVGはスクリプトを持てる
    "data:text/html;base64,AAAA",
    "javascript:x()",
    " data:image/png;base64,AAAA",                 // 先頭の空白でごまかす
    "data:image/png;base64,AAAA\n<img onerror=x>",
  ];
  for (const v of bad) {
    assert.equal(
      Core.normalizeTransaction({ type: "expense", amount: 1, cat: "food", date: D(10), photo: v }).photo,
      null, "通してはいけない写真を受け入れた: " + JSON.stringify(v));
  }
});

test("①入口：バックアップから復元しても、細工した写真は残らない", () => {
  const b = Core.normalizeBackup({
    settings: {},
    tx: [{ type: "expense", amount: 100, cat: "food", date: D(10), photo: BREAKOUT }],
    diary: { [D(10)]: { text: "あ", photo: BREAKOUT } },
  });
  assert.equal(b.tx[0].photo, null, "記録に細工した写真が残っている");
  assert.equal("photo" in b.diary[D(10)], false, "日記に細工した写真が残っている");
});

test("①出口：写真を出す場所は、すべて属性を逃がしてから書く", () => {
  /* 入口で弾いているので普段は届かない。それでも出口を素通しにはしない。
     入口の1行が将来ゆるんだときに、ここが最後の砦になる。 */
  const imgs = appSrc.match(/<img[^>]*src="\$\{[^}]*\}"/g) || [];
  assert.ok(imgs.length >= 3, "写真を出す場所が見つからない");
  for (const tag of imgs) {
    assert.match(tag, /src="\$\{escapeAttr\(/, "逃がさずに写真を出している: " + tag);
  }
});

test("①出口：escapeHtml は、二重引用符も一重引用符も逃がす", () => {
  const app = bootApp({});
  assert.equal(app.run(`escapeHtml('a"b')`), "a&quot;b", "二重引用符が逃げていない");
  assert.equal(app.run(`escapeHtml("a'b")`), "a&#39;b", "一重引用符が逃げていない");
  assert.equal(app.run(`escapeHtml("<&>")`), "&lt;&amp;&gt;");
  assert.equal(app.run(`escapeAttr('a"b')`), "a&quot;b");
});

test("①出口：細工した写真が state に居座っても、属性は生まれない", () => {
  const app = bootApp({});
  app.run(`state.diary=${JSON.stringify({ [D(10)]: { text: "あ", photo: BREAKOUT } })};`);
  const html = app.run(`view="diary"; render(); document.getElementById("app").innerHTML`);
  /* 引用符が生のまま出れば src="" が閉じ、onerror が独立した属性になってしまう。
     逃がされていれば &quot; になり、ただの文字として src の中に留まる。 */
  assert.equal(/onerror="/.test(html), false, "onerror が属性として生まれている");
  assert.equal(/base64,[^"]*"\s+onerror/.test(html), false, "属性を抜け出している");
  assert.ok(html.includes("&quot;"), "引用符が逃がされていない");
});

/* =========================================================================
   ②③ グラフの左端の日付 ― 月末でも時差でもずれない
   ========================================================================= */

/* 決められた日を「今日」だと思わせて起動する */
function bootAt(iso) {
  const app = bootApp({});
  app.run(`
    const R = Date;
    const F = function (...a) { return a.length ? new R(...a) : new R(${JSON.stringify(iso)}); };
    F.now = R.now; F.parse = R.parse; F.UTC = R.UTC; F.prototype = R.prototype;
    globalThis.Date = F;
  `);
  return app;
}
const fromOn = (iso, range) => {
  const app = bootAt(iso);
  return app.run(`healthRange=${JSON.stringify(range)}; healthFromDate()`);
};

test("②月末に開いても、1か月ぶんの範囲になる", () => {
  /* setMonth を使うと「2月31日」が3月3日へ繰り越し、
     3月31日に開いた1か月グラフが数日ぶんしか出なくなっていた。 */
  const cases = [
    ["2026-01-31T12:00:00", "2026-01-01"],
    ["2026-03-31T12:00:00", "2026-03-01"],
    ["2026-05-31T12:00:00", "2026-05-01"],
    ["2026-07-31T12:00:00", "2026-07-01"],
    ["2026-08-31T12:00:00", "2026-08-01"],
    ["2026-10-31T12:00:00", "2026-10-01"],
    ["2026-12-31T12:00:00", "2026-12-01"],
    ["2026-03-01T12:00:00", "2026-01-30"],   // 月をまたいで戻る
    ["2028-03-01T12:00:00", "2028-01-31"],   // うるう年
  ];
  for (const [now, want] of cases) {
    assert.equal(fromOn(now, "month"), want, "1か月の左端がずれている: " + now);
  }
});

test("②どの日に開いても、左端はきっちり30日前になる", () => {
  for (let m = 1; m <= 12; m++) {
    const last = new Date(Date.UTC(2026, m, 0)).getUTCDate();
    for (const d of [1, 15, last]) {
      const iso = `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const got = fromOn(iso + "T12:00:00", "month");
      assert.equal(Core.daysApart(got, iso), 30, "30日ぶんになっていない: " + iso + " → " + got);
    }
  }
});

test("②「1日」「1週間」も、日数どおりになる", () => {
  assert.equal(fromOn("2026-03-01T12:00:00", "day"), "2026-02-28");
  assert.equal(fromOn("2026-03-01T12:00:00", "week"), "2026-02-22");
  assert.equal(fromOn("2028-03-01T12:00:00", "day"), "2028-02-29", "うるう日を飛ばしている");
});

/* 時差の検証。TZ はプロセス全体にかかるので、国ごとに別の node で確かめる。 */
function fromInTz(tz, whenUtc, range) {
  const script = `
    const { bootApp } = require(${JSON.stringify(path.join(__dirname, "boot-app.cjs"))});
    const app = bootApp({});
    app.run(\`
      const R = Date;
      const F = function (...a) { return a.length ? new R(...a) : new R(${JSON.stringify(whenUtc)}); };
      F.now = R.now; F.parse = R.parse; F.UTC = R.UTC; F.prototype = R.prototype;
      globalThis.Date = F;
    \`);
    process.stdout.write(JSON.stringify({
      today: app.run("todayISO()"),
      from: app.run("healthRange=" + JSON.stringify(${JSON.stringify(range)}) + "; healthFromDate()"),
    }));
  `;
  const out = execFileSync(process.execPath, ["-e", script], { env: Object.assign({}, process.env, { TZ: tz }) });
  return JSON.parse(out.toString());
}

test("③どの国の時差でも、左端はその土地の日付で数える", () => {
  /* toISOString() を使うと、ローカルの日付をUTCへ直してしまう。
     日本では1日多く、アメリカなどでは「昨日」がまるごと消えていた。
     どの土地でも「今日から数えた日数」になっていること。 */
  const moments = [
    "2026-08-10T00:30:00Z",   // 日本は朝、ロンドンは深夜
    "2026-08-10T13:00:00Z",   // 日本は夜、アメリカは午前
    "2026-08-10T23:30:00Z",   // アメリカは夜、豪州は翌朝
  ];
  const zones = [
    ["JP", "Asia/Tokyo"],
    ["US", "America/New_York"],
    ["US(西)", "America/Los_Angeles"],
    ["GB", "Europe/London"],
    ["CA", "America/Toronto"],
    ["AU", "Australia/Sydney"],
  ];
  for (const [label, tz] of zones) {
    for (const when of moments) {
      const day = fromInTz(tz, when, "day");
      assert.equal(Core.daysApart(day.from, day.today), 1,
        `${label} の「1日」がずれている（${when}／今日=${day.today}／左端=${day.from}）`);

      const month = fromInTz(tz, when, "month");
      assert.equal(Core.daysApart(month.from, month.today), 30,
        `${label} の「1か月」がずれている（${when}／今日=${month.today}／左端=${month.from}）`);
    }
  }
});

test("③左端の計算に、UTCへ直す書き方を使っていない", () => {
  const fn = /function healthFromDate\(\)\{[\s\S]*?\n\}/.exec(appSrc);
  assert.ok(fn, "左端を出す関数が見つからない");
  assert.equal(/toISOString/.test(fn[0]), false, "UTCへ直している（時差でずれる）");
  assert.equal(/setMonth/.test(fn[0]), false, "月ずらしを使っている（月末で繰り越す）");
});

/* =========================================================================
   ④ 金額 ― どの経路を通っても同じ値になる
   ========================================================================= */

const fillSheet = (app, amount, extra) => app.run(`
  ${extra || ""}
  document.getElementById("s-amt").value=${JSON.stringify(String(amount))};
  document.getElementById("s-date").value=${JSON.stringify(D(10))};
`);

test("④電卓で作った桁あふれは、上限で止まる", async () => {
  /* 電卓は 9桁×9桁 の掛け算ができる。止めないと18桁が保存され、
     その月の集計がすべて壊れる。 */
  const app = bootApp({});
  app.run(`globalThis.__toasts=[]; const t0=toast; toast=(m)=>{ globalThis.__toasts.push(m); return t0(m); };`);
  app.run(`openRecord(null);`);
  fillSheet(app, "999999998000000000");
  await app.run(`saveTx()`);
  const saved = JSON.parse(app.saved());
  assert.equal(saved.tx.length, 1, "記録されていない");
  assert.equal(saved.tx[0].amount, Core.AMOUNT_MAX, "上限で止まっていない");

  /* 黙って切り詰めない。打った額と残る額が違うのだから、必ず伝える。
     （計算コアでも同じ上限で止めているので、伝えないと
       「なぜか額が変わった」だけが残ってしまう。） */
  const said = app.run(`JSON.stringify(globalThis.__toasts)`);
  assert.match(said, /大きすぎます/, "切り詰めたことを伝えていない: " + said);
});

test("④上限の内側なら、切り詰めたとは言わない", async () => {
  const app = bootApp({});
  app.run(`globalThis.__toasts=[]; const t0=toast; toast=(m)=>{ globalThis.__toasts.push(m); return t0(m); };`);
  app.run(`openRecord(null);`);
  fillSheet(app, Core.AMOUNT_MAX);
  await app.run(`saveTx()`);
  assert.equal(JSON.parse(app.saved()).tx[0].amount, Core.AMOUNT_MAX);
  assert.equal(/大きすぎます/.test(app.run(`JSON.stringify(globalThis.__toasts)`)), false,
    "切り詰めていないのに知らせている");
});

test("④ふつうの金額は、1円も変わらない", async () => {
  for (const v of [1, 100, 1234, 999999999]) {
    const app = bootApp({});
    app.run(`openRecord(null);`);
    fillSheet(app, v);
    await app.run(`saveTx()`);
    assert.equal(JSON.parse(app.saved()).tx[0].amount, v, "金額が変わった: " + v);
  }
});

test("④保存・再起動・復元のどれを通っても、金額は同じ", async () => {
  const app = bootApp({});
  app.run(`openRecord(null);`);
  fillSheet(app, 123456);
  await app.run(`saveTx()`);

  const afterSave = JSON.parse(app.saved()).tx[0];

  /* 再起動：端末に残った内容でもう一度立ち上げる */
  const again = bootApp({ state: JSON.parse(app.saved()) });
  const afterBoot = again.run(`state.tx[0]`);

  /* 復元：バックアップを書き出して読み直す */
  const restored = Core.normalizeBackup(JSON.parse(JSON.stringify(
    Core.buildBackup({ settings: {}, tx: [afterSave] })))).tx[0];

  assert.equal(afterSave.amount, 123456);
  assert.equal(afterBoot.amount, 123456, "再起動で金額が変わった");
  assert.equal(restored.amount, 123456, "復元で金額が変わった");
});

test("④桁あふれた古いデータは、読み込んだ時点で上限まで戻る", () => {
  /* 直す前の版が保存してしまった記録が端末に残っていても、
     開いた時点で正しい上限に収まること。 */
  const app = bootApp({ state: {
    settings: {},
    tx: [{ id: "x1", type: "expense", amount: 999999998000000000, cat: "food", date: D(10), memo: "", photo: null }],
  } });
  assert.equal(app.run(`state.tx[0].amount`), Core.AMOUNT_MAX, "読み込みで整えていない");
});

test("④読み込みでも、壊れた記録は捨てて、まともな記録は残す", () => {
  const app = bootApp({ state: {
    settings: {},
    tx: [
      { id: "ok", type: "expense", amount: 500, cat: "food", date: D(10), memo: "", photo: null },
      { id: "ng", type: "expense", amount: 500, cat: "food", date: "こわれた" },
      { id: "ng2", type: "なにか", amount: 500, cat: "food", date: D(10) },
    ],
  } });
  const ids = app.run(`JSON.stringify(state.tx.map(t=>t.id))`);
  assert.equal(ids, '["ok"]', "壊れた記録が残っている / まともな記録が消えた");
});

test("④記録は、画面ではなく計算コアで整える（整える場所はひとつ）", async () => {
  const app = bootApp({});
  app.run(`
    globalThis.__through = 0;
    const orig = Core.normalizeTransaction;
    Core.normalizeTransaction = function (r) { globalThis.__through++; return orig(r); };
  `);
  app.run(`openRecord(null);`);
  fillSheet(app, 500);
  await app.run(`saveTx()`);
  assert.ok(app.run(`globalThis.__through`) >= 1, "計算コアを通さずに保存している");
});

/* --- 5カ国対応を壊していないこと --- */

test("④国の印は、これまでどおり付く（JPは持たない）", async () => {
  const app = bootApp({ state: { settings: { country: "US" }, tx: [] } });
  app.run(`openRecord(null);`);
  fillSheet(app, 50);
  await app.run(`saveTx()`);
  assert.equal(JSON.parse(app.saved()).tx[0].country, "US", "USの印が付いていない");

  const jp = bootApp({});
  jp.run(`openRecord(null);`);
  fillSheet(jp, 50);
  await jp.run(`saveTx()`);
  assert.equal("country" in JSON.parse(jp.saved()).tx[0], false, "JPに余計な印が付いている");
});

test("④記録を直しても、その記録の国は変わらない", async () => {
  /* US滞在中に日本の記録を直しても、日本の記録のままにする。
     ここを取り違えると、その1件だけ集計から消えたように見える。 */
  const app = bootApp({ state: {
    settings: { country: "US" },
    tx: [{ id: "jp1", type: "expense", amount: 1000, cat: "food", date: D(1), memo: "", photo: null }],
  } });
  app.run(`openRecord("jp1");`);
  fillSheet(app, 2000);
  await app.run(`saveTx()`);
  const t = JSON.parse(app.saved()).tx[0];
  assert.equal(t.amount, 2000, "直っていない");
  assert.equal("country" in t, false, "日本の記録がUSに変わってしまった");
});

test("④国別プロファイルは、読み込みで壊れない", () => {
  const state = {
    settings: { country: "US", nisaMonthly: 300 },
    moneyProfiles: { JP: { country: "JP", nisaMonthly: 50000 }, US: { country: "US", nisaMonthly: 300 } },
    tx: [{ id: "a", type: "expense", amount: 10, cat: "food", date: D(2), country: "US", memo: "", photo: null }],
  };
  const app = bootApp({ state });
  assert.equal(app.run(`state.settings.country`), "US");
  assert.equal(app.run(`state.moneyProfiles.JP.nisaMonthly`), 50000, "JPのお金設定が消えた");
  assert.equal(app.run(`state.moneyProfiles.US.nisaMonthly`), 300, "USのお金設定が消えた");
  assert.equal(app.run(`state.tx[0].country`), "US", "記録の国の印が消えた");
});

/* =========================================================================
   ⑦ カメラ ― 許可を待っている最中に離れても必ず止まる
   ========================================================================= */

test("⑦許可を待っている間に離れたら、届いた映像はその場で止める", () => {
  /* pRunning は許可が下りたあとに立つ。それだけを見張っていると、
     許可の確認が出ている最中に画面を移られたときに止め損ね、
     あとから届いた映像でカメラとライトが点いたまま残る。 */
  assert.match(appSrc, /const gen=\+\+pGen;/, "世代トークンを取っていない");
  assert.match(appSrc, /if\(gen!==pGen \|\| view!=="pulse"\)\{/, "届いた映像を捨てる判定が無い");
  assert.match(appSrc, /stream\.getTracks\(\)\.forEach\(t=>t\.stop\(\)\);/, "捨てる側で止めていない");
});

test("⑦止めるときは、待っている最中の測定も無効にする", () => {
  const stop = /function pulseStopAll\(\)\{[\s\S]*?\n\}/.exec(appSrc);
  assert.ok(stop, "停止処理が見つからない");
  assert.match(stop[0], /pGen\+\+;/, "待っている最中の測定を無効にしていない");
  assert.match(stop[0], /pStopGen=pGen;/, "止めた世代を控えていない");
  /* 止めるときに片づけるもの。1つでも欠けたら、点けっぱなしになる。 */
  for (const [what, re] of [
    ["刻み", /clearInterval\(pTickId\)/],
    ["見張り", /clearInterval\(pWatch\)/],
    ["コマ送り", /cancelAnimationFrame\(pRafId\)/],
    ["映像コマ", /cancelVideoFrameCallback\(pRvfcId\)/],
    ["ライト", /torch:false/],
    ["カメラ", /pStream\.getTracks\(\)\.forEach\(t=>t\.stop\(\)\)/],
    ["画面の点けっぱなし", /pWake\.release\(\)/],
  ]) {
    assert.match(stop[0], re, "止めるときに片づけていない: " + what);
  }
});

test("⑦離れる・移る・閉じるのどれでも、待機中かどうかまで見る", () => {
  const cond = String.raw`\(pRunning \|\| pStream \|\| pGen!==pStopGen\)`;
  assert.match(appSrc, new RegExp(`if\\(view!=="pulse" && ${cond}\\) pulseStopAll\\(\\);`), "画面を移ったとき");
  assert.match(appSrc, new RegExp(`if\\(document\\.hidden\\)\\{ if${cond}`), "画面を離れたとき");
  assert.match(appSrc, new RegExp(`"pagehide",\\(\\)=>\\{ if${cond}`), "閉じるとき");
});

/* =========================================================================
   ⑥ service worker ― 失敗した返事を焼き付けない
   （動かしての確認は sw_test.js。ここは書き方の砦だけ）
   ========================================================================= */

test("⑥キャッシュへ入れる前に、返事が成功か確かめている", () => {
  assert.match(swSrc, /res\.ok/, "成功かどうかを見ていない");
  assert.match(swSrc, /function cacheable\(res\)/, "判定をひとつにまとめていない");
  /* put するところは、すべて判定を通ってから呼ぶこと */
  const puts = (swSrc.match(/\.put\(/g) || []).length;
  assert.equal(puts, 1, "判定を通らない put が増えている");
});

test("⑥キャッシュにも無いときに、空を返さない", () => {
  assert.match(swSrc, /new Response\(/, "オフラインのときの返事が無い");
  assert.match(swSrc, /status: 503/, "オフラインだと分かる返事になっていない");
});

/* =========================================================================
   触っていないことの確認（5カ国・連携・計算）
   ========================================================================= */

test("金額の計算式は、これまでのまま", () => {
  const settings = { cycleStart: 1, nisaMonthly: 30000 };
  const txs = [
    { id: "s", type: "income", amount: 300000, cat: "salary", date: D(25) },
    { id: "b", type: "income", amount: 50000, cat: "bonus", date: D(26) },
    { id: "r", type: "expense", amount: 80000, cat: "rent", date: D(1), recurring: true },
    { id: "f", type: "expense", amount: 20000, cat: "food", date: D(5) },
  ];
  const c = Core.computeMonth(settings, txs, "2026-08");
  assert.equal(c.incomeTotal, 350000);
  assert.equal(c.spendTotal, 100000);
  assert.equal(c.setAside, 30000);
  assert.equal(c.available, 350000 - 100000 - 30000, "使える額の式が変わっている");
});

test("ライフプランへ渡す形は、これまでのまま", () => {
  const snap = Core.buildSnapshot({ cycleStart: 1, nisaMonthly: 30000 },
    [{ id: "s", type: "income", amount: 300000, cat: "salary", date: D(25) }], "2026-08");
  for (const k of ["schema_version", "country_code", "base_currency", "year_month",
                   "cycle_start_day", "period_from", "period_to",
                   "income_regular", "income_extra", "income_actual_total",
                   "spend_total", "expense_total", "by_category",
                   "planned_set_aside", "accounts", "available_to_spend"]) {
    assert.ok(k in snap, "連携の項目が消えている: " + k);
  }
  assert.equal(snap.year_month, "2026-08");
  assert.equal(snap.income_actual_total, 300000);
});

test("5カ国の通貨と表示は、これまでのまま", () => {
  assert.equal(Core.formatMoney(1234, "JP"), "¥1,234");
  assert.equal(Core.formatMoney(1234, "US"), "$1,234.00");
  assert.equal(Core.formatMoney(1234, "GB"), "£1,234.00");
  assert.ok(Core.formatMoney(1234, "CA").startsWith("CA$"));
  assert.ok(Core.formatMoney(1234, "AU").startsWith("A$"));
});
