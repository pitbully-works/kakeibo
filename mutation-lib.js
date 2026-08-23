/* =========================================================================
   かけいぼ ― mutation test の土台（走らせる仕組み）
   -------------------------------------------------------------------------
   わざと壊す内容の一覧は mutations.js が持つ。ここは走らせ方だけを持つ。

   いちばん大事な決めごと：**元のソースには絶対に触らない**
     以前は core.js / index.html をその場で書き換えて、終わったら戻していた。
     途中で止まると戻し損ねて、壊れたソースがそのまま残ってしまった。
     いまは作業用の一時フォルダへ丸ごと写して、その写しだけを壊す。
     だから途中で止まっても、元のソースは1バイトも変わらない。

   後始末：
     正常終了・失敗・中断（Ctrl+C / kill）のどれでも一時フォルダを消す。
     try/finally に加えて exit・SIGINT・SIGTERM でも消す。
     万一消し残しても、それは一時フォルダなのでリポジトリは汚れない。
   ========================================================================= */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = __dirname;

/* テストを走らせるのに要るファイルだけを写す（写真は要らない） */
const COPY_EXT = new Set([".js", ".cjs", ".mjs", ".html", ".json", ".webmanifest", ".md", ".yml", ".yaml"]);

/* 後始末する一時フォルダの控え。中断されてもここを見て消す。 */
const workspaces = new Set();
let cleanupHooked = false;

function removeWorkspace(dir) {
  workspaces.delete(dir);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 消せなくても進む */ }
}
function removeAllWorkspaces() {
  for (const d of [...workspaces]) removeWorkspace(d);
}
function hookCleanup() {
  if (cleanupHooked) return;
  cleanupHooked = true;
  process.on("exit", removeAllWorkspaces);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => { removeAllWorkspaces(); process.exit(130); });
  }
  process.on("uncaughtException", (e) => { removeAllWorkspaces(); throw e; });
}

/* 作業用の写しを作る */
function makeWorkspace() {
  hookCleanup();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kakeibo-mut-"));
  workspaces.add(dir);
  for (const name of fs.readdirSync(ROOT)) {
    if (!COPY_EXT.has(path.extname(name))) continue;
    const from = path.join(ROOT, name);
    if (!fs.statSync(from).isFile()) continue;
    fs.copyFileSync(from, path.join(dir, name));
  }

  /* ci_test.js も通常テストの一部。
     そのテストは GitHub Actions の設定ファイルを読むため、
     一時フォルダにも .github/workflows/ を丸ごと同じ場所へ写す。
     これが無いと、元リポジトリでは全件PASSでも mutation の
     ベースラインだけ ENOENT で落ちる。
     ワークフローは2本（ふだん用・完全検査用）あるので、
     1本だけ写す作りにはしない。 */
  const workflowSrc = path.join(ROOT, ".github", "workflows");
  if (fs.existsSync(workflowSrc)) {
    const workflowDir = path.join(dir, ".github", "workflows");
    fs.mkdirSync(workflowDir, { recursive: true });
    for (const name of fs.readdirSync(workflowSrc)) {
      const from = path.join(workflowSrc, name);
      if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(workflowDir, name));
    }
  }
  return dir;
}

/* テストを1回走らせる。
   合否は **終了コード** だけで決める（0＝全部PASS、非0＝どれか落ちた）。
   表示形式は Node の版で変わるので、合否の判断には使わない。 */
function runTests(dir, testFiles) {
  return new Promise((resolve) => {
    const args = ["--test", "--test-reporter=tap"];
    if (Array.isArray(testFiles) && testFiles.length) args.push(...testFiles);
    const p = spawn("node", args, { cwd: dir, env: { ...process.env, FORCE_COLOR: "0" } });
    let out = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    /* node 自体を起動できなかった場合を「mutation を検出した」と誤判定しない。 */
    p.on("error", (e) => {
      finish({ ok: false, failedCount: null, detectedBy: [],
        executionError: `テスト実行を開始できません: ${e.message}` });
    });
    p.on("close", (code, signal) => {
      if (signal) {
        finish({ ok: false, failedCount: null, detectedBy: [],
          executionError: `テスト実行がシグナル ${signal} で終了しました` });
        return;
      }
      const m = /^[#\u2139]\s*fail\s+(\d+)\s*$/m.exec(out);
      /* 落ちたテストが、どのファイルのものだったかを拾う。
         「この変異は、このテストが捕まえている」という対応表の材料になる。 */
      const files = new Set();
      const re = /^\s*location:\s*'(.+?):\d+:\d+'/gm;
      let g;
      while ((g = re.exec(out)) !== null) files.add(path.basename(g[1]));
      finish({ ok: code === 0, failedCount: m ? Number(m[1]) : null,
        detectedBy: [...files].sort(), executionError: null });
    });
  });
}

/* 変異を1件だけ試す。写しの中だけで壊すので、元のソースは触らない。 */
async function runMutation(m, opts) {
  const o = opts || {};
  const original = fs.readFileSync(path.join(ROOT, m.file), "utf8");
  const hits = original.split(m.from).length - 1;
  if (hits === 0) {
    return { status: "対象なし", failedCount: 0, detectedBy: [],
      note: "変異させる箇所が見つかりません（コードが変わった可能性）" };
  }
  /* run-mutations.js の事前点検を通さず、この関数を直接呼ばれても安全側で止める。
     2か所以上に当たる変異を replace() すると最初の1か所だけ壊し、
     狙った場所とは別のコードを検査して緑になるおそれがある。 */
  if (hits !== 1) {
    return { status: "対象不明", failedCount: 0, detectedBy: [],
      note: `変異させる箇所が ${hits} か所あり、1か所に定まりません` };
  }
  const dir = makeWorkspace();
  try {
    const target = path.join(dir, m.file);
    /* 置き換えは関数で渡す。文字列のままだと、壊した後のコードに
       "$&" のような記号が入っていたとき勝手に別の意味になってしまう。 */
    fs.writeFileSync(target, original.replace(m.from, function () { return m.to; }));

    /* ① まず「この変異を捕まえるはずのテスト」だけを走らせる。
       ここで落ちれば、その時点で「検出」と確定できる。
       落ちたテストは全テストにも含まれているので、
       全部走らせたときの判定と結果は同じになる（甘くならない）。 */
    if (Array.isArray(o.quickFiles) && o.quickFiles.length) {
      const quick = await runTests(dir, o.quickFiles);
      if (quick.executionError) {
        return { status: "実行エラー", failedCount: null, detectedBy: [],
          note: quick.executionError, checkedBy: "早期検出（" + o.quickFiles.join(" / ") + "）" };
      }
      if (!quick.ok) {
        return {
          status: "検出",
          failedCount: quick.failedCount,
          detectedBy: quick.detectedBy,
          checkedBy: "早期検出（" + o.quickFiles.join(" / ") + "）",
        };
      }
    }

    /* ② 早く落ちなかったときだけ、指定のテスト（無指定なら全テスト）で確かめる。
       「見逃し」と判定するのは、必ずこちらを通ったときだけ。 */
    const res = await runTests(dir, o.testFiles);
    if (res.executionError) {
      return { status: "実行エラー", failedCount: null, detectedBy: [],
        note: res.executionError, checkedBy: Array.isArray(o.testFiles) && o.testFiles.length
          ? o.testFiles.join(" / ") : "全テスト" };
    }
    return {
      status: res.ok ? "見逃し" : "検出",
      failedCount: res.failedCount,
      detectedBy: res.detectedBy,
      checkedBy: Array.isArray(o.testFiles) && o.testFiles.length
        ? o.testFiles.join(" / ") : "全テスト",
    };
  } finally {
    removeWorkspace(dir);
  }
}

/* 変異をまとめて試す。何本かを同時に走らせて短くする。
   同時に走っても、それぞれ別の一時フォルダなので混ざらない。 */
async function runMutations(list, opts) {
  const o = opts || {};
  const jobs = Math.max(1, Number(o.jobs) || 1);
  const results = new Array(list.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      const m = list[i];
      const testFiles = o.testFilesFor ? o.testFilesFor(m) : null;
      const quickFiles = o.quickFilesFor ? o.quickFilesFor(m) : null;
      results[i] = { ...m, ...(await runMutation(m, { testFiles, quickFiles })) };
      if (o.onDone) o.onDone(results[i], i, list.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, worker));
  return results;
}

/* 元のソースが、いま在るとおりに保たれているかの確認用 */
function sourcesUntouched(before) {
  return Object.keys(before).every(function (f) {
    return fs.readFileSync(path.join(ROOT, f), "utf8") === before[f];
  });
}
function readSources(files) {
  const out = {};
  files.forEach(function (f) { out[f] = fs.readFileSync(path.join(ROOT, f), "utf8"); });
  return out;
}

module.exports = {
  ROOT, makeWorkspace, removeWorkspace, removeAllWorkspaces,
  runTests, runMutation, runMutations, readSources, sourcesUntouched,
};
