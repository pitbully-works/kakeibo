const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const src = fs.readFileSync("index.html", "utf8");

test("ライフプランから渡されたcountryを5カ国だけ受け入れる", () => {
  assert.match(src, /country=\(\[\^&\]\*\)/);
  assert.match(src, /Core\.isSupportedCountry\(raw\)/);
});

test("起動国を切り替えるとき既存の国別金額を混ぜない", () => {
  assert.match(src, /state\.moneyProfiles\[current\] = Core\.normalizeSettings/);
  assert.match(src, /state\.settings = Core\.settingsForCountry\(state\.moneyProfiles, next, birth\)/);
  assert.match(src, /state\.moneyProfiles\[next\] = Core\.normalizeSettings\(state\.settings\)/);
});
