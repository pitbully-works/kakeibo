/* =========================================================================
   かけいぼ ― 自作の簡易 mutation test（テストが本当に効いているかを確かめる）
   -------------------------------------------------------------------------
   ※ mutation testing 全体を網羅するものではありません。
      あらゆる変異を機械的に生成するのではなく、壊れると困る重要な
      パターンを手作業で列挙したものです（一覧は mutations.js）。
      選んだ範囲の外に穴が残る可能性はあります。
   -------------------------------------------------------------------------
   仕組み：
     1. 作業用の一時フォルダへソースを丸ごと写す
     2. その **写しだけ** をわざと壊す（元のソースには絶対に触らない）
     3. その状態でテストを走らせる
     4. テストが落ちれば「その壊れ方を検出できる」＝合格
        テストが通ってしまえば「見逃す」＝不合格（テストの穴）
     5. 一時フォルダを消す（正常終了・失敗・中断のどれでも消す）

   -------------------------------------------------------------------------
   2つの使い方
   -------------------------------------------------------------------------
   ① ふだんの検査（高速）   node run-mutations.js --fast
        変えたファイルに関わる変異だけを、
        「その変異を捕まえられるテストファイル」だけで試す。
        対応表（mutation-map.json）は完全検査の実測から作られる。
        数分で終わるので、ふだんの変更はこちらでよい。

   ② 完全検査             node run-mutations.js
        すべての変異を、すべてのテストで試す。
        同時に対応表 mutation-map.json を作り直す。
        リリース前と、大きな変更のあとはこちら。

   -------------------------------------------------------------------------
   高速版が甘くならない理由
   -------------------------------------------------------------------------
     テストを減らすと「捕まえにくくなる」方向にしか動かない。
     つまり高速版で見逃しが出たら、それは本物の警告か、
     対応表が古くなったかのどちらか。どちらの場合も **赤くなる**。
     見逃しを見落とす方向には壊れない（安全側に倒れる）。

   オプション：
     --fast                高速検査
     --write-map           対応表 mutation-map.json を作り直す（完全検査のときだけ）
     --changed=a.js,b.html 変えたファイルを指定（省略時は環境変数 CHANGED_FILES）
     --jobs=N              同時に走らせる本数（既定：CPU数と4の小さいほう）
   結果： MUTATION-REPORT.md に書き出す
   ========================================================================= */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const MUTATIONS = require("./mutations.js");
const lib = require("./mutation-lib.js");

const dir = __dirname;
const MAP_FILE = path.join(dir, "mutation-map.json");

/* ---------- 引数 ---------- */
const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const val = (n) => {
  const hit = argv.find((a) => a.startsWith(n + "="));
  return hit ? hit.slice(n.length + 1) : null;
};
const FAST = has("--fast");
const JOBS = Math.max(1, Number(val("--jobs")) || Math.min(4, os.cpus().length || 1));

/* 変えたファイル。指定が無ければ全部を対象にする（絞れないなら絞らない）。 */
function changedFiles() {
  const raw = val("--changed") || process.env.CHANGED_FILES || "";
  const list = raw.split(/[,\s]+/).map((s) => path.basename(s.trim())).filter(Boolean);
  return list.length ? list : null;
}

/* ---------- 対応表（どのテストがその変異を捕まえるか） ---------- */
function loadMap() {
  try { return JSON.parse(fs.readFileSync(MAP_FILE, "utf8")); } catch (e) { return {}; }
}

/* ---------- 対象の変異を選ぶ ---------- */
const changed = changedFiles();
let targets = MUTATIONS;
let scopeNote = "すべての変異";
if (FAST && changed) {
  targets = MUTATIONS.filter((m) => changed.includes(path.basename(m.file)));
  scopeNote = `変えたファイル（${changed.join(" / ")}）に関わる変異`;
  /* 変えたのがテストだけ、といった場合は当てはまる変異が無い。
     そのときは絞らずに全部やる（黙って何も試さないのが一番あぶない）。 */
  if (!targets.length) {
    targets = MUTATIONS;
    scopeNote = "すべての変異（変えたファイルに当てはまる変異が無いため絞らなかった）";
  }
} else if (FAST) {
  scopeNote = "すべての変異（変えたファイルの指定が無いため絞らなかった）";
}

const map = FAST ? loadMap() : {};

/* ---------- ここから実行 ---------- */
(async function main() {
  /* 元のソースが最後まで無傷であることを、後で突き合わせるために控える */
  const watchFiles = [...new Set(MUTATIONS.map((m) => m.file))];
  const before = lib.readSources(watchFiles);

  /* 変異させる前に、そのままの状態でテストが通ることを確かめる */
  const baseWs = lib.makeWorkspace();
  let base;
  try { base = await lib.runTests(baseWs); } finally { lib.removeWorkspace(baseWs); }
  if (!base.ok) {
    console.error("変異させる前からテストが落ちています。先に直してください。");
    process.exit(1);
  }

  const started = Date.now();
  console.log(`${FAST ? "① ふだんの検査（高速）" : "② 完全検査"} を始めます`);
  console.log(`対象：${scopeNote} ／ ${targets.length} 件 ／ 同時に ${JOBS} 本`);

  const results = await lib.runMutations(targets, {
    jobs: JOBS,
    /* 高速版のときだけ、対応表にあるテストファイルへ絞る。
       対応表に無い変異（新しく足した変異など）は、絞らずに全部で試す。 */
    testFilesFor: (m) => {
      if (!FAST) return null;
      const files = map[m.name];
      return Array.isArray(files) && files.length ? files : null;
    },
    onDone: (r, i, n) => console.log(`[${i + 1}/${n}] ${r.status}: ${r.name}`),
  });
  const took = (Date.now() - started) / 1000;

  const caught = results.filter((r) => r.status === "検出");
  const missed = results.filter((r) => r.status === "見逃し");
  const skipped = results.filter((r) => r.status === "対象なし");

  /* 対応表を作り直すのは、はっきり指示されたときだけ。
     ふだんのCIで勝手にファイルが増えると「差分が残っている」検査に引っかかるため。
       node run-mutations.js --write-map */
  if (!FAST && has("--write-map")) {
    const next = {};
    results.forEach((r) => { if (r.detectedBy && r.detectedBy.length) next[r.name] = r.detectedBy; });
    fs.writeFileSync(MAP_FILE, JSON.stringify(next, null, 1) + "\n");
    console.log(`対応表を作り直しました：${MAP_FILE}`);
  }

  /* ---------- 結果を書き出す ---------- */
  const md = [
    "# mutation test 結果",
    "",
    "テストが本当に効いているかを、ソースをわざと壊して確かめた記録です。",
    "壊すのは一時フォルダへ写したものだけで、リポジトリのソースには触れていません。",
    "",
    "> **注記**：これは mutation testing 全体を網羅するものではありません。",
    "> あらゆる変異を機械的に生成するのではなく、壊れると困る重要なパターンを",
    "> 手作業で列挙した自作の簡易チェックです。選んだ範囲の外に穴が残る可能性はあります。",
    "",
    `実行方法： \`node run-mutations.js${FAST ? " --fast" : ""}\``,
    "",
    `- 実行日時： ${new Date().toISOString()}`,
    `- 使用した Node： ${process.version}`,
    `- 種類： ${FAST ? "① ふだんの検査（高速）" : "② 完全検査"}`,
    `- 対象： ${scopeNote}`,
    `- 変異の数： ${results.length}（一覧の総数 ${MUTATIONS.length}）`,
    `- **検出できた： ${caught.length} 件**`,
    `- 見逃した： ${missed.length} 件`,
    `- 対象なし： ${skipped.length} 件`,
    `- かかった時間： ${took.toFixed(1)} 秒`,
    "",
    "| # | わざと壊した内容 | 守りたい振る舞い | 対象 | 結果 | 落ちたテスト数 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.guards} | \`${r.file}\` | ${
      r.status === "検出" ? "✅ 検出" : r.status === "見逃し" ? "❌ 見逃し" : "— 対象なし"
    } | ${r.failedCount === null ? "-" : r.failedCount} |`),
    "",
    missed.length
      ? "## 見逃し（テストの穴）\n\n" + missed.map((r) => `- ${r.name}（${r.guards}）`).join("\n")
        + (FAST ? "\n\n> 高速検査で見逃しが出たときは、対応表が古い可能性もあります。\n> `node run-mutations.js`（完全検査）で確かめてください。" : "")
      : "## 見逃しなし\n\nすべての変異を検出できました。",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "MUTATION-REPORT.md"), md);

  /* 元のソースが1バイトも変わっていないことを、最後に必ず確かめる */
  if (!lib.sourcesUntouched(before)) {
    console.error("::error::元のソースが書き換わっています（本来ありえません）");
    process.exit(1);
  }

  console.log(`変異 ${results.length} 件中、検出 ${caught.length} 件 ／ 見逃し ${missed.length} 件`
    + ` ／ ${took.toFixed(1)} 秒`);
  if (missed.length) {
    missed.forEach((r) => console.log("  見逃し: " + r.name));
    process.exit(1);
  }
})().catch((e) => {
  lib.removeAllWorkspaces();
  console.error(e);
  process.exit(1);
});
