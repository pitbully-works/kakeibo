const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");

test("取引・予定IDをHTML属性へ出す箇所はescapeAttrを通す",()=>{
  const unsafe=[
    /data-id="\$\{p\.id\}"/,
    /data-id="\$\{t\.id\}"/,
    /data-edit="\$\{t\.id\}"/,
  ];
  for(const re of unsafe) assert.doesNotMatch(html,re);
  assert.match(html,/data-id="\$\{escapeAttr\(p\.id\)\}"/);
  assert.match(html,/data-id="\$\{escapeAttr\(t\.id\)\}"/);
  assert.match(html,/data-edit="\$\{escapeAttr\(t\.id\)\}"/);
});
