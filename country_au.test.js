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

test('AU is selectable and uses AUD/en-AU',()=>{
  assert.equal(Core.isSupportedCountry('AU'), true);
  assert.equal(Core.pickCountry('AU'),'AU');
  const s=Core.normalizeSettings({country:'AU'});
  assert.equal(s.currency,'AUD');
  assert.equal(Core.countryLocale(s),'en-AU');
});

test('AU money uses Australian dollars with two decimals',()=>{
  assert.equal(Core.formatMoney(1234.56,{country:'AU'}),'A$1,234.56');
  assert.equal(Core.formatMoney(0,{country:'AU'}),'A$0.00');
});

test('AU dates use day/month order',()=>{
  assert.equal(Core.formatMonthDay('2026-08-10',{country:'AU'}),'10/8');
  assert.equal(Core.formatDateHeading('2026-08-10',{country:'AU'}),'10 August');
  assert.equal(Core.formatDate('2026-08-10',{country:'AU'}),'10/8/2026');
  assert.equal(Core.formatYearMonth('2026-08',{country:'AU'}),'August 2026');
  assert.equal(Core.cycleLabel('2026-07',20,{country:'AU'}),'20/7〜19/8');
});

test('AU records are separate from JP US GB and CA',()=>{
  const tx=[
    {id:'j',type:'expense',amount:100,cat:'food',date:'2026-08-02'},
    {id:'u',type:'expense',amount:200,cat:'food',date:'2026-08-02',country:'US'},
    {id:'g',type:'expense',amount:300,cat:'food',date:'2026-08-02',country:'GB'},
    {id:'c',type:'expense',amount:400,cat:'food',date:'2026-08-02',country:'CA'},
    {id:'a',type:'expense',amount:500,cat:'food',date:'2026-08-02',country:'AU'},
  ];
  assert.equal(Core.computeMonth({country:'JP'},tx,YM).spendTotal,100);
  assert.equal(Core.computeMonth({country:'US'},tx,YM).spendTotal,200);
  assert.equal(Core.computeMonth({country:'GB'},tx,YM).spendTotal,300);
  assert.equal(Core.computeMonth({country:'CA'},tx,YM).spendTotal,400);
  assert.equal(Core.computeMonth({country:'AU'},tx,YM).spendTotal,500);
});

test('AU profile is independent and starts empty',()=>{
  const profiles=Core.normalizeMoneyProfiles({JP:{country:'JP',nisaMonthly:110500},US:{country:'US',nisaMonthly:369},GB:{country:'GB',nisaMonthly:99},CA:{country:'CA',nisaMonthly:425}},null);
  const au=Core.settingsForCountry(profiles,'AU','1968-11-13');
  assert.equal(au.country,'AU');
  assert.equal(au.currency,'AUD');
  assert.equal(au.nisaMonthly,0);
  assert.equal(au.birth,'1968-11-13');
});

test('settings shows Australia AUD',()=>{
  const h=plain(screen({country:'AU'},[],'settings'));
  assert.match(h,/Country & currency/);
  assert.match(h,/Australia · AUD/);
  assert.equal(/[ぁ-んァ-ン一-龯]/.test(h),false);
});

test('AU home is English and does not count other-country records',()=>{
  const tx=[
    {id:'j',type:'income',amount:9999,cat:'salary',date:'2026-08-02'},
    {id:'u',type:'income',amount:8888,cat:'salary',date:'2026-08-02',country:'US'},
    {id:'g',type:'income',amount:7777,cat:'salary',date:'2026-08-02',country:'GB'},
    {id:'c',type:'income',amount:6666,cat:'salary',date:'2026-08-02',country:'CA'},
    {id:'a',type:'income',amount:1200,cat:'salary',date:'2026-08-02',country:'AU'},
  ];
  const h=plain(screen({country:'AU',cycleStart:1},tx,'home'));
  assert.match(h,/Hello/);
  assert.match(h,/A\$1,200.00/);
  assert.equal(h.includes('A$9,999.00'),false);
  assert.equal(h.includes('$8,888.00'),false);
  assert.equal(h.includes('£7,777.00'),false);
  assert.equal(h.includes('CA$6,666.00'),false);
});

test('life plan snapshot uses AU and AUD',()=>{
  const tx=[{id:'a',type:'income',amount:1200,cat:'salary',date:'2026-08-02',country:'AU'}];
  const snap=Core.buildSnapshot({country:'AU'},tx,YM);
  assert.equal(snap.country_code,'AU');
  assert.equal(snap.base_currency,'AUD');
  assert.equal(snap.locale,'en-AU');
});

test('AU settings survive AU to JP to AU profile round-trip',()=>{
  const profiles=Core.normalizeMoneyProfiles({
    JP:{country:'JP',nisaMonthly:110500},
    AU:{country:'AU',nisaMonthly:510,goalTarget:9000}
  },null);
  const jp=Core.settingsForCountry(profiles,'JP','1968-11-13');
  const au=Core.settingsForCountry(profiles,'AU','1968-11-13');
  assert.equal(jp.nisaMonthly,110500);
  assert.equal(au.nisaMonthly,510);
  assert.equal(au.goalTarget,9000);
  assert.equal(au.currency,'AUD');
});

test('backup keeps AU money profile',()=>{
  const state={
    settings:{country:'AU',birth:'1968-11-13',nisaMonthly:510},
    moneyProfiles:{JP:{country:'JP',nisaMonthly:110500},AU:{country:'AU',nisaMonthly:510}},
    tx:[]
  };
  const b=Core.buildBackup(state);
  assert.equal(b.moneyProfiles.JP.nisaMonthly,110500);
  assert.equal(b.moneyProfiles.AU.nisaMonthly,510);
  assert.equal(b.moneyProfiles.AU.currency,'AUD');
});
