/* =========================================================================
   かけいぼ ― CI設定とファイル構成の整合性チェック
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const wf = fs.readFileSync(path.join(__dirname, ".github/workflows/test.yml"), "utf8");
const files = fs.readdirSync(__dirname);

/* ---------- mutation スクリプトの一本化 ---------- */
test("mutation スクリプトは run-mutations.js の1本だけ", () => {
  assert.ok(files.includes("run-mutations.js"), "run-mutations.js が無い");
  assert.equal(files.includes("run-mutations.mjs"), false, "古い run-mutations.mjs が残っている");
});

test("どのファイルにも run-mutations.mjs への参照が残っていない", () => {
  // このテスト自身は、検査対象の文字列を持っているので除く
  const targets = files.filter((f) => /\.(js|cjs|mjs|md|yml|html)$/.test(f) && f !== "ci.test.js");
  const hits = [];
  for (const f of targets) {
    const body = fs.readFileSync(path.join(__dirname, f), "utf8");
    if (body.includes("run-mutations.mjs")) hits.push(f);
  }
  if (wf.includes("run-mutations.mjs")) hits.push(".github/workflows/test.yml");
  assert.deepEqual(hits, [], "古い名前を参照している: " + hits.join(", "));
});

test("READMEの実行手順が run-mutations.js になっている", () => {
  const readme = fs.readFileSync(path.join(__dirname, "README.md"), "utf8");
  assert.match(readme, /node run-mutations\.js/, "READMEの実行方法が更新されていない");
});

test("生成されるレポートも run-mutations.js を案内する", () => {
  const runner = fs.readFileSync(path.join(__dirname, "run-mutations.js"), "utf8");
  assert.match(runner, /`node run-mutations\.js`/, "レポート内の案内が古い");
  assert.equal(runner.includes("run-mutations.mjs"), false, "スクリプト内に古い名前が残っている");
});

/* ---------- ワークフロー ---------- */
test("main への push と pull request で走る", () => {
  assert.match(wf, /on:\s*\n\s*push:\s*\n\s*branches: \[main\]/);
  assert.match(wf, /^\s{2}pull_request:/m);
});

test("通常テストと mutation test の両方を実行する", () => {
  assert.match(wf, /run: node --test --test-reporter=spec/, "通常テストを実行していない");
  assert.match(wf, /run: node run-mutations\.js/, "mutation test を実行していない");
});

test("mutation の前に、古いレポートを削除している", () => {
  const del = wf.indexOf("rm -f MUTATION-REPORT.md");
  const run = wf.indexOf("run: node run-mutations.js");
  assert.ok(del > 0, "古いレポートの削除ステップが無い");
  assert.ok(del < run, "mutation 実行より後に削除している");
});

test("mutation ステップに id が付いている", () => {
  assert.match(wf, /id: mutation/, "id が無いと、動いた回かどうか判定できない");
});

test("レポートの表示と保存は、mutation が動いた回だけ", () => {
  const guards = wf.match(/if: always\(\) && steps\.mutation\.outcome != 'skipped' && hashFiles\('MUTATION-REPORT\.md'\) != ''/g) || [];
  assert.equal(guards.length, 2, "サマリー表示とartifact保存の両方に条件が付いていない: " + guards.length);
});

test("レポートが無いのに保存しようとしない", () => {
  assert.match(wf, /if-no-files-found: error/, "ファイルが無いまま保存を試みる設定になっている");
  assert.equal(wf.includes("if-no-files-found: warn"), false, "見逃し設定が残っている");
});

test("外部APIやシークレットを使わない", () => {
  assert.equal(/secrets\./.test(wf), false, "シークレットを参照している");
  assert.match(wf, /permissions:\s*\n\s*contents: read/, "権限が読み取りに絞られていない");
});

test("package.json を前提にしていない", () => {
  assert.equal(files.includes("package.json"), false, "package.json ができている（テストの読み込み方が変わる）");
  assert.equal(/npm (test|ci|install)/.test(wf), false, "npm を前提にしている");
});
