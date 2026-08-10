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
const COPY_EXT = new Set([".js", ".cjs", ".mjs", ".html", ".json", ".webmanifest"]);

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
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.on("close", (code) => {
      const m = /^[#\u2139]\s*fail\s+(\d+)\s*$/m.exec(out);
      /* 落ちたテストが、どのファイルのものだったかを拾う。
         「この変異は、このテストが捕まえている」という対応表の材料になる。 */
      const files = new Set();
      const re = /^\s*location:\s*'(.+?):\d+:\d+'/gm;
      let g;
      while ((g = re.exec(out)) !== null) files.add(path.basename(g[1]));
      resolve({ ok: code === 0, failedCount: m ? Number(m[1]) : null, detectedBy: [...files].sort() });
    });
  });
}

/* 変異を1件だけ試す。写しの中だけで壊すので、元のソースは触らない。 */
async function runMutation(m, opts) {
  const o = opts || {};
  const original = fs.readFileSync(path.join(ROOT, m.file), "utf8");
  if (!original.includes(m.from)) {
    return { status: "対象なし", failedCount: 0, detectedBy: [],
      note: "変異させる箇所が見つかりません（コードが変わった可能性）" };
  }
  const dir = makeWorkspace();
  try {
    const target = path.join(dir, m.file);
    fs.writeFileSync(target, original.replace(m.from, m.to));
    const res = await runTests(dir, o.testFiles);
    return {
      status: res.ok ? "見逃し" : "検出",
      failedCount: res.failedCount,
      detectedBy: res.detectedBy,
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
      results[i] = { ...m, ...(await runMutation(m, { testFiles: testFiles })) };
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
