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
   実行： node run-mutations.js
   結果： MUTATION-REPORT.md に書き出す
   ========================================================================= */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const dir = __dirname;

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
    file: "index.html", from: "    state.tx.push(rec);",
    to: "    rec.photoHi=st.photoHi; state.tx.push(rec);" },
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
  { name: "キャッシュの版数を上げ忘れる", guards: "更新が端末に届く",
    file: "sw.js", from: 'const CACHE = "kakeibo-v14";', to: 'const CACHE = "kakeibo-v13";' },
  { name: "設定の保存失敗を巻き戻さない", guards: "設定保存の巻き戻し",
    file: "index.html", from: "    state.settings = before;      // 画面と保存データが食い違わないよう完全に戻す", to: "" },
  { name: "設定の保存失敗でも成功と表示する", guards: "失敗時に成功メッセージを出さない",
    file: "index.html", from: '    toast("設定を保存できませんでした");\n    return;', to: '    toast("保存しました ✓");' },
  { name: "記録削除の失敗を巻き戻さない", guards: "記録削除の巻き戻し",
    file: "index.html", from: "    state.tx = before;            // 消えたように見えて復活する、を防ぐ", to: "" },
  { name: "写真一括削除の失敗を巻き戻さない", guards: "写真削除の巻き戻し",
    file: "index.html", from: "    state.tx = before;            // 写真をすべて元へ戻す", to: "" },
  { name: "写真0枚でも保存を試みる", guards: "写真0枚なら保存しない",
    file: "index.html", from: '  if(!n){ toast("消せる写真はありません"); return; }   // 保存処理そのものを行わない',
    to: '  if(!n){ }' },
  { name: "バックアップ復元の失敗を巻き戻さない", guards: "復元の巻き戻し",
    file: "index.html", from: "      state = before;                               // 保存できないなら元のまま", to: "" },
  { name: "バックアップの確認ダイアログを出さない", guards: "上書き前の確認",
    file: "index.html", from: "    if(!ok){ clear(); return; }                     // キャンセル：何も変えない", to: "" },
  { name: "壊れた記録をそのまま取り込む", guards: "記録の正規化",
    file: "core.js", from: "    if (!validateDateString(tx.date)) return null;            // 日付が不正なら捨てる", to: "" },
  { name: "巨大な金額を制限しない", guards: "金額の上限",
    file: "core.js", from: "    if (amount > AMOUNT_MAX) amount = AMOUNT_MAX;             // 巨大値は上限で止める", to: "" },
  { name: "危険な写真データを通す", guards: "写真は画像のdata URLだけ",
    file: "core.js", from: 'if (typeof tx.photo === "string" && /^data:image\\/[a-z+.-]+;base64,/i.test(tx.photo)) {',
    to: 'if (typeof tx.photo === "string") {' },
  { name: "Tesseractの版を範囲指定に戻す", guards: "完全バージョン固定",
    file: "index.html", from: 'const TESSERACT_VERSION = "5.1.1";', to: 'const TESSERACT_VERSION = "5";' },
  { name: "旧固定費キーを支出カテゴリから外す", guards: "旧データの互換",
    file: "core.js", from: '    { k: "rent",     e: "🏠", n: "住居" },', to: "" },
  { name: "支出集計から一部カテゴリを除外する", guards: "二重計上・計算漏れなし",
    file: "core.js", from: "    const spendTotal = sum(expRecs, function (t) { return t.amount; });",
    to: "    const spendTotal = sum(expRecs.filter(function(t){return t.cat!=='rent';}), function (t) { return t.amount; });" },
  { name: "健康の範囲外を受け入れる", guards: "健康記録の正規化",
    file: "core.js", from: "      if (v < f.min || v > f.max) return;              // 範囲外は捨てる", to: "" },
  { name: "健康の未入力を0として記録する", guards: "未入力は記録しない",
    file: "core.js", from: '      if (raw === "" || raw === null || raw === undefined) return;  // 未入力はその項目を入れない', to: "" },
  { name: "健康の保存失敗を巻き戻さない", guards: "健康保存の巻き戻し",
    file: "index.html", from: "    state.health=before;      // 失敗したら完全に戻す", to: "" },
  { name: "バックアップから健康を外す", guards: "健康もバックアップに含む",
    file: "core.js", from: "      health: normalizeHealth(st.health),\n", to: "" },
  { name: "日記の空を残す", guards: "空の日記は残さない",
    file: "core.js", from: '    if (text.trim() === "" && !photo) return null;', to: "" },
  { name: "日記の上限を外す", guards: "長すぎる本文を切る",
    file: "core.js", from: "    text = text.slice(0, DIARY_MAX);", to: "" },
  { name: "日記の危険な写真を通す", guards: "写真は画像data URLだけ",
    file: "core.js", from: 'if (typeof raw.photo === "string" && /^data:image\\/[a-z+.-]+;base64,/i.test(raw.photo)) {',
    to: 'if (typeof raw.photo === "string") {' },
  { name: "日記の写真を保存前に縮小しない", guards: "容量対策",
    file: "index.html", from: "  if(photo && diaryPhotoPending) photo = await resizeDataUrl(photo, Core.PHOTO_STORE_MAX, 0.6);", to: "" },
  { name: "日記の保存失敗を巻き戻さない", guards: "日記保存の巻き戻し",
    file: "index.html", from: "  state.diary=before;   // それでも駄目なら完全に戻す", to: "" },
  { name: "バックアップから日記を外す", guards: "日記もバックアップに含む",
    file: "core.js", from: "      diary: normalizeDiary(st.diary),", to: "" },
  { name: "その日以外の記録も混ぜる", guards: "カレンダーの日別集約",
    file: "core.js", from: "    const txs = (Array.isArray(st.tx) ? st.tx : []).filter(function (t) { return t && t.date === date; });",
    to: "    const txs = (Array.isArray(st.tx) ? st.tx : []);" },
  { name: "別の月にも印をつける", guards: "月ごとの印つけ",
    file: "core.js", from: "if (t && typeof t.date === \"string\" && t.date.slice(0, 7) === ym) {",
    to: "if (t && typeof t.date === \"string\") {" },
  { name: "のこりのマイナスを0にしない", guards: "使いすぎでものこりは0",
    file: "core.js", from: "    const remain = Math.max(0, income - spend - setAside);   // のこり（マイナスは0扱い）",
    to: "    const remain = income - spend - setAside;" },
  { name: "円グラフの割合を収入基準にしない", guards: "収入を100%とした割合",
    file: "core.js", from: "    const base = income > 0 ? income : (spend + setAside);   // 収入0なら支出+先取りを基準に",
    to: "    const base = spend + setAside;" },
  { name: "内訳を一部カテゴリだけにする", guards: "全カテゴリの内訳",
    file: "core.js", from: "    expRecs.forEach(function (t) {\n      byCat[t.cat] = (byCat[t.cat] || 0) + num(t.amount);\n    });",
    to: "    expRecs.filter(function(t){return t.cat!=='rent';}).forEach(function (t) {\n      byCat[t.cat] = (byCat[t.cat] || 0) + num(t.amount);\n    });" },
  { name: "core.js をキャッシュ優先に戻す", guards: "更新直後に古いcore.jsを出さない",
    file: "sw.js", from: "  if (isAppCode(url)) {", to: "  if (false) {" },
  { name: "sw.js をブラウザのキャッシュ任せにする", guards: "sw.js を必ず取り直す",
    file: "index.html", from: '        updateViaCache: "none"', to: '        updateViaCache: "imports"' },
  { name: "更新確認をやめる", guards: "登録後の update()",
    file: "index.html", from: "      await registration.update();", to: "" },
  { name: "初回登録でも読み直す（余計なリロード）", guards: "初回登録では読み直さない",
    file: "index.html", from: "        if (!hadController) return;  // ← 初回登録。更新ではないので読み直さない", to: "" },
  { name: "制御の有無を見ない（常に更新扱い）", guards: "初回登録と更新の区別",
    file: "index.html", from: "      const hadController = !!navigator.serviceWorker.controller;",
    to: "      const hadController = true;" },
  { name: "再読み込みの印を外す（無限ループ）", guards: "無限再読み込みが起きない",
    file: "index.html", from: "        if (refreshing) return;      // ← 無限に読み直さないための印", to: "" },
  { name: "切り替わっても読み直さない", guards: "新しい版が画面に反映される",
    file: "index.html", from: "        window.location.reload();", to: "" },
  { name: "古いキャッシュを消さない", guards: "古いアプリが残らない",
    file: "sw.js", from: "keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))",
    to: "keys.filter((k) => false).map((k) => caches.delete(k))" },
  { name: "画面をキャッシュ優先に戻す", guards: "画面はネットワーク優先",
    file: "sw.js", from: "  if (isNavigation(e.request, url)) {", to: "  if (false) {" },
  { name: "桁欠けに気づかない", guards: "先頭の桁が欠けた読み取りの補正",
    file: "core.js", from: "    if (/[,.]\\s*$/.test(pre)) return { digits: null, evidence: \"comma\" };",
    to: "    if (false) return { digits: null, evidence: \"comma\" };" },
  { name: "桁欠けの減点をやめる", guards: "合計らしい候補を上に",
    file: "core.js", from: "    if (c.truncated) s -= 40;", to: "    if (c.truncated) s -= 0;" },
  { name: "推測を自動入力する", guards: "推測は必ず選んでもらう",
    file: "core.js", from: '    if (ranked[0].source === "reconstructed") return true;',
    to: "    if (false) return true;" },
  { name: "推測の信頼度に上限を設けない", guards: "直接読めた候補と区別する",
    file: "core.js", from: "      confidence: Math.min(RECON_MAX_CONF, Number(o.confidence) || 0),",
    to: "      confidence: Number(o.confidence) || 0," },
  { name: "補正の対象を広げすぎる（候補が増えすぎる）", guards: "3桁のときだけ補正する",
    file: "core.js", from: "    if (d.amount < 100 || d.amount > 999) return null;        // 3桁のときだけ",
    to: "    if (false) return null;        // 3桁のときだけ" },
  /* ---- 毎月固定の印・選べるカテゴリ ---- */
  { name: "📦 を選べるボタンに戻す", guards: "「その他」は1つだけ",
    file: "core.js", from: "  const EXP_PICK_CATS = EXP_CATS.filter(function (c) { return !c.hidden; });",
    to: "  const EXP_PICK_CATS = EXP_CATS;" },
  { name: "📦 のキーごと消す", guards: "過去の記録が消えない",
    file: "core.js", from: '    { k: "fixother", e: "📦", n: "その他", hidden: true },\n', to: "" },
  { name: "毎月固定の印を見ない", guards: "固定とそれ以外の切り分け",
    file: "core.js", from: '    return !!(t && t.type === "expense" && t.recurring === true);', to: "    return false;" },
  { name: "収入にも固定の印を認める", guards: "印は支出だけ",
    file: "core.js", from: '    return !!(t && t.type === "expense" && t.recurring === true);',
    to: "    return !!(t && t.recurring === true);" },
  { name: "印を文字列でも受け入れる", guards: "印は true のときだけ",
    file: "core.js", from: '    const recurring = type === "expense" && tx.recurring === true;',
    to: '    const recurring = type === "expense" && !!tx.recurring;' },
  { name: "毎月固定も日割りする", guards: "固定は日割りしない",
    file: "core.js", from: "      ? recurringSoFar + Math.round((spotSoFar / elapsed) * days) : 0;",
    to: "      ? Math.round((spentSoFar / elapsed) * days) : 0;" },
  { name: "まだ来ていない日付もペースに混ぜる", guards: "経過日数までで見る",
    file: "core.js", from: "    const spotSoFar = spentSoFar - recurringSoFar;", to: "    const spotSoFar = c.spotSpend;" },
  { name: "連携JSONの固定費を0に戻す", guards: "印のとおりに書き出す",
    file: "core.js", from: "      fixed_cost: c.recurringSpend,", to: "      fixed_cost: 0," },
  { name: "保存のときに印を落とす", guards: "オンで記録したら残る",
    file: "index.html", from: "    if(recurring) rec.recurring=true;   // オフのときはキーごと持たない（保存を軽くする）\n", to: "" },
  { name: "更新のときに印を消さない", guards: "オフに戻したら消える",
    file: "index.html", from: "           if(recurring) t.recurring=true; else delete t.recurring; }",
    to: "           if(recurring) t.recurring=true; }" },
  { name: "収入に切り替えても印を残す", guards: "収入に固定費の印を付けない",
    file: "index.html", from: '  const recurring = st.type==="expense" && st.recurring===true;',
    to: "  const recurring = st.recurring===true;" },
  { name: "スイッチを押しても切り替わらない", guards: "毎月固定の切り替え",
    file: "index.html", from: "sheetState.recurring=!sheetState.recurring;", to: "sheetState.recurring=sheetState.recurring;" },
  /* ---- 詳細分析（分析タブ） ---- */
  { name: "月末の予測を経過日数で割らない", guards: "つかうペースの予測",
    file: "core.js", from: "      ? recurringSoFar + Math.round((spotSoFar / elapsed) * days) : 0;",
    to: "      ? spentSoFar : 0;" },
  { name: "つかってよい額から先取りを引かない", guards: "予算＝収入－先取り",
    file: "core.js", from: "    const budget = c.incomeTotal - c.setAside;", to: "    const budget = c.incomeTotal;" },
  { name: "収入が無くても使いすぎと決めつける", guards: "未記録なら判定しない",
    file: "core.js", from: "      over: c.hasIncome ? forecast - budget : null,", to: "      over: forecast - budget," },
  { name: "つかわなかった日を数えない", guards: "つかった日／つかわなかった日",
    file: "core.js", from: "      if (perDayAmount[d] > 0) spendDays += 1; else noSpend += 1;", to: "      spendDays += 1;" },
  { name: "カテゴリ集計にほかの月を混ぜる", guards: "当月だけを数える",
    file: "core.js", from: "      if (!t || t.type !== \"expense\" || cycleOf(t.date, startDay) !== ym) return;\n      out[t.cat] = (out[t.cat] || 0) + num(t.amount);",
    to: "      if (!t || t.type !== \"expense\") return;\n      out[t.cat] = (out[t.cat] || 0) + num(t.amount);" },
  { name: "曜日の集計にほかの月を混ぜる", guards: "曜日ぐせは当月だけ",
    file: "core.js", from: "      if (!t || t.type !== \"expense\" || cycleOf(t.date, startDay) !== ym) return;\n      if (!validateDateString(t.date)) return;",
    to: "      if (!t || t.type !== \"expense\") return;\n      if (!validateDateString(t.date)) return;" },
  { name: "先月ではなく当月と比べる", guards: "先月との比較",
    file: "core.js", from: "    const prev = categorySpend(txs, shiftYm(ym, -1), startDay);", to: "    const prev = categorySpend(txs, ym, startDay);" },
  { name: "平均を記録の無い月でも割る", guards: "平均は記録のあった月だけ",
    file: "core.js", from: "        avg: activeMonths > 0 ? Math.round(sumPast / activeMonths) : null,",
    to: "        avg: Math.round(sumPast / past.length)," },
  { name: "使いすぎの警告を出さない", guards: "予算を超えそうなら知らせる",
    file: "core.js", from: "      if (pace.over > 0) {", to: "      if (false) {" },
  { name: "先月の記録が無くても「ふえた」と言う", guards: "はじめての項目は増加にしない",
    file: "core.js", from: "    if (up && up.diff > 0 && up.prev > 0) {", to: "    if (up && up.diff > 0) {" },
  { name: "気づきを何件でも出す", guards: "気づきは5件まで",
    file: "core.js", from: "    return out.slice(0, 5);", to: "    return out;" },
  { name: "分析タブを開いても今月のまとめを出す", guards: "タブの切り替え",
    file: "index.html", from: 'sumTab==="analysis" ? renderAnalysis() : renderSummary();', to: "renderSummary();" },
  /* ---- 先月の🔁をまとめて入れる ---- */
  { name: "今月にすでにあっても、もう一度入れる", guards: "二重計上を防ぐ",
    file: "core.js", from: "        already: done[t.cat] === true,", to: "        already: false," },
  { name: "先月ではなく当月を写す", guards: "写すのは先月の記録",
    file: "core.js", from: "      return isRecurring(t) && cycleOf(t.date, startDay) === prevYm;",
    to: "      return isRecurring(t) && cycleOf(t.date, startDay) === ym;" },
  { name: "印の無い支出まで写す", guards: "🔁が付いたものだけ",
    file: "core.js", from: "      return isRecurring(t) && cycleOf(t.date, startDay) === prevYm;",
    to: "      return t.type === \"expense\" && cycleOf(t.date, startDay) === prevYm;" },
  { name: "無い起点日を月末へ寄せない（2/31）", guards: "月末へ丸める",
    file: "core.js", from: "    return Math.min(normalizeCycleStart(startDay), daysInMonth(ym));",
    to: "    return normalizeCycleStart(startDay);" },
  { name: "区切りからはみ出す日付を作る", guards: "写す日付は区切りの中",
    file: "core.js", from: "    if (iso > r.to) iso = r.to;", to: "" },
  { name: "区切りの境目を1日ずらす", guards: "給料日当日はその月から",
    file: "core.js", from: "    return Number(String(iso).slice(8, 10)) >= cycleStartDay(ym, s) ? ym : shiftYm(ym, -1);",
    to: "    return Number(String(iso).slice(8, 10)) > cycleStartDay(ym, s) ? ym : shiftYm(ym, -1);" },
  { name: "集計が区切りを見ずに暦の月で数える", guards: "給料日起点の集計",
    file: "core.js", from: "    const month = all.filter(function (t) { return cycleOf(t.date, s.cycleStart) === ym; });",
    to: "    const month = all.filter(function (t) { return monthOf(t.date) === ym; });" },
  { name: "写した記録に🔁を付けない", guards: "写した先も毎月固定",
    file: "index.html", from: 'state.tx.push({id:uid(),type:"expense",amount:i.amount,cat:i.cat,date:i.date,memo:i.memo,photo:null,recurring:true});',
    to: 'state.tx.push({id:uid(),type:"expense",amount:i.amount,cat:i.cat,date:i.date,memo:i.memo,photo:null});' },
  { name: "確認しないで入れる", guards: "入れる前に確認する",
    file: "index.html", from: "  if(!ok) return;                                   // キャンセル：何も変えない", to: "" },
  { name: "まとめて入れる失敗を巻き戻さない", guards: "失敗したら1件も増やさない",
    file: "index.html", from: "    state.tx = before;            // 途中まで増えた状態を残さない", to: "" },
  /* ---- 今日やることカード ---- */
  { name: "やることを何件でも出す", guards: "多くても2件",
    file: "core.js", from: "    return out.slice(0, TASK_MAX);", to: "    return out;" },
  { name: "給料日より前でも催促する", guards: "給料日を過ぎてから",
    file: "core.js", from: "      if (hint !== null && today >= dateInCycle(ym, startDay, hint)) {", to: "      if (true) {" },
  { name: "はじめての人にも給料を催促する", guards: "履歴が無ければ催促しない",
    file: "core.js", from: "      if (hint !== null && today >= dateInCycle(ym, startDay, hint)) {",
    to: "      if (today >= dateInCycle(ym, startDay, hint === null ? 1 : hint)) {" },
  { name: "1日あいただけで記録を催促する", guards: "とだえ日数のしきい値",
    file: "core.js", from: "      if (gap >= TASK_QUIET_DAYS) {", to: "      if (gap >= 1) {" },
  { name: "まだ来ていない記録も数える", guards: "未来の日付は数えない",
    file: "core.js", from: "      return t && t.type === \"expense\" && validateDateString(t.date) && t.date <= today;",
    to: "      return t && t.type === \"expense\" && validateDateString(t.date);" },
  { name: "続けていない人にも日記を催促する", guards: "習慣の人にだけ",
    file: "core.js", from: "    if (isHabit(st.diary, today) && !(st.diary || {})[today]) {",
    to: "    if (!(st.diary || {})[today]) {" },
  { name: "今日つけた分も習慣の数に入れる", guards: "今日を除いて数える",
    file: "core.js", from: "      if (d >= from && d < today) n += 1;", to: "      if (d >= from && d <= today) n += 1;" },
  { name: "やることが無くてもカードを出す", guards: "空のカードを出さない",
    file: "index.html", from: '  if(!tasks.length && !shown.length) return "";', to: "" },
  { name: "まとめのカードを横1列に戻す", guards: "カードがはみ出さない",
    file: "index.html", from: "  .sumcards{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}",
    to: "  .sumcards{display:flex;gap:10px}" },
  { name: "オフライン時の受け皿を外す", guards: "オフラインでも起動する",
    file: "sw.js", from: "    .catch(() =>\n      caches.match(cacheKey || request).then((hit) => hit || caches.match(request))\n    );",
    to: "    .catch(() => undefined);" },

  /* --- 予定（スケジュール） --- */
  { name: "済んだ予定もホームに出す", guards: "済んだらホームから消える",
    file: "core.js", from: "    return dayPlans(state, today).filter(function (p) { return !p.done; });",
    to: "    return dayPlans(state, today);" },
  { name: "時刻なしの予定を先頭に置く", guards: "時刻の早い順・時刻なしは最後",
    file: "core.js", from: '      const at = a.time || "99:99", bt = b.time || "99:99";',
    to: '      const at = a.time || "00:00", bt = b.time || "00:00";' },
  { name: "1日に入れられる予定の上限を外す", guards: "1日の件数に上限がある",
    file: "core.js", from: "        .slice(0, PLAN_PER_DAY_MAX)", to: "" },
  { name: "中身が空の予定も残す", guards: "空の予定は残さない",
    file: "core.js", from: '    if (text.trim() === "") return null;\n    return {\n      id: String(raw.id',
    to: '    return {\n      id: String(raw.id' },
  { name: "おかしな時刻をそのまま通す", guards: "時刻は24時間の範囲だけ",
    file: "core.js", from: '    if (h < 0 || h > 23 || mi < 0 || mi > 59) return "";', to: "" },
  { name: "保存に失敗しても予定を残す", guards: "保存失敗時の巻き戻し",
    file: "index.html", from: '  if(!save()){ state.plans=before; toast("予定を保存できませんでした"); render(); return; }',
    to: "  save();" },
  { name: "ホームに今日の予定を全部出す", guards: "ホームに出すのは3件まで",
    file: "index.html", from: "  const shown=plans.slice(0, Core.PLAN_SHOW_MAX);", to: "  const shown=plans;" },
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
  "実行方法： `node run-mutations.js`（このファイルが結果を書き出します）",
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
