const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('ライフプランの monthlyYen だけのNISA区間を家計簿の銘柄行へ変換する', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /legacyMonthly/);
  assert.match(html, /ライフプラン連携/);
  assert.match(html, /normalizedFunds/);
  assert.match(html, /monthlyYen:normalizedTotal/);
});
