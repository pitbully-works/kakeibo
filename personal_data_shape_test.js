const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");
test("1か国分の個人記録は配列をオブジェクトとして受け付けない",()=>{
 const p=src.indexOf("function normalizePersonalData(v)");
 const b=src.slice(p,src.indexOf("function normalizePersonalProfiles",p));
 assert.match(b,/typeof v===["']object["'] && !Array\.isArray\(v\)/);
});
