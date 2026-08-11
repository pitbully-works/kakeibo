const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html','utf8');

test('生年月日はOSの日付pickerではなく年・月・日の選択欄で入力する',()=>{
  assert.ok(html.includes('id="f-birth" type="hidden"'));
  assert.ok(html.includes('id="f-birth-y"'));
  assert.ok(html.includes('id="f-birth-m"'));
  assert.ok(html.includes('id="f-birth-d"'));
  assert.ok(!html.includes('id="f-birth" type="date"'));
});

test('生年月日を消す専用処理がありNISA自動計算の停止を説明する',()=>{
  assert.ok(html.includes('function clearBirth()'));
  assert.ok(html.includes('生年月日を消す'));
  assert.ok(html.includes('年齢区間による自動計算'));
  assert.ok(html.includes('birth:""'));
});


test('生年月日を消す前に現在のNISA月額を固定値へ退避する',()=>{
  assert.ok(html.includes('const currentNisa=Core.nisaPlannedOn(state.settings,from);'));
  assert.ok(html.includes('{birth:"",nisaMonthly:currentNisa}'));
  assert.ok(html.includes('現在のNISA月額はそのまま保持'));
});

test('生年月日未設定でも入力したNISA月額を画面上部に表示する',()=>{
  assert.ok(html.includes('const now=Core.nisaPlannedOn(s,Core.cycleRange(curYM(),s.cycleStart).from);'));
  assert.ok(html.includes('入力した現在のNISA月額は <b>${yen(now)}</b> です'));
});
