'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('./core.js');

test('予定IDは64文字以内に正規化される', () => {
  const longId = 'x'.repeat(200);
  const out = Core.normalizePlans({
    '2026-08-23': [{ id: longId, time: '12:30', text: '予定A', done: false }]
  });
  assert.equal(out['2026-08-23'].length, 1);
  assert.equal(out['2026-08-23'][0].id.length, 64);
  assert.equal(out['2026-08-23'][0].id, 'x'.repeat(64));
});

test('同じ日の重複予定IDは別IDへ振り直される', () => {
  const out = Core.normalizePlans({
    '2026-08-23': [
      { id: 'same-id', time: '09:00', text: '予定A', done: false },
      { id: 'same-id', time: '10:00', text: '予定B', done: false }
    ]
  });
  const rows = out['2026-08-23'];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'same-id');
  assert.notEqual(rows[1].id, 'same-id');
  assert.notEqual(rows[0].id, rows[1].id);
});
