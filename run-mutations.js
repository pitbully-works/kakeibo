/* =========================================================================
   かけいぼ ― 自作の簡易 mutation test（テストが本当に効いているかを確かめる）
   -------------------------------------------------------------------------
   ※ mutation testing 全体を網羅するものではありません。
      あらゆる変異を機械的に生成するのではなく、壊れると困る重要な
      パターンを手作業で列挙したものです。選んだ範囲の外に穴が残る
      可能性はあります。
   -------------------------------------------------------------------------
   仕組み：
     1. ソースの一部をわざと壊す（変異させる）
     2. その状態で `node --test` を走らせる
     3. テストが落ちれば「その壊れ方を検出できる」＝合格
        テストが通ってしまえば「見逃す」＝不合格（テストの穴）
     4. 元に戻す
   実行： node run-mutations.mjs
   結果： MUTATION-REPORT.md に書き出す
   ========================================================================= */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const dir = path.dirname(fileURLToPath(import.meta.url));

/* 変異の一覧。それぞれ「守りたい振る舞い」に1対1で対応させる。 */
const MUTATIONS = [
  { name: "拡大枠を効かなくする", guards: "枠3種の座標計算",
    file: "core.js", from: '{ key: "wide",  pad: 0.05 }', to: '{ key: "wide",  pad: 0.00 }' },
  { name: "縮小枠を効かなくする", guards: "枠3種の座標計算",
    file: "core.js", from: '{ key: "tight", pad: -0.10 }', to: '{ key: "tight", pad: 0.00 }' },
  { name: "枠のはみ出し防止を外す", guards: "画像範囲を超えない",
    file: "core.js", from: "if (x + w > 1) { w = 1 - x; }", to: "if (false) { w = 1 - x; }" },
  { name: "一致回数の加点を消す", guards: "同じ金額が複数回出たら点数が上がる",
    file: "core.js", from: "s += Math.min(30, Math.max(0, (Number(c.agree) || 1) - 1) * 15);", to: "s += 0;" },
  { name: "桁区切りの検査を外す", guards: "不自然な桁区切りは低評価",
    file: "core.js", from: "if (commaScore(c.raw) === 0) return 0;", to: "if (false) return 0;" },
  { name: "低確信でも自動確定する", guards: "低確信度なら候補選択",
    file: "core.js", from: "if (ranked[0].score < SCORE_CONFIRM) return true;", to: "if (false) return true;" },
  { name: "1位2位の点差を見ない", guards: "僅差なら候補選択",
    file: "core.js", from: "if (ranked.length > 1 && ranked[0].score - ranked[1].score < SCORE_GAP) return true;",
    to: "if (false) return true;" },
  { name: "1回出ただけで打ち切る", guards: "単独の高信頼では打ち切らない",
    file: "core.js", from: "if (votes[k] >= 2) return true;", to: "if (votes[k] >= 1) return true;" },
  { name: "自動反転をやめる", guards: "白抜き文字の反転",
    file: "core.js", from: "if (shouldInvert(data)) invertForOcr(data);", to: "if (false) invertForOcr(data);" },
  { name: "反転を二重に適用する", guards: "二重反転が起きない",
    file: "core.js", from: "if (shouldInvert(data)) invertForOcr(data);",
    to: "if (shouldInvert(data)) { invertForOcr(data); invertForOcr(data); }" },
  { name: "読み取り用の高解像度をやめる", guards: "高解像度画像の利用",
    file: "index.html", from: "const source = st.photoHi || st.photo;", to: "const source = st.photo;" },
  { name: "読み取り後に高解像度を捨てる", guards: "再試行でも高解像度を維持",
    file: "index.html", from: "  }finally{\n    /* 高解像度画像はここでは解放しない。",
    to: "  }finally{\n    releaseOcrImage(st);\n    /* 高解像度画像はここでは解放しない。" },
  { name: "シートを閉じても解放しない", guards: "解放のタイミング",
    file: "index.html", from: "if(!on){ releaseOcrImage(sheetState);", to: "if(!on){ (function(){})(sheetState);" },
  { name: "記録に高解像度画像を混ぜる", guards: "保存データに含めない",
    file: "index.html", from: "state.tx.push({id:uid(),type:st.type,amount,cat:st.cat,date:st.date,memo:st.memo,photo:photo});",
    to: "state.tx.push({id:uid(),type:st.type,amount,cat:st.cat,date:st.date,memo:st.memo,photo:photo,photoHi:st.photoHi});" },
  { name: "候補をタップしたら保存する", guards: "タップだけでは保存しない",
    file: "index.html", from: "sheetState.ocrChoices=null;\n    sheetState.ocrNote=\"金額を入れました。",
    to: "sheetState.ocrChoices=null; save();\n    sheetState.ocrNote=\"金額を入れました。" },
  { name: "保存前の写真縮小をやめる", guards: "容量オーバー対策",
    file: "index.html", from: "if(photo) photo = await resizeDataUrl(photo, Core.PHOTO_STORE_MAX, 0.6);", to: "" },
  { name: "保存の失敗を握りつぶす", guards: "保存の成否判定",
    file: "index.html", from: "catch(e){ lastSaveError=e; return false; }", to: "catch(e){ lastSaveError=e; return true; }" },
  { name: "スクリプト読み込み関数を消す", guards: "呼んでいる関数が実在するか",
    file: "index.html", from: "function loadScript(src){", to: "function loadScript_REMOVED(src){" },
  { name: "保存の成否が出る前に高解像度を解放する", guards: "記録確定時にだけ解放",
    file: "index.html", from: "  let photo = st.photo || null;", to: "  releaseOcrImage(st);\n  let photo = st.photo || null;" },
  { name: "保存に失敗しても高解像度を解放する", guards: "失敗時は維持する",
    file: "index.html", from: "  state.tx = JSON.parse(before);", to: "  releaseOcrImage(st);\n  state.tx = JSON.parse(before);" },
  { name: "写真を外した再保存の成功で解放しない", guards: "再保存成功時にも解放",
    file: "index.html", from: "      releaseOcrImage(st);          // 写真は諦めたが記録は確定した", to: "" },
];

/* テストを1回走らせる。
   合否の判定は **終了コード** で行う（0=全部PASS、非0=どれか落ちた）。
   出力の文字列は Node のバージョンや表示形式（tap / spec）で変わるため、
   合否の判断には使わない。件数は表示用に、両方の形式から拾えるだけ拾う。 */
function run() {
  const r = spawnSync("node", ["--test", "--test-reporter=tap"], {
    cwd: dir, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" },
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const num = (label) => {
    const m = new RegExp("^[#\\u2139]\\s*" + label + "\\s+(\\d+)\\s*$", "m").exec(out);
    return m ? Number(m[1]) : null;
  };
  return {
    ok: r.status === 0,          // ← これが唯一の合否
    status: r.status,
    passed: num("pass"),
    failedCount: num("fail"),
    out,
  };
}

const base = run();
if (!base.ok) {
  console.error("変異させる前からテストが落ちています。先に直してください。");
  console.error(base.out.split("\n").slice(-40).join("\n"));
  process.exit(1);
}

const results = [];
for (const m of MUTATIONS) {
  const file = path.join(dir, m.file);
  const original = fs.readFileSync(file, "utf8");
  if (!original.includes(m.from)) {
    results.push({ ...m, status: "対象なし", failedCount: 0, note: "変異させる箇所が見つかりません（コードが変わった可能性）" });
    continue;
  }
  fs.writeFileSync(file, original.replace(m.from, m.to));
  let res;
  try { res = run(); } finally { fs.writeFileSync(file, original); }
  /* テストが落ちた（＝終了コードが非0）なら、その壊れ方を検出できたということ */
  results.push({ ...m, status: res.ok ? "見逃し" : "検出", failedCount: res.failedCount });
}

const caught = results.filter((r) => r.status === "検出").length;
const missed = results.filter((r) => r.status === "見逃し");
const skipped = results.filter((r) => r.status === "対象なし");

const md = [
  "# mutation test 結果",
  "",
  "テストが本当に効いているかを、ソースをわざと壊して確かめた記録です。",
  "",
  "> **注記**：これは mutation testing 全体を網羅するものではありません。",
  "> あらゆる変異を機械的に生成するのではなく、壊れると困る重要なパターンを",
  "> 手作業で列挙した自作の簡易チェックです。選んだ範囲の外に穴が残る可能性はあります。",
  "実行方法： `node run-mutations.mjs`（このファイルが結果を書き出します）",
  "",
  `- 実行日時： ${new Date().toISOString()}`,
  `- 使用した Node： ${process.version}`,
  `- 変異させる前： ${base.passed === null ? "件数不明（合否は終了コードで判定）" : base.passed + " 件PASS"} ／ 0 件FAIL`,
  `- 変異の数： ${results.length}`,
  `- **検出できた： ${caught} 件**`,
  `- 見逃した： ${missed.length} 件`,
  `- 対象なし： ${skipped.length} 件`,
  "",
  "| # | わざと壊した内容 | 守りたい振る舞い | 対象 | 結果 | 落ちたテスト数 |",
  "| --- | --- | --- | --- | --- | --- |",
  ...results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.guards} | \`${r.file}\` | ${r.status === "検出" ? "✅ 検出" : r.status === "見逃し" ? "❌ 見逃し" : "— 対象なし"} | ${r.failedCount === null ? "-" : r.failedCount} |`),
  "",
  missed.length
    ? "## 見逃し（テストの穴）\n\n" + missed.map((r) => `- ${r.name}（${r.guards}）`).join("\n")
    : "## 見逃しなし\n\nすべての変異を検出できました。",
  "",
].join("\n");

fs.writeFileSync(path.join(dir, "MUTATION-REPORT.md"), md);
console.log(`変異 ${results.length} 件中、検出 ${caught} 件 ／ 見逃し ${missed.length} 件`);
if (missed.length) { missed.forEach((r) => console.log("  見逃し: " + r.name)); process.exit(1); }
