const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('./core.js');
const { bootApp } = require('./boot-app.cjs');

const YM = '2026-08';
function plain(html){ return String(html).replace(/<[^>]+>/g,' ').replace(/\s+/g,' '); }
function screen(settings, tx, view){
  const app=bootApp({state:{settings,tx}});
  app.run(`view=${JSON.stringify(view)}; render();`);
  return app.el('app').innerHTML;
}

test('GB is selectable and uses GBP/en-GB',()=>{
  assert.equal(Core.isSupportedCountry('GB'), true);
  assert.equal(Core.pickCountry('GB'),'GB');
  const s=Core.normalizeSettings({country:'GB'});
  assert.equal(s.currency,'GBP');
  assert.equal(Core.countryLocale(s),'en-GB');
});

test('GB money uses pounds with two decimals',()=>{
  assert.equal(Core.formatMoney(1234.56,{country:'GB'}),'£1,234.56');
  assert.equal(Core.formatMoney(0,{country:'GB'}),'£0.00');
});

test('GB dates use day/month order',()=>{
  assert.equal(Core.formatMonthDay('2026-08-10',{country:'GB'}),'10/8');
  assert.equal(Core.formatDateHeading('2026-08-10',{country:'GB'}),'10 August');
  assert.equal(Core.formatDate('2026-08-10',{country:'GB'}),'10/8/2026');
  assert.equal(Core.formatYearMonth('2026-08',{country:'GB'}),'August 2026');
  assert.equal(Core.cycleLabel('2026-07',20,{country:'GB'}),'20/7〜19/8');
});

test('GB records are separate from JP and US',()=>{
  const tx=[
    {id:'j',type:'expense',amount:100,cat:'food',date:'2026-08-02'},
    {id:'u',type:'expense',amount:200,cat:'food',date:'2026-08-02',country:'US'},
    {id:'g',type:'expense',amount:300,cat:'food',date:'2026-08-02',country:'GB'},
  ];
  assert.equal(Core.computeMonth({country:'JP'},tx,YM).spendTotal,100);
  assert.equal(Core.computeMonth({country:'US'},tx,YM).spendTotal,200);
  assert.equal(Core.computeMonth({country:'GB'},tx,YM).spendTotal,300);
});

test('GB profile is independent and starts empty',()=>{
  const profiles=Core.normalizeMoneyProfiles({JP:{country:'JP',nisaMonthly:110500},US:{country:'US',nisaMonthly:369}},null);
  const gb=Core.settingsForCountry(profiles,'GB');
  assert.equal(gb.country,'GB');
  assert.equal(gb.currency,'GBP');
  assert.equal(gb.nisaMonthly,0);
  assert.equal(gb.birth,'');
});

test('settings shows United Kingdom GBP',()=>{
  const h=plain(screen({country:'GB'},[],'settings'));
  assert.match(h,/Country & currency/);
  assert.match(h,/United Kingdom · GBP/);
  assert.equal(/[ぁ-んァ-ン一-龯]/.test(h),false);
});

test('GB home is English and does not count JP or US records',()=>{
  const tx=[
    {id:'j',type:'income',amount:9999,cat:'salary',date:'2026-08-02'},
    {id:'u',type:'income',amount:8888,cat:'salary',date:'2026-08-02',country:'US'},
    {id:'g',type:'income',amount:120000,cat:'salary',date:'2026-08-02',country:'GB'},
  ];
  const h=plain(screen({country:'GB',cycleStart:1},tx,'home'));
  assert.match(h,/Hello/);
  assert.match(h,/£1,200.00/);
  assert.equal(h.includes('£9,999.00'),false);
  assert.equal(h.includes('$8,888.00'),false);
});

test('life plan snapshot uses GB and GBP',()=>{
  const tx=[{id:'g',type:'income',amount:1200,cat:'salary',date:'2026-08-02',country:'GB'}];
  const snap=Core.buildSnapshot({country:'GB'},tx,YM);
  assert.equal(snap.country_code,'GB');
  assert.equal(snap.base_currency,'GBP');
  assert.equal(snap.locale,'en-GB');
});
