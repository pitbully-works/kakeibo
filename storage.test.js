/* =========================================================================
   かけいぼ ― 保存まわりのテスト
   「記録したのに残らない」の再発防止。
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("./core.js");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const appSrc = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].pop()[1];

/* ---------- 写真の縮小 ---------- */
test("スマホの大きな写真は、読み取り用の長辺まで縮まる", () => {
  const r = Core.fitSize(4032, 3024, Core.PHOTO_VIEW_MAX);
  assert.equal(Math.max(r.w, r.h), Core.PHOTO_VIEW_MAX);
  assert.ok(Math.abs(r.w / r.h - 4032 / 3024) < 0.01, "縦横比が崩れている");
});

test("保存用はさらに小さくなる", () => {
  assert.ok(Core.PHOTO_STORE_MAX < Core.PHOTO_VIEW_MAX);
  const r = Core.fitSize(4032, 3024, Core.PHOTO_STORE_MAX);
  assert.equal(Math.max(r.w, r.h), Core.PHOTO_STORE_MAX);
});

test("もともと小さい画像は拡大しない", () => {
  assert.deepEqual(Core.fitSize(400, 300, 1600), { w: 400, h: 300 });
});

test("縦長の写真でも長辺で判定する", () => {
  const r = Core.fitSize(3024, 4032, 900);
  assert.equal(r.h, 900);
  assert.ok(r.w < 900);
});

/* ---------- 保存量の見積もり ---------- */
test("dataURLのバイト数をだいたい正しく見積もる", () => {
  const body = "A".repeat(4000); // base64 4000文字 ≒ 3000バイト
  assert.equal(Core.approxBytes("data:image/jpeg;base64," + body), 3000);
});

test("写真の枚数と合計量が分かる", () => {
  const state = {
    settings: {},
    tx: [
      { photo: "data:image/jpeg;base64," + "A".repeat(4000) },
      { photo: "data:image/jpeg;base64," + "A".repeat(4000) },
      { photo: null },
    ],
  };
  const u = Core.storageUsage(state);
  assert.equal(u.photoCount, 2);
  assert.equal(u.photos, 6000);
  assert.ok(u.total >= u.photos);
  assert.equal(u.nearLimit, false);
});

test("上限に近づいたら nearLimit が立つ", () => {
  const big = "data:image/jpeg;base64," + "A".repeat(6 * 1024 * 1024);
  const u = Core.storageUsage({ settings: {}, tx: [{ photo: big }] });
  assert.equal(u.nearLimit, true);
});

test("壊れたデータでも見積もりで落ちない", () => {
  assert.doesNotThrow(() => Core.storageUsage(null));
  assert.doesNotThrow(() => Core.storageUsage({ tx: "こわれている" }));
  assert.equal(Core.approxBytes(null), 0);
});

/* ---------- アプリ側の作り（静的チェック） ---------- */
test("save() は成否を返し、失敗を握りつぶさない", () => {
  assert.match(appSrc, /function save\(\)\{[\s\S]*?return true;[\s\S]*?return false;/, "save が成否を返していない");
  assert.equal(/catch\(e\)\{\}\s*\}\s*function uid/.test(appSrc), false, "保存の失敗を黙って捨てている");
});

test("保存前に写真を縮めている", () => {
  assert.match(appSrc, /resizeDataUrl\(photo, Core\.PHOTO_STORE_MAX/, "保存用の縮小をしていない");
  assert.match(appSrc, /resizeDataUrl\(reader\.result, Core\.PHOTO_VIEW_MAX/, "撮影時の縮小をしていない");
});

test("容量オーバーでも、写真を諦めて記録は必ず残す", () => {
  assert.match(appSrc, /t2\.photo=null;[\s\S]{0,200}if\(save\(\)\)/, "写真を落として再保存する処理が無い");
  assert.match(appSrc, /写真は容量オーバーで保存できません/, "利用者への説明が無い");
});

test("どうしても保存できないときは、元に戻して理由を伝える", () => {
  assert.match(appSrc, /state\.tx = JSON\.parse\(before\)/, "失敗時に元へ戻していない");
  assert.match(appSrc, /プライベートブラウズ/, "保存できない理由の説明が無い");
});

test("せっていで使用量が見え、写真をまとめて消せる", () => {
  assert.match(appSrc, /Core\.storageUsage\(state\)/, "使用量の表示が無い");
  assert.match(appSrc, /data-act="purge-photos"/, "写真を消すボタンが無い");
  assert.match(appSrc, /function purgePhotos\(\)/, "写真を消す処理が無い");
  assert.match(appSrc, /t\.photo=null;[\s\S]{0,120}記録は残っています/, "記録まで消していないか要確認");
});

/* ---------- 写真の選び方・記録ボタン ---------- */
test("写真の入り口はカメラだけ（ライブラリ・ファイル選択は出さない）", () => {
  assert.match(html, /id="camInput"[^>]*capture="environment"/, "カメラ限定になっていない");
});

test("写真の受け取りが、各段階を必ず画面に出す", () => {
  assert.match(appSrc, /function setStatus\(msg\)/, "状態表示の仕組みが無い");
  assert.match(appSrc, /写真を受け取りました/, "受け取りの表示が無い");
  assert.match(appSrc, /reader\.onerror=\(\)=>\{ setStatus/, "読み込み失敗を伝えていない");
});

test("シートが消えていても写真を受け取れる", () => {
  assert.match(appSrc, /function ensureSheetForPhoto\(\)/, "受け皿の作り直しが無い");
  assert.match(appSrc, /onPhotoPicked\(file\)\{[\s\S]{0,200}ensureSheetForPhoto\(\)/, "受け取り前に受け皿を用意していない");
});

test("読み取りは2通りの画像で試し、結果を突き合わせる", () => {
  assert.match(appSrc, /cropToDataUrl\(st\.photo, crop, "bw"\)/, "白黒版を作っていない");
  assert.match(appSrc, /cropToDataUrl\(st\.photo, crop, "plain"\)/, "通常版を作っていない");
  assert.match(appSrc, /Core\.pickBestAmount\(results\)/, "結果の突き合わせをしていない");
  assert.match(appSrc, /for\(const psm of \["7","6"\]\)/, "読み取り方を1通りしか試していない");
});

test("記録ボタンがシートの下に固定され、常に押せる", () => {
  assert.match(appSrc, /class="sheetsave"/, "記録ボタンの固定枠が無い");
  assert.match(html, /\.sheetsave\{position:sticky;bottom:0/, "記録ボタンが固定されていない");
  assert.match(appSrc, /この内容で記録する/, "記録ボタンが無い");
});


/* ---------- 枠のドラッグ後もボタンが押せること ---------- */
test("枠のドラッグに setPointerCapture を使わない（タップが吸われる原因）", () => {
  assert.equal(/\.setPointerCapture\s*\(/.test(appSrc), false,
    "画像全体にポインタ捕捉をかけると、離したあとボタンが押せなくなる");
});

test("ドラッグ中だけ document で受け、終わったら必ず外す", () => {
  assert.match(appSrc, /document\.addEventListener\("pointermove",onMove/, "移動をdocumentで受けていない");
  assert.match(appSrc, /document\.removeEventListener\("pointermove",onMove\)/, "移動の購読を外していない");
  assert.match(appSrc, /document\.removeEventListener\("pointerup",onEnd\)/, "終了の購読を外していない");
  assert.match(appSrc, /document\.removeEventListener\("pointercancel",onEnd\)/, "中断の購読を外していない");
});

test("枠の外を触ってもドラッグを始めない（ボタンを邪魔しない）", () => {
  assert.match(appSrc, /else return;\s*\/\/ 枠の外は無視/, "枠の外で早期に抜けていない");
});

test("読み取りボタンが記録バーに隠れない", () => {
  assert.match(appSrc, /class="photobtn main big" data-act="read-crop"/, "読み取りボタンが大きくなっていない");
  assert.match(html, /\.photobtn\.big\{[^}]*margin-bottom:14px/, "記録バーとの余白が無い");
  assert.match(html, /\.sheetsave\{[^}]*z-index:3/, "記録バーの重なり順が決まっていない");
});
