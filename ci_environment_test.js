const test = require("node:test");
const assert = require("node:assert/strict");
const { bootApp } = require("./boot-app.cjs");

test("テスト端末は実行サーバーの地域に関係なく初回JPで開く", () => {
  const app = bootApp({});
  assert.equal(app.run("curCountry()"), "JP");
  assert.equal(app.run("decOf(curCountry())"), 0);
});

test("初回国推定は指定した端末地域を使い、保存済みの選択国は変えない", () => {
  assert.equal(bootApp({ timeZone: "America/New_York" }).run("curCountry()"), "US");
  assert.equal(bootApp({ timeZone: "America/New_York", state: { settings: { country: "JP" }, tx: [] } }).run("curCountry()"), "JP");
});

test("日付を指定したテストは年月・日付・現在時刻が同じ基準を使う", () => {
  const now = "2026-08-15T12:00:00Z";
  const app = bootApp({ now });
  assert.equal(app.run("todayISO()"), "2026-08-15");
  assert.equal(app.run("curYM()"), "2026-08");
  assert.equal(app.run("Date.now()"), Date.parse(now));
});
