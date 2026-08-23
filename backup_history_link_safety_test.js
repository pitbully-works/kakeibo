const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");

test("バックアップの関数電卓履歴は各国20件まで",()=>{
  const p=src.indexOf("function backupCalcHistory(v)");
  const b=src.slice(p,src.indexOf("function backupRecordCalcHistory",p));
  assert.match(b,/normalized\.filter\(h=>h\.country===c\)\.slice\(0,20\)/);
});

test("記録電卓履歴は実在する同じ国の記録だけに紐づける",()=>{
  const p=src.indexOf("function backupRecordCalcHistory(v, txList)");
  const b=src.slice(p,src.indexOf("/* --- バックアップの読み込み",p));
  assert.match(b,/const linked=txById\[txId\]/);
  assert.match(b,/if\(!linked \|\| Core\.normalizeCountry\(h\.country\)!==linked\.country\) return null/);
});

test("記録電卓履歴の属性はリンク先記録を正本にする",()=>{
  const p=src.indexOf("function backupRecordCalcHistory(v, txList)");
  const b=src.slice(p,src.indexOf("/* --- バックアップの読み込み",p));
  assert.match(b,/cat:linked\.cat\|\|"food"/);
  assert.match(b,/type:linked\.type==="income"/);
  assert.match(b,/country:linked\.country/);
  assert.match(b,/linked\.date/);
});

test("復元時に記録一覧を履歴正規化へ渡す",()=>{
  const p=src.indexOf("function onBackupPicked(file)");
  const b=src.slice(p,src.indexOf("function shareText",p));
  assert.match(b,/backupRecordCalcHistory\(rawBackup && rawBackup\.recordCalcHistory, restored\.tx\)/);
});
