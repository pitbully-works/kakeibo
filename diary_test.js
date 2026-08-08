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
  assert.equal(d["2026-07-25"].text, "よく歩いた", "旧形式の文字列が読めていない");
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
  assert.equal(d["2026-07-25"].text.length, Core.DIARY_MAX);
});

test("日記でないものは空になる", () => {
  assert.deepEqual(Core.normalizeDiary(null), {});
  assert.deepEqual(Core.normalizeDiary([1]), {});
});

test("一覧は新しい日付順", () => {
  const l = Core.diaryList(Core.normalizeDiary({ "2026-07-20": "a", "2026-07-25": "b", "2026-07-22": "c" }));
  assert.deepEqual(l.map(x => x.date), ["2026-07-25", "2026-07-22", "2026-07-20"]);
  assert.equal(l[0].text, "b");
});

/* ---------- バックアップ ---------- */
test("書き出しに日記が入る", () => {
  const b = Core.buildBackup({ settings: {}, tx: [], diary: { "2026-07-25": "hi" } });
  assert.equal(b.diary["2026-07-25"].text, "hi");
});

test("日記の無い旧バックアップも読める（空で返る）", () => {
  const r = Core.normalizeBackup({ settings: {}, tx: [] });
  assert.deepEqual(r.diary, {});
});

test("書き出し→読み込みで日記が元通り", () => {
  const orig = { settings: {}, tx: [], diary: { "2026-07-20": { text: "朝" }, "2026-07-25": { text: "夜", photo: "data:image/png;base64,AA" } } };
  const round = Core.normalizeBackup(Core.parseBackupJson(JSON.stringify(Core.buildBackup(orig))));
  assert.deepEqual(round.diary, orig.diary);
});

/* ---------- 画面：保存・編集・巻き戻し ---------- */
test("日記ページで保存すると state.diary に入る", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {}, diary: {} } });
  app.run(`view="diary"; render(); document.getElementById("d-text").value="今日のメモ"; saveDiary();`);
  assert.equal(app.run(`state.diary[todayISO()].text`), "今日のメモ");
  assert.match(app.toastText(), /日記を保存しました/);
});

test("過去の日付をタップして編集できる", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {}, diary: { "2026-07-01": "むかしの日記" } } });
  app.run(`view="diary"; diaryEditDate="2026-07-01"; render(); document.getElementById("d-text").value="なおした"; saveDiary();`);
  assert.equal(app.run(`state.diary["2026-07-01"].text`), "なおした", "編集が反映されていない");
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
  assert.equal(app.run(`state.diary["2026-07-01"].text`), "元の日記");
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
  const block = appSrc.slice(appSrc.indexOf("async function saveDiary"), appSrc.indexOf("/* ---------- 健康ページ"));
  assert.match(block, /JSON\.parse\(JSON\.stringify\(state\.diary\)\)/, "退避していない");
  assert.match(block, /if\(save\(\)\)\{/, "保存の成否を見ていない");
  assert.match(block, /state\.diary=before;   \/\/ それでも駄目なら/, "失敗時に戻していない");
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

/* ---------- 写真添付（Ver.2） ---------- */
const PIMG = "data:image/jpeg;base64," + "A".repeat(200);

test("写真つきの日記を保存すると photo が入る", async () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {}, diary: {} } });
  await app.run('view="diary"; render();' +
    'document.getElementById("d-text").value="写真の日";' +
    'diaryPhotoPending=' + JSON.stringify(PIMG) + ';' +
    'saveDiary();');   // saveDiary は Promise を返す
  assert.equal(app.run('state.diary[todayISO()].text'), "写真の日");
  assert.ok(app.run('!!state.diary[todayISO()].photo'), "写真が保存されていない");
});

test("旧形式（文字列）の日記は自動で新形式に読み替わる", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {}, diary: { "2026-07-01": "古い形式" } } });
  assert.equal(app.run(`state.diary["2026-07-01"].text`), "古い形式", "旧形式が読めていない");
  assert.equal(app.run(`state.diary["2026-07-01"].photo||null`), null);
});

test("危険な写真データは取り込まない", () => {
  const d = Core.normalizeDiary({ "2026-07-01": { text: "x", photo: "javascript:alert(1)" } });
  assert.equal("photo" in d["2026-07-01"], false, "危険な値を通している");
  const d2 = Core.normalizeDiary({ "2026-07-01": { text: "x", photo: "data:text/html;base64,PHN2Zz4=" } });
  assert.equal("photo" in d2["2026-07-01"], false, "画像以外のdata URLを通している");
});

test("写真だけ（本文なし）の日記も残る", () => {
  const d = Core.normalizeDiary({ "2026-07-01": { text: "", photo: PIMG } });
  assert.ok(d["2026-07-01"], "写真だけの日記が消えている");
  assert.equal(d["2026-07-01"].photo, PIMG);
});

test("本文も写真も無ければ日記は残らない", () => {
  const d = Core.normalizeDiary({ "2026-07-01": { text: "  ", photo: null } });
  assert.equal("2026-07-01" in d, false);
});

test("写真つき日記を保存→写真を外して保存できる", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {}, diary: { "2026-07-01": { text: "写真あり", photo: PIMG } } } });
  // 実機では textarea に本文が入っている。最小DOMでは value を明示する。
  app.run(`view="diary"; diaryEditDate="2026-07-01"; diaryPhotoPending=null; render();
    document.getElementById("d-text").value="写真あり"; saveDiary();`);
  assert.equal(app.run(`state.diary["2026-07-01"].text`), "写真あり", "本文まで消えている");
  assert.equal(app.run(`state.diary["2026-07-01"].photo||null`), null, "写真が外れていない");
});

test("書き出しに日記の写真が含まれ、読み込みで戻る", () => {
  const orig = { settings: {}, tx: [], diary: { "2026-07-01": { text: "t", photo: PIMG } } };
  const round = Core.normalizeBackup(Core.parseBackupJson(JSON.stringify(Core.buildBackup(orig))));
  assert.equal(round.diary["2026-07-01"].photo, PIMG);
});

test("日記に写真を入れる導線がある（撮影・ライブラリ）", () => {
  assert.match(html, /id="diaryPhotoInput" accept="image\/\*"/, "写真入力が無い");
  assert.equal(/id="diaryPhotoInput"[^>]*capture=/.test(html), false, "capture指定でライブラリが選べない");
  assert.match(appSrc, /data-act="add-diary-photo"/, "写真追加ボタンが無い");
  assert.match(appSrc, /data-act="rm-diary-photo"/, "写真削除ボタンが無い");
});

test("日記の写真も保存前に縮小する", () => {
  const block = appSrc.slice(appSrc.indexOf("async function saveDiary"), appSrc.indexOf("/* ---------- 健康ページ"));
  assert.match(block, /resizeDataUrl\(photo, Core\.PHOTO_STORE_MAX/, "保存前に縮小していない");
});

/* =========================================================================
   日記の日付えらび／写真ボタン
   -------------------------------------------------------------------------
   ・カレンダーへ行かなくても、日記の画面のまま日付を変えられること
   ・書きかけの本文を、確かめずに捨ててしまわないこと
   ・「写真を追加」が、押せる場所だと分かる見た目になっていること
   ========================================================================= */
test("日記の画面に日付えらびがあり、いまの日付が入っている", () => {
  const app = bootApp({ state: { settings:{}, tx:[], diary:{ "2026-08-01":{text:"むかしの日記"} } } });
  const today = app.run(`todayISO()`);
  const out = app.run(`view="diary"; diaryEditDate=null; render(); document.getElementById("app").innerHTML`);
  assert.match(out, /id="d-date"/, "日付えらびが無い");
  assert.ok(out.includes(`value="${today}"`), "いまの日付が入っていない");
});

test("日付を変えると、その日の日記に切り替わる", () => {
  const app = bootApp({ state: { settings:{}, tx:[], diary:{ "2026-08-01":{text:"むかしの日記"} } } });
  app.run(`view="diary"; render(); pickDiaryDate("2026-08-01");`);
  assert.equal(app.run(`diaryEditDate`), "2026-08-01");
  const out = app.run(`render(); document.getElementById("app").innerHTML`);
  assert.match(out, /むかしの日記/, "その日の本文が出ていない");
});

test("今日を選んだら、今日の日記に戻る", () => {
  const app = bootApp({ state: { settings:{}, tx:[], diary:{} } });
  app.run(`view="diary"; diaryEditDate="2026-08-01"; render(); pickDiaryDate(todayISO());`);
  assert.equal(app.run(`diaryEditDate`), null, "今日に戻っていない");
});

test("書きかけがあるときは、確かめてから日付を変える", () => {
  const app = bootApp({ state: { settings:{}, tx:[], diary:{} } });
  app.run(`view="diary"; render();
    document.getElementById("d-text").value="書きかけ";
    confirm=()=>false; pickDiaryDate("2026-08-01");`);
  assert.equal(app.run(`diaryEditDate`), null, "確かめずに日付を変えている");
  app.run(`confirm=()=>true; view="diary"; render();
    document.getElementById("d-text").value="書きかけ";
    pickDiaryDate("2026-08-01");`);
  assert.equal(app.run(`diaryEditDate`), "2026-08-01");
});

test("書きかけが無ければ、確かめずに日付を変えられる", () => {
  const app = bootApp({ state: { settings:{}, tx:[], diary:{} } });
  app.run(`view="diary"; render(); confirm=()=>{ throw new Error("聞いてはいけない"); };`);
  assert.doesNotThrow(() => app.run(`pickDiaryDate("2026-08-01");`));
  assert.equal(app.run(`diaryEditDate`), "2026-08-01");
});

test("おかしな日付では、日付を変えない", () => {
  const app = bootApp({ state: { settings:{}, tx:[], diary:{} } });
  app.run(`view="diary"; render(); pickDiaryDate("2026-02-31");`);
  assert.equal(app.run(`diaryEditDate`), null);
  app.run(`pickDiaryDate("");`);
  assert.equal(app.run(`diaryEditDate`), null);
});

test("今日を見ているときは「今日」ボタンを出さない", () => {
  const app = bootApp({ state: { settings:{}, tx:[], diary:{} } });
  const today = app.run(`view="diary"; diaryEditDate=null; render(); document.getElementById("app").innerHTML`);
  assert.equal(/class="today"/.test(today), false, "今日なのに「今日」ボタンが出ている");
  const past = app.run(`diaryEditDate="2026-08-01"; render(); document.getElementById("app").innerHTML`);
  assert.match(past, /class="today"/, "ほかの日なのに「今日」ボタンが無い");
});

test("日付えらびの操作が、画面につながっている", () => {
  /* 日付は「押す」ではなく「選ぶ」操作なので、change で受ける必要がある。
     ここが外れると、日付を選んでも何も起きなくなる。 */
  assert.match(appSrc, /addEventListener\("change"/, "change を受けていない");
  assert.match(appSrc, /if\(el && el\.id === "d-date"\) pickDiaryDate\(el\.value\);/, "日付を選んだときの受け取りが無い");
});

test("「写真を追加」が、押せる場所だと分かる見た目になっている", () => {
  const app = bootApp({ state: { settings:{}, tx:[], diary:{} } });
  const out = app.run(`view="diary"; render(); document.getElementById("app").innerHTML`);
  assert.match(out, /class="photobtn"/, "写真ボタンの見た目が変わっていない");
  assert.match(out, /data-act="add-diary-photo"/, "写真ボタンの動きが無い");
  assert.match(html, /\.photobtn\{/, "写真ボタンの見た目の指定が無い");
  assert.match(html, /border:2px dashed/, "枠が無く、押せる場所に見えない");
});

test("写真があるときは、追加ボタンではなく写真と外すボタンを出す", () => {
  const app = bootApp({ state: { settings:{}, tx:[], diary:{} } });
  const out = app.run(`view="diary"; diaryPhotoPending="data:image/png;base64,AAA"; render(); document.getElementById("app").innerHTML`);
  assert.equal(out.includes('class="photobtn"'), false, "写真があるのに追加ボタンが出ている");
  assert.match(out, /rm-diary-photo/, "外すボタンが無い");
});
