/* =========================================================================
   かけいぼ ― 健康記録（体重・血圧）のテスト
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

/* ---------- 1. 1件の正規化 ---------- */
test("正常な値はそのまま整えて受け入れる", () => {
  const e = Core.normalizeHealthEntry({ weight: "62.53", bpHigh: 120, bpLow: 78 });
  assert.equal(e.weight, 62.5, "体重の小数が1桁に丸められていない");
  assert.equal(e.bpHigh, 120);
  assert.equal(e.bpLow, 78);
});

test("数値でない・範囲外の項目は捨てる", () => {
  const e = Core.normalizeHealthEntry({ weight: "abc", bpHigh: 999, bpLow: 78 });
  assert.equal("weight" in e, false, "文字列を受け入れている");
  assert.equal("bpHigh" in e, false, "範囲外(999)を受け入れている");
  assert.equal(e.bpLow, 78, "正常な項目まで捨てている");
});

test("負数や巨大値は捨てる", () => {
  assert.equal(Core.normalizeHealthEntry({ weight: -5 }), null);
  assert.equal(Core.normalizeHealthEntry({ weight: 1e9 }), null);
  assert.equal(Core.normalizeHealthEntry({ weight: Infinity }), null);
});

test("中身が空なら記録しない（null）", () => {
  assert.equal(Core.normalizeHealthEntry({}), null);
  assert.equal(Core.normalizeHealthEntry(null), null);
  assert.equal(Core.normalizeHealthEntry("x"), null);
});

test("体重だけ・血圧だけでも記録できる", () => {
  assert.deepEqual(Core.normalizeHealthEntry({ weight: 60 }), { weight: 60 });
  assert.deepEqual(Core.normalizeHealthEntry({ bpHigh: 120, bpLow: 80 }), { bpHigh: 120, bpLow: 80 });
});

/* ---------- 2. 全体の正規化 ---------- */
test("日付キーが妥当なものだけ残す", () => {
  const h = Core.normalizeHealth({
    "2026-07-25": { weight: 62 },
    "2026-02-31": { weight: 61 },   // 存在しない日付
    "bad": { weight: 60 },
    "2026-07-26": { weight: 999 },  // 中身が範囲外→捨てる
  });
  assert.deepEqual(Object.keys(h), ["2026-07-25"], "不正な日付・中身が混ざっている");
});

test("健康データでないものは空オブジェクトになる", () => {
  assert.deepEqual(Core.normalizeHealth(null), {});
  assert.deepEqual(Core.normalizeHealth([1, 2]), {});
  assert.deepEqual(Core.normalizeHealth("x"), {});
});

/* ---------- 3. グラフ用の推移 ---------- */
test("推移は日付順に並ぶ", () => {
  const h = { "2026-07-25": { weight: 62.5 }, "2026-07-20": { weight: 63 }, "2026-07-22": { weight: 62.8 } };
  const s = Core.healthSeries(h, "weight");
  assert.deepEqual(s.map((p) => p.date), ["2026-07-20", "2026-07-22", "2026-07-25"]);
  assert.deepEqual(s.map((p) => p.value), [63, 62.8, 62.5]);
});

test("期間で絞れる（週・月）", () => {
  const h = { "2026-06-01": { weight: 65 }, "2026-07-20": { weight: 63 }, "2026-07-25": { weight: 62 } };
  const s = Core.healthSeries(h, "weight", "2026-07-01", "2026-07-31");
  assert.equal(s.length, 2, "期間外が混ざっている");
  assert.equal(s[0].date, "2026-07-20");
});

test("その項目が無い日は推移に出ない", () => {
  const h = { "2026-07-20": { bpHigh: 120 }, "2026-07-25": { weight: 62 } };
  assert.equal(Core.healthSeries(h, "weight").length, 1);
  assert.equal(Core.healthSeries(h, "bpHigh").length, 1);
});

/* ---------- 4. バックアップに含まれる（旧形式と互換） ---------- */
test("書き出しに健康データが入る", () => {
  const b = Core.buildBackup({ settings: {}, tx: [], health: { "2026-07-25": { weight: 62 } } });
  assert.deepEqual(b.health, { "2026-07-25": { weight: 62 } });
});

test("健康データを含むバックアップを読み込める", () => {
  const r = Core.normalizeBackup({ settings: {}, tx: [], health: { "2026-07-25": { weight: 62, bpHigh: 120, bpLow: 80 } } });
  assert.deepEqual(r.health["2026-07-25"], { weight: 62, bpHigh: 120, bpLow: 80 });
});

test("健康データの無い旧バックアップも読める（空で返る）", () => {
  const r = Core.normalizeBackup({ settings: {}, tx: [] });
  assert.deepEqual(r.health, {}, "health が無いと落ちる");
});

test("書き出し→読み込みで健康データが元通り", () => {
  const orig = { settings: {}, tx: [], health: { "2026-07-20": { weight: 63 }, "2026-07-25": { weight: 62.5, bpHigh: 118, bpLow: 76 } } };
  const round = Core.normalizeBackup(Core.parseBackupJson(JSON.stringify(Core.buildBackup(orig))));
  assert.deepEqual(round.health, orig.health);
});

/* ---------- 5. 画面：記録・上書き・保存失敗の巻き戻し ---------- */
test("健康ページで記録すると state.health に入る", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {} } });
  app.run(`view="health"; render();
    document.getElementById("h-weight").value="62.5";
    document.getElementById("h-bphigh").value="120";
    document.getElementById("h-bplow").value="78";
    saveHealth();`);
  assert.equal(app.run(`state.health[todayISO()].weight`), 62.5);
  assert.equal(app.run(`state.health[todayISO()].bpHigh`), 120);
  assert.equal(app.run(`state.health[todayISO()].bpLow`), 78);
  assert.match(app.toastText(), /記録しました/);
});

test("同じ日にもう一度記録すると上書きされる", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {} } });
  app.run(`view="health"; render(); document.getElementById("h-weight").value="62"; saveHealth();`);
  app.run(`document.getElementById("h-weight").value="61"; saveHealth();`);
  const rec = app.run(`state.health[todayISO()]`);
  assert.equal(rec.weight, 61, "上書きされていない");
  assert.equal(app.run(`Object.keys(state.health).length`), 1, "同じ日が2件になっている");
});

test("保存に失敗したら、健康データが元に戻る", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: { "2026-07-01": { weight: 60 } } }, storageFull: true });
  app.run(`view="health"; render(); document.getElementById("h-weight").value="62"; saveHealth();`);
  // 追加されず、元の1件だけ
  assert.equal(app.run(`Object.keys(state.health).length`), 1, "失敗なのに追加されている");
  assert.equal(app.run(`state.health["2026-07-01"].weight`), 60);
  assert.match(app.toastText(), /保存できませんでした/);
});

test("数値が無いと記録しない", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {} } });
  app.run(`view="health"; render(); saveHealth();`);
  assert.equal(app.run(`Object.keys(state.health).length`), 0);
  assert.match(app.toastText(), /数値を入れてね/);
});

/* ---------- 6. メニュー・ページの存在 ---------- */
test("下部メニューに健康が追加されている", () => {
  assert.match(html, /data-nav="health"/, "健康メニューが無い");
  assert.match(appSrc, /view==="health"/, "健康ページのルーティングが無い");
});

test("健康ページに体重・血圧の入力と折れ線グラフがある", () => {
  assert.match(appSrc, /id="h-weight"/, "体重の入力が無い");
  assert.match(appSrc, /id="h-bphigh"/, "血圧(上)の入力が無い");
  assert.match(appSrc, /id="h-bplow"/, "血圧(下)の入力が無い");
  assert.match(appSrc, /function lineChart/, "折れ線グラフが無い");
  assert.match(appSrc, /<polyline/, "折れ線を描いていない");
});

test("健康の保存も失敗時に巻き戻す作りになっている", () => {
  const block = appSrc.slice(appSrc.indexOf("function saveHealth"), appSrc.indexOf("function renderSettings"));
  assert.match(block, /JSON\.parse\(JSON\.stringify\(state\.health\)\)/, "退避していない");
  assert.match(block, /if\(!save\(\)\)\{/, "保存の成否を見ていない");
  assert.match(block, /state\.health=before/, "失敗時に戻していない");
});

test("既存の家計簿データを壊していない（健康は別領域）", () => {
  const app = bootApp({ state: {
    settings: { savingsTarget: 40000, nisaMonthly: 33000 },
    tx: [{ id: "s", type: "income", amount: 290000, cat: "salary", date: "2026-07-25" }],
    health: {},
  }});
  app.run(`view="health"; render(); document.getElementById("h-weight").value="62"; saveHealth();`);
  // 家計簿の記録は無傷
  assert.equal(app.run(`state.tx.length`), 1);
  assert.equal(app.run(`state.tx[0].amount`), 290000);
});
