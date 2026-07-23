/* =========================================================================
   かけいぼ ― 静的チェック（index.html を読む側のテスト）
   ブラウザなしでも「白画面」「仕様の逆戻り」を検出するための最低限の砦。
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");

/* index.html の中のアプリ本体スクリプトを取り出す */
function appScript() {
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length >= 1, "インラインスクリプトが見つからない");
  return blocks[blocks.length - 1][1];
}

test("index.html は core.js を読み込んでいる", () => {
  assert.match(html, /<script src="\.\/core\.js"><\/script>/);
});

test("アプリ本体のJavaScriptが構文エラーなく解析できる（白画面の予防）", () => {
  const src = appScript();
  assert.doesNotThrow(() => new vm.Script(src, { filename: "index.html:inline" }));
});

test("画面側に計算式を書き戻していない（計算は core.js だけ）", () => {
  const src = appScript();
  // 旧実装で使っていた画面ローカルの集計変数が復活していないこと
  for (const banned of ["const free=", "const net=c.income-", "c.spent", "EXP_CATS", "s.fixedCost", "c.fixedTotal"]) {
    assert.equal(src.includes(banned), false, `画面側に「${banned}」が復活している`);
  }
  // ホームとまとめは、どちらも compute() の結果だけを読む
  assert.match(src, /function compute\(\)\{\s*const c = Core\.computeMonth/);
});

test("ホームの主役とまとめの「のこり」が同じ値を参照している", () => {
  const src = appScript();
  assert.match(src, /heroN=yen\(c\.available\)/, "ホームの主役が c.available でない");
  assert.match(src, /const net=c\.available/, "まとめの のこり が c.available でない");
});

test("不正確な「先取り貯金は、もう済んでます」表示が残っていない", () => {
  assert.equal(html.includes("もう済んでます"), false);
  assert.match(html, /先取り貯金・NISA積立の予定額を除いています/);
});

test("せっていに固定費の入力欄が無い（入力口は記録だけ）", () => {
  const src = appScript();
  assert.equal(src.includes('id="f-fixed"'), false, "固定費の合計欄が残っている");
  assert.equal(src.includes("f-fx-"), false, "固定費の予定額欄が復活している");
  assert.equal(src.includes("s.fixed["), false, "設定の固定費を読む処理が残っている");
});

test("せっていに給料の入力欄が無く、入力口がひとつに保たれている", () => {
  const src = appScript();
  assert.equal(src.includes('id="f-income"'), false, "設定に手取り収入欄が復活している");
  assert.equal(src.includes("s.incomeNet"), false, "設定の手取り収入を読む処理が残っている");
});

test("スナップショットは core.js に一本化されている", () => {
  const src = appScript();
  assert.match(src, /function buildSnapshot\(\)\{\s*return Core\.buildSnapshot/);
  assert.equal(src.includes("contribution:Number("), false, "予定額と実績を混同するキーが残っている");
});

test("レシートは枠で指定した範囲だけを読む", () => {
  const src = appScript();
  assert.equal(src.includes("function guessAmount"), false, "画面側の旧パーサが残っている");
  assert.equal(src.includes('data-act="shot-full"'), false, "レシート全体の撮影が残っている");
  assert.match(src, /data-act="shot-total"/, "アップ撮影のボタンが無い");
  assert.match(src, /data-act="read-crop"/, "枠で読み取るボタンが無い");
  assert.match(src, /Core\.cropRect\(crop, nat\)/, "枠の切り出しに core を使っていない");
  assert.match(src, /Core\.parseAmount\(data\.text,"total"\)/, "core の parseAmount を使っていない");
  assert.match(src, /tessedit_char_whitelist/, "数字だけを読む設定が無い");
});

test("撮影しただけでは読み取らず、枠を決めてから読む", () => {
  const src = appScript();
  assert.equal(/reader\.onload[\s\S]{0,200}runOCR/.test(src), false, "撮影直後に自動で読んでいる");
  assert.match(src, /reader\.onload[\s\S]{0,900}CROP_DEFAULT/, "撮影後に枠が用意されない");
  assert.match(src, /function initCrop\(\)/, "枠を動かす処理が無い");
});

test("service worker が core.js をキャッシュし、版が上がっている", () => {
  assert.match(sw, /"\.\/core\.js"/);
  assert.match(sw, /kakeibo-v2/);
});
