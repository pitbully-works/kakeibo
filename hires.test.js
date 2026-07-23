/* =========================================================================
   かけいぼ ― 読み取り用の高解像度画像まわりのテスト
   -------------------------------------------------------------------------
   ・表示/保存用（縮小）と読み取り用（高解像度）を別に持つ
   ・高解像度画像はメモリ内だけで、保存データには入れない
   ・枠は0〜1の比率なので、どちらの画像でも同じ範囲が切り出せる
   ・読み取りが終わったら手放す
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("./core.js");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const appSrc = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].pop()[1];

/* ---------- 1. 表示用とOCR用が別管理 ---------- */
test("表示用・保存用・読み取り用で、それぞれ別の上限を持つ", () => {
  assert.ok(Core.PHOTO_OCR_MAX >= 3000 && Core.PHOTO_OCR_MAX <= 4000,
    "読み取り用の上限が3000〜4000pxでない: " + Core.PHOTO_OCR_MAX);
  assert.ok(Core.PHOTO_OCR_MAX > Core.PHOTO_VIEW_MAX, "読み取り用が表示用より粗い");
  assert.ok(Core.PHOTO_VIEW_MAX > Core.PHOTO_STORE_MAX, "表示用が保存用より粗い");
});

test("撮影時に、表示用と読み取り用の2枚を別々に作る", () => {
  assert.match(appSrc, /resizeDataUrl\(reader\.result, Core\.PHOTO_VIEW_MAX/, "表示用を作っていない");
  assert.match(appSrc, /resizeDataUrl\(reader\.result, Core\.PHOTO_OCR_MAX/, "読み取り用を作っていない");
  assert.match(appSrc, /sheetState\.photoHi=hires/, "読み取り用を別に保持していない");
  assert.match(appSrc, /sheetState\.photo=shrunk/, "表示用を保持していない");
});

test("読み取りは高解像度側から切り抜く（無ければ表示用に落とす）", () => {
  assert.match(appSrc, /const source = st\.photoHi \|\| st\.photo;/, "高解像度を優先していない");
  assert.match(appSrc, /cropToDataUrl\(source, crop, style\)/, "切り抜き元が高解像度になっていない");
});

/* ---------- 2. 保存データに含まれない ---------- */
test("保存する記録には photo だけを入れ、photoHi を入れない", () => {
  const saveBlock = appSrc.slice(appSrc.indexOf("async function saveTx()"), appSrc.indexOf("function delTx()"));
  assert.match(saveBlock, /releaseOcrImage\(st\);/, "保存前に高解像度を手放していない");
  assert.equal(/photoHi/.test(saveBlock.replace(/releaseOcrImage\(st\);/g, "")), false,
    "保存処理が高解像度画像に触れている");
  assert.match(saveBlock, /photo:photo/, "保存する写真が表示用でない");
});

test("保存されるデータ構造に photoHi が現れない", () => {
  // 記録として作られるオブジェクトのキーを確認
  const rec = /state\.tx\.push\(\{([^}]*)\}\)/.exec(appSrc);
  assert.ok(rec, "記録の追加処理が見つからない");
  assert.equal(rec[1].includes("photoHi"), false, "記録に高解像度画像が含まれている");
  assert.ok(rec[1].includes("photo:photo"), "記録に表示用写真が含まれていない");
});

test("保存量の見積もりは photo だけを数える（photoHi は対象外）", () => {
  const u = Core.storageUsage({
    settings: {},
    tx: [{ photo: "data:image/jpeg;base64," + "A".repeat(4000), photoHi: "data:image/jpeg;base64," + "B".repeat(400000) }],
  });
  assert.equal(u.photos, 3000, "保存量に高解像度画像が混ざっている");
});

/* ---------- 3. 高解像度から正しい比率で切り抜く ---------- */
test("同じ枠なら、低解像度でも高解像度でも同じ相対位置が切り出される", () => {
  const crop = { x: 0.2, y: 0.4, w: 0.5, h: 0.1 };
  const lo = Core.cropRect(crop, { w: 1600, h: 1200 });
  const hi = Core.cropRect(crop, { w: 3500, h: 2625 });
  const rel = (r, n) => ({ x: r.x / n.w, y: r.y / n.h, w: r.w / n.w, h: r.h / n.h });
  const a = rel(lo, { w: 1600, h: 1200 }), b = rel(hi, { w: 3500, h: 2625 });
  for (const k of ["x", "y", "w", "h"]) {
    assert.ok(Math.abs(a[k] - b[k]) < 0.002, `${k} の比率がずれている: ${a[k]} vs ${b[k]}`);
  }
});

test("高解像度から切り出すと、画素数が実際に増える", () => {
  const crop = { x: 0.1, y: 0.45, w: 0.8, h: 0.08 };
  const lo = Core.cropRect(crop, { w: 1600, h: 1200 });
  const hi = Core.cropRect(crop, { w: 3500, h: 2625 });
  assert.ok(hi.w > lo.w * 2, "高解像度側の切り抜きが大きくなっていない");
  assert.ok(hi.h > lo.h * 2);
});

test("拡大の上限が上がり、細部を落とさない", () => {
  assert.equal(Core.cropOutputSize(4000, 1000).w, 2400);
  assert.equal(Core.cropOutputSize(2200, 300).w, 2200, "ちょうどよい大きさを縮めている");
});

/* ---------- 4. 読み取り後に解放する ---------- */
test("読み取りが終わったら（成功・失敗とも）高解像度を手放す", () => {
  assert.match(appSrc, /function releaseOcrImage\(st\)\{/, "解放処理が無い");
  const read = appSrc.slice(appSrc.indexOf("async function readCrop()"), appSrc.indexOf("function cropToDataUrl"));
  assert.match(read, /\}finally\{\s*releaseOcrImage\(st\);/, "finally で解放していない");
});

test("記録画面を閉じたときも、写真を消したときも手放す", () => {
  assert.match(appSrc, /if\(!on\)\{ releaseOcrImage\(sheetState\);/, "シートを閉じたときに解放していない");
  assert.match(appSrc, /rm-photo"\)\{[\s\S]{0,120}releaseOcrImage\(sheetState\)/, "写真削除時に解放していない");
});

/* ---------- 5. 画像整形と段階実行 ---------- */
test("二値化で消える薄い印字のために、ゆるいグレースケール版を残す", () => {
  const data = new Uint8ClampedArray([120, 120, 120, 255, 150, 150, 150, 255, 135, 135, 135, 255]);
  Core.softenForOcr(data);
  const vals = [data[0], data[4], data[8]];
  assert.equal(new Set(vals).size, 3, "中間の濃淡がつぶれている（二値化と同じになっている）");
  assert.ok(vals.every((v) => v >= 0 && v <= 255));
});

test("読み取りは速い組合せから順に、取れたら止める", () => {
  assert.equal(Core.OCR_STAGES.length, 3, "段階が3つでない");
  assert.deepEqual(Core.OCR_STAGES[0], [{ image: "bw", psm: "7" }, { image: "plain", psm: "7" }]);
  const psms = Core.OCR_STAGES.flat().map((s) => s.psm);
  assert.ok(psms.includes("8") || psms.includes("13"), "金額1つ向けの読み取り方を試していない");
  assert.ok(Core.OCR_STAGES.flat().some((s) => s.image === "soft"), "ゆるい版を候補にしていない");
  assert.match(appSrc, /if\(Core\.ocrEnough\(candidates\)\) break;/, "取れた時点で止めていない");
});

test("同じ金額が2回出たら、そこで打ち切ってよいと判断する", () => {
  assert.equal(Core.ocrEnough([{ amount: 3555, confidence: 40 }, { amount: 3555, confidence: 35 }]), true);
  assert.equal(Core.ocrEnough([{ amount: 3555, confidence: 85 }]), true, "高い信頼度で止めない");
  assert.equal(Core.ocrEnough([{ amount: 99, confidence: 20 }]), false, "怪しい1件で止めている");
  assert.equal(Core.ocrEnough([]), false);
  assert.equal(Core.ocrEnough([{ amount: null, confidence: 90 }]), false);
});

test("投票方式は維持されている", () => {
  assert.equal(Core.pickBestAmount([
    { amount: 3555, confidence: 40 }, { amount: 355, confidence: 90 }, { amount: 3555, confidence: 30 },
  ]), 3555);
});

/* ---------- 6. 既存機能を壊していない ---------- */
test("保存・容量制限・写真削除の作りが残っている", () => {
  assert.match(appSrc, /function save\(\)\{[\s\S]*?return true;[\s\S]*?return false;/, "保存の成否判定が消えた");
  assert.match(appSrc, /resizeDataUrl\(photo, Core\.PHOTO_STORE_MAX/, "保存時の縮小が消えた");
  assert.match(appSrc, /写真は容量オーバーで保存できません/, "容量オーバー時の救済が消えた");
  assert.match(appSrc, /function purgePhotos\(\)/, "写真の一括削除が消えた");
  assert.match(appSrc, /Core\.storageUsage\(state\)/, "使用量の表示が消えた");
});

test("手入力の経路が残っている（読み取りに失敗しても記録できる）", () => {
  assert.match(appSrc, /id="s-amt"/, "金額の入力欄が無い");
  assert.match(appSrc, /金額を入れてね/, "手入力を促す案内が無い");
  assert.match(appSrc, /金額は手で入れられます/, "読み取り失敗時の案内が無い");
});
