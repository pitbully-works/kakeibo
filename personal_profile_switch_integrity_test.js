const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync('index.html','utf8');

function block(name,next){
  const p=src.indexOf(`function ${name}`);
  assert.ok(p>=0,`${name} が見つからない`);
  const e=next ? src.indexOf(`function ${next}`,p) : p+1800;
  return src.slice(p,e>p?e:p+1800);
}

test('国切替前の個人記録同期は現在国を正規化して保存する',()=>{
  const b=block('syncPersonalProfile','loadPersonalProfile');
  assert.match(b,/const c=Core\.normalizeCountry\(state\.settings\.country\)/);
  assert.match(b,/state\.personalProfiles\[c\]=normalizePersonalData\(/);
});

test('国切替後の個人記録読込は指定国を正規化してから選ぶ',()=>{
  const b=block('loadPersonalProfile');
  assert.match(b,/const c=Core\.normalizeCountry\(country\)/);
  assert.match(b,/state\.personalProfiles\[c\]\s*\?\s*normalizePersonalData\(state\.personalProfiles\[c\]\)\s*:\s*emptyPersonalData\(\)/);
});

test('個人記録読込は4領域をまとめて現在状態へ戻す',()=>{
  const b=block('loadPersonalProfile');
  assert.match(b,/state\.health=d\.health;\s*state\.diary=d\.diary;\s*state\.plans=d\.plans;\s*state\.pulse=d\.pulse/);
});

test('未作成国の個人記録は共有参照ではなく毎回新しい空領域を使う',()=>{
  const b=block('emptyPersonalData','normalizePersonalData');
  assert.match(b,/return \{ health:\{\}, diary:\{\}, plans:\{\}, pulse:\[\] \}/);
});
