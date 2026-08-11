"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");
test("記録後も記録ページに残る",()=>{ assert.match(src,/if\(save\(\)\)[\s\S]*?openRecord\(null\)/); });
test("記録電卓の履歴を端末に保存する",()=>{ assert.match(src,/recordCalcHistory:\[\]/); assert.match(src,/calcHistCandidate/); });
test("履歴にはカテゴリ絵文字・式・答えを表示する",()=>{ assert.match(src,/recordCalcCatEmoji/); assert.match(src,/rechistexpr/); });
test("履歴は削除でき、編集ボタンは出さない",()=>{ assert.match(src,/record-hist-del/); assert.doesNotMatch(src,/data-act="record-hist-edit"/); });
test("履歴削除で紐づく家計簿記録も同時に削除する",()=>{
  assert.match(src,/const txId=String\(h\.txId\|\|""\)/);
  assert.match(src,/state\.tx=beforeTx\.filter\(x=>x\.id!==txId\)/);
  assert.match(src,/state\.recordCalcHistory=beforeHistory\.filter/);
});
test("履歴と記録の削除保存に失敗したら両方戻す",()=>{
  assert.match(src,/state\.recordCalcHistory=beforeHistory;[\s\S]*?state\.tx=beforeTx;/);
});
test("計算しない直接入力の金額も記録履歴に残す",()=>{
  assert.match(src,/const hasCalcHistory/);
  assert.match(src,/calcHistCandidate\.result=calcHistCandidate\.expr/);
  assert.match(src,/expr===result \? expr/);
});
test("計算履歴がある状態で再起動しても家計簿記録を失わない",()=>{
  const {bootApp}=require("./boot-app.cjs");
  const tx={id:"tx1",type:"expense",amount:126,cat:"food",date:"2026-08-11",memo:"",photo:null};
  const history={id:"h1",txId:"tx1",expr:"63.22+63.22",result:"126.44",cat:"food",type:"expense",country:"JP",date:"2026-08-11"};
  const app=bootApp({state:{settings:{},tx:[tx],recordCalcHistory:[history]}});
  const loaded=app.run(`({tx:state.tx, history:state.recordCalcHistory})`);
  assert.equal(loaded.tx.length,1);
  assert.equal(loaded.tx[0].amount,126);
  assert.equal(loaded.history.length,1);
  assert.equal(loaded.history[0].txId,"tx1");
});

test("まとめページの各記録に削除ボタンがあり、関連する計算履歴も同時に削除する",()=>{
  assert.match(src,/data-act="summary-tx-del"/);
  assert.match(src,/function deleteTxWithLinkedHistory\(txId\)/);
  assert.match(src,/state\.tx=beforeTx\.filter\(t=>t\.id!==id\)/);
  assert.match(src,/state\.recordCalcHistory=beforeHistory\.filter\(h=>String\(h\.txId\|\|""\)!==id\)/);
});
