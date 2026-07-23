/* =========================================================================
   かけいぼ ― 先頭の桁が欠けた読み取りの補正テスト
   -------------------------------------------------------------------------
   実際に起きた不具合の再現：
     画像には「¥3,555」と写っているのに、候補が 555 / 665 / 655 しか出ない。
     先頭の「3,」がOCRで落ちていた。
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("./core.js");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const appSrc = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].pop()[1];

const FRAME = { x: 0.10, y: 0.42, w: 0.80, h: 0.16 };

/* OCRの1回ぶんの結果を、実際の流れと同じ形に組み立てる */
function pass(text, confidence) {
  return Core.amountDetails(text).map((d) => ({
    amount: d.amount, raw: d.raw, confidence,
    posScore: Core.textPositionScore(d),
    context: Core.totalHint(d),
    truncated: !!Core.truncatedLeading(d),
    detail: d,
    source: "ocr",
  }));
}

/* ---------- 1. まず、正しく読めたときは何も壊さない ---------- */
test("「¥3,555」がそのまま読めたら、そのまま候補になる", () => {
  const cands = [...pass("¥3,555", 88), ...pass("¥3,555", 85)];
  const ranked = Core.rankCandidates(cands);
  assert.equal(ranked[0].amount, 3555);
  assert.equal(ranked[0].source, "ocr", "直接読めたのに推測扱いになっている");
  assert.equal(Core.needsConfirmation(ranked), false, "正しく読めたのに自動入力されない");
});

test("素直な3桁の買い物（カンマなし）は、桁が欠けた扱いにしない", () => {
  const cands = [...pass("555", 82), ...pass("555", 80)];
  assert.equal(cands[0].truncated, false, "普通の3桁を桁欠けとみなしている");
  assert.equal(Core.reconstructionPlan(cands.map((c) => c.detail), FRAME), null,
    "補正が要らない場面で補正しようとしている");
  const ranked = Core.rankCandidates(cands);
  assert.equal(ranked[0].amount, 555);
});

/* ---------- 2. 桁が欠けたことに気づく ---------- */
test("カンマが見えていれば「4桁以上のはず」と気づく", () => {
  const d = Core.amountDetails(",555")[0];
  const t = Core.truncatedLeading(d);
  assert.ok(t, "桁欠けに気づいていない");
  assert.equal(t.digits, null, "数字は不明のはず");
  assert.equal(t.evidence, "comma");
});

test("先頭の数字が文字として残っていれば、それを使う", () => {
  const d = Core.amountDetails("3,555")[0];
  assert.equal(d.amount, 3555, "そもそも正しく読めている");
  // 「3 ,555」のように分かれてしまった場合
  const d2 = Core.amountDetails("3, 555")[0];
  const t2 = Core.truncatedLeading(d2);
  if (t2) assert.equal(t2.digits, "3", "残っている先頭の数字を拾えていない");
});

test("すでにカンマ付きで読めている候補は、桁欠けとみなさない", () => {
  assert.equal(Core.truncatedLeading(Core.amountDetails("1,285")[0]), null);
});

test("4桁以上・2桁以下は補正の対象にしない", () => {
  assert.equal(Core.truncatedLeading(Core.amountDetails(",12")[0]), null, "2桁を対象にしている");
  assert.equal(Core.truncatedLeading(Core.amountDetails(",1234")[0]), null, "4桁を対象にしている");
});

/* ---------- 3. 欠けた1文字を探す場所 ---------- */
test("欠けた先頭数字を探す帯は、枠の中に収まる", () => {
  for (const text of [",555", "555", "  ,555"]) {
    const d = Core.amountDetails(text)[0];
    const strip = Core.leadingStripCrop(FRAME, d);
    assert.ok(strip.x >= FRAME.x - 1e-9, "枠の左外に出ている");
    assert.ok(strip.x + strip.w <= FRAME.x + FRAME.w + 1e-9, "枠の右外に出ている");
    assert.ok(strip.w > 0.01, "帯が細すぎる");
    assert.equal(strip.y, FRAME.y);
    assert.equal(strip.h, FRAME.h);
  }
});

test("帯は数字より左側を見る（数字そのものを読み直さない）", () => {
  // 行の後ろの方に数字がある場合
  const d = Core.amountDetails("      ,555")[0];
  const strip = Core.leadingStripCrop(FRAME, d);
  assert.ok(strip.x + strip.w <= FRAME.x + FRAME.w, "枠をはみ出している");
  assert.ok(strip.w < FRAME.w, "枠全体を読み直そうとしている");
});

/* ---------- 4. 候補の作り方 ---------- */
test("先頭の数字が分かったら、候補を1つだけ作る（1〜9を総当たりしない）", () => {
  const built = Core.buildReconstructed(555, "3", { confidence: 90, agree: 3 });
  assert.equal(built.amount, 3555);
  assert.equal(built.raw, "3,555", "カンマの形になっていない");
  assert.equal(built.source, "reconstructed", "推測だと分かる印が無い");
  assert.ok(built.confidence <= Core.RECON_MAX_CONF, "推測なのに信頼度が高い");
});

test("先頭の数字が読めなければ、候補を作らない", () => {
  assert.equal(Core.buildReconstructed(555, null), null);
  assert.equal(Core.buildReconstructed(555, ""), null);
  assert.equal(Core.buildReconstructed(555, "0"), null, "先頭0は意味がない");
  assert.equal(Core.buildReconstructed(555, "あ"), null);
});

test("帯の読み取り結果から、いちばん確からしい数字を1つ選ぶ", () => {
  assert.equal(Core.firstDigit([{ text: "3", confidence: 90 }]), "3");
  assert.equal(Core.firstDigit([{ text: "8", confidence: 30 }, { text: "3", confidence: 92 }]), "3");
  assert.equal(Core.firstDigit([{ text: "", confidence: 90 }]), null);
  assert.equal(Core.firstDigit([]), null);
  assert.equal(Core.firstDigit(null), null);
});

/* ---------- 5. 今回の不具合の再現 ---------- */
test("再現：¥3,555 の画像で 555 / 665 / 655 しか読めなかった場合", () => {
  // 実際に起きた読み取り結果（先頭の「3,」が落ちている）
  const cands = [
    ...pass("¥555", 78),
    ...pass(",555", 74),
    ...pass("665", 52),
    ...pass("655", 48),
  ];

  // ① 桁が欠けていることに気づく
  const plan = Core.reconstructionPlan(cands.map((c) => c.detail), FRAME);
  assert.ok(plan, "桁が欠けていることに気づいていない");
  assert.equal(plan.base, 555);
  assert.equal(plan.kind, "strip", "画像から読み直す作戦になっていない");

  // ② 帯を読み直したら「3」だった
  const digit = Core.firstDigit([{ text: "3", confidence: 86 }]);
  const rebuilt = Core.buildReconstructed(plan.base, digit, { confidence: 78, agree: 2 });
  cands.push(rebuilt);

  // ③ 3,555 が候補に出て、いちばん上に来る
  const ranked = Core.rankCandidates(cands);
  const amounts = ranked.map((r) => r.amount);
  assert.ok(amounts.includes(3555), "¥3,555 が候補に出ていない: " + amounts.join(", "));
  assert.equal(ranked[0].amount, 3555, "合計らしい候補が一番上に来ていない: " + amounts.join(", "));

  // ④ 推測なので、自動では入れず必ず選んでもらう
  assert.equal(ranked[0].source, "reconstructed");
  assert.equal(Core.needsConfirmation(ranked), true, "推測を自動入力しようとしている");

  // ⑤ 元の 555 も候補には残る（利用者が選べる）
  assert.ok(amounts.includes(555), "直接読めた候補が消えている");
});

test("点数が高くても、推測なら必ず選んでもらう（自動入力しない）", () => {
  // わざと点数を満点近くにした推測候補。点数の条件だけでは止まらない状況をつくる。
  const strong = Core.rankCandidates([
    { amount: 3555, raw: "3,555", confidence: 100, agree: 9, posScore: 1, context: true, source: "reconstructed" },
  ]);
  assert.equal(strong[0].source, "reconstructed");
  assert.ok(strong[0].score >= Core.SCORE_CONFIRM,
    "点数が低いままで、確認の理由が「点数」になってしまう: " + strong[0].score);
  assert.equal(Core.needsConfirmation(strong), true, "点数が高い推測を自動入力しようとしている");

  // 比較：同じ点数でも、直接読めた候補なら自動入力してよい
  const direct = Core.rankCandidates([
    { amount: 3555, raw: "3,555", confidence: 100, agree: 9, posScore: 1, context: true, source: "ocr" },
  ]);
  assert.equal(Core.needsConfirmation(direct), false, "直接読めた候補まで確認にしている");
});

test("候補は重複を消して最大5件", () => {
  const many = [];
  for (const [amt, conf] of [[555, 70], [665, 60], [655, 55], [755, 50], [855, 45], [955, 40], [455, 35]]) {
    many.push(...pass(String(amt), conf), ...pass(String(amt), conf - 5));
  }
  const ranked = Core.rankCandidates(many);
  const shown = ranked.slice(0, Core.MAX_CHOICES).map((r) => r.amount);
  assert.equal(new Set(shown).size, shown.length, "同じ金額が重複している");
  assert.ok(shown.length <= 5, "候補が5件を超えている");
  assert.equal(Core.MAX_CHOICES, 5);
});

/* ---------- 6. 合計らしい候補を上に ---------- */
test("¥やカンマ・合計の手がかりがある候補を優先する", () => {
  const withHint = pass("合計 ¥1,285", 70);
  const without = Core.amountDetails("1285")[0];
  assert.equal(withHint[0].context, true, "手がかりを拾えていない");
  assert.equal(Core.totalHint(without), false, "手がかりが無いのに拾っている");

  const ranked = Core.rankCandidates([
    { amount: 1285, raw: "1,285", confidence: 70, posScore: 0.5, context: true },
    { amount: 7285, raw: "7,285", confidence: 70, posScore: 0.5, context: false },
  ]);
  assert.equal(ranked[0].amount, 1285, "手がかりのある候補が上に来ていない");
});

test("カンマが見えているのに3桁のままの候補は、順位を下げる", () => {
  const ranked = Core.rankCandidates([
    { amount: 555, raw: "555", confidence: 85, posScore: 0.5, context: true, truncated: true },
    { amount: 3555, raw: "3,555", confidence: 55, posScore: 0.5, context: true, source: "reconstructed", agree: 2 },
  ]);
  assert.equal(ranked[0].amount, 3555, "桁が欠けた候補が上に残っている");
});

/* ---------- 7. 画面側の作り ---------- */
test("補正は最大1回だけ、すでに4桁が読めていれば行わない", () => {
  const read = appSrc.slice(appSrc.indexOf("async function readCrop()"), appSrc.indexOf("function cropToDataUrl"));
  assert.match(read, /const already4 = candidates\.some\(c=>Number\(c\.amount\)>=1000\);/, "4桁が読めている場合の判定が無い");
  assert.match(read, /if\(plan && !already4\)\{/, "無条件で補正しようとしている");
  assert.match(read, /Core\.reconstructionPlan\(details, crop\)/, "補正の作戦を立てていない");
  assert.match(read, /psm:"10"/, "1文字として読む設定になっていない");
});

test("推測した金額を自動記録しない（候補として出すだけ）", () => {
  const read = appSrc.slice(appSrc.indexOf("async function readCrop()"), appSrc.indexOf("function cropToDataUrl"));
  // 自動入力は needsConfirmation が false のときだけ
  assert.match(read, /if\(Core\.needsConfirmation\(ranked\)\)\{/, "確認の分岐が無い");
  assert.equal(/save\(\)|saveTx\(\)/.test(read), false, "読み取りの中で保存している");
});

test("候補が出ても手入力欄は必ず残る", () => {
  assert.match(appSrc, /data-act="manual-amount"/, "手入力ボタンが無い");
  assert.match(appSrc, /id="s-amt"/, "金額の入力欄が無い");
  assert.match(appSrc, /記録はまだされません/, "保存されない旨の説明が無い");
});

test("撮り直しと記録処理を壊していない", () => {
  assert.match(appSrc, /data-act="shot-total"/, "撮り直しが消えた");
  assert.match(appSrc, /state\.tx\.push\(\{id:uid\(\)/, "記録の追加が消えた");
  assert.match(appSrc, /この内容で記録する/, "記録ボタンが消えた");
});
