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

test('CA is selectable and uses CAD/en-CA',()=>{
  assert.equal(Core.isSupportedCountry('CA'), true);
  assert.equal(Core.pickCountry('CA'),'CA');
  const s=Core.normalizeSettings({country:'CA'});
  assert.equal(s.currency,'CAD');
  assert.equal(Core.countryLocale(s),'en-CA');
});

test('CA money uses Canadian dollars with two decimals',()=>{
  assert.equal(Core.formatMoney(1234.56,{country:'CA'}),'CA$1,234.56');
  assert.equal(Core.formatMoney(0,{country:'CA'}),'CA$0.00');
});

test('CA dates use en-CA style',()=>{
  assert.equal(Core.formatMonthDay('2026-08-10',{country:'CA'}),'08-10');
  assert.equal(Core.formatDateHeading('2026-08-10',{country:'CA'}),'August 10');
  assert.equal(Core.formatDate('2026-08-10',{country:'CA'}),'2026-08-10');
  assert.equal(Core.formatYearMonth('2026-08',{country:'CA'}),'August 2026');
  assert.equal(Core.cycleLabel('2026-07',20,{country:'CA'}),'07-20〜08-19');
});

test('CA records are separate from JP US and GB',()=>{
  const tx=[
    {id:'j',type:'expense',amount:100,cat:'food',date:'2026-08-02'},
    {id:'u',type:'expense',amount:200,cat:'food',date:'2026-08-02',country:'US'},
    {id:'g',type:'expense',amount:300,cat:'food',date:'2026-08-02',country:'GB'},
    {id:'c',type:'expense',amount:400,cat:'food',date:'2026-08-02',country:'CA'},
  ];
  assert.equal(Core.computeMonth({country:'JP'},tx,YM).spendTotal,100);
  assert.equal(Core.computeMonth({country:'US'},tx,YM).spendTotal,200);
  assert.equal(Core.computeMonth({country:'GB'},tx,YM).spendTotal,300);
  assert.equal(Core.computeMonth({country:'CA'},tx,YM).spendTotal,400);
});

test('CA profile is independent and starts empty',()=>{
  const profiles=Core.normalizeMoneyProfiles({JP:{country:'JP',nisaMonthly:110500},US:{country:'US',nisaMonthly:369},GB:{country:'GB',nisaMonthly:99}},null);
  const ca=Core.settingsForCountry(profiles,'CA');
  assert.equal(ca.country,'CA');
  assert.equal(ca.currency,'CAD');
  assert.equal(ca.nisaMonthly,0);
  assert.equal(ca.birth,'');
});

test('settings shows Canada CAD',()=>{
  const h=plain(screen({country:'CA'},[],'settings'));
  assert.match(h,/Country & currency/);
  assert.match(h,/Canada · CAD/);
  assert.equal(/[ぁ-んァ-ン一-龯]/.test(h),false);
});

test('CA home is English and does not count other-country records',()=>{
  const tx=[
    {id:'j',type:'income',amount:9999,cat:'salary',date:'2026-08-02'},
    {id:'u',type:'income',amount:8888,cat:'salary',date:'2026-08-02',country:'US'},
    {id:'g',type:'income',amount:7777,cat:'salary',date:'2026-08-02',country:'GB'},
    {id:'c',type:'income',amount:120000,cat:'salary',date:'2026-08-02',country:'CA'},
  ];
  const h=plain(screen({country:'CA',cycleStart:1},tx,'home'));
  assert.match(h,/Hello/);
  assert.match(h,/CA\$1,200.00/);
  assert.equal(h.includes('CA$9,999.00'),false);
  assert.equal(h.includes('$8,888.00'),false);
  assert.equal(h.includes('£7,777.00'),false);
});

test('life plan snapshot uses CA and CAD',()=>{
  const tx=[{id:'c',type:'income',amount:1200,cat:'salary',date:'2026-08-02',country:'CA'}];
  const snap=Core.buildSnapshot({country:'CA'},tx,YM);
  assert.equal(snap.country_code,'CA');
  assert.equal(snap.base_currency,'CAD');
  assert.equal(snap.locale,'en-CA');
});

test('CA settings survive CA to JP to CA profile round-trip',()=>{
  let profiles=Core.normalizeMoneyProfiles({
    JP:{country:'JP',nisaMonthly:110500},
    CA:{country:'CA',nisaMonthly:425,goalTarget:8000}
  },null);
  const jp=Core.settingsForCountry(profiles,'JP');
  const ca=Core.settingsForCountry(profiles,'CA');
  assert.equal(jp.nisaMonthly,110500);
  assert.equal(ca.nisaMonthly,425);
  assert.equal(ca.goalTarget,8000);
  assert.equal(ca.currency,'CAD');
});

test('backup keeps CA money profile',()=>{
  const state={
    settings:{country:'CA',birth:'1968-11-13',nisaMonthly:425},
    moneyProfiles:{JP:{country:'JP',nisaMonthly:110500},CA:{country:'CA',nisaMonthly:425}},
    tx:[]
  };
  const b=Core.buildBackup(state);
  assert.equal(b.moneyProfiles.JP.nisaMonthly,110500);
  assert.equal(b.moneyProfiles.CA.nisaMonthly,425);
  assert.equal(b.moneyProfiles.CA.currency,'CAD');
});
