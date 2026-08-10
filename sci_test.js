/* =========================================================================
   かけいぼ ― 関数電卓のテスト
   -------------------------------------------------------------------------
   守りたいこと：
     ・＋ー×÷ に加えて、かっこ・√・べき乗・三角関数・log が正しく解ける
     ・おかしな式でも落ちず、理由を返す
     ・答えをそのまま家計簿の記録にまわせる（1円以上の整数のときだけ）
     ・計算の履歴が端末に残り、あとで呼び戻せる
     ・下のタブから開ける
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");
const fs = require("node:fs");
const path = require("node:path");
const { bootApp } = require("./boot-app.cjs");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

/* キーを順に押して、最後の状態を返す */
const run = (...keys) => keys.reduce((s, k) => Core.sciPress(s, k), Core.newSci());
const val = (...keys) => { const s = run.apply(null, keys.concat(["="])); return s.error ? s.error : Core.sciFormat(s.result); };

/* ---------- 1. 計算 ---------- */

test("四則は、かけ算・わり算を先に計算する", () => {
  assert.equal(val("2", "+", "3", "*", "4"), "14");
  assert.equal(val("1", "0", "-", "6", "/", "2"), "7");
});

test("かっこの中を先に計算する", () => {
  assert.equal(val("(", "2", "+", "3", ")", "*", "4"), "20");
  assert.equal(val("2", "*", "(", "3", "+", "(", "4", "-", "1", ")", ")"), "12");
});

test("小数が使える", () => {
  assert.equal(val("1", ".", "5", "*", "2"), "3");
  assert.equal(val("0", ".", "1", "+", "0", ".", "2"), "0.3", "誤差がそのまま出ている");
});

test("べき乗は右から計算する", () => {
  assert.equal(val("2", "^", "1", "0"), "1024");
  assert.equal(val("2", "^", "3", "^", "2"), "512", "2^(3^2) になっていない");
});

test("符号のマイナスが使える", () => {
  assert.equal(val("-", "5", "+", "3"), "-2");
  assert.equal(val("-", "2", "^", "2"), "-4", "−(2^2) になっていない");
  assert.equal(val("5", "*", "(", "-", "3", ")"), "-15");
});

test("√・log・ln が使える", () => {
  assert.equal(val("√", "1", "6", ")"), "4");
  assert.equal(val("log", "1", "0", "0", ")"), "2");
  assert.equal(val("ln", "e", ")"), "1");
});

test("三角関数は、はじめは度で計算する", () => {
  assert.equal(val("sin", "3", "0", ")"), "0.5");
  assert.equal(val("cos", "6", "0", ")"), "0.5");
});

test("度で計算するとき、90の倍数はきっちり 0・1・エラーになる", () => {
  /* 90° を弧度へ直しても π/2 ちょうどにはならないため、
     そのまま Math に渡すと sin(180) が 1.224647e-16、
     tan(90) が 1.633124e+16 のような値になって画面に出てしまう。
     市販の関数電卓と同じく、0 と「計算できません」を返す。 */
  assert.equal(val("sin", "1", "8", "0", ")"), "0", "sin(180) に誤差が出ている");
  assert.equal(val("sin", "3", "6", "0", ")"), "0", "sin(360) に誤差が出ている");
  assert.equal(val("cos", "9", "0", ")"), "0", "cos(90) に誤差が出ている");
  assert.equal(val("cos", "2", "7", "0", ")"), "0", "cos(270) に誤差が出ている");
  assert.equal(val("tan", "0", ")"), "0");
  assert.equal(val("sin", "9", "0", ")"), "1");
  assert.equal(val("cos", "1", "8", "0", ")"), "-1");
  assert.equal(val("sin", "2", "7", "0", ")"), "-1");
});

test("度で計算するとき、tan(90) は答えを出さない", () => {
  for (const deg of [["9", "0"], ["2", "7", "0"], ["4", "5", "0"], ["-", "9", "0"]]) {
    const s = run.apply(null, ["tan"].concat(deg, [")", "="]));
    assert.equal(s.result, null, "tan(" + deg.join("") + ") が答えを出している");
    assert.equal(s.error, "計算できません", "理由が出ていない: " + deg.join(""));
  }
});

test("ふつうの角度は、これまでどおりの値が出る", () => {
  assert.equal(val("sin", "3", "0", ")"), "0.5");
  assert.equal(val("cos", "6", "0", ")"), "0.5");
  assert.equal(val("tan", "4", "5", ")"), "1");
  assert.equal(val("sin", "4", "5", ")"), "0.7071067812");
});

test("弧度モードでは 90の倍数の丸めを持ち込まない", () => {
  /* 弧度のときの 90 は π/2 ではないので、0 に丸めてはいけない。 */
  let s = Core.sciPress(Core.newSci(), "deg");
  ["sin", "9", "0", ")", "="].forEach((k) => { s = Core.sciPress(s, k); });
  assert.equal(Core.sciFormat(s.result), "0.8939966636", "弧度なのに度として丸めている");
});

test("Deg と Rad を切り替えられる", () => {
  let s = Core.sciPress(Core.newSci(), "deg");
  assert.equal(s.deg, false);
  ["sin", "π", "/", "2", ")", "="].forEach((k) => { s = Core.sciPress(s, k); });
  assert.equal(Core.sciFormat(s.result), "1", "弧度で計算されていない");
});

test("π と e が使える。かける記号は省ける", () => {
  assert.equal(val("2", "π"), "6.283185307");
  assert.equal(val("2", "(", "3", "+", "4", ")"), "14", "2(3+4) が計算できない");
});

test("Ans で前の答えを使える", () => {
  let s = run("1", "0", "0", "+", "5", "0", "=");
  assert.equal(Core.sciFormat(s.result), "150");
  ["Ans", "*", "2", "="].forEach((k) => { s = Core.sciPress(s, k); });
  assert.equal(Core.sciFormat(s.result), "300");
});

/* ---------- 2. おかしな式 ---------- */

test("0で割ろうとしたら、理由を返す", () => {
  assert.equal(val("1", "/", "0"), "0では割れません");
});

test("かっこが合っていなければ、そう教える", () => {
  assert.equal(val("(", "2", "+", "3"), "かっこが合っていません");
  assert.equal(val("2", "+", "3", ")"), "かっこが合っていません");
});

test("式として読めないものは、そう教える", () => {
  assert.equal(val("2", "+"), "式が正しくありません");
  assert.equal(val("1", ".", "2", ".", "3"), "式が正しくありません");
});

test("計算できない答えは、答えとして出さない", () => {
  assert.equal(val("√", "-", "4", ")"), "計算できません");
  assert.equal(val("log", "0", ")"), "計算できません");
});

test("何も押していないときに ＝ を押しても、何も起きない", () => {
  const s = run("=");
  assert.equal(s.result, null);
  assert.equal(s.error, "");
});

test("式が長くなりすぎたら、そこで止める", () => {
  const keys = [];
  for (let i = 0; i < Core.SCI_TOKENS_MAX + 10; i++) keys.push("1");
  const s = run.apply(null, keys);
  assert.equal(s.tokens.length, Core.SCI_TOKENS_MAX);
  assert.match(s.error, /長すぎ/);
});

/* ---------- 3. 打ち込みの決まり ---------- */

test("AC でぜんぶ消える。履歴と Deg/Rad は残る", () => {
  let s = run("1", "+", "1", "=");
  s = Core.sciPress(s, "deg");
  s = Core.sciPress(s, "AC");
  assert.equal(Core.sciExpr(s), "");
  assert.equal(s.result, null);
  assert.equal(s.history.length, 1, "履歴まで消えている");
  assert.equal(s.deg, false, "Deg/Rad の設定が戻っている");
});

test("⌫ は最後のひと押しぶんを消す（関数はまとめて消える）", () => {
  assert.equal(Core.sciExpr(run("1", "2", "3", "DEL")), "12");
  assert.equal(Core.sciExpr(run("sin", "DEL")), "", "関数が半端に残っている");
});

test("答えのあとに数字を押すと、新しい式になる", () => {
  const s = run("1", "+", "1", "=", "9");
  assert.equal(Core.sciExpr(s), "9");
  assert.equal(s.result, null);
});

test("答えのあとに記号を押すと、その答えから続けて計算できる", () => {
  const s = run("1", "0", "+", "5", "=", "*", "2", "=");
  assert.equal(Core.sciFormat(s.result), "30");
});

test("関数のうしろには、開きかっこが見える", () => {
  assert.equal(Core.sciExpr(run("sin", "3", "0")), "sin(30");
  assert.equal(Core.sciExpr(run("√", "9")), "√(9");
});

/* ---------- 4. 家計簿に渡す ---------- */

test("1円以上の整数の答えだけ、家計簿にまわせる", () => {
  assert.equal(Core.sciAmount(run("1", "2", "0", "0", "+", "3", "8", "0", "=")), 1580);
  assert.equal(Core.sciAmount(run("1", ".", "5", "=")), null, "小数を通している");
  assert.equal(Core.sciAmount(run("0", "-", "5", "=")), null, "マイナスを通している");
  assert.equal(Core.sciAmount(run("1", "+", "1")), null, "＝ を押す前に通している");
});

/* ---------- 5. 履歴 ---------- */

test("＝ を押すたびに履歴が増える（新しいものが上）", () => {
  const s = run("1", "+", "1", "=", "2", "*", "3", "=");
  assert.equal(s.history.length, 2);
  assert.equal(s.history[0].expr, "2*3");
  assert.equal(s.history[0].value, 6);
  assert.equal(s.history[1].expr, "1+1");
});

test("履歴は増えすぎない", () => {
  let s = Core.newSci();
  for (let i = 0; i < Core.SCI_HISTORY_MAX + 5; i++) s = ["1", "+", "1", "="].reduce((a, k) => Core.sciPress(a, k), s);
  assert.equal(s.history.length, Core.SCI_HISTORY_MAX);
});

test("履歴を消せる", () => {
  const s = Core.sciClearHistory(run("1", "+", "1", "="));
  assert.equal(s.history.length, 0);
});

test("こわれた履歴が端末に入っていても、読み飛ばす", () => {
  assert.deepEqual(Core.normalizeSciHistory([{ expr: "1+1", value: 2 }, { expr: "", value: 1 }, null, "x"]),
    [{ expr: "1+1", value: 2 }]);
  assert.deepEqual(Core.normalizeSciHistory("こわれた"), []);
});

/* ---------- 6. 画面 ---------- */

const boot = (calcHistory) => bootApp({ state: { settings: {}, tx: [], health: {}, diary: {}, plans: {}, calcHistory: calcHistory || [] } });
const press = (app, ...keys) => keys.forEach((k) =>
  app.run(`handleAct("sci",{target:{closest:()=>({dataset:{key:${JSON.stringify(k)}}})}});`));
const screen = (app) => { app.run(`view="calc"; render();`); return app.el("app").innerHTML; };

test("下のタブから電卓を開ける", () => {
  assert.match(html, /<button data-nav="calc">.*電卓<\/button>/, "下のタブに電卓が無い");
  assert.match(screen(boot()), /class="scipad"/, "電卓の画面が出ない");
});

test("キーがひととおりそろっている", () => {
  const h = screen(boot());
  for (const key of ["7", "0", ".", "00", "+", "-", "*", "/", "^", "(", ")", "=", "AC", "DEL",
                     "sin", "cos", "tan", "log", "ln", "√", "π", "e", "Ans", "deg"]) {
    assert.ok(h.includes(`data-key="${key}"`), `${key} のキーが無い`);
  }
});

test("押すと、式と答えが画面に出る", () => {
  const app = boot();
  screen(app);
  press(app, "1", "2", "0", "0", "+", "3", "8", "0", "=");
  const h = app.el("app").innerHTML;
  assert.match(h, /class="sciexpr mono">1200\+380</);
  assert.match(h, /class="scians mono">1580</);
});

test("答えを家計簿の記録にまわせる", () => {
  const app = boot();
  screen(app);
  press(app, "5", "0", "0", "*", "3", "=");
  app.run(`handleAct("sci-record",{});`);
  assert.equal(app.run(`sheetState.amount`), "1500", "記録の金額に入っていない");
  assert.match(app.el("sheet").innerHTML, /id="s-amt"[^>]*value="1500"/, "記録の画面に金額が出ていない");
  assert.equal(app.run(`view`), "calc", "電卓の画面から勝手に移動している");
});

test("＝ の前は、記録にまわす案内だけ出す", () => {
  const app = boot();
  screen(app);
  press(app, "1", "2", "3");
  const h = app.el("app").innerHTML;
  assert.equal(h.includes("を家計簿に記録する"), false, "＝ の前に記録ボタンが出ている");
  assert.match(h, /＝ を押すと/);
});

test("履歴は端末に残り、次に開いたときも出る", () => {
  const app = boot();
  screen(app);
  press(app, "1", "+", "1", "=");
  assert.deepEqual(JSON.parse(app.saved()).calcHistory, [{ expr: "1+1", value: 2 }]);
  const again = boot(JSON.parse(app.saved()).calcHistory);
  assert.match(screen(again), /1\+1/, "残した履歴が出ていない");
});

test("履歴をタップすると、その式が戻ってくる", () => {
  const app = boot();
  screen(app);
  press(app, "1", "2", "+", "3", "=");
  app.run(`handleAct("sci-use",{target:{closest:()=>({dataset:{i:"0"}})}});`);
  assert.match(app.el("app").innerHTML, /class="sciexpr mono">12\+3</);
});

test("履歴を消すと、端末からも消える", () => {
  const app = boot();
  screen(app);
  press(app, "1", "+", "1", "=");
  app.run(`handleAct("sci-clear",{});`);
  assert.deepEqual(JSON.parse(app.saved()).calcHistory, []);
  assert.match(app.el("app").innerHTML, /まだ計算していません/);
});

test("電卓を使っても、お金の記録は増えない", () => {
  const app = boot();
  screen(app);
  press(app, "9", "9", "9", "=");
  assert.deepEqual(JSON.parse(app.saved()).tx, []);
});
