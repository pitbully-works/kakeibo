const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('./core.js');

test('国コードを正として通貨を必ず固定する', () => {
  assert.equal(Core.normalizeSettings({ country: 'JP', currency: 'USD' }).currency, 'JPY');
  assert.equal(Core.normalizeSettings({ country: 'US', currency: 'JPY' }).currency, 'USD');
  assert.equal(Core.normalizeSettings({ country: 'GB', currency: 'USD' }).currency, 'GBP');
  assert.equal(Core.normalizeSettings({ country: 'CA', currency: 'USD' }).currency, 'CAD');
});

test('CAは選べ、未対応のAUは画面選択ではJPへ安全に戻す', () => {
  assert.deepEqual([...Core.SUPPORTED_COUNTRIES], ['JP', 'US', 'GB', 'CA']);
  assert.equal(Core.pickCountry('CA'), 'CA');
  assert.equal(Core.pickCountry('AU'), 'JP');
  assert.equal(Core.pickCountry('XX'), 'JP');
});
