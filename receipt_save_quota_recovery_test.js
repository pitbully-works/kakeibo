const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");

test("容量超過時、移行完了済みなら古い移行控えを解放して保存を再試行する",()=>{
  const start=src.indexOf("function save(){");
  const block=src.slice(start,start+2600);
  assert.match(block,/isQuotaError\(e\)/);
  assert.match(block,/state&&state\.dataVersion/);
  assert.match(block,/MIGRATION_BACKUP_KEY/);
  assert.match(block,/localStorage\.removeItem\(MIGRATION_BACKUP_KEY\)/);
  const writes=[...block.matchAll(/localStorage\.setItem\(STORE_KEY, text\)/g)];
  assert.ok(writes.length>=2,"控え解放後の再保存が無い");
});

test("移行未完了のときは安全控えを勝手に消さない",()=>{
  const start=src.indexOf("function save(){");
  const block=src.slice(start,start+2600);
  assert.match(block,/!migrationDone && Number\(state&&state\.dataVersion\|\|0\)>=Core\.DATA_VERSION/);
});
