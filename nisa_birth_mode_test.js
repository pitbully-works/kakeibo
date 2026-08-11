const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('./core.js');

function nisaSettings(birth=''){
  return Core.normalizeSettings({
    birth,
    nisaMonthly: 45000,
    lp: {
      tsumitateSchedule: [
        { fromAge: 57.7, toAge: 65, funds: [
          { name:'全世界', amount:40000 },
          { name:'S&P500', amount:40000 },
          { name:'たわら8', amount:20000 },
        ]},
      ],
      growthSchedule: [
        { fromAge: 57.7, toAge: 65, funds: [
          { name:'トヨタ', amount:5000 },
          { name:'AI', amount:5000 },
        ]},
      ],
    }
  });
}

test('NISA: 生年月日なしでも各枠の最初の区間の入力額を合算する', () => {
  const s = nisaSettings('');
  assert.equal(Core.nisaAuto(s), false);
  assert.equal(Core.nisaManualMonthly(s), 110000);
  assert.equal(Core.nisaPlannedOn(s, '2026-08-12'), 110000);
});

test('NISA: 生年月日なしで古いnisaMonthlyが残っていても入力内訳を優先する', () => {
  const s = nisaSettings('');
  assert.equal(s.nisaMonthly, 45000);
  assert.equal(Core.nisaPlannedOn(s, '2026-08-12'), 110000);
});

test('NISA: 生年月日なしで複数区間が残っていても各枠の最初の区間だけを現在額にする', () => {
  const s = Core.normalizeSettings({
    birth:'', nisaMonthly:45000,
    lp:{
      tsumitateSchedule:[
        {fromAge:50,toAge:59,funds:[{name:'今',amount:100000}]},
        {fromAge:60,toAge:65,funds:[{name:'将来',amount:200000}]},
      ],
      growthSchedule:[
        {fromAge:50,toAge:59,funds:[{name:'今',amount:10000}]},
        {fromAge:60,toAge:65,funds:[{name:'将来',amount:20000}]},
      ]
    }
  });
  assert.equal(Core.nisaPlannedOn(s, '2026-08-12'), 110000);
});

test('NISA: 生年月日ありでは現在年齢の重複区間をすべて合算する', () => {
  const s = Core.normalizeSettings({
    birth:'1968-11-13',
    lp:{
      tsumitateSchedule:[
        {fromAge:57,toAge:60,funds:[{name:'A',amount:100000}]},
        {fromAge:57.5,toAge:65,funds:[{name:'B',amount:10000}]},
      ]
    }
  });
  assert.equal(Core.nisaAuto(s), true);
  // 2026-08-12 は57歳8か月台。2区間とも有効。
  assert.equal(Core.nisaPlannedOn(s, '2026-08-12'), 110000);
});

test('iDeCo: 生年月日なしでも毎月の掛金は先取りに入る', () => {
  const s = Core.normalizeSettings({
    birth:'',
    lp:{ ideco:{ monthlyContribution:23000, startAge:50, endAge:65 } }
  });
  const rows = Core.lpSetAsideItems(s, null);
  const ideco = rows.find(r => r.key === 'ideco');
  assert.ok(ideco);
  assert.equal(ideco.amount, 23000);
});

test('UI: NISAの2つ目の年齢区間は生年月日なしでは追加できない', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.ok(html.includes('a0[key].length>=1 && !state.settings.birth'));
  assert.ok(html.includes('2つ目以降の年齢区間を使うには、せっていで生年月日を入力してください'));
});
