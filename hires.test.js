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
  assert.match(appSrc, /cropToDataUrl\(source, Core\.cropVariant\(crop, cropKey\), style\)/, "切り抜き元が高解像度になっていない");
});

/* ---------- 2. 保存データに含まれない ---------- */
test("保存する記録には photo だけを入れ、photoHi を入れない", () => {
  const saveBlock = appSrc.slice(appSrc.indexOf("async function saveTx()"), appSrc.indexOf("function delTx()"));
  // コメントを除いた「実際に動くコード」だけを見る
  const code = saveBlock.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.equal(/photoHi/.test(code), false, "保存処理が高解像度画像を読み書きしている");
  assert.match(code, /photo:photo/, "保存する写真が表示用でない");
  assert.match(code, /releaseOcrImage\(st\);/, "記録確定時に解放していない");
});

test("解放は保存が成功した後に行う（成否が分かる前に手放さない）", () => {
  const saveBlock = appSrc.slice(appSrc.indexOf("async function saveTx()"), appSrc.indexOf("function delTx()"));
  const code = saveBlock.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const firstSave = code.indexOf("if(save()){");
  const firstRelease = code.indexOf("releaseOcrImage(st);");
  assert.ok(firstSave > 0 && firstRelease > 0);
  assert.ok(firstRelease > firstSave, "save() の結果が出る前に解放している");
  // 解放は2か所（最初の保存成功と、写真を外した再保存の成功）
  const releases = code.match(/releaseOcrImage\(st\);/g) || [];
  assert.equal(releases.length, 2, "解放の場所が2か所でない: " + releases.length);
  // 巻き戻し処理より後に解放が来ないこと
  const rollback = code.indexOf("state.tx = JSON.parse(before)");
  assert.ok(rollback > 0, "巻き戻し処理が無い");
  assert.ok(code.lastIndexOf("releaseOcrImage(st);") < rollback, "完全失敗の経路で解放している");
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

/* ---------- 4. 解放するのは4つの場面だけ（再試行では手放さない） ---------- */
test("1回目の読み取りが終わっても、高解像度は残る（枠を直して再試行できる）", () => {
  const read = appSrc.slice(appSrc.indexOf("async function readCrop()"), appSrc.indexOf("function cropToDataUrl"));
  assert.equal(/finally\{[\s\S]*?releaseOcrImage\(/.test(read), false,
    "読み取り終了時に解放している。2回目が表示用画像に落ちる");
  assert.match(read, /const source = st\.photoHi \|\| st\.photo;/, "高解像度を優先していない");
});

test("枠を変えて2回目を実行しても、切り抜き元は高解像度のまま", () => {
  const read = appSrc.slice(appSrc.indexOf("async function readCrop()"), appSrc.indexOf("function cropToDataUrl"));
  // 切り抜き元は毎回 st.photoHi を見る。読み取り側で photoHi を書き換えないこと。
  assert.equal(/st\.photoHi\s*=/.test(read), false, "読み取り処理が高解像度画像を書き換えている");
  assert.match(read, /const cache=\{\};/, "加工画像がローカル変数になっていない（関数を抜ければ消える）");
});

test("記録シートを閉じたときに解放する", () => {
  assert.match(appSrc, /if\(!on\)\{ releaseOcrImage\(sheetState\);/, "シートを閉じたときに解放していない");
});

test("写真を削除したときに解放する", () => {
  assert.match(appSrc, /rm-photo"\)\{[\s\S]{0,120}releaseOcrImage\(sheetState\)/, "写真削除時に解放していない");
});

test("新しい写真に置き換えるとき、先に古い高解像度を解放する", () => {
  const pick = appSrc.slice(appSrc.indexOf("function onPhotoPicked"), appSrc.indexOf("function resizeDataUrl"));
  const rel = pick.indexOf("releaseOcrImage(sheetState);");
  const set = pick.indexOf("sheetState.photoHi=hires");
  assert.ok(rel > 0, "差し替え時に解放していない");
  assert.ok(rel < set, "新しい写真を入れる前に解放していない");
});

test("記録を確定したときに解放する", () => {
  const save = appSrc.slice(appSrc.indexOf("async function saveTx()"), appSrc.indexOf("function delTx()"));
  assert.match(save, /releaseOcrImage\(st\);/, "記録確定時に解放していない");
});

test("解放処理そのものが存在する", () => {
  assert.match(appSrc, /function releaseOcrImage\(st\)\{/, "解放処理が無い");
  assert.match(appSrc, /t\.photoHi = null;/, "参照を切っていない");
});

/* ---------- 5. 画像整形と段階実行 ---------- */
test("二値化で消える薄い印字のために、ゆるいグレースケール版を残す", () => {
  const data = new Uint8ClampedArray([120, 120, 120, 255, 150, 150, 150, 255, 135, 135, 135, 255]);
  Core.softenForOcr(data);
  const vals = [data[0], data[4], data[8]];
  assert.equal(new Set(vals).size, 3, "中間の濃淡がつぶれている（二値化と同じになっている）");
  assert.ok(vals.every((v) => v >= 0 && v <= 255));
});

test("打ち切りは「異なる実行で同じ金額が2回」だけ。単独の高信頼では止めない", () => {
  assert.equal(Core.ocrEnough([{ amount: 3555, confidence: 40 }, { amount: 3555, confidence: 35 }]), true);
  assert.equal(Core.ocrEnough([{ amount: 3555, confidence: 95 }]), false,
    "1件だけの高信頼で打ち切っている（誤読でも高信頼が付くため危険）");
  assert.equal(Core.ocrEnough([{ amount: 3555, confidence: 99 }, { amount: 7285, confidence: 98 }]), false,
    "食い違う2件で打ち切っている");
  assert.equal(Core.ocrEnough([]), false);
  assert.equal(Core.ocrEnough([{ amount: null, confidence: 90 }, { amount: null, confidence: 90 }]), false);
});

test("旧 OCR_STAGES は撤去され、計画は OCR_PLAN 一本になっている", () => {
  assert.equal("OCR_STAGES" in Core, false, "古い計画が残っている");
  assert.ok(Array.isArray(Core.OCR_PLAN), "OCR_PLAN が無い");
  assert.equal(appSrc.includes("OCR_STAGES"), false, "画面側が古い計画を参照している");
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

/* =========================================================================
   解放のタイミングを、実際にアプリを動かして確かめる
   ========================================================================= */
const { bootApp } = require("./boot-app.cjs");

const PHOTO = "data:image/jpeg;base64," + "A".repeat(600);
const PHOTO_HI = "data:image/jpeg;base64," + "H".repeat(4000);

test("保存に成功したら、高解像度画像が解放される", async () => {
  const app = bootApp({});
  await app.record(1234, PHOTO, PHOTO_HI);
  assert.equal(app.run("state.tx.length"), 1, "記録できていない");
  assert.equal(app.run("sheetState"), null, "シートが閉じていない");
  const saved = String(app.saved() || "");
  assert.ok(saved.includes("1234"), "端末に保存されていない");
  assert.equal(saved.includes("photoHi"), false, "保存データに高解像度画像が入っている");
  assert.equal(saved.includes("H".repeat(50)), false, "高解像度画像の中身が保存されている");
});

test("容量超過で写真を外した再保存でも、成功したら解放される", async () => {
  // 写真つきだと入りきらず、写真を外せば入る大きさに設定する
  const app = bootApp({ maxBytes: 400 });
  await app.record(1234, PHOTO, PHOTO_HI);
  assert.equal(app.run("state.tx.length"), 1, "記録が残っていない");
  assert.equal(app.run("state.tx[0].photo"), null, "写真が外されていない");
  assert.match(app.toastText(), /容量オーバー/, "写真を外した旨を伝えていない");
  assert.equal(app.run("sheetState"), null, "シートが閉じていない");
  assert.equal(String(app.saved() || "").includes("photoHi"), false, "高解像度が保存されている");
});

test("保存が完全に失敗したときは、高解像度画像が残る", async () => {
  const app = bootApp({ storageFull: true });
  await app.record(1234, PHOTO, PHOTO_HI);
  assert.equal(app.run("state.tx.length"), 0, "保存できていないのに記録が残っている");
  assert.notEqual(app.run("sheetState"), null, "シートが閉じてしまっている");
  assert.match(app.toastText(), /保存できません|保存が使えません/, "理由を伝えていない");
  assert.equal(app.run("sheetState.photoHi"), PHOTO_HI,
    "保存に失敗してシートが残っているのに、高解像度画像を手放している");
});

test("保存に失敗したあと、もう一度読み取ると高解像度画像を使う", async () => {
  const app = bootApp({ storageFull: true });
  await app.record(1234, PHOTO, PHOTO_HI);
  assert.notEqual(app.run("sheetState"), null, "シートが閉じてしまっている");

  // 枠を変えて読み直す。切り抜き元が高解像度側であることを確認する。
  app.run(`sheetState.crop={x:0.1,y:0.3,w:0.7,h:0.2};`);
  const used = await app.spyReadCrop();
  assert.equal(used, PHOTO_HI, "表示用(1600px)の画像に落ちている");
});

test("読み取りを2回続けても、2回目の切り抜き元は高解像度のまま", async () => {
  const app = bootApp({});
  app.run(`openRecord(null); sheetState.photo=${JSON.stringify(PHOTO)}; sheetState.photoHi=${JSON.stringify(PHOTO_HI)};`);
  const first = await app.spyReadCrop();
  assert.equal(first, PHOTO_HI, "1回目から表示用に落ちている");
  app.run(`sheetState.crop={x:0.2,y:0.5,w:0.5,h:0.1};`);
  const second = await app.spyReadCrop();
  assert.equal(second, PHOTO_HI, "2回目で表示用に落ちている");
});

test("記録シートを閉じると、高解像度画像が解放される（実動作）", async () => {
  const app = bootApp({});
  app.run(`openRecord(null); sheetState.photoHi=${JSON.stringify(PHOTO_HI)}; showSheet(false);`);
  assert.equal(app.run("sheetState"), null, "シートの状態が残っている");
});
