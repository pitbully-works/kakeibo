const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./boot-app.cjs');

function hashFor(payload){
  return '#lpbridge=' + encodeURIComponent(JSON.stringify(payload));
}

test('ライフプランから開くとNISAだけ更新し日記・予定を保持する', () => {
  const oldState = {
    settings: {
      birth: '1968-11-13', country: 'JP', currency: 'JPY',
      lp: {
        tsumitateSchedule: [{ fromAge: 57, toAge: 65, monthlyYen: 40000 }],
        growthSchedule: [{ fromAge: 57, toAge: 65, monthlyYen: 5000 }]
      }
    },
    diary: { '2026-08-09': { text: '残す日記' } },
    plans: { '2026-08-12': [{ id:'p1', time:'09:00', text:'残す予定', done:false }] },
    health: { '2026-08-09': { weight:63.5 } },
    tx: []
  };
  const payload = {
    source:'lifeplan', schemaVersion:1, birth:'1968-11-13', country:'JP', currency:'JPY',
    nisa:{
      tsumitateSchedule:[{fromAge:57,toAge:65,monthlyYen:80000}],
      growthSchedule:[{fromAge:57,toAge:65,monthlyYen:30000}]
    }
  };
  const app = bootApp({ state: oldState, hash: hashFor(payload) });
  assert.equal(app.run('Core.nisaPlannedOn(state.settings,"2026-08-11")'), 110000);
  assert.equal(app.run('state.diary["2026-08-09"].text'), '残す日記');
  assert.equal(app.run('state.plans["2026-08-12"][0].text'), '残す予定');
  assert.equal(app.run('state.health["2026-08-09"].weight'), 63.5);
  assert.equal(app.run('location.hash'), '', '読み取り後の橋渡し情報がURLに残っている');
});

test('壊れた橋渡し情報では既存データを変更しない', () => {
  const app = bootApp({ state:{ settings:{ birth:'1968-11-13', lp:{ tsumitateSchedule:[{fromAge:0,toAge:120,monthlyYen:45000}] } }, tx:[] }, hash:'#lpbridge=%7Bbad' });
  assert.equal(app.run('Core.nisaPlannedOn(state.settings,"2026-08-11")'), 45000);
});
