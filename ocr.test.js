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

/* ---------- 切り取り枠の計算 ---------- */
test("枠（割合）が元画像のピクセル座標に正しく変換される", () => {
  assert.deepEqual(Core.cropRect({ x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, { w: 1000, h: 2000 }),
    { x: 100, y: 400, w: 500, h: 600 });
});

test("枠が画像からはみ出しても、画像の中に収まる", () => {
  const r = Core.cropRect({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, { w: 100, h: 100 });
  assert.ok(r.x + r.w <= 100 && r.y + r.h <= 100, "はみ出している");
  assert.ok(r.w >= 1 && r.h >= 1);
});

test("不正な枠でも落ちず、画像内に収まる", () => {
  const r = Core.cropRect({ x: -5, y: NaN, w: 99, h: undefined }, { w: 200, h: 300 });
  assert.ok(r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1);
  assert.ok(r.x + r.w <= 200 && r.y + r.h <= 300);
});

test("小さい切り抜きは拡大され、大きすぎる切り抜きは縮小される", () => {
  assert.equal(Core.cropOutputSize(300, 80).w, 900, "小さい枠が拡大されない");
  assert.equal(Core.cropOutputSize(4000, 1000).w, 1800, "大きい枠が縮小されない");
  const keep = Core.cropOutputSize(1200, 400);
  assert.equal(keep.w, 1200);
  assert.equal(keep.h, 400, "縦横比が崩れている");
});

test("白黒化とコントラスト伸長で、薄い印字がはっきりする", () => {
  // 100〜160 の狭い濃淡が 0〜255 に広がること
  const data = new Uint8ClampedArray([100, 100, 100, 255, 160, 160, 160, 255, 130, 130, 130, 255]);
  Core.enhanceForOcr(data);
  assert.equal(data[0], 0);
  assert.equal(data[4], 255);
  assert.ok(data[8] > 100 && data[8] < 155);
});

/* ---------- 枠のドラッグ ---------- */
test("枠を動かしても画像の外に出ない", () => {
  const start = { x: 0.5, y: 0.5, w: 0.4, h: 0.3 };
  const right = Core.moveCrop(start, 1, 0, "move");
  assert.equal(right.x, 0.6, "右端で止まらない");
  const left = Core.moveCrop(start, -1, -1, "move");
  assert.equal(left.x, 0);
  assert.equal(left.y, 0);
});

test("枠を小さくしすぎない（最小サイズで止まる）", () => {
  const start = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
  const shrunk = Core.moveCrop(start, -1, -1, "br");
  assert.equal(shrunk.w, Core.CROP_MIN);
  assert.equal(shrunk.h, Core.CROP_MIN);
});

test("左上をつかんで広げると、右下の位置は動かない", () => {
  const start = { x: 0.4, y: 0.4, w: 0.3, h: 0.3 };
  const grown = Core.moveCrop(start, -0.2, -0.2, "tl");
  assert.ok(Math.abs((grown.x + grown.w) - (start.x + start.w)) < 1e-9, "右端がずれた");
  assert.ok(Math.abs((grown.y + grown.h) - (start.y + start.h)) < 1e-9, "下端がずれた");
});
