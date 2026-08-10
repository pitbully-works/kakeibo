const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Core=require('./core.js');
const { bootApp } = require('./boot-app.cjs');
function screen(settings,tx,view){ const app=bootApp({state:{settings,tx:tx||[]}}); app.run(`view=${JSON.stringify(view)}; render();`); return app.el('app').innerHTML; }
const YM='2026-08';
function plain(s){return String(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ')}

test('CA is selectable and paired with CAD/en-CA',()=>{
  assert.equal(Core.SUPPORTED_COUNTRIES.includes('CA'),true);
  const s=Core.normalizeSettings({country:'CA',currency:'JPY'});
  assert.equal(s.country,'CA');
  assert.equal(s.currency,'CAD');
  assert.equal(Core.countryLocale(s),'en-CA');
  assert.equal(Core.formatMoney(1234.56,s),'CA$1,234.56');
});

test('CA uses Canadian full date and English heading',()=>{
  assert.equal(Core.formatDate('2026-08-10','CA'),'2026-08-10');
  assert.equal(Core.formatDateHeading('2026-08-10','CA'),'August 10');
  assert.equal(Core.formatYearMonth('2026-08','CA'),'August 2026');
});

test('CA money profile starts independently and preserves shared birth',()=>{
  const profiles=Core.normalizeMoneyProfiles({JP:{country:'JP',nisaMonthly:110500},US:{country:'US',nisaMonthly:369},GB:{country:'GB',nisaMonthly:200}},null);
  const ca=Core.settingsForCountry(profiles,'CA','1968-11-13');
  assert.equal(ca.country,'CA'); assert.equal(ca.currency,'CAD');
  assert.equal(ca.nisaMonthly,0); assert.equal(ca.birth,'1968-11-13');
});

test('settings shows Canada CAD and CA home does not count other countries',()=>{
  const hs=plain(screen({country:'CA'},[],'settings'));
  assert.match(hs,/Canada · CAD/);
  const tx=[
    {id:'j',type:'income',amount:9999,cat:'salary',date:'2026-08-02'},
    {id:'u',type:'income',amount:8888,cat:'salary',date:'2026-08-02',country:'US'},
    {id:'g',type:'income',amount:7777,cat:'salary',date:'2026-08-02',country:'GB'},
    {id:'c',type:'income',amount:1200,cat:'salary',date:'2026-08-02',country:'CA'},
  ];
  const h=plain(screen({country:'CA',cycleStart:1},tx,'home'));
  assert.match(h,/Hello/); assert.match(h,/CA\$1,200.00/);
  assert.equal(h.includes('CA$9,999.00'),false);
  assert.equal(h.includes('CA$8,888.00'),false);
  assert.equal(h.includes('CA$7,777.00'),false);
});

test('life plan snapshot uses CA and CAD',()=>{
  const tx=[{id:'c',type:'income',amount:1200,cat:'salary',date:'2026-08-02',country:'CA'}];
  const snap=Core.buildSnapshot({country:'CA'},tx,YM);
  assert.equal(snap.country_code,'CA'); assert.equal(snap.base_currency,'CAD'); assert.equal(snap.locale,'en-CA');
});
