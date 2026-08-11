"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");
test("記録後も記録ページに残る",()=>{ assert.match(src,/if\(save\(\)\)[\s\S]*?openRecord\(null\)/); });
test("記録電卓の履歴を端末に保存する",()=>{ assert.match(src,/recordCalcHistory:\[\]/); assert.match(src,/calcHistCandidate/); });
test("履歴にはカテゴリ絵文字・式・答えを表示する",()=>{ assert.match(src,/recordCalcCatEmoji/); assert.match(src,/rechistexpr/); });
test("履歴は編集と削除ができる",()=>{ assert.match(src,/record-hist-edit/); assert.match(src,/record-hist-del/); });
test("履歴の編集は元の家計簿記録を開く",()=>{ assert.match(src,/state\.tx\.find\(x=>x\.id===h\.txId\)/); });
