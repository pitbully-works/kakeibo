const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./core.js");

test("moneyProfiles無しのUSバックアップでもUS設定を失わない", () => {
  const r = Core.normalizeBackup({
    version: Core.BACKUP_VERSION,
    settings: { country:"US", goalName:"US goal", goalTarget:12345, birth:"1980-01-02" },
    tx: []
  });
  assert.equal(r.moneyProfiles.US.country, "US");
  assert.equal(r.moneyProfiles.US.goalName, "US goal");
  assert.equal(r.moneyProfiles.US.goalTarget, 12345);
  assert.equal(r.moneyProfiles.US.birth, "1980-01-02");
});

test("moneyProfilesに復元対象国だけ欠けてもsettingsから補完する", () => {
  const r = Core.normalizeBackup({
    version: Core.BACKUP_VERSION,
    settings: { country:"GB", goalName:"GB goal", goalTarget:67890, birth:"1975-05-06" },
    moneyProfiles: { JP:{ country:"JP", goalName:"JP goal", goalTarget:111 } },
    tx: []
  });
  assert.equal(r.moneyProfiles.JP.goalName, "JP goal");
  assert.equal(r.moneyProfiles.GB.country, "GB");
  assert.equal(r.moneyProfiles.GB.goalName, "GB goal");
  assert.equal(r.moneyProfiles.GB.goalTarget, 67890);
  assert.equal(r.moneyProfiles.GB.birth, "1975-05-06");
});
