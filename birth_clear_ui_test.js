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
  assert.ok(html.includes('NISAの年齢区間による自動計算'));
  assert.ok(html.includes('birth:""'));
});
