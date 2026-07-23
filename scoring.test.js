/* =========================================================================
   かけいぼ ― 枠3種・画像処理・候補の採点のテスト
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("./core.js");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const appSrc = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].pop()[1];
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* ---------- 1. 拡大枠・通常枠・縮小枠の座標計算 ---------- */
test("通常枠は指定どおり変わらない", () => {
  const c = { x: 0.1, y: 0.4, w: 0.8, h: 0.2 };
  assert.deepEqual(Core.cropVariant(c, "base"), c);
});

test("拡大枠は上下左右が5%ずつ広がる", () => {
  const c = { x: 0.10, y: 0.40, w: 0.80, h: 0.20 };
  const w = Core.cropVariant(c, "wide");
  assert.ok(near(w.x, 0.10 - 0.04), "左が5%広がっていない: " + w.x);
  assert.ok(near(w.y, 0.40 - 0.01), "上が5%広がっていない: " + w.y);
  assert.ok(near(w.w, 0.80 * 1.10), "幅が1.1倍でない: " + w.w);
  assert.ok(near(w.h, 0.20 * 1.10), "高さが1.1倍でない: " + w.h);
  assert.ok(near(w.x + w.w, c.x + c.w + 0.04), "右が5%広がっていない");
});

test("縮小枠は上下左右が10%ずつ狭まる", () => {
  const c = { x: 0.10, y: 0.40, w: 0.80, h: 0.20 };
  const t = Core.cropVariant(c, "tight");
  assert.ok(near(t.x, 0.10 + 0.08), "左が10%狭まっていない: " + t.x);
  assert.ok(near(t.w, 0.80 * 0.80), "幅が0.8倍でない: " + t.w);
  assert.ok(near(t.h, 0.20 * 0.80), "高さが0.8倍でない: " + t.h);
  assert.ok(t.w < c.w && t.h < c.h, "縮んでいない");
});

/* ---------- 2. 画像範囲を超えない ---------- */
test("画面いっぱいの枠を広げても、はみ出さない", () => {
  const w = Core.cropVariant({ x: 0, y: 0, w: 1, h: 1 }, "wide");
  assert.deepEqual(w, { x: 0, y: 0, w: 1, h: 1 });
});

test("端に寄せた枠を広げても、0〜1に収まる", () => {
  for (const c of [
    { x: 0, y: 0, w: 0.3, h: 0.3 },
    { x: 0.7, y: 0.7, w: 0.3, h: 0.3 },
    { x: 0.02, y: 0.95, w: 0.5, h: 0.04 },
  ]) {
    const w = Core.cropVariant(c, "wide");
    assert.ok(w.x >= 0 && w.y >= 0, "左上がはみ出した");
    assert.ok(w.x + w.w <= 1 + 1e-9, "右がはみ出した: " + (w.x + w.w));
    assert.ok(w.y + w.h <= 1 + 1e-9, "下がはみ出した: " + (w.y + w.h));
  }
});

test("縮めすぎても、最小サイズを下回らない", () => {
  const t = Core.cropVariant({ x: 0.4, y: 0.4, w: Core.CROP_MIN, h: Core.CROP_MIN }, "tight");
  assert.ok(t.w >= Core.CROP_MIN - 1e-9 && t.h >= Core.CROP_MIN - 1e-9, "最小サイズを割った");
  assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= 1 && t.y + t.h <= 1);
});

test("3種の枠は、いずれも元画像の座標に正しく変換できる", () => {
  const c = { x: 0.1, y: 0.4, w: 0.8, h: 0.2 };
  for (const key of ["base", "wide", "tight"]) {
    const r = Core.cropRect(Core.cropVariant(c, key), { w: 3500, h: 2625 });
    assert.ok(r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1);
    assert.ok(r.x + r.w <= 3500 && r.y + r.h <= 2625, key + " が画像を超えた");
  }
});

/* ---------- 3. 同じ金額が複数回出たら点数が上がる ---------- */
test("同じ金額が複数の切り抜きで出ると、点数が上がる", () => {
  const one = Core.scoreCandidate({ amount: 1285, raw: "1,285", confidence: 60, agree: 1, posScore: 0.5 });
  const two = Core.scoreCandidate({ amount: 1285, raw: "1,285", confidence: 60, agree: 2, posScore: 0.5 });
  const three = Core.scoreCandidate({ amount: 1285, raw: "1,285", confidence: 60, agree: 3, posScore: 0.5 });
  assert.ok(two > one, "2回一致で上がっていない");
  assert.ok(three > two, "3回一致で上がっていない");
});

test("並べ替えで、一致回数の多い候補が上に来る", () => {
  const ranked = Core.rankCandidates([
    { amount: 7285, raw: "7,285", confidence: 88, posScore: 0.5 },
    { amount: 1285, raw: "1,285", confidence: 55, posScore: 0.9 },
    { amount: 1285, raw: "1,285", confidence: 52, posScore: 0.9 },
    { amount: 1285, raw: "1,285", confidence: 50, posScore: 0.8 },
  ]);
  assert.equal(ranked[0].amount, 1285, "一致の多い候補が1位でない");
  assert.equal(ranked[0].agree, 3);
});

test("信頼度・文字列内の位置も点数に効く", () => {
  const low = Core.scoreCandidate({ amount: 1285, raw: "1,285", confidence: 20, agree: 1, posScore: 0.5 });
  const high = Core.scoreCandidate({ amount: 1285, raw: "1,285", confidence: 90, agree: 1, posScore: 0.5 });
  assert.ok(high > low, "信頼度が効いていない");
  const edge = Core.scoreCandidate({ amount: 1285, raw: "1,285", confidence: 60, agree: 1, posScore: 0 });
  const mid = Core.scoreCandidate({ amount: 1285, raw: "1,285", confidence: 60, agree: 1, posScore: 1 });
  assert.ok(mid > edge, "文字列内の位置が効いていない");
});

/* ---------- 4. 不自然な桁区切りは低評価 ---------- */
test("カンマの位置が不自然な候補は0点になる", () => {
  assert.equal(Core.commaScore("1,285"), 1);
  assert.equal(Core.commaScore("12,85"), 0, "3桁区切りでないのに合格している");
  assert.equal(Core.commaScore("1,2,85"), 0);
  assert.equal(Core.commaScore("1285,"), 0);
  assert.equal(Core.scoreCandidate({ amount: 1285, raw: "12,85", confidence: 95, agree: 3, posScore: 1 }), 0,
    "桁区切りが壊れているのに高得点になっている");
});

test("カンマ無しの4桁以上は、カンマありより低い", () => {
  const withComma = Core.scoreCandidate({ amount: 3555, raw: "3,555", confidence: 70, agree: 1, posScore: 0.5 });
  const without = Core.scoreCandidate({ amount: 3555, raw: "3555", confidence: 70, agree: 1, posScore: 0.5 });
  assert.ok(withComma > without, "カンマありが優遇されていない");
  assert.ok(without > 0, "カンマ無しを弾きすぎている");
});

test("範囲外の金額は0点", () => {
  assert.equal(Core.scoreCandidate({ amount: 0, raw: "0", confidence: 99, agree: 5, posScore: 1 }), 0);
  assert.equal(Core.scoreCandidate({ amount: 1000000, raw: "1,000,000", confidence: 99, agree: 5, posScore: 1 }), 0);
  assert.ok(Core.scoreCandidate({ amount: 999999, raw: "999,999", confidence: 70, agree: 1, posScore: 0.5 }) > 0);
  assert.ok(Core.scoreCandidate({ amount: 1, raw: "1", confidence: 70, agree: 1, posScore: 0.5 }) > 0);
});

/* ---------- 5. 低確信度なら候補選択、高確信度なら自動入力 ---------- */
test("確信度が低ければ、利用者に選んでもらう", () => {
  const ranked = Core.rankCandidates([
    { amount: 1285, raw: "1,285", confidence: 30, posScore: 0.5 },
    { amount: 7285, raw: "7,285", confidence: 28, posScore: 0.5 },
  ]);
  assert.ok(ranked[0].score < Core.SCORE_CONFIRM, "点数が高すぎて検証にならない");
  assert.equal(Core.needsConfirmation(ranked), true, "選択画面にならない");

  // 候補が1つだけ＝点差の条件が効かない場面でも、点数が低ければ選択画面にする
  const only = Core.rankCandidates([{ amount: 1285, raw: "1,285", confidence: 30, posScore: 0.5 }]);
  assert.equal(only.length, 1);
  assert.ok(only[0].score < Core.SCORE_CONFIRM, "点数が高すぎて検証にならない: " + only[0].score);
  assert.equal(Core.needsConfirmation(only), true, "1件だけのとき、低確信でも自動確定している");
});

test("1位と2位の差が小さいときも、選んでもらう", () => {
  const ranked = Core.rankCandidates([
    { amount: 1285, raw: "1,285", confidence: 92, posScore: 0.9 },
    { amount: 1285, raw: "1,285", confidence: 90, posScore: 0.9 },
    { amount: 1265, raw: "1,265", confidence: 92, posScore: 0.9 },
    { amount: 1265, raw: "1,265", confidence: 90, posScore: 0.9 },
  ]);
  assert.ok(ranked.length >= 2);
  assert.ok(Math.abs(ranked[0].score - ranked[1].score) < Core.SCORE_GAP, "点差が開いていて検証にならない");
  assert.equal(Core.needsConfirmation(ranked), true, "拮抗しているのに自動確定している");
});

test("確信度が高く、2位を引き離していれば自動入力", () => {
  const ranked = Core.rankCandidates([
    { amount: 3555, raw: "3,555", confidence: 93, posScore: 0.95 },
    { amount: 3555, raw: "3,555", confidence: 91, posScore: 0.95 },
    { amount: 3555, raw: "3,555", confidence: 88, posScore: 0.9 },
    { amount: 263, raw: "263", confidence: 40, posScore: 0.1 },
  ]);
  assert.equal(ranked[0].amount, 3555);
  assert.ok(ranked[0].score >= Core.SCORE_CONFIRM, "点数が上がらない: " + ranked[0].score);
  assert.equal(Core.needsConfirmation(ranked), false, "自動入力にならない");
});

test("候補が1件も無ければ、選択画面は出さない（手入力へ）", () => {
  assert.deepEqual(Core.rankCandidates([]), []);
  assert.equal(Core.needsConfirmation([]), false);
  assert.equal(Core.needsConfirmation(Core.rankCandidates([{ amount: 12, raw: "1,2", confidence: 90 }])), false,
    "壊れた候補だけなのに選択画面を出している");
});

/* ---------- 画面側の作り ---------- */
test("候補は最大3件、タップしても保存はしない", () => {
  assert.match(appSrc, /st\.ocrChoices = ranked\.slice\(0,3\)/, "候補が3件までになっていない");
  assert.match(appSrc, /data-pick="\$\{a\}"/, "候補ボタンが無い");
  const pick = appSrc.slice(appSrc.indexOf('const pick=e.target.closest("[data-pick]")'), appSrc.indexOf('const act=e.target.closest'));
  assert.match(pick, /sheetState\.amount=String\(pick\.dataset\.pick\)/, "タップで金額が入らない");
  assert.equal(/save\(\)|saveTx\(\)/.test(pick), false, "候補をタップしただけで保存している");
  assert.match(appSrc, /記録はまだされません/, "保存されない旨の説明が無い");
});

test("候補が出ても「手入力する」に移れる", () => {
  assert.match(appSrc, /data-act="manual-amount"/, "手入力ボタンが無い");
  assert.match(appSrc, /a==="manual-amount"[\s\S]{0,200}focusField\("s-amt"\)/, "手入力欄に移動していない");
  assert.match(appSrc, /id="s-amt"/, "金額の入力欄が無い");
});

test("段階ごとに、いま何をしているかを表示する", () => {
  assert.match(appSrc, /setStatus\("画像を調整しています…"\)/, "調整中の表示が無い");
  assert.match(appSrc, /金額を確認しています…/, "確認中の表示が無い");
  assert.match(appSrc, /もう少し詳しく確認しています…/, "追加処理中の表示が無い");
});

test("読み取りは段階式で、最大9回に収まる（無条件反転の候補は持たない）", () => {
  assert.equal(Core.OCR_PLAN.flat().some((s) => s.image === "invert"), false,
    "無条件で反転する候補が残っている（自動反転と二重になる）");
  assert.equal(Core.OCR_MAX_RUNS, 9, "最大実行回数が想定と違う: " + Core.OCR_MAX_RUNS);
  assert.equal(Core.OCR_PLAN[0].length, 2, "1段目が重い");
  assert.match(appSrc, /if\(Core\.ocrEnough\(candidates\)\) break;/, "取れた時点で止めていない");
  const styles = new Set(Core.OCR_PLAN.flat().map((s) => s.image));
  for (const need of ["soft", "bw", "adaptive", "sharp"]) {
    assert.ok(styles.has(need), need + " が候補に無い");
  }
  const crops = new Set(Core.OCR_PLAN.flat().map((s) => s.crop));
  assert.deepEqual([...crops].sort(), ["base", "tight", "wide"], "枠3種を使っていない");
});

/* ---------- 画像処理そのもの ---------- */
test("適応的二値化は、明るさのムラがあっても文字を残す", () => {
  // 左から右へなだらかに明るくなる（照明ムラ）。暗い側と明るい側に1つずつ文字がある。
  const w = 12, h = 5;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const base = 90 + x * 12;                       // なだらかな明るさの変化
    const isInk = (x === 2 || x === 9) && y === 2;
    const v = isInk ? base - 55 : base;
    const i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  Core.adaptiveBinarize(data, w, h, 5, 10);
  const at = (x, y) => data[(y * w + x) * 4];
  assert.equal(at(2, 2), 0, "暗い側の文字が消えた");
  assert.equal(at(9, 2), 0, "明るい側の文字が消えた");
  // 文字でないところが黒く塗りつぶされていないこと
  let inked = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y) === 0) inked++;
  assert.ok(inked <= 4, "背景まで黒くなっている（黒画素 " + inked + " 個）");
});

test("固定のしきい値だと、暗い側が丸ごと黒くつぶれる（適応的が必要な理由）", () => {
  const w = 12, h = 5;
  const mk = () => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const base = 90 + x * 12;
      const isInk = (x === 2 || x === 9) && y === 2;
      const v = isInk ? base - 55 : base;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    return d;
  };
  const black = (d) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 0) n++; return n; };
  const otsu = mk(); Core.binarizeForOcr(otsu);
  const adap = mk(); Core.adaptiveBinarize(adap, w, h, 5, 10);
  // 文字は2画素だけ。大津だと暗い側の背景まで黒くなり、文字が埋もれる。
  assert.ok(black(otsu) > 10, "この画像では大津でもつぶれないため、比較の意味がない");
  assert.equal(black(adap), 2, "適応的二値化が文字だけを残せていない");
  assert.equal(adap[(0 * 12 + 0) * 4], 255, "暗い側の背景が黒く塗られている");
});

test("シャープ化は輪郭を強め、画像を壊さない", () => {
  const w = 5, h = 5;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const p = i * 4; data[p] = data[p + 1] = data[p + 2] = 200; data[p + 3] = 255; }
  const c = (2 * w + 2) * 4; data[c] = data[c + 1] = data[c + 2] = 100;   // 真ん中だけ暗い
  Core.sharpenForOcr(data, w, h);
  assert.ok(data[c] < 100, "暗い点がより暗くなっていない");
  for (let i = 0; i < data.length; i += 4) assert.ok(data[i] >= 0 && data[i] <= 255);
});

test("白抜き文字のときだけ反転する", () => {
  const dark = new Uint8ClampedArray([20, 20, 20, 255, 30, 30, 30, 255]);
  const light = new Uint8ClampedArray([230, 230, 230, 255, 210, 210, 210, 255]);
  assert.equal(Core.shouldInvert(dark), true, "暗い背景を見つけられない");
  assert.equal(Core.shouldInvert(light), false, "明るい背景を反転しようとしている");
  Core.invertForOcr(dark);
  assert.equal(dark[0], 235);
});

/* ---------- 6. 既存機能を壊していない ---------- */
test("記録・保存・写真削除・容量制限が残っている", () => {
  assert.match(appSrc, /state\.tx\.push\(\{id:uid\(\)/, "記録の追加が消えた");
  assert.match(appSrc, /function save\(\)\{[\s\S]*?return true;[\s\S]*?return false;/, "保存の成否判定が消えた");
  assert.match(appSrc, /resizeDataUrl\(photo, Core\.PHOTO_STORE_MAX/, "保存時の縮小が消えた");
  assert.match(appSrc, /写真は容量オーバーで保存できません/, "容量オーバー時の救済が消えた");
  assert.match(appSrc, /function purgePhotos\(\)/, "写真の一括削除が消えた");
  assert.match(appSrc, /Core\.storageUsage\(state\)/, "使用量の表示が消えた");
  assert.match(appSrc, /この内容で記録する/, "記録ボタンが消えた");
});

test("高解像度・加工画像は保存されず、決められた場面で解放される", () => {
  const read = appSrc.slice(appSrc.indexOf("async function readCrop()"), appSrc.indexOf("function cropToDataUrl"));
  assert.equal(/finally\{[\s\S]*?releaseOcrImage\(/.test(read), false,
    "読み取り終了時に解放している（再試行で表示用画像に落ちる）");
  assert.match(read, /const cache=\{\};/, "加工画像を使い回していない");
  // 解放されるのは4つの場面
  assert.match(appSrc, /if\(!on\)\{ releaseOcrImage\(sheetState\);/, "シートを閉じたとき");
  assert.match(appSrc, /rm-photo"\)\{[\s\S]{0,120}releaseOcrImage\(sheetState\)/, "写真を消したとき");
  assert.match(appSrc, /releaseOcrImage\(sheetState\);\s*\/\/ 前の写真の高解像度版/, "写真を撮り直したとき");
  const save = appSrc.slice(appSrc.indexOf("async function saveTx()"), appSrc.indexOf("function delTx()"));
  assert.match(save, /releaseOcrImage\(st\);/, "記録を確定したとき");
  const rec = /state\.tx\.push\(\{([^}]*)\}\)/.exec(appSrc);
  assert.equal(rec[1].includes("photoHi"), false, "記録に高解像度画像が入っている");
  assert.equal(rec[1].includes("ocrChoices"), false, "記録に候補が入っている");
});

/* ---------- 反転の二重適用が起きない ---------- */
function grayImage(w, h, fill) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const p = i * 4; d[p] = d[p + 1] = d[p + 2] = fill(i % w, (i / w) | 0); d[p + 3] = 255; }
  return d;
}
const meanOf = (d) => { let t = 0, n = 0; for (let i = 0; i < d.length; i += 4) { t += d[i]; n++; } return t / n; };

test("暗い背景の画像は1回だけ反転され、明るい背景・暗い文字になる", () => {
  const w = 10, h = 6;
  // 背景が暗く、文字（1画素）が明るい＝白抜き文字
  // 白抜き文字（背景が暗い）。文字は一定の面積を持ち、紙の濃淡もある。
  const src = grayImage(w, h, (x, y) => (y === 3 && x >= 2 && x <= 6 ? 225 + (x % 3) * 8 : 28 + (x % 4) * 5));
  const out = Core.prepareForOcr(src, w, h, "soft");
  const at = (x, y) => out[(y * w + x) * 4];
  assert.ok(meanOf(out) > 128, "背景が明るくなっていない（反転されていないか、二重に反転した）");
  assert.ok(at(4, 3) < at(0, 0), "文字が背景より暗くなっていない");
});

test("明るい背景の画像は反転されない", () => {
  const w = 10, h = 6;
  const src = grayImage(w, h, (x, y) => (y === 3 && x >= 2 && x <= 6 ? 38 + (x % 3) * 6 : 228 + (x % 4) * 5));
  const out = Core.prepareForOcr(src, w, h, "soft");
  const at = (x, y) => out[(y * w + x) * 4];
  assert.ok(meanOf(out) > 128, "明るい背景が暗くなった（不要な反転が入った）");
  assert.ok(at(4, 3) < at(0, 0), "文字が背景より暗くない");
});

test("どの画像処理を選んでも、二重反転で元へ戻らない", () => {
  const w = 12, h = 8;
  for (const style of ["soft", "bw", "sharp", "adaptive", "plain"]) {
    const src = grayImage(w, h, (x, y) => (y === 4 && x >= 3 && x <= 6 ? 235 : 25)); // 白抜き文字
    const out = Core.prepareForOcr(src, w, h, style);
    const ink = out[(4 * w + 4) * 4];
    const bg = out[(1 * w + 1) * 4];
    assert.ok(ink < bg, `${style}: 文字が背景より暗くない（二重反転の疑い）ink=${ink} bg=${bg}`);
  }
});

test("画面側は自前で反転せず、prepareForOcr に任せている", () => {
  const crop = appSrc.slice(appSrc.indexOf("function cropToDataUrl"), appSrc.indexOf("async function ocrCandidates"));
  assert.match(crop, /Core\.prepareForOcr\(d\.data, out\.w, out\.h, style\)/, "下ごしらえを任せていない");
  assert.equal(/Core\.invertForOcr/.test(crop), false, "画面側でも反転している（二重適用の原因）");
  assert.equal(/Core\.shouldInvert/.test(crop), false, "画面側でも反転判定している");
});
