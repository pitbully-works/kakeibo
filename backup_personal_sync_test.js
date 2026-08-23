const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");

test("バックアップ書き出し前に現在国の個人記録をpersonalProfilesへ同期する",()=>{
  const start=src.indexOf("function exportBackup()");
  const block=src.slice(start,start+900);
  assert.ok(start>=0);
  const sync=block.indexOf("syncPersonalProfile();");
  const build=block.indexOf("Core.buildBackup(state)");
  const profiles=block.indexOf("backup.personalProfiles=");
  assert.ok(sync>=0,"同期がない");
  assert.doesNotMatch(block,/syncPersonalProfile\s*=\s*function\(\)\{\}/,
    "同期関数が無効化されている");
  assert.ok(build>sync,"同期より先にバックアップを作っている");
  assert.ok(profiles>build,"国別個人記録がバックアップに入っていない");
});
