/* 5カ国対応の土台：既存JPを壊さず、国・通貨・ライフプラン連携を一元管理する。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");

test("旧データ（countryなし）はJPYからJPへ安全に移行する", () => {
  const s = Core.normalizeSettings({ currency: "JPY" });
  assert.equal(s.country, "JP");
  assert.equal(s.currency, "JPY");
});

test("対応5カ国は国と基準通貨が必ず組になる", () => {
  const expected = { JP:"JPY", US:"USD", GB:"GBP", CA:"CAD", AU:"AUD" };
  for (const [country, currency] of Object.entries(expected)) {
    const s = Core.normalizeSettings({ country, currency:"JPY" });
    assert.equal(s.country, country);
    assert.equal(s.currency, currency);
  }
});

test("countryが無い旧データは既知通貨から国を推定できる", () => {
  assert.equal(Core.normalizeSettings({ currency:"USD" }).country, "US");
  assert.equal(Core.normalizeSettings({ currency:"GBP" }).country, "GB");
  assert.equal(Core.normalizeSettings({ currency:"CAD" }).country, "CA");
  assert.equal(Core.normalizeSettings({ currency:"AUD" }).country, "AU");
});

test("不明な国・通貨は安全にJP/JPYへ戻る", () => {
  const s = Core.normalizeSettings({ country:"XX", currency:"ZZZ" });
  assert.equal(s.country, "JP");
  assert.equal(s.currency, "JPY");
});

test("ライフプラン連携はcountry_codeとbase_currencyを設定から出す", () => {
  const snap = Core.buildSnapshot({ country:"US" }, [], "2026-08");
  assert.equal(snap.country_code, "US");
  assert.equal(snap.base_currency, "USD");
});

test("日本の金額表示は従来どおり円表示になる", () => {
  const text = Core.formatMoney(1234, { country:"JP" });
  assert.match(text, /￥|¥/);
  assert.match(text, /1,234/);
});
