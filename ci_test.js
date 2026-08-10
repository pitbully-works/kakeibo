/* =========================================================================
   かけいぼ ― CI設定とファイル構成の整合性チェック
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const wf = fs.readFileSync(path.join(__dirname, ".github/workflows/test.yml"), "utf8");
/* 完全検査 workflow はリリース前の任意ツール。
   iPhone からの更新などで一時的に未配置でも、普段の通常テスト＋高速mutationを
   丸ごと止めない。存在するときだけ内容を厳しく検査する。 */
const fullWorkflowPath = path.join(__dirname, ".github/workflows/mutation-full.yml");
const wfFull = fs.existsSync(fullWorkflowPath) ? fs.readFileSync(fullWorkflowPath, "utf8") : "";
const files = fs.readdirSync(__dirname);

/* ---------- mutation スクリプトの一本化 ---------- */
test("mutation スクリプトは run-mutations.js の1本だけ", () => {
  assert.ok(files.includes("run-mutations.js"), "run-mutations.js が無い");
  assert.equal(files.includes("run-mutations.mjs"), false, "古い run-mutations.mjs が残っている");
});

test("どのファイルにも run-mutations.mjs への参照が残っていない", () => {
  // このテスト自身は検査対象の文字列を持っているので除く。
  // ファイル名の綴り（ci.test.js / ci_test.js）に依存しないよう __filename を使う。
  const self = path.basename(__filename);
  const targets = files.filter((f) => /\.(js|cjs|mjs|md|yml|html)$/.test(f) && f !== self);
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

/* ---------- 同じテストが二重に入っていないか ---------- */
test("ファイル名にスペースが混ざっていない", () => {
  const bad = files.filter((f) => /\s/.test(f));
  assert.deepEqual(bad, [], "アップロード時に名前が変わったファイルがある: " + bad.join(" / "));
});

test("同じテストが名前違いで二重に入っていない", () => {
  // 「xxx.test.js」「xxx_test.js」「xxx test.js」は同じものとみなす
  const key = (f) => f.replace(/[._\s]test\.js$/i, "").toLowerCase();
  const groups = {};
  files.filter((f) => /[._\s]test\.js$/i.test(f)).forEach((f) => {
    (groups[key(f)] = groups[key(f)] || []).push(f);
  });
  const dup = Object.keys(groups).filter((k) => groups[k].length > 1)
    .map((k) => groups[k].join(" と "));
  assert.deepEqual(dup, [], "同じテストが重複している: " + dup.join(" / "));
});

test("テスト補助ファイルも重複していない", () => {
  const key = (f) => f.replace(/[-_\s]/g, "").toLowerCase();
  const helpers = files.filter((f) => /\.cjs$/.test(f));
  const seen = {};
  const dup = [];
  helpers.forEach((f) => { const k = key(f); if (seen[k]) dup.push(seen[k] + " と " + f); seen[k] = f; });
  assert.deepEqual(dup, [], "補助ファイルが重複している: " + dup.join(" / "));
});

/* ---------- 2段構え（①ふだんの検査 ②完全検査） ---------- */
test("ふだんのワークフローは高速mutation（--fast）を使う", () => {
  assert.match(wf, /node run-mutations\.js --fast/, "高速検査になっていない");
});

test("ふだんのワークフローは、変えたファイルを mutation へ渡している", () => {
  assert.match(wf, /CHANGED_FILES:/, "変更ファイルを渡していない（絞り込みが効かない）");
});

test("完全検査のワークフローは、配置されていれば全変異を試す", () => {
  if (!wfFull) return;
  assert.match(wfFull, /run: node run-mutations\.js/, "完全検査が mutation を実行していない");
  assert.equal(/node run-mutations\.js[^\n]*--fast/.test(wfFull), false,
    "完全検査なのに --fast が付いている（全変異を試さなくなる）");
});

test("完全検査は、配置されていれば Actions の画面から手で走らせられる", () => {
  if (!wfFull) return;
  assert.match(wfFull, /^on:\s*\n\s*workflow_dispatch:/m, "手動実行の設定が無い");
});

test("完全検査も、配置されていれば外部APIやシークレットを使わない", () => {
  if (!wfFull) return;
  assert.equal(/secrets\./.test(wfFull), false, "シークレットを参照している");
});

test("完全検査も、配置されていればレポートが無いまま保存しようとしない", () => {
  if (!wfFull) return;
  assert.match(wfFull, /if-no-files-found: error/);
});

test("完全検査がある場合、2つのワークフローは名前だけで見分けられる", () => {
  assert.match(wf, /^name: .*①/m, "ふだん用の名前に①が無い");
  if (!wfFull) return;
  assert.match(wfFull, /^name: .*②/m, "完全検査の名前に②が無い");
  const nameOf = (y) => (/^name: (.+)$/m.exec(y) || [])[1];
  assert.notEqual(nameOf(wf), nameOf(wfFull), "2つの名前が同じ");
});

/* ---------- 速くするために検査を弱めていないか ---------- */
test("変異の一覧は減らされていない", () => {
  const list = require("./mutations.js");
  assert.ok(Array.isArray(list), "mutations.js が一覧を返していない");
  assert.ok(list.length >= 279, "変異が減っている: " + list.length + " 件");
});

test("高速検査も、変異の一覧は同じものを使っている", () => {
  const runner = fs.readFileSync(path.join(__dirname, "run-mutations.js"), "utf8");
  assert.match(runner, /require\("\.\/mutations\.js"\)/, "別の一覧を使っている");
});

test("早期検出は「検出」しか決められない（見逃しの判定は全テストのまま）", () => {
  const libSrc = fs.readFileSync(path.join(__dirname, "mutation-lib.js"), "utf8");
  const at = libSrc.indexOf("quickFiles");
  assert.ok(at > 0, "早期検出の仕組みが無い");
  /* 説明の文（コメント）には「見逃し」の語が出てくるので、判定にはコードだけを見る */
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const quickBlock = stripComments(libSrc.slice(at, libSrc.indexOf("const res = await runTests")));
  assert.equal(quickBlock.includes("見逃し"), false,
    "早期検出だけで「見逃し」を決めている（判定が甘くなる）");
  assert.match(libSrc, /status: res\.ok \? "見逃し" : "検出"/,
    "見逃しの判定が全テストの結果から外れている");
});

/* ---------- 対応表 ---------- */
test("対応表は、実在するテストファイルだけを指している", () => {
  const mapPath = path.join(__dirname, "mutation-map.json");
  if (!fs.existsSync(mapPath)) return; // 無くても動く（そのとき高速検査は全テストで試す）
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const bad = [];
  Object.keys(map).forEach((k) => {
    (map[k] || []).forEach((f) => { if (!files.includes(f)) bad.push(k + " → " + f); });
  });
  assert.deepEqual(bad, [], "対応表が存在しないテストを指している: " + bad.join(" / "));
});

test("対応表は、いまある変異の名前だけを持っている", () => {
  const mapPath = path.join(__dirname, "mutation-map.json");
  if (!fs.existsSync(mapPath)) return;
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const names = new Set(require("./mutations.js").map((m) => m.name));
  const stale = Object.keys(map).filter((k) => !names.has(k));
  assert.deepEqual(stale, [], "もう無い変異が対応表に残っている: " + stale.join(" / "));
});

test("元のソースをその場で書き換える作りに戻っていない", () => {
  const libSrc = fs.readFileSync(path.join(__dirname, "mutation-lib.js"), "utf8");
  assert.match(libSrc, /makeWorkspace/, "一時フォルダへ写す作りになっていない");
  assert.match(libSrc, /removeAllWorkspaces/, "後始末の仕組みが無い");
  ["SIGINT", "SIGTERM"].forEach((sig) => {
    assert.ok(libSrc.includes(sig), sig + " で後始末していない（中断で壊れたまま残る）");
  });
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
