const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("index.html","utf8");

test("国別個人記録の外側は配列を拒否する",()=>{
 const p=src.indexOf("function normalizePersonalProfiles(v)");
 const b=src.slice(p,src.indexOf("function syncPersonalProfile",p));
 assert.match(b,/!Array\.isArray\(v\)/);
});
test("各国の個人記録も配列を拒否する",()=>{
 const p=src.indexOf("function normalizePersonalProfiles(v)");
 const b=src.slice(p,src.indexOf("function syncPersonalProfile",p));
 assert.match(b,/!Array\.isArray\(v\[c\]\)/);
});
