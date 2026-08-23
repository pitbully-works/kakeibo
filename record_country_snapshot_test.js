const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");

test("記録は画面を開いた時点の国を固定する",()=>{
  const p=src.indexOf("function openRecord(editId)");
  const b=src.slice(p,p+1100);
  assert.match(b,/mode:"add", country:curCountry\(\)/);
  assert.match(b,/mode:"edit", id:t\.id, country:txCountryOf\(t\)/);
});

test("新規記録の保存と履歴表示はシート開始国を使う",()=>{
  const s=src.slice(src.indexOf("async function saveTx()"),src.indexOf("function deleteTxWithLinkedHistory"));
  assert.match(s,/Core\.normalizeCountry\(st\.country\|\|curCountry\(\)\)/);
  const h=src.slice(src.indexOf("function recordCalcHistoryHtml()"),src.indexOf("function renderSheet()"));
  assert.match(h,/sheetState&&sheetState\.country/);
});

test("カメラ退避と復帰でも記録開始国を保持する",()=>{
  const p=src.slice(src.indexOf("function savePending()"),src.indexOf("function clearPending()"));
  assert.match(p,/country:Core\.normalizeCountry\(st\.country\|\|curCountry\(\)\)/);
  const r=src.slice(src.indexOf("function restorePending()"),src.indexOf("/* --- SW-REGISTRATION-START"));
  assert.match(r,/const pendingCountry=Core\.normalizeCountry\(p\.country\|\|curCountry\(\)\)/);
});

test("カメラ復帰時に編集元が消えていたら復元しない",()=>{
  const e=src.slice(src.indexOf("function ensureSheetForPhoto()"),src.indexOf("/* ---------- 写真＋OCR"));
  assert.match(e,/p && p\.mode==="edit" && !\(state\.tx\|\|\[\]\)\.some/);
  assert.match(e,/clearPending\(\);[\s\S]*?return false/);
  const r=src.slice(src.indexOf("function restorePending()"),src.indexOf("/* --- SW-REGISTRATION-START"));
  assert.match(r,/if\(p\.mode==="edit" && !\(state\.tx\|\|\[\]\)\.some/);
  assert.match(r,/clearPending\(\);[\s\S]*?pending edit was not restored[\s\S]*?return;/);
});
