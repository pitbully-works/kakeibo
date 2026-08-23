const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");
test("バックアップ作成前に現在国の設定と個人記録を両方同期する",()=>{
 const b=src.slice(src.indexOf("function exportBackup()"),src.indexOf("/* --- バックアップの読み込み"));
 assert.ok(b.indexOf("syncMoneyProfile();")>=0);
 assert.ok(b.indexOf("syncPersonalProfile();")>b.indexOf("syncMoneyProfile();"));
});
test("バックアップに2種類の電卓履歴を含める",()=>{
 const b=src.slice(src.indexOf("function exportBackup()"),src.indexOf("/* --- バックアップの読み込み"));
 assert.match(b,/backup\.calcHistory=/); assert.match(b,/backup\.recordCalcHistory=/);
});
test("バックアップ復元時は電卓履歴も同じバックアップへ置き換える",()=>{
 const b=src.slice(src.indexOf("function onBackupPicked(file)"),src.indexOf("function shareText"));
 assert.match(b,/state\.calcHistory = backupCalcHistory/);
 assert.match(b,/state\.recordCalcHistory = backupRecordCalcHistory/);
});
test("旧バックアップに履歴が無ければ空として扱う",()=>{
 assert.match(src,/function backupCalcHistory\(v\)[\s\S]*?Array\.isArray\(v\)\?v:\[\]/);
 assert.match(src,/function backupRecordCalcHistory\(v, txList\)[\s\S]*?Array\.isArray\(v\)\?v:\[\]/);
});
