/* =========================================================================
   かけいぼ ― レシート金額の読み取りテスト
   OCRが吐きそうな文字列を入れて、正しい「合計」だけを拾えるか確認する。
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");

const full = (t) => Core.parseAmount(t, "full");
const closeup = (t) => Core.parseAmount(t, "total");

/* ---------- 合計だけをアップで撮った写真 ---------- */
test("アップ撮影：合計の行だけなら素直に読める", () => {
  assert.equal(closeup("合計 ¥1,240"), 1240);
  assert.equal(closeup("合 計   1240"), 1240);
  assert.equal(closeup("￥12,800"), 12800);
});

test("アップ撮影：全角数字でも読める", () => {
  assert.equal(closeup("合計 ￥１，２４０"), 1240);
});

test("アップ撮影：¥のついた数字を優先する", () => {
  // 端に「8」などのノイズが写り込んでも、¥つきを優先
  assert.equal(closeup("12\n合計 ¥3,480"), 3480);
});

test("アップ撮影：数字が無ければ null", () => {
  assert.equal(closeup("合計"), null);
  assert.equal(closeup(""), null);
});

/* ---------- レシート全体を撮った写真 ---------- */
test("全体撮影：小計・お預り・お釣りに惑わされず合計を拾う", () => {
  const t = [
    "スーパー〇〇",
    "牛乳    218",
    "卵      248",
    "パン    168",
    "小計   1,100",
    "消費税    140",
    "合計  ¥1,240",
    "お預り  2,000",
    "お釣り    760",
  ].join("\n");
  assert.equal(full(t), 1240);
});

test("全体撮影：お預りの方が大きくても合計を選ぶ", () => {
  const t = "合計 ¥1,240\nお預り 10,000\nお釣り 8,760";
  assert.equal(full(t), 1240);
});

test("全体撮影：合計の金額が次の行にあるレシート", () => {
  const t = "小計 1,100\n合計\n¥1,240\nお釣り 760";
  assert.equal(full(t), 1240);
});

test("全体撮影：「お会計」「ご請求額」でも拾える", () => {
  assert.equal(full("小計 900\nお会計 1,050"), 1050);
  assert.equal(full("ご請求額 ¥3,300\n現金 5,000"), 3300);
});

test("全体撮影：日付・時刻・電話番号を金額と間違えない", () => {
  const t = [
    "レシート",
    "2026/07/24 19:35",
    "TEL 052-123-4567",
    "〒500-8001",
    "合計 ¥980",
  ].join("\n");
  assert.equal(full(t), 980);
});

test("全体撮影：合計が読めなかったら、紛らわしい行を除いた最大値", () => {
  const t = "牛乳 218\n卵 248\nパン 168\nお預り 2,000";
  assert.equal(full(t), 248, "お預りは候補から外す");
});

test("全体撮影：ポイント・値引きを合計と間違えない", () => {
  const t = "小計 2,500\n値引 -300\nポイント 1,200\n合計 2,200";
  assert.equal(full(t), 2200);
});

test("全体撮影：合計が2回出てきたら大きい方（税込）を採る", () => {
  const t = "合計 2,000\n税込合計 2,200";
  assert.equal(full(t), 2200);
});

test("読めない写真では null を返し、手入力にまかせる", () => {
  assert.equal(full("あああ いいい"), null);
  assert.equal(full(""), null);
});

test("極端な数字は金額として採用しない", () => {
  assert.equal(full("合計 9"), null, "10円未満は無視");
  assert.equal(full("合計 99999999"), null, "300万円超は無視");
});
