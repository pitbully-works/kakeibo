/* =========================================================================
   かけいぼ ― 資産形成へのジャンプ／アプリ情報（About）のテスト
   -------------------------------------------------------------------------
   守りたいこと：
     ・ホームから「資産形成 総合ライフプラン」へ行ける（リンクが消えない）
     ・iPhoneで戻れる開き方になっている（PWAは _blank、Safariは同じタブ）
     ・せっていに、アプリ情報が出る（版数・著作権・連絡先）
     ・版数は core.js の定数ひとつだけで決まる（画面にベタ書きしない）
     ・見た目の追加であって、計算や保存には触っていない
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

const S = { birth: "1968-11-13", lp: { banks: [{ name: "貯金", monthlyDeposit: 40000 }], tsumitateSchedule: [{ fromAge: 0, toAge: 120, funds: [{ name: "全世界株式", amount: 33000 }] }] }, currency: "JPY" };
const YM = new Date().toISOString().slice(0, 7);
const SALARY = { id: "s1", type: "income", amount: 300000, cat: "salary", date: `${YM}-10` };
const STATE = { settings: S, tx: [SALARY], health: {}, diary: {} };

/* 画面を描いてHTMLを返す */
function screen(view, opts) {
  const app = bootApp(Object.assign({ state: STATE }, opts || {}));
  if (opts && opts.standalone) app.run(`navigator.standalone=true;`);
  app.run(`view=${JSON.stringify(view)}; render();`);
  return app.el("app").innerHTML;
}

/* ---------- 1. 資産形成へのジャンプ ---------- */

test("ホームに、資産形成 総合ライフプランへの入口がある", () => {
  const h = screen("home");
  assert.match(h, /href="https:\/\/pitbully-works\.jp\/\?country=JP"/, "ライフプランへのリンクに現在国が付いていない");
  assert.match(h, /資産形成 総合ライフプラン/, "どこへ行くのか書かれていない");
  assert.match(h, /class="lpcard"/, "入口カードが描かれていない");
});

test("外部リンクには rel=\"noopener\" が付いている", () => {
  const h = screen("home");
  const card = h.slice(h.indexOf('class="lpcard"'));
  assert.match(card.slice(0, 400), /rel="noopener noreferrer"/);
});

test("Safariのタブで開いているときは、同じタブで開く（戻るで戻れる）", () => {
  const h = screen("home");
  const card = h.slice(h.indexOf('class="lpcard"'), h.indexOf('class="lpcard"') + 400);
  assert.match(card, /target="_self"/, "同じタブで開く指定になっていない");
});

test("ホーム画面のPWAで開いているときは、別画面で開く（かけいぼの表示が残る）", () => {
  const h = screen("home", { standalone: true });
  const card = h.slice(h.indexOf('class="lpcard"'), h.indexOf('class="lpcard"') + 400);
  assert.match(card, /target="_blank"/, "PWAでも同じタブで開こうとしている");
});

test("入口を足しても、ホームの金額は変わらない（計算に触っていない）", () => {
  const c = Core.computeMonth(STATE.settings, STATE.tx, YM);
  const h = screen("home");
  const yen = "¥" + Math.round(c.available).toLocaleString("en-US");
  assert.ok(h.includes(yen), "ホームの「つかえるお金」が変わっている");
});

/* ---------- 2. アプリ情報（About） ---------- */

test("せっていに、アプリ情報のカードが出る", () => {
  const h = screen("settings");
  assert.match(h, /class="about"/, "アプリ情報のカードが無い");
  assert.match(h, /家計簿アプリ/);
  assert.match(h, /© 2026 Kunihiko Hioki/);
  assert.match(h, /Developed by Kunihiko Hioki/);
});

test("版数は core.js の定数から出ている", () => {
  const h = screen("settings");
  assert.match(h, new RegExp("Version " + Core.APP_VERSION.replace(/\./g, "\\.")));
});

test("版数を画面側にベタ書きしていない（変更は core.js の1か所だけ）", () => {
  const v = Core.APP_VERSION;
  assert.equal(html.includes("Version " + v), false, "index.html に版数が直接書かれている");
  assert.match(html, /Version \$\{escapeHtml\(Core\.APP_VERSION\)\}/, "定数を読んでいない");
});

test("版数は x.y.z の形をしている", () => {
  assert.match(Core.APP_VERSION, /^\d+\.\d+\.\d+$/);
});

test("メールアドレスはタップでメールアプリが開く（mailtoリンク）", () => {
  const h = screen("settings");
  assert.match(h, /href="mailto:pdr\.gifu@gmail\.com"/, "mailto リンクになっていない");
});

test("サイトのアドレスも載っていて、ジャンプ先と同じドメインになっている", () => {
  const h = screen("settings");
  assert.match(h, /🌐 pitbully-works\.jp/, "サイトのアドレスが出ていない");
  assert.match(h, /href="https:\/\/pitbully-works\.jp\/\?country=JP"[^>]*>🌐/, "表示と行き先が食い違っている");
  assert.equal(h.includes("vercel.app"), false, "古いアドレスが残っている");
});

test("アプリ情報はせっていだけに出す（ホームには出さない）", () => {
  assert.equal(screen("home").includes('class="about"'), false);
});

test("せっていの保存欄・データの書き出しは、そのまま残っている", () => {
  const h = screen("settings");
  /* 先取り貯金・NISA積立の欄は廃止した（銀行貯金・NISAの内訳が唯一の入力口）。
     消したままであることを、ここで固定する。 */
  assert.equal(h.includes('id="f-save"'), false, "廃止した先取り貯金の欄が残っている");
  assert.equal(h.includes('id="f-nisa"'), false, "廃止したNISA積立の欄が残っている");
  assert.ok(h.includes('data-act="lp-open"'), "ライフプラン欄の内訳ボタンが消えている");
  assert.ok(h.includes('data-act="save-settings"'), "保存ボタンが消えている");
  /* 月次の書き出しは廃止した。資産を渡す「ライフプランへ渡す」だけを残す。 */
  assert.equal(h.includes('data-act="export-snapshot"'), false, "廃止した月次の書き出しが残っている");
  assert.ok(h.includes('data-act="lp-export"'), "ライフプランへ渡すボタンが消えている");
});
