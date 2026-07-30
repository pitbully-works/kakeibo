/* =========================================================================
   かけいぼ ― 確定ボタンの見た目のテスト
   「＋予定を入れる／保存する／この内容で記録する／＝ が小さくて
     ボタンだと分からない」を直したぶんを守る。
   .btn-main には以前スタイルの指定がまったく無く、ただの文字リンクに
   見えていた。指定が消えたら落ちるようにしておく。
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const { html } = require("./boot-app.cjs");

const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

/* 指定したセレクタの中身（{ 〜 }）を取り出す */
function ruleOf(selector) {
  const i = css.indexOf(selector + "{");
  assert.notEqual(i, -1, `${selector} のスタイル指定が無い（ボタンに見えなくなる）`);
  return css.slice(i + selector.length + 1, css.indexOf("}", i));
}

/* ---------- 1. 確定ボタンの土台 ---------- */
test(".btn-main に見た目の指定がある", () => {
  const r = ruleOf(".btn-main");
  assert.match(r, /background:var\(--green-d\)/, "背景色が無い（押せると分からない）");
  assert.match(r, /color:#fff/, "文字色が無い");
  assert.match(r, /width:100%/, "横いっぱいに広がらない");
  assert.match(r, /font-weight:800/, "太字になっていない");
});

test("確定ボタンは指で押しやすい大きさがある", () => {
  const r = ruleOf(".btn-main");
  const pad = /padding:(\d+(?:\.\d+)?)px/.exec(r);
  assert.notEqual(pad, null, "余白の指定が無い");
  assert.equal(Number(pad[1]) >= 14, true, `上下の余白が小さい: ${pad[1]}px`);
  const fs = /font-size:(\d+(?:\.\d+)?)px/.exec(r);
  assert.notEqual(fs, null, "文字の大きさの指定が無い");
  assert.equal(Number(fs[1]) >= 15, true, `文字が小さい: ${fs[1]}px`);
});

test("押したことが分かる（縮む動き）", () => {
  assert.notEqual(css.indexOf(".btn-main:active{"), -1, "押したときの反応が無い");
});

/* ---------- 2. 記録するボタンと同じ見た目か ---------- */
test("確定ボタンはホームの「記録する」と同じ系統の見た目", () => {
  const main = ruleOf(".btn-main");
  const rec = ruleOf(".recordbtn");
  ["background:var(--green-d)", "color:#fff", "font-weight:800"].forEach((k) => {
    assert.ok(main.includes(k), `記録するボタンと違う: ${k} が無い`);
    assert.ok(rec.includes(k), `記録するボタン側が変わっている: ${k}`);
  });
});

/* ---------- 3. それぞれのボタンが .btn-main を使っているか ---------- */
const MUST_USE_BTN_MAIN = [
  ["plan-add", "＋予定を入れる"],
  ["save-diary", "日記の保存する"],
  ["save-health", "この内容で記録する"],
  ["sci-record", "答えを家計簿に記録する"],
  ["carry-recurring", "今月にまとめて入れる"],
  ["cal-edit-plan", "この日の予定を書く"],
];
MUST_USE_BTN_MAIN.forEach(([act, name]) => {
  test(`${name} は大きなボタンになっている`, () => {
    const re = new RegExp(`<button[^>]*class="[^"]*btn-main[^"]*"[^>]*data-act="${act}"`);
    assert.match(html, re, `${name}（data-act="${act}"）が btn-main を使っていない`);
  });
});

/* ---------- 4. 電卓の ＝ ---------- */
test("電卓の ＝ は btn-main を使っている", () => {
  assert.match(html, /<button class="btn-main scieq" data-act="sci" data-key="="/, "＝ がボタンになっていない");
});

test("電卓の ＝ は他のキーより大きい", () => {
  const eq = ruleOf(".scieq");
  const fs = /font-size:(\d+(?:\.\d+)?)px/.exec(eq);
  const mh = /min-height:(\d+(?:\.\d+)?)px/.exec(eq);
  assert.notEqual(fs, null, "＝ の文字の大きさが指定されていない");
  assert.notEqual(mh, null, "＝ の高さが指定されていない");
  assert.equal(Number(fs[1]) >= 24, true, `＝ の文字が小さい: ${fs[1]}px`);

  // 数字キー（.scipad button）より大きいこと
  const pad = ruleOf(".scipad button");
  const padFs = Number(/font-size:(\d+(?:\.\d+)?)px/.exec(pad)[1]);
  const padMh = Number(/min-height:(\d+(?:\.\d+)?)px/.exec(pad)[1]);
  assert.equal(Number(fs[1]) > padFs, true, "＝ が数字キーより大きくない");
  assert.equal(Number(mh[1]) > padMh, true, "＝ の高さが数字キーより大きくない");
});
