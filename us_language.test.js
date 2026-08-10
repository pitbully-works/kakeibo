/* =========================================================================
   かけいぼ ― USを選んだとき、画面に日本語が残っていないかの見張り
   -------------------------------------------------------------------------
   守りたいこと：
     USを選んだ人には、日本語がひとつも見えないこと。
     画面を足したり文言を直したりしたときに、訳し忘れがそのまま出ていく——
     という事故を防ぐための砦。

   やり方：
     使えるすべての画面・状態を US で実際に描いて、
     出てきた文字の中にひらがな・カタカナ・漢字が無いことを確かめる。
     どこに残っているかが分かるよう、見つけた語をそのまま知らせる。

   ここで見ないもの：
     ・利用者が自分で打った文字（メモ・日記・目標名・銀行名など）
       日本語で打てば日本語のまま出るのが正しい。
     ・絵文字や記号（日本語の文字ではない）
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, appSrc } = require("./boot-app.cjs");

/* ひらがな・カタカナ・漢字（CJK統合漢字と拡張A）。
   全角の「（）」などの約物は、日本語の文字そのものではないので見ない。 */
const JA = /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/;

const TODAY = new Date().toISOString().slice(0, 10);
const YM = TODAY.slice(0, 7);
const D = (n) => `${YM}-${String(n).padStart(2, "0")}`;

/* 中身のある状態にしておく。空の画面だけ見ても訳し忘れは見つからない。 */
const PULSE = {
  id: "p1", bpm: 66, stars: 4, date: D(1), time: "09:00", cond: "rest",
  kept: 9, wins: 9, fps: 30, cam: "640x480", torch: true, device: "iPhone",
};
function usState() {
  return {
    settings: { country: "US", birth: "1968-11-13", goalTarget: 5000, goalCurrent: 1200,
      lp: {
        gold: { currentGrams: 10, pricePerGram: 60, monthlyYen: 50 },
        banks: [{ name: "Main", balance: 8000, monthlyDeposit: 200 }],
        loans: [{ name: "Car", principal: 9000, monthlyPayment: 300 }],
        insurancePolicies: [{ name: "Term life", monthlyPremium: 40 }],
        privatePensionPlans: [{ name: "Annuity", monthlyContribution: 100 }],
        ideco: { productName: "Index", monthlyContribution: 200 },
        tsumitateSchedule: [{ fromAge: 40, toAge: 65, funds: [{ name: "World", amount: 300 }] }],
        lumpSums: [{ age: 60, amount: 10000 }],
      } },
    tx: [
      { id: "i1", type: "income", amount: 4200, cat: "salary", date: D(25), country: "US" },
      { id: "e1", type: "expense", amount: 1200, cat: "rent", date: D(1), recurring: true, country: "US" },
      { id: "e2", type: "expense", amount: 85, cat: "food", date: D(3), country: "US" },
    ],
    pulse: [PULSE],
    diary: { [D(2)]: { text: "A quiet day", photo: null } },
    plans: { [TODAY]: [{ id: "pl1", time: "14:00", text: "Dentist", done: false }] },
    health: { [D(1)]: { weight: 70, bpHigh: 120, bpLow: 78, pulse: 65 } },
  };
}

/* 見つけた日本語を、そのまま知らせる（どこを直せばよいか分かるように） */
function japaneseIn(html) {
  const text = String(html || "").replace(/<[^>]+>/g, " ");
  return [...new Set(text.split(/\s+/).filter((w) => JA.test(w)))];
}
function assertEnglish(label, html) {
  const found = japaneseIn(html);
  assert.equal(found.length, 0, `${label} に日本語が残っています: ${found.join(" / ")}`);
}

test("USでは、どの画面にも日本語が残らない", () => {
  const app = bootApp({ state: usState() });
  for (const v of ["home", "summary", "calendar", "diary", "health", "calc", "pulse", "settings"]) {
    app.run(`view=${JSON.stringify(v)}; render();`);
    assertEnglish(v, app.el("app").innerHTML);
  }
});

test("USでは、分析タブにも日本語が残らない", () => {
  const app = bootApp({ state: usState() });
  app.run(`view="summary"; sumTab="analysis"; render();`);
  assertEnglish("分析タブ", app.el("app").innerHTML);
});

test("USでは、ライフプラン入力の全画面に日本語が残らない", () => {
  const app = bootApp({ state: usState() });
  for (const k of ["nisa", "ideco", "gold", "banks", "loans", "insurance", "pension"]) {
    app.run(`view="lp"; lpKind=${JSON.stringify(k)}; render();`);
    assertEnglish("ライフプラン:" + k, app.el("app").innerHTML);
  }
});

test("USでは、記録シートに日本語が残らない（支出・収入とも）", () => {
  const app = bootApp({ state: usState() });
  app.run(`openRecord(null);`);
  assertEnglish("記録シート（支出）", app.el("sheet").innerHTML);
  app.run(`sheetState.type="income"; sheetState.cat="salary"; renderSheet();`);
  assertEnglish("記録シート（収入）", app.el("sheet").innerHTML);
});

test("USでは、心拍の測定・詳細・編集にも日本語が残らない", () => {
  const app = bootApp({ state: usState() });
  app.run(`view="pulse"; pulseStage="measure"; render();`);
  assertEnglish("心拍（測定中）", app.el("app").innerHTML);
  app.run(`pulseStage=null; pulseOpenId="p1"; render();`);
  assertEnglish("心拍（詳細）", app.el("app").innerHTML);
  app.run(`pulseEditId="p1"; render();`);
  assertEnglish("心拍（編集）", app.el("app").innerHTML);
});

test("USでは、下のタブとページの言語も英語になる", () => {
  const app = bootApp({ state: usState() });
  app.run(`view="home"; render();`);
  assertEnglish("下のタブ", app.nav().map((b) => b.innerHTML).join(" "));
  assert.equal(app.htmlLang(), "en");
});

/* ---------------------------------------------------------------------
   知らせ（toast・confirm）は、押したときにしか出ないので画面を見ても分からない。
   そこで「日本語をそのまま渡していないか」をソースの形で見張る。
   L("日本語","English") でくるんであれば、ここは通る。
   --------------------------------------------------------------------- */
test("知らせの文言に、日本語をそのまま渡している所が無い", () => {
  const src = String(appSrc)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ");
  const bad = [];
  src.split("\n").forEach((line, i) => {
    /* toast( や confirm( の直後に、いきなり日本語の文字列が来ていないか */
    const m = line.match(/\b(toast|confirm|alert)\(\s*(["'`])([^"'`]*)/);
    if (m && JA.test(m[3])) bad.push(`${i + 1}行目: ${line.trim().slice(0, 70)}`);
  });
  assert.deepEqual(bad, [], "日本語をそのまま渡しています:\n" + bad.join("\n"));
});

/* ---------------------------------------------------------------------
   JP側が変わっていないことも、同じ強さで見張る。
   英語化のついでに日本語まで書き換えてしまう、が一番こわい壊し方。
   --------------------------------------------------------------------- */
test("JPでは、これまでどおり日本語で出る", () => {
  const jp = usState();
  jp.settings.country = "JP";
  const app = bootApp({ state: jp });
  for (const v of ["home", "summary", "calendar", "diary", "health", "calc", "pulse", "settings"]) {
    app.run(`view=${JSON.stringify(v)}; render();`);
    const found = japaneseIn(app.el("app").innerHTML);
    assert.ok(found.length > 0, `${v} が日本語で出ていません`);
  }
  app.run(`view="home"; render();`);
  assert.match(app.nav().map((b) => b.innerHTML).join(" "), /ホーム/);
  assert.equal(app.htmlLang(), "ja");
});
