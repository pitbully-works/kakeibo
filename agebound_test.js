/* =========================================================================
   年齢の境目（誕生日ちょうど）と、そこから決まる毎月の金額
   -------------------------------------------------------------------------
   決めごと：終了年齢は「ちょうどは有効」。終了年齢60なら age <= 60 が有効で、
   60を超えた時点で終わる。この決めごと自体は変えない。

   直したのは、その境目を年齢の出し方の誤差でまたいでしまう問題。
   経過日数を365.2425で割ると、誕生日ちょうどでも 60.001... になり得た。
   暦で数えることで、誕生日の当日はちょうど整数になる。

   ここでは ageFromBirth() を直に見るだけでなく、
   生年月日 → 年齢 → 払う期間の判定 → 実際の月額 まで通して確かめる。
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const Core = require(path.join(__dirname, "core.js"));

const BIRTH = "1966-09-15";

/* 家計の区切りの初日で年齢を見る、という既存の考え方をそのまま使う。
   日割りはしない。 */
const ageAt = (birth, onDate) => Core.ageFromBirth(birth, onDate);
const monthlyAt = (lp, birth, onDate, kind) =>
  Core.lpMonthlyOf({ birth: birth, lp: lp }, kind, ageAt(birth, onDate));

/* ------------------------------------------------------------ 基本の境目 */

test("誕生日の前日は、満年齢より小さい", () => {
  const a = ageAt(BIRTH, "2026-09-14");
  assert.ok(a < 60, `60未満になっていない: ${a}`);
  assert.ok(a > 59.99, `1年近くずれている: ${a}`);
});

test("誕生日の当日は、ちょうど整数になる", () => {
  assert.strictEqual(ageAt(BIRTH, "2026-09-15"), 60);
});

test("誕生日の翌日は、満年齢より大きい", () => {
  const a = ageAt(BIRTH, "2026-09-16");
  assert.ok(a > 60, `60より大きくなっていない: ${a}`);
  assert.ok(a < 60.01, `進みすぎている: ${a}`);
});

test("誕生日の当日は、何歳のときでもちょうど整数になる", () => {
  for (let n = 1; n <= 80; n++) {
    const y = 1966 + n;
    assert.strictEqual(ageAt(BIRTH, `${y}-09-15`), n, `${y}年でずれた`);
  }
});

test("生まれた日そのものは0歳ちょうど。未来の生年月日は決められない", () => {
  assert.strictEqual(ageAt(BIRTH, BIRTH), 0);
  assert.strictEqual(Core.ageFromBirth("2030-01-01", "2026-08-08"), null);
});

test("年の途中は小数で返る（57.5歳のような区間の指定に使うため）", () => {
  const a = ageAt(BIRTH, "2026-03-15");
  assert.ok(a > 59.4 && a < 59.6, `年の途中が小数になっていない: ${a}`);
  assert.ok(!Number.isInteger(a), "整数の満年齢だけになっている");
});

/* -------------------------------------------------------------- うるう年 */

test("2月29日生まれ：うるう年でない年は2月28日を応当日として1つ年をとる", () => {
  assert.strictEqual(ageAt("1968-02-29", "2026-02-28"), 58, "2月28日でちょうど整数にならない");
  const before = ageAt("1968-02-29", "2026-02-27");
  assert.ok(before < 58 && before > 57.99, `前日がずれている: ${before}`);
  const after = ageAt("1968-02-29", "2026-03-01");
  assert.ok(after > 58 && after < 58.01, `翌日がずれている: ${after}`);
});

test("2月29日生まれ：うるう年は2月29日がちょうど整数", () => {
  assert.strictEqual(ageAt("1968-02-29", "2028-02-29"), 60);
  assert.ok(ageAt("1968-02-29", "2028-02-28") < 60);
});

test("2月29日生まれ：どの日でも NaN や1年近い誤差にならない", () => {
  ["2025-02-28", "2025-03-01", "2026-02-28", "2027-12-31", "2028-02-29", "2028-03-01"]
    .forEach((d) => {
      const a = ageAt("1968-02-29", d);
      assert.ok(Number.isFinite(a), `NaNになった: ${d}`);
      const rough = (Date.parse(d) - Date.parse("1968-02-29")) / (365.2425 * 864e5);
      assert.ok(Math.abs(a - rough) < 0.02, `おおよその年齢と1年近くずれた: ${d} ${a}`);
    });
});

test("年末生まれ：年をまたいでも、誕生日の当日と翌日を取り違えない", () => {
  /* 12月31日生まれは、暦の年と満年齢の年がずれる。
     満何年かを数え直さないと、年が変わった1月1日を
     「誕生日ちょうど」と取り違えてしまう。 */
  assert.strictEqual(ageAt("1966-12-31", "1999-12-31"), 33, "誕生日の当日が整数になっていない");
  const nextDay = ageAt("1966-12-31", "2000-01-01");
  assert.ok(nextDay > 33, `誕生日の翌日が33より大きくない: ${nextDay}`);
  assert.ok(nextDay < 33.01, `進みすぎている: ${nextDay}`);
  assert.ok(ageAt("1966-12-31", "1999-12-30") < 33, "誕生日の前日が33未満になっていない");
});

test("年末生まれ：終了年齢の判定も1日ずれない", () => {
  const lp = { privatePensionPlans: [
    { name: "共済", monthlyContribution: 15000, contribFromAge: 33, contribToAge: 33 },
  ] };
  const s = { birth: "1966-12-31", lp: lp };
  assert.strictEqual(Core.lpMonthlyOf(s, "pension", ageAt("1966-12-31", "1999-12-31")), 15000);
  assert.strictEqual(Core.lpMonthlyOf(s, "pension", ageAt("1966-12-31", "2000-01-01")), 0,
    "年が変わった翌日も払い続けている");
});

test("月末生まれ：短い月でも末日を応当日にする", () => {
  assert.strictEqual(ageAt("1966-03-31", "2026-03-31"), 60);
  assert.strictEqual(ageAt("1966-08-31", "2026-08-31"), 60);
});

/* -------------------------------- 実際の月額まで通す（終了年齢ちょうどは有効） */

test("民間年金：終了年齢60の掛金は、60歳の誕生日まで払い、翌日で止まる", () => {
  const lp = { privatePensionPlans: [
    { name: "共済", monthlyContribution: 15000, contribFromAge: 40, contribToAge: 60 },
  ] };
  assert.strictEqual(monthlyAt(lp, BIRTH, "2026-09-14", "pension"), 15000, "前日で止まっている");
  assert.strictEqual(monthlyAt(lp, BIRTH, "2026-09-15", "pension"), 15000, "誕生日ちょうどが無効になっている");
  assert.strictEqual(monthlyAt(lp, BIRTH, "2026-09-16", "pension"), 0, "翌日も払い続けている");
});

test("iDeCo：終了年齢65の掛金も、誕生日ちょうどは有効", () => {
  const lp = { ideco: { monthlyContribution: 23000, startAge: 50, endAge: 65 } };
  assert.strictEqual(monthlyAt(lp, BIRTH, "2031-09-15", "ideco"), 23000);
  assert.strictEqual(monthlyAt(lp, BIRTH, "2031-09-16", "ideco"), 0);
  /* 開始年齢の側も、その誕生日から始まる */
  assert.strictEqual(monthlyAt(lp, BIRTH, "2016-09-14", "ideco"), 0);
  assert.strictEqual(monthlyAt(lp, BIRTH, "2016-09-15", "ideco"), 23000);
});

test("生命保険：払い終わり年齢65の保険料も、誕生日ちょうどは有効", () => {
  const lp = { insurancePolicies: [
    { name: "○○生命", monthlyPremium: 8000, premiumFromAge: 46, premiumToAge: 65, coverageUntilAge: 82 },
  ] };
  assert.strictEqual(monthlyAt(lp, BIRTH, "2031-09-15", "insurance"), 8000);
  assert.strictEqual(monthlyAt(lp, BIRTH, "2031-09-16", "insurance"), 0);
});

test("NISA：区間の終わりの年齢ちょうどまで積み立てる", () => {
  const s = Core.normalizeSettings({
    birth: BIRTH,
    lp: { tsumitateSchedule: [
      { fromAge: 57, toAge: 60, funds: [{ name: "全世界株式", amount: 90000 }] },
    ] },
  });
  assert.strictEqual(Core.nisaPlannedOn(s, "2026-09-14"), 90000);
  assert.strictEqual(Core.nisaPlannedOn(s, "2026-09-15"), 90000, "誕生日ちょうどで止まっている");
  assert.strictEqual(Core.nisaPlannedOn(s, "2026-09-16"), 0);
});

test("NISA：区間の始まりの年齢ちょうどから積み立てる", () => {
  const s = Core.normalizeSettings({
    birth: BIRTH,
    lp: { tsumitateSchedule: [
      { fromAge: 60, toAge: 65, funds: [{ name: "全世界株式", amount: 90000 }] },
    ] },
  });
  assert.strictEqual(Core.nisaPlannedOn(s, "2026-09-14"), 0);
  assert.strictEqual(Core.nisaPlannedOn(s, "2026-09-15"), 90000, "誕生日ちょうどから始まっていない");
});

test("NISA：年の途中で区切る区間（57.5歳＝57歳6ヶ月）も動く", () => {
  const s = Core.normalizeSettings({
    birth: BIRTH,
    lp: { tsumitateSchedule: [
      { fromAge: 57.5, toAge: 65, funds: [{ name: "全世界株式", amount: 90000 }] },
    ] },
  });
  assert.strictEqual(Core.nisaPlannedOn(s, "2024-02-15"), 0, "57歳5ヶ月で始まっている");
  assert.strictEqual(Core.nisaPlannedOn(s, "2024-04-15"), 90000, "57歳7ヶ月で始まっていない");
});

/* ---------------------------------------------------- 家計の締め日との境目 */

/* 区切りの初日で年齢を見る（日割りはしない）。締め日が変わっても同じ考え方。 */
const cycleAge = (birth, ym, cycleStart) =>
  Core.ageFromBirth(birth, Core.cycleRange(ym, cycleStart).from);

test("締め日1日：区切りの初日で見る。月の途中の誕生日は翌月ぶんから効く", () => {
  const lp = { privatePensionPlans: [
    { name: "共済", monthlyContribution: 15000, contribFromAge: 40, contribToAge: 60 },
  ] };
  const s = { birth: BIRTH, lp: lp };
  /* 9/1 時点はまだ59歳 → その月は通常どおり計上する（日割りしない） */
  assert.ok(cycleAge(BIRTH, "2026-09", 1) < 60);
  assert.strictEqual(Core.lpMonthlyOf(s, "pension", cycleAge(BIRTH, "2026-09", 1)), 15000);
  /* 10/1 時点は60歳を超えている → 止まる */
  assert.ok(cycleAge(BIRTH, "2026-10", 1) > 60);
  assert.strictEqual(Core.lpMonthlyOf(s, "pension", cycleAge(BIRTH, "2026-10", 1)), 0);
});

test("締め日15日：区切りの初日が誕生日と同じ日になる場合", () => {
  const from = Core.cycleRange("2026-09", 15).from;
  assert.strictEqual(from, "2026-09-15", "区切りの初日が誕生日と同じ日にならない");
  assert.strictEqual(cycleAge(BIRTH, "2026-09", 15), 60, "その日ちょうどが整数になっていない");
  const lp = { privatePensionPlans: [
    { name: "共済", monthlyContribution: 15000, contribFromAge: 40, contribToAge: 60 },
  ] };
  assert.strictEqual(Core.lpMonthlyOf({ birth: BIRTH, lp: lp }, "pension", cycleAge(BIRTH, "2026-09", 15)),
    15000, "誕生日と締め日が同じ日で、掛金が止まってしまった");
});

test("締め日が月末付近（28日）でも、境目の考え方は変わらない", () => {
  const lp = { ideco: { monthlyContribution: 23000, startAge: 50, endAge: 60 } };
  const s = { birth: BIRTH, lp: lp };
  assert.strictEqual(Core.lpMonthlyOf(s, "ideco", cycleAge(BIRTH, "2026-08", 28)), 23000,
    "8/28（まだ59歳）で止まっている");
  assert.strictEqual(Core.lpMonthlyOf(s, "ideco", cycleAge(BIRTH, "2026-09", 28)), 0,
    "9/28（60歳を超えた）で払い続けている");
});

test("締め日20日：誕生日をまたぐ月も、区切りの初日で見た年齢で決まる", () => {
  /* 9月分の区切りは 9/20 から。誕生日（9/15）はもう過ぎている。 */
  assert.strictEqual(Core.cycleRange("2026-09", 20).from, "2026-09-20");
  const a = cycleAge(BIRTH, "2026-09", 20);
  assert.ok(a > 60 && a < 60.02, `区切りの初日の年齢がずれている: ${a}`);
  const lp = { privatePensionPlans: [
    { name: "共済", monthlyContribution: 15000, contribFromAge: 40, contribToAge: 60 },
  ] };
  const s = { birth: BIRTH, lp: lp };
  assert.strictEqual(Core.lpMonthlyOf(s, "pension", a), 0, "60歳を過ぎた区切りで払い続けている");
  /* ひとつ前の区切り（8/20〜）はまだ59歳なので、その月は通常どおり計上する */
  assert.strictEqual(Core.lpMonthlyOf(s, "pension", cycleAge(BIRTH, "2026-08", 20)), 15000);
});

test("ひと月ぶんを日割りしない（誕生日が月の途中でも月額はそのまま）", () => {
  const lp = { banks: [{ name: "A銀行", monthlyDeposit: 10000 }] };
  const s = { birth: BIRTH, lp: lp };
  ["2026-08", "2026-09", "2026-10"].forEach((ym) => {
    assert.strictEqual(Core.lpMonthlyOf(s, "banks", cycleAge(BIRTH, ym, 1)), 10000, ym);
  });
});

/* --------------------------------------------- 近似で数えていないことの確認 */

test("経過日数÷365.2425 の近似では、誕生日ちょうどが整数にならない", () => {
  const rough = (Date.parse("2026-09-15") - Date.parse("1966-09-15")) / (365.2425 * 864e5);
  assert.ok(rough > 60, `前提の確認：近似だと60を超えるはず: ${rough}`);
  assert.strictEqual(ageAt(BIRTH, "2026-09-15"), 60, "近似のままになっている");
});

/* ------------------------------------------- 「その年齢になる日」（開始日） */

/* 判定に使う年齢と、画面に出す開始日は、同じ暦の数え方でそろえる。
   ここだけ経過日数の近似で出していたため、1日前の日付が出ていた。 */

test("開始日は、その年齢の誕生日ちょうど", () => {
  assert.strictEqual(Core.dateAtAge(BIRTH, 60), "2026-09-15");
  assert.strictEqual(Core.dateAtAge("1968-11-13", 57), "2025-11-13");
});

test("開始日は、その年齢に達する最初の日（前日はまだ達していない）", () => {
  /* うるう日をまたぐ年（366日）の小数年齢は、近似では1日ずれる。必ず入れる。 */
  [[BIRTH, 60], [BIRTH, 57.5], [BIRTH, 57.75], [BIRTH, 57.25], ["1968-11-13", 57.5],
   ["1968-11-13", 57.75], ["1968-02-29", 58], ["1968-02-29", 59.5], ["1966-12-31", 33.5]]
    .forEach(([b, a]) => {
      const d = Core.dateAtAge(b, a);
      const prev = new Date(Date.parse(d) - 864e5).toISOString().slice(0, 10);
      assert.ok(Core.ageFromBirth(b, d) >= a, `${b} ${a} の開始日がまだ達していない: ${d}`);
      assert.ok(Core.ageFromBirth(b, prev) < a, `${b} ${a} は前日でもう達している: ${prev}`);
    });
});

test("2月29日生まれの開始日も1日ずれない", () => {
  assert.strictEqual(Core.dateAtAge("1968-02-29", 60), "2028-02-29", "うるう年は2月29日");
  assert.strictEqual(Core.dateAtAge("1968-02-29", 58), "2026-02-28", "非うるう年は2月28日");
});

test("うるう日をまたぐ年の小数年齢でも、開始日が1日ずれない", () => {
  /* 1966-09-15 の57歳の年は 2023-09-15〜2024-09-15 で366日ある。
     経過日数を365.2425で割る近似だと、ここで1日手前の日付になる。 */
  assert.strictEqual(Core.dateAtAge(BIRTH, 57.75), "2024-06-16");
  assert.ok(Core.ageFromBirth(BIRTH, "2024-06-15") < 57.75, "前日でもう達している");
});

test("小数の年齢（57歳6ヶ月）でも開始日を出せる", () => {
  const d = Core.dateAtAge("1966-09-15", 57.5);
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/, "日付の形になっていない");
  assert.ok(Core.ageFromBirth("1966-09-15", d) >= 57.5);
});

test("生年月日が無い・おかしな年齢なら空文字（勝手な日付を作らない）", () => {
  assert.strictEqual(Core.dateAtAge("", 60), "");
  assert.strictEqual(Core.dateAtAge(BIRTH, -1), "");
  assert.strictEqual(Core.dateAtAge(BIRTH, NaN), "");
});

test("開始日は、年齢の判定と食い違わない（近似で1日ずれない）", () => {
  const s = Core.normalizeSettings({
    birth: BIRTH,
    lp: { tsumitateSchedule: [
      { fromAge: 60, toAge: 65, funds: [{ name: "全世界株式", amount: 90000 }] },
    ] },
  });
  const up = Core.nisaUpcoming(s, "2026-01-01");
  assert.strictEqual(up.fromAge, 60);
  assert.strictEqual(up.monthly, 90000);
  assert.strictEqual(up.startDate, "2026-09-15", "開始日が1日ずれている");
  /* 画面に出した開始日の前日は0円、その日から積み立てが始まる */
  assert.strictEqual(Core.nisaPlannedOn(s, "2026-09-14"), 0);
  assert.strictEqual(Core.nisaPlannedOn(s, up.startDate), 90000, "出した開始日にまだ始まっていない");
});

test("小数の区間でも、出した開始日から積立が始まる", () => {
  const s = Core.normalizeSettings({
    birth: "1968-11-13",
    lp: { tsumitateSchedule: [
      { fromAge: 57.5, toAge: 65, funds: [{ name: "全世界株式", amount: 90000 }] },
    ] },
  });
  const up = Core.nisaUpcoming(s, "2025-12-01");
  assert.strictEqual(Core.nisaPlannedOn(s, up.startDate), 90000, "出した開始日にまだ始まっていない");
  const prev = new Date(Date.parse(up.startDate) - 864e5).toISOString().slice(0, 10);
  assert.strictEqual(Core.nisaPlannedOn(s, prev), 0, "開始日より前から始まっている");
});
