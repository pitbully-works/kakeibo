/* =========================================================================
   かけいぼ ― 横スワイプでの画面切り替えのテスト
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const appSrc = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].pop()[1];

/* ---------- 1. どこへ移るか ---------- */
test("並びは下のタブと同じで、せっていは入らない", () => {
  const nav = [...html.matchAll(/data-nav="([a-z]+)"/g)].map((m) => m[1]);
  const tabs = [];
  for (const v of nav) if (!tabs.includes(v)) tabs.push(v);
  assert.deepEqual(Core.SWIPE_VIEWS, tabs, "スワイプの並びが下のタブと違う");
  assert.equal(Core.SWIPE_VIEWS.includes("settings"), false, "せっていが並びに入っている");
});

test("左へ払うと次の画面、右へ払うと前の画面", () => {
  assert.equal(Core.swipeNextView("home", -80), "summary");
  assert.equal(Core.swipeNextView("summary", 80), "home");
  assert.equal(Core.swipeNextView("calc", -80), "pulse");
  assert.equal(Core.swipeNextView("pulse", 80), "calc");
});

test("端では行き止まりにする（ぐるっと回り込まない）", () => {
  assert.equal(Core.swipeNextView("home", 80), null, "ホームから右へ回り込んでいる");
  assert.equal(Core.swipeNextView("pulse", -80), null, "心拍から左へ回り込んでいる");
});

test("並びに無い画面（せってい）からは切り替えない", () => {
  assert.equal(Core.swipeNextView("settings", -80), null);
  assert.equal(Core.swipeNextView("", -80), null);
  assert.equal(Core.swipeNextView("home", 0), null, "動いていないのに切り替えている");
  assert.equal(Core.swipeNextView("home", NaN), null);
});

/* ---------- 2. 指の動きの見きわめ ---------- */
const decide = (app, dx, dy, ms, view) => app.run(`swipeDecide(${dx}, ${dy}, ${ms}, "${view}")`);

test("はっきり横に払ったときだけ切り替える", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  assert.equal(decide(app, -120, 5, 200, "home"), "summary");
  assert.equal(decide(app, 120, -5, 200, "summary"), "home");
});

test("縦スクロールを、画面の切り替えと取り違えない", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  assert.equal(decide(app, -70, 200, 300, "home"), null, "縦に動かしたのに切り替わっている");
  assert.equal(decide(app, -70, 60, 300, "home"), null, "斜めの動きで切り替わっている");
});

test("ほんの少し触れただけでは切り替えない", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  assert.equal(decide(app, -20, 2, 150, "home"), null, "20pxで切り替わっている");
  assert.equal(decide(app, -59, 2, 150, "home"), null, "59pxで切り替わっている");
  assert.equal(decide(app, -60, 2, 150, "home"), "summary", "60pxで切り替わらない");
});

test("ゆっくりなぞった指では切り替えない", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  assert.equal(decide(app, -200, 5, 1500, "home"), null, "ゆっくりでも切り替わっている");
});

/* ---------- 3. 切り替えてはいけない場面 ---------- */
test("記録シートを開いている間は切り替えない", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  assert.equal(app.run(`sheetState=null; swipeBlocked(null)`), false);
  assert.equal(app.run(`openRecord(null); swipeBlocked(null)`), true, "シートを開いても切り替わる");
});

test("心拍を測っている間は切り替えない（カメラが止まってしまう）", () => {
  const app = bootApp({ state: { settings: {}, tx: [], pulse: [] } });
  assert.equal(app.run(`pRunning=true; swipeBlocked(null)`), true);
  assert.equal(app.run(`pRunning=false; swipeBlocked(null)`), false);
});

test("入力欄や波形の上から始めた指の動きは、切り替えに使わない", () => {
  const app = bootApp({ state: { settings: {}, tx: [] } });
  const el = (sel) => app.run(`swipeBlocked({closest:(s)=>s.includes("${sel}")?{}:null})`);
  for (const sel of ["input", "textarea", "select", "canvas"]) {
    assert.equal(el(sel), true, `${sel} の上で切り替わってしまう`);
  }
  assert.equal(app.run(`swipeBlocked({closest:()=>null})`), false, "ふつうの場所で切り替わらない");
});

/* ---------- 4. つなぎこみ ---------- */
test("指を離したときに切り替え、画面を描き直す", () => {
  assert.match(appSrc, /addEventListener\("touchstart"/, "指を置いたときを見ていない");
  assert.match(appSrc, /addEventListener\("touchend"/, "指を離したときを見ていない");
  assert.match(appSrc, /view=next; render\(\);/, "切り替えたあとに描き直していない");
});

test("つまむ操作（2本指）では切り替えない", () => {
  assert.match(appSrc, /e\.touches\.length!==1/, "指の本数を見ていない");
  assert.match(appSrc, /e\.touches\.length>1\) swipeLive=false/, "途中で指が増えたときにやめていない");
});

test("スクロールを妨げない（passiveで受ける）", () => {
  const part = appSrc.slice(appSrc.indexOf("横スワイプで画面を切り替える"));
  const head = part.slice(0, part.indexOf("/* ---------- イベント（委譲）"));
  assert.equal((head.match(/\{passive:true\}/g) || []).length, 3, "passiveで受けていない指の操作がある");
  assert.equal(/preventDefault/.test(head), false, "既定の動きを止めている");
});
