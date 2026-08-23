const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");
test("国別個人記録は継承プロパティを本人データとして読まない",()=>{
 const p=src.indexOf("function normalizePersonalProfiles(v)");
 const e=src.indexOf("function syncPersonalProfile",p);
 const b=src.slice(p,e);
 assert.match(b,/Object\.prototype\.hasOwnProperty\.call\(v,c\)/);
});
