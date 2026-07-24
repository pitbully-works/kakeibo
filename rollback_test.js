/* =========================================================================
   かけいぼ ― 保存に失敗したときの巻き戻しテスト
   -------------------------------------------------------------------------
   「画面では成功したように見えるのに、開き直すと元に戻っている」
   という食い違いを防ぐ。実際にアプリを動かして確かめる。
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { bootApp } = require("./boot-app.cjs");
const Core = require("./core.js");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const appSrc = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].pop()[1];

const PHOTO = "data:image/jpeg;base64," + "A".repeat(400);
const baseState = () => ({
  settings: { savingsTarget: 40000, nisaMonthly: 33000, goalName: "旅行", goalTarget: 300000, goalCurrent: 50000, currency: "JPY" },
  tx: [
    { id: "t1", type: "expense", amount: 1200, cat: "food", date: "2026-07-01", memo: "スーパー", photo: PHOTO },
    { id: "t2", type: "income", amount: 290000, cat: "salary", date: "2026-07-25", memo: "", photo: null },
  ],
});

/* 設定画面を開いて値を入れ、保存する */
function editSettings(app, values) {
  app.run(`view="settings"; render();`);
  app.run(`
    document.getElementById("f-save").value=${JSON.stringify(String(values.save))};
    document.getElementById("f-nisa").value=${JSON.stringify(String(values.nisa))};
    document.getElementById("f-gname").value=${JSON.stringify(values.gname || "")};
    document.getElementById("f-gtarget").value=${JSON.stringify(String(values.gtarget || 0))};
    document.getElementById("f-gcur").value=${JSON.stringify(String(values.gcur || 0))};
    saveSettings();
  `);
}

/* ---------- 1. 設定保存 ---------- */
test("保存に成功したら、設定が確定してホームへ戻る", () => {
  const app = bootApp({ state: baseState() });
  editSettings(app, { save: 50000, nisa: 20000, gname: "車", gtarget: 1000000, gcur: 100 });
  assert.equal(app.run("state.settings.savingsTarget"), 50000);
  assert.equal(app.run("state.settings.nisaMonthly"), 20000);
  assert.equal(app.run("view"), "home", "ホームへ戻っていない");
  assert.match(app.toastText(), /保存しました/);
  assert.ok(String(app.saved()).includes("50000"), "端末に保存されていない");
});

test("保存に失敗したら、変更前の設定へ完全に戻る", () => {
  const app = bootApp({ state: baseState(), storageFull: true });
  editSettings(app, { save: 50000, nisa: 20000 });
  assert.equal(app.run("state.settings.savingsTarget"), 40000, "設定がメモリ上だけ変わっている");
  assert.equal(app.run("state.settings.nisaMonthly"), 33000);
  assert.equal(app.run("state.settings.goalName"), "旅行", "他の項目まで巻き添えで消えている");
});

test("保存に失敗したら、成功メッセージを出さず設定画面も閉じない", () => {
  const app = bootApp({ state: baseState(), storageFull: true });
  editSettings(app, { save: 50000, nisa: 20000 });
  assert.equal(/保存しました/.test(app.toastText()), false, "失敗なのに成功と表示している");
  assert.match(app.toastText(), /設定を保存できませんでした/);
  assert.equal(app.run("view"), "settings", "設定画面を閉じてしまっている");
});

/* ---------- 2. 記録の削除 ---------- */
function deleteFirst(app) {
  app.run(`openRecord(state.tx[0].id); delTx();`);   // openRecord は id を受け取る
}

test("保存に成功したら、記録が削除されシートが閉じる", () => {
  const app = bootApp({ state: baseState() });
  deleteFirst(app);
  assert.equal(app.run("state.tx.length"), 1, "削除できていない");
  assert.equal(app.run("state.tx[0].id"), "t2");
  assert.equal(app.run("sheetState"), null, "シートが閉じていない");
  assert.match(app.toastText(), /削除しました/);
});

test("保存に失敗したら、記録が元どおり復元される", () => {
  const app = bootApp({ state: baseState(), storageFull: true });
  deleteFirst(app);
  assert.equal(app.run("state.tx.length"), 2, "画面上だけ消えている（開き直すと復活する状態）");
  assert.equal(app.run("state.tx[0].id"), "t1");
  assert.equal(app.run("state.tx[0].amount"), 1200);
});

test("保存に失敗したら、「削除しました」を出さず編集画面も閉じない", () => {
  const app = bootApp({ state: baseState(), storageFull: true });
  deleteFirst(app);
  assert.equal(/削除しました/.test(app.toastText()), false, "失敗なのに成功と表示している");
  assert.match(app.toastText(), /削除できませんでした/);
  assert.notEqual(app.run("sheetState"), null, "編集画面を閉じてしまっている");
});

/* ---------- 3. 写真の一括削除 ---------- */
test("保存に成功したときだけ写真が消える（記録本体は残る）", () => {
  const app = bootApp({ state: baseState() });
  app.run(`purgePhotos();`);
  assert.equal(app.run("state.tx.length"), 2, "記録本体まで消えている");
  assert.equal(app.run("state.tx[0].photo"), null, "写真が消えていない");
  assert.equal(app.run("state.tx[0].amount"), 1200, "記録の中身が変わっている");
  assert.match(app.toastText(), /写真1枚を消しました/);
});

test("保存に失敗したら、写真がすべて元に戻る", () => {
  const app = bootApp({ state: baseState(), storageFull: true });
  app.run(`purgePhotos();`);
  assert.equal(app.run("state.tx[0].photo"), PHOTO, "写真がメモリ上だけ消えている");
  assert.equal(app.run("state.tx.length"), 2);
  assert.match(app.toastText(), /写真を消せませんでした/);
});

test("写真が1枚も無ければ、保存処理そのものを行わない", () => {
  const st = baseState();
  st.tx.forEach((t) => { t.photo = null; });
  const app = bootApp({ state: st, storageFull: true });   // 保存すれば必ず失敗する状態
  app.run(`purgePhotos();`);
  assert.match(app.toastText(), /消せる写真はありません/);
  assert.equal(/消せませんでした/.test(app.toastText()), false, "保存を試みてしまっている");
});

/* ---------- 画面側の作り ---------- */
test("3つの処理すべてで、保存前に退避している", () => {
  for (const [fn, end] of [
    ["function saveSettings()", "function buildSnapshot()"],
    ["function delTx()", "function saveSettings()"],
    ["function purgePhotos()", "function exportBackup()"],
  ]) {
    const block = appSrc.slice(appSrc.indexOf(fn), appSrc.indexOf(end));
    assert.match(block, /JSON\.parse\(JSON\.stringify\(/, fn + " が退避していない");
    assert.match(block, /if\(!save\(\)\)\{/, fn + " が保存の成否を見ていない");
  }
});
