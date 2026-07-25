/* =========================================================================
   かけいぼ ― 日記のテスト
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

/* ---------- 正規化 ---------- */
test("正常な日記はそのまま残る", () => {
  const d = Core.normalizeDiary({ "2026-07-25": "よく歩いた" });
  assert.equal(d["2026-07-25"], "よく歩いた");
});

test("空・空白だけの日記は残さない", () => {
  const d = Core.normalizeDiary({ "2026-07-25": "   ", "2026-07-24": "", "2026-07-23": "a" });
  assert.deepEqual(Object.keys(d), ["2026-07-23"]);
});

test("不正な日付キーは捨てる", () => {
  const d = Core.normalizeDiary({ "2026-02-31": "x", "bad": "y", "2026-07-25": "ok" });
  assert.deepEqual(Object.keys(d), ["2026-07-25"]);
});

test("文字列でない本文は捨てる", () => {
  const d = Core.normalizeDiary({ "2026-07-25": 123, "2026-07-24": { t: 1 }, "2026-07-23": "ok" });
  assert.deepEqual(Object.keys(d), ["2026-07-23"]);
});

test("長すぎる本文は上限で切る", () => {
  const long = "あ".repeat(5000);
  const d = Core.normalizeDiary({ "2026-07-25": long });
  assert.equal(d["2026-07-25"].length, Core.DIARY_MAX);
});

test("日記でないものは空になる", () => {
  assert.deepEqual(Core.normalizeDiary(null), {});
  assert.deepEqual(Core.normalizeDiary([1]), {});
});

test("一覧は新しい日付順", () => {
  const l = Core.diaryList({ "2026-07-20": "a", "2026-07-25": "b", "2026-07-22": "c" });
  assert.deepEqual(l.map(x => x.date), ["2026-07-25", "2026-07-22", "2026-07-20"]);
});

/* ---------- バックアップ ---------- */
test("書き出しに日記が入る", () => {
  const b = Core.buildBackup({ settings: {}, tx: [], diary: { "2026-07-25": "hi" } });
  assert.deepEqual(b.diary, { "2026-07-25": "hi" });
});

test("日記の無い旧バックアップも読める（空で返る）", () => {
  const r = Core.normalizeBackup({ settings: {}, tx: [] });
  assert.deepEqual(r.diary, {});
});

test("書き出し→読み込みで日記が元通り", () => {
  const orig = { settings: {}, tx: [], diary: { "2026-07-20": "朝", "2026-07-25": "夜" } };
  const round = Core.normalizeBackup(Core.parseBackupJson(JSON.stringify(Core.buildBackup(orig))));
  assert.deepEqual(round.diary, orig.diary);
});

/* ---------- 画面：保存・編集・巻き戻し ---------- */
test("日記ページで保存すると state.diary に入る", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {}, diary: {} } });
  app.run(`view="diary"; render(); document.getElementById("d-text").value="今日のメモ"; saveDiary();`);
  assert.equal(app.run(`state.diary[todayISO()]`), "今日のメモ");
  assert.match(app.toastText(), /日記を保存しました/);
});

test("過去の日付をタップして編集できる", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {}, diary: { "2026-07-01": "むかしの日記" } } });
  app.run(`view="diary"; diaryEditDate="2026-07-01"; render(); document.getElementById("d-text").value="なおした"; saveDiary();`);
  assert.equal(app.run(`state.diary["2026-07-01"]`), "なおした", "編集が反映されていない");
});

test("本文を空にすると、その日の日記が消える", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {}, diary: { "2026-07-01": "消す予定" } } });
  app.run(`view="diary"; diaryEditDate="2026-07-01"; render(); document.getElementById("d-text").value=""; saveDiary();`);
  assert.equal(app.run(`"2026-07-01" in state.diary`), false, "空にしても残っている");
});

test("保存に失敗したら、日記が元に戻る", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {}, diary: { "2026-07-01": "元の日記" } }, storageFull: true });
  app.run(`view="diary"; render(); document.getElementById("d-text").value="新しい日記"; saveDiary();`);
  assert.equal(app.run(`Object.keys(state.diary).length`), 1, "失敗なのに追加されている");
  assert.equal(app.run(`state.diary["2026-07-01"]`), "元の日記");
  assert.match(app.toastText(), /保存できませんでした/);
});

test("日記にHTMLを書いても、生のHTMLとして画面に出ない", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {}, diary: { "2026-07-01": "<img src=x onerror=alert(1)>" } } });
  app.run(`view="diary"; render();`);
  const out = app.el("app").innerHTML;
  assert.ok(out.includes("&lt;img"), "エスケープされていない");
  assert.equal(out.includes("<img src=x onerror"), false, "生のHTMLとして出力されている");
});

/* ---------- メニュー・作り ---------- */
test("下部メニューに日記が追加されている", () => {
  assert.match(html, /data-nav="diary"/, "日記メニューが無い");
  assert.match(appSrc, /view==="diary"/, "日記ページのルーティングが無い");
});

test("日記の保存も失敗時に巻き戻す作りになっている", () => {
  const block = appSrc.slice(appSrc.indexOf("function saveDiary"), appSrc.indexOf("/* ---------- 健康ページ"));
  assert.match(block, /JSON\.parse\(JSON\.stringify\(state\.diary\)\)/, "退避していない");
  assert.match(block, /if\(!save\(\)\)\{/, "保存の成否を見ていない");
  assert.match(block, /state\.diary=before/, "失敗時に戻していない");
});

test("既存の家計簿・健康データを壊していない", () => {
  const app = bootApp({ state: {
    settings: { savingsTarget: 40000, nisaMonthly: 33000 },
    tx: [{ id: "s", type: "income", amount: 290000, cat: "salary", date: "2026-07-25" }],
    health: { "2026-07-25": { weight: 62 } }, diary: {},
  }});
  app.run(`view="diary"; render(); document.getElementById("d-text").value="日記"; saveDiary();`);
  assert.equal(app.run(`state.tx.length`), 1);
  assert.equal(app.run(`state.health["2026-07-25"].weight`), 62);
});
