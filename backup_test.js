/* =========================================================================
   かけいぼ ― バックアップの書き出しと読み込みのテスト
   -------------------------------------------------------------------------
   読み込むファイルは「他人が作ったかもしれないもの」として扱う。
   壊れた値・悪意のある値が来ても、アプリが壊れないことを確かめる。
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

const tx = (o) => Object.assign(
  { id: "x1", type: "expense", amount: 1200, cat: "food", date: "2026-07-01", memo: "", photo: null }, o);

/* ---------- 1. 書き出す形 ---------- */
test("書き出しには version と exportedAt が入る", () => {
  const b = Core.buildBackup({ settings: { savingsTarget: 1000 }, tx: [tx({})] });
  assert.equal(b.version, Core.BACKUP_VERSION);
  assert.match(b.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof b.settings, "object");
  assert.ok(Array.isArray(b.tx));
});

test("書き出しに高解像度の写真は入らない", () => {
  const b = Core.buildBackup({ settings: {}, tx: [Object.assign(tx({}), { photoHi: "data:image/jpeg;base64,HHHH" })] });
  assert.equal(JSON.stringify(b).includes("photoHi"), false, "読み取り用の画像が書き出されている");
});

/* ---------- 2. 正常な読み込み ---------- */
test("現行形式（version付き）を読み込める", () => {
  const json = JSON.stringify({
    version: 1, exportedAt: "2026-07-24T00:00:00.000Z",
    settings: { savingsTarget: 40000, nisaMonthly: 33000 },
    tx: [tx({}), tx({ id: "x2", type: "income", amount: 290000, cat: "salary", date: "2026-07-25" })],
  });
  const r = Core.normalizeBackup(Core.parseBackupJson(json));
  assert.equal(r.version, 1);
  assert.equal(r.tx.length, 2);
  assert.equal(r.settings.savingsTarget, 40000);
  assert.equal(r.dropped, 0);
});

test("旧形式（version無し・state をそのまま書き出したもの）も読み込める", () => {
  const json = JSON.stringify({ settings: { savingsTarget: 25000 }, tx: [tx({})] });
  const r = Core.normalizeBackup(Core.parseBackupJson(json));
  assert.equal(r.version, 0, "旧形式と判別できていない");
  assert.equal(r.tx.length, 1);
  assert.equal(r.settings.savingsTarget, 25000);
});

test("復元したデータで、計算結果が正しく出る", () => {
  const json = JSON.stringify({
    settings: { savingsTarget: 40000, nisaMonthly: 33000 },
    tx: [
      tx({ id: "s", type: "income", amount: 290000, cat: "salary", date: "2026-07-25" }),
      tx({ id: "r", type: "expense", amount: 60000, cat: "rent", date: "2026-07-01" }),
      tx({ id: "f", type: "expense", amount: 20000, cat: "food", date: "2026-07-05" }),
    ],
  });
  const r = Core.normalizeBackup(Core.parseBackupJson(json));
  const c = Core.computeMonth(r.settings, r.tx, "2026-07");
  assert.equal(c.incomeTotal, 290000);
  assert.equal(c.spendTotal, 80000);
  assert.equal(c.setAside, 73000);
  assert.equal(c.available, 290000 - 80000 - 73000);
  // 先取りが二重に引かれていないこと
  assert.equal(c.available, 137000);
});

/* ---------- 3. 壊れた入力を拒む ---------- */
test("JSONとして読めないものは拒む", () => {
  for (const bad of ["", "   ", "{", "こんにちは", "<html></html>"]) {
    assert.throws(() => Core.parseBackupJson(bad), /読み取れません|形が違います|空です/, "拒めていない: " + bad);
  }
});

test("配列や数値そのものは拒む", () => {
  assert.throws(() => Core.parseBackupJson("[1,2,3]"), /形が違います/);
  assert.throws(() => Core.parseBackupJson("42"), /形が違います/);
  assert.throws(() => Core.parseBackupJson("null"), /形が違います/);
});

test("settings が無い・配列・文字列なら拒む", () => {
  for (const bad of [{ tx: [] }, { settings: [], tx: [] }, { settings: "x", tx: [] }, { settings: null, tx: [] }]) {
    assert.throws(() => Core.normalizeBackup(bad), /設定が入っていません/);
  }
});

test("tx が無い・配列でないなら拒む", () => {
  for (const bad of [{ settings: {} }, { settings: {}, tx: {} }, { settings: {}, tx: "x" }]) {
    assert.throws(() => Core.normalizeBackup(bad), /記録が入っていません/);
  }
});

/* ---------- 4. 1件ずつの正規化 ---------- */
test("不正な type は取り込まない", () => {
  for (const t of ["", "delete", "INCOME", null, 1, undefined]) {
    assert.equal(Core.normalizeTransaction(tx({ type: t })), null, "通してしまっている: " + String(t));
  }
  assert.equal(Core.normalizeTransaction(tx({ type: "income", cat: "salary" })).type, "income");
});

test("不正な日付は取り込まない", () => {
  for (const d of ["2026-13-01", "2026-02-31", "2026/07/01", "20260701", "", null, "2026-7-1"]) {
    assert.equal(Core.normalizeTransaction(tx({ date: d })), null, "通してしまっている: " + String(d));
  }
  assert.equal(Core.normalizeTransaction(tx({ date: "2026-02-29" })), null, "2026年に2/29は無い");
  assert.equal(Core.normalizeTransaction(tx({ date: "2024-02-29" })).date, "2024-02-29", "うるう年を弾いている");
});

test("金額は有限の0以上の整数になる", () => {
  assert.equal(Core.normalizeTransaction(tx({ amount: -500 })).amount, 500, "負数を整えていない");
  assert.equal(Core.normalizeTransaction(tx({ amount: 12.7 })).amount, 12, "小数を整えていない");
  assert.equal(Core.normalizeTransaction(tx({ amount: "1234" })).amount, 1234, "数字の文字列を扱えていない");
  assert.equal(Core.normalizeTransaction(tx({ amount: 0 })).amount, 0);
  for (const bad of ["abc", NaN, Infinity, -Infinity, null, undefined, {}, []]) {
    const r = Core.normalizeTransaction(tx({ amount: bad }));
    if (r) assert.ok(Number.isFinite(r.amount) && r.amount >= 0, "不正な金額が残った: " + String(bad));
  }
});

test("巨大な金額は上限で止まる", () => {
  assert.equal(Core.normalizeTransaction(tx({ amount: 1e15 })).amount, Core.AMOUNT_MAX);
  assert.equal(Core.normalizeTransaction(tx({ amount: Number.MAX_SAFE_INTEGER })).amount, Core.AMOUNT_MAX);
});

test("知らないカテゴリは「その他」に寄せる", () => {
  assert.equal(Core.normalizeTransaction(tx({ cat: "存在しない" })).cat, "other");
  assert.equal(Core.normalizeTransaction(tx({ cat: "rent" })).cat, "rent", "正しいカテゴリまで変えている");
  // 支出のカテゴリを収入に使うことはできない
  assert.equal(Core.normalizeTransaction(tx({ type: "income", cat: "food" })).cat, "other");
});

test("長すぎるメモは上限で切る", () => {
  const long = "あ".repeat(500);
  const r = Core.normalizeTransaction(tx({ memo: long }));
  assert.equal(r.memo.length, Core.MEMO_MAX);
  assert.equal(Core.normalizeTransaction(tx({ memo: null })).memo, "");
  assert.equal(Core.normalizeTransaction(tx({ memo: 123 })).memo, "123");
});

test("写真は画像のdata URLだけを受け入れる", () => {
  assert.equal(Core.normalizeTransaction(tx({ photo: "data:image/jpeg;base64,AAAA" })).photo, "data:image/jpeg;base64,AAAA");
  for (const bad of ["javascript:alert(1)", "http://example.com/a.png", "data:text/html;base64,PHNjcmlwdD4=", 123, {}]) {
    assert.equal(Core.normalizeTransaction(tx({ photo: bad })).photo, null, "危険な値を通している: " + String(bad));
  }
});

test("id が無い・重複していても、記録は失われず別のidになる", () => {
  const r = Core.normalizeBackup({ settings: {}, tx: [tx({ id: null }), tx({ id: "same" }), tx({ id: "same" })] });
  assert.equal(r.tx.length, 3, "重複を理由に記録を捨てている");
  assert.equal(new Set(r.tx.map((t) => t.id)).size, 3, "idが重複したまま");
});

test("壊れた記録は除外され、件数が報告される", () => {
  const r = Core.normalizeBackup({
    settings: {},
    tx: [tx({}), { type: "expense" }, null, "文字列", tx({ date: "こわれた" })],
  });
  assert.equal(r.tx.length, 1);
  assert.equal(r.dropped, 4, "除外した件数が合わない");
});

test("記録が多すぎても暴走しない", () => {
  const many = new Array(Core.TX_MAX + 50).fill(0).map((_, i) => tx({ id: "i" + i }));
  const r = Core.normalizeBackup({ settings: {}, tx: many });
  assert.equal(r.tx.length, Core.TX_MAX);
  assert.equal(r.dropped, 50);
});

/* ---------- 5. XSS ---------- */
test("メモにHTMLが入っていても、生のHTMLとして画面に出ない", () => {
  const evil = '<img src=x onerror=alert(1)>';
  const r = Core.normalizeTransaction(tx({ memo: evil }));
  assert.equal(r.memo, evil, "メモの文字自体は保つ（表示側で無害化する）");

  const app = bootApp({ state: { settings: {}, tx: [Object.assign(r, { id: "e1" })] } });
  app.run(`view="summary"; render();`);
  const out = app.el("app").innerHTML;
  assert.ok(out.includes("&lt;img"), "エスケープされていない");
  assert.equal(out.includes("<img src=x onerror"), false, "生のHTMLとして出力されている");
});

test("目標名にHTMLが入っていても、生のHTMLとして出ない", () => {
  const app = bootApp({ state: { settings: { goalName: '<script>x</script>', goalTarget: 100, goalCurrent: 1 }, tx: [] } });
  app.run(`view="home"; render();`);
  const out = app.el("app").innerHTML;
  assert.equal(out.includes("<script>x</script>"), false, "生のHTMLとして出力されている");
});

/* ---------- 6. 画面側の作り ---------- */
test("設定画面に書き出しと読み込みの両方がある", () => {
  assert.match(appSrc, /data-act="export-backup"/, "書き出しが無い");
  assert.match(appSrc, /data-act="import-backup"/, "読み込みが無い");
  assert.match(html, /<input type="file" id="backupInput" accept="application\/json,\.json"/, "ファイル選択が無い");
});

test("読み込み前に確認ダイアログを出し、キャンセルなら何もしない", () => {
  const block = appSrc.slice(appSrc.indexOf("function onBackupPicked"), appSrc.indexOf("function downloadText"));
  assert.match(block, /confirm\(/, "確認していない");
  assert.match(block, /現在のデータを上書きします/, "上書きの警告が無い");
  assert.match(block, /先にバックアップを書き出すことをおすすめします/, "推奨の案内が無い");
  assert.match(block, /if\(!ok\)\{ clear\(\); return; \}/, "キャンセルで抜けていない");
});

test("読み込みは退避してから行い、保存に失敗したら元へ戻す", () => {
  const block = appSrc.slice(appSrc.indexOf("function onBackupPicked"), appSrc.indexOf("function downloadText"));
  assert.match(block, /const before = JSON\.parse\(JSON\.stringify\(state\)\);/, "退避していない");
  assert.match(block, /if\(!save\(\)\)\{[\s\S]{0,120}state = before;/, "失敗時に戻していない");
  assert.match(block, /バックアップを復元できませんでした/, "失敗の説明が無い");
});

test("解析に失敗したら、現在のデータを一切変更しない", () => {
  const block = appSrc.slice(appSrc.indexOf("function onBackupPicked"), appSrc.indexOf("function downloadText"));
  const parseFail = block.indexOf("catch(e){");
  const mutate = block.indexOf("state.settings = restored.settings");
  assert.ok(parseFail > 0 && mutate > parseFail, "解析より前に state を書き換えている");
  assert.match(block, /clear\(\); return;\s*\/\/ 現在のデータは一切変更しない/, "解析失敗時に抜けていない");
});

test("同じファイルをもう一度選べるよう、選択欄を空に戻す", () => {
  const block = appSrc.slice(appSrc.indexOf("function onBackupPicked"), appSrc.indexOf("function downloadText"));
  assert.match(block, /const clear=\(\)=>\{ if\(el\) el\.value=""; \}/, "選択欄を戻す処理が無い");
  assert.match(appSrc, /function pickBackup\(\)\{ const el=\$\("backupInput"\); if\(el\)\{ el\.value=""; el\.click\(\); \} \}/,
    "開く前にも空に戻していない");
});

test("書き出しは新形式（version付き）で行う", () => {
  assert.match(appSrc, /Core\.buildBackup\(state\)/, "新形式で書き出していない");
});

/* ---------- 7. 書き出し → 読み込み で完全に戻ることの確認 ---------- */
test("書き出したものを読み込むと、元と同じ状態になる", () => {
  const original = {
    settings: { savingsTarget: 40000, nisaMonthly: 33000, goalName: "旅行", goalTarget: 300000, goalCurrent: 50000, currency: "JPY" },
    tx: [
      tx({ id: "a", type: "income", amount: 290000, cat: "salary", date: "2026-07-25", memo: "給料" }),
      tx({ id: "b", type: "expense", amount: 60000, cat: "rent", date: "2026-07-01", memo: "家賃" }),
      tx({ id: "c", type: "expense", amount: 20000, cat: "food", date: "2026-07-05", memo: "スーパー" }),
    ],
  };
  const text = JSON.stringify(Core.buildBackup(original));
  const restored = Core.normalizeBackup(Core.parseBackupJson(text));

  assert.equal(restored.tx.length, 3);
  assert.deepEqual(restored.tx.map((t) => [t.id, t.type, t.amount, t.cat, t.date, t.memo]),
    original.tx.map((t) => [t.id, t.type, t.amount, t.cat, t.date, t.memo]), "記録が変わっている");
  assert.deepEqual(restored.settings, Core.normalizeSettings(original.settings), "設定が変わっている");

  const a = Core.computeMonth(original.settings, original.tx, "2026-07");
  const b = Core.computeMonth(restored.settings, restored.tx, "2026-07");
  assert.equal(b.available, a.available, "復元後に計算結果が変わっている");
  assert.equal(b.incomeTotal, a.incomeTotal);
  assert.equal(b.spendTotal, a.spendTotal);
});

test("復元後、ホームとまとめの金額が一致する", () => {
  const text = JSON.stringify(Core.buildBackup({
    settings: { savingsTarget: 40000, nisaMonthly: 33000 },
    tx: [
      tx({ id: "a", type: "income", amount: 290000, cat: "salary", date: "2026-07-25" }),
      tx({ id: "b", type: "expense", amount: 60000, cat: "rent", date: "2026-07-01" }),
    ],
  }));
  const r = Core.normalizeBackup(Core.parseBackupJson(text));
  const c = Core.computeMonth(r.settings, r.tx, "2026-07");
  assert.equal(c.available, c.incomeTotal - c.spendTotal - c.setAside, "ホームとまとめの定義がずれている");
});
