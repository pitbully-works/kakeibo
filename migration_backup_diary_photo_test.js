const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"), path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");

test("移行控えの写真なし再試行は国別日記写真も外す",()=>{
  const start=src.indexOf("function backupBeforeMigration(raw)");
  const block=src.slice(start,start+2600);
  assert.match(block,/lite\.personalProfiles/);
  assert.match(block,/const diary=lite\.personalProfiles\[c\].*\.diary/);
  assert.match(block,/diary\[d\]=\{ text:diary\[d\]\.text \|\| "" \}/);
});

test("移行控えの写真なし再試行は記録写真も従来どおり外す",()=>{
  const start=src.indexOf("function backupBeforeMigration(raw)");
  const block=src.slice(start,start+2600);
  assert.match(block,/photo: null/);
});
