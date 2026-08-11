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
