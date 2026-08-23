const test=require("node:test");
const assert=require("node:assert/strict");
const Core=require("./core.js");
const {bootApp}=require("./boot-app.cjs");

const P="data:image/png;base64,AAAA";

test("容量表示は記録写真だけでなく国別の日記写真も数える",()=>{
  const s={
    tx:[{id:"t",type:"expense",amount:1,cat:"food",date:"2026-08-01",photo:P}],
    personalProfiles:{
      JP:{diary:{"2026-08-01":{text:"jp",photo:P}}},
      US:{diary:{"2026-08-02":{text:"us",photo:P}}}
    }
  };
  const u=Core.storageUsage(s);
  assert.equal(u.photoCount,3);
  assert.ok(u.photos>0);
});

test("写真をすべて消すと記録写真と全5か国の日記写真を消す",()=>{
  const state={
    settings:{country:"JP"},
    tx:[{id:"t",type:"expense",amount:1,cat:"food",date:"2026-08-01",photo:P}],
    diary:{"2026-08-01":{text:"jp",photo:P}},
    personalProfiles:{
      JP:{health:{},diary:{"2026-08-01":{text:"jp",photo:P}},plans:{},pulse:[]},
      US:{health:{},diary:{"2026-08-02":{text:"us",photo:P}},plans:{},pulse:[]}
    }
  };
  const app=bootApp({state});
  app.run("purgePhotos()");
  const saved=JSON.parse(app.saved());
  assert.equal(saved.tx[0].photo,null);
  assert.equal(saved.personalProfiles.JP.diary["2026-08-01"].photo,undefined);
  assert.equal(saved.personalProfiles.US.diary["2026-08-02"].photo,undefined);
});

test("写真一括削除の保存失敗では日記写真も含めて元へ戻す",()=>{
  const state={
    settings:{country:"JP"},
    tx:[],
    diary:{"2026-08-01":{text:"jp",photo:P}},
    personalProfiles:{JP:{health:{},diary:{"2026-08-01":{text:"jp",photo:P}},plans:{},pulse:[]}}
  };
  const app=bootApp({state, storageFull:true});
  app.run("purgePhotos()");
  assert.equal(app.run('state.diary["2026-08-01"].photo'),P);
});
