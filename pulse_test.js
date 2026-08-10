/* =========================================================================
   かけいぼ ― 心拍数（カメラ/PPG・β版）のテスト
   -------------------------------------------------------------------------
   ・解析（analyzePulse）は純粋関数なので、合成した波形で答え合わせができる。
   ・保存の可否・履歴の正規化・画面の描画・健康記録への受け渡しまで通しで見る。
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("./core.js");
const { bootApp } = require("./boot-app.cjs");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const appSrc = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].pop()[1];

/* 指を当てているときの見え方を作る。
   g（緑）に心拍の波を乗せ、赤みと明るさは「指で覆えている」値にする。 */
function frames(opts) {
  const o = opts || {};
  const bpm = o.bpm || 72;
  const fps = o.fps || 30;
  const secs = o.secs === undefined ? Core.PULSE_CFG.TOTAL_SEC : o.secs;
  const amp = o.amp === undefined ? 1.2 : o.amp;
  const out = [];
  const n = Math.round(secs * fps);
  for (let i = 0; i < n; i++) {
    const t = (i / fps) * 1000;
    const g = 128 + amp * Math.sin(2 * Math.PI * (bpm / 60) * (t / 1000));
    /* 途中で指が離れる再現：赤みが落ちる */
    const off = o.offFrom !== undefined && t >= o.offFrom * 1000;
    out.push({
      t: t,
      r: off ? 60 : 200, g: g, b: 60,
      bright: off ? 60 : 129,
      sd: off ? 60 : 5,
      redRatio: off ? 0.9 : 1.5 });
  }
  return out;
}

/* =========================================================================
   1. 解析（心拍数の求め方）
   ========================================================================= */
test("合成した波形から、その心拍数をそのまま取り出せる", () => {
  for (const bpm of [48, 60, 72, 95, 120, 150]) {
    const r = Core.analyzePulse(frames({ bpm: bpm }));
    assert.equal(r.ok, true, `${bpm}bpm で確定できていない: ${r.reason}`);
    assert.ok(Math.abs(r.bpm - bpm) <= 1, `${bpm}bpm のはずが ${r.bpm}bpm`);
  }
});

test("窓の数は、測定のわずかな長さの差で変わらない（いつも9窓）", () => {
  /* 60.0秒ちょうど・60.5秒・59.2秒。どれも 9窓で数えられること。 */
  for (const secs of [60, 60.5, 59.2]) {
    const r = Core.analyzePulse(frames({ bpm: 72, secs: secs }));
    assert.equal(r.ok, true, `${secs}秒で確定できていない: ${r.reason}`);
    assert.equal(r.wins, Core.PULSE_WINDOWS, `${secs}秒で窓の数が ${r.wins} になっている`);
  }
});

test("最後の窓も使える（移動平均の末尾が0のまま残っていない）", () => {
  const r = Core.analyzePulse(frames({ bpm: 72 }));
  assert.equal(r.kept, Core.PULSE_WINDOWS, "きれいな波形なのに採用できない窓がある");
});

test("準備時間（最初の10秒）は計算に使わない", () => {
  /* 最初の10秒だけ別の速さにしても、結果は後半の心拍数になること */
  const head = frames({ bpm: 150, secs: Core.PULSE_CFG.PREP_SEC });
  const tail = frames({ bpm: 66 }).filter((s) => s.t >= Core.PULSE_CFG.PREP_SEC * 1000);
  const r = Core.analyzePulse(head.concat(tail));
  assert.equal(r.ok, true, r.reason);
  assert.ok(Math.abs(r.bpm - 66) <= 1, `準備時間が混ざっている: ${r.bpm}bpm`);
  /* fps は「準備時間を除いた50秒」で数える。準備時間のコマまで数えると
     30fps が 36fps に化けて、保存の可否（25fps以上）の判定が甘くなる。 */
  const plain = Core.analyzePulse(frames({ bpm: 72, fps: 30 }));
  assert.ok(Math.abs(plain.fps - 30) <= 1, `fps に準備時間のコマが混ざっている: ${plain.fps}`);
});

test("最後まで測れていない測定は確定しない", () => {
  const r = Core.analyzePulse(frames({ bpm: 72, secs: 40 }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /最後まで/);
});

test("コマ数が足りない測定は確定しない", () => {
  const r = Core.analyzePulse(frames({ bpm: 72, fps: 8 }));
  assert.equal(r.ok, false);
  assert.ok(r.fps < Core.PULSE_CFG.minFps);
});

test("途中で指が離れた測定は確定しない", () => {
  const r = Core.analyzePulse(frames({ bpm: 72, offFrom: 25 }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /指が外れた|明るさ/);
});

test("脈の波がほとんど無い測定は確定しない", () => {
  const r = Core.analyzePulse(frames({ bpm: 72, amp: 0.0005 }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /信号が弱/);
});

test("確定できなかったときも、戻り値の形は同じ（画面が分岐で困らない）", () => {
  const r = Core.analyzePulse([]);
  for (const k of ["ok", "reason", "bpm", "stars", "quality", "kept", "wins", "spread", "fps", "badRate"]) {
    assert.ok(k in r, `${k} が入っていない`);
  }
  assert.equal(r.ok, false);
  assert.equal(r.bpm, null);
});

test("1コマの良し悪しの判定は、赤み・明るさ・ばらつきを見る", () => {
  assert.equal(Core.pulseFrameOk({ redRatio: 1.5, bright: 129, sd: 5 }), true);
  assert.equal(Core.pulseFrameOk({ redRatio: 1.0, bright: 129, sd: 5 }), false, "赤みが足りないのに通している");
  assert.equal(Core.pulseFrameOk({ redRatio: 1.5, bright: 3, sd: 5 }), false, "暗すぎるのに通している");
  assert.equal(Core.pulseFrameOk({ redRatio: 1.5, bright: 250, sd: 5 }), false, "明るすぎるのに通している");
  assert.equal(Core.pulseFrameOk({ redRatio: 1.5, bright: 129, sd: 60 }), false, "ばらつきが大きいのに通している");
  assert.equal(Core.pulseFrameOk(null), false);
});

/* =========================================================================
   2. 測定品質（★5段階）
   ========================================================================= */
test("測定品質は★1〜5で、良いほど数が多い", () => {
  assert.equal(Core.pulseStars(9, 9, 1, 0.9), 5);
  assert.equal(Core.pulseStars(8, 9, 3, 0.75), 4);
  assert.equal(Core.pulseStars(6, 9, 6, 0.6), 3);
  assert.equal(Core.pulseStars(5, 9, 9, 0.45), 2);
  assert.equal(Core.pulseStars(2, 9, 20, 0.2), 1);
  assert.equal(Core.pulseStars(0, 0, 0, 0), 1, "窓が1つも無いのに★が付いている");
});

test("測定品質の言い方が決まっている（「信頼度」とは呼ばない）", () => {
  assert.equal(Core.pulseQualityLabel(5), "とても良好");
  assert.equal(Core.pulseQualityLabel(4), "良好");
  assert.equal(Core.pulseQualityLabel(3), "普通");
  assert.equal(Core.pulseQualityLabel(2), "やや不安定");
  assert.equal(Core.pulseQualityLabel(1), "再測定推奨");
  assert.equal(Core.pulseStarText(3), "★★★☆☆");
  assert.equal(Core.pulseStarText(5), "★★★★★");
});

test("画面のどこにも「信頼度」という言い方が残っていない", () => {
  const pulseUi = appSrc.slice(appSrc.indexOf("心拍数（β版）"));
  assert.equal(pulseUi.includes("信頼度"), false, "「信頼度」が残っている");
  assert.match(appSrc, /測定品質/, "「測定品質」の表示が無い");
});

/* =========================================================================
   3. 保存してよいかの判定
   ========================================================================= */
const okResult = { ok: true, bpm: 72, stars: 4, quality: 0.8, kept: 8, wins: 9, spread: 2, fps: 30, badRate: 0.02 };

test("条件を満たしていれば保存できる", () => {
  assert.equal(Core.pulseSaveCheck(okResult).ok, true);
});

test("ライトが点かなくても、品質さえ満たしていれば保存できる", () => {
  /* ライトを制御できない端末・ブラウザでも測定を続けられるようにするため、
     ライトのON/OFFは保存の条件にしない（記録には残す）。 */
  assert.equal(Core.pulseSaveCheck(okResult).ok, true);
  assert.equal("needTorch" in Core.PULSE_SAVE, false, "ライト必須の条件が残っている");
  assert.equal(Core.pulseSaveCheck.length, 1, "保存判定がライトの情報を受け取っている");
});

test("採用窓が足りなければ保存しない", () => {
  const r = Core.pulseSaveCheck(Object.assign({}, okResult, { kept: 5 }));
  assert.equal(r.ok, false);
  assert.match(r.detail, /採用窓/);
});

test("fpsが足りなければ保存しない", () => {
  const r = Core.pulseSaveCheck(Object.assign({}, okResult, { fps: 24 }));
  assert.equal(r.ok, false);
  assert.match(r.detail, /fps/);
  assert.equal(Core.pulseSaveCheck(Object.assign({}, okResult, { fps: 25 })).ok, true, "ちょうど25fpsを弾いている");
});

test("測定品質が★3未満なら保存しない", () => {
  const r = Core.pulseSaveCheck(Object.assign({}, okResult, { stars: 2 }));
  assert.equal(r.ok, false);
  assert.match(r.detail, /測定品質/);
  assert.equal(Core.pulseSaveCheck(Object.assign({}, okResult, { stars: 3 })).ok, true, "ちょうど★3を弾いている");
});

test("途中で指が離れていたら保存しない", () => {
  const r = Core.pulseSaveCheck(Object.assign({}, okResult, { badRate: 0.5 }));
  assert.equal(r.ok, false);
  assert.match(r.detail, /指が離れ/);
});

test("心拍数が35〜200bpmの外なら保存しない", () => {
  assert.equal(Core.pulseSaveCheck(Object.assign({}, okResult, { bpm: 34 })).ok, false);
  assert.equal(Core.pulseSaveCheck(Object.assign({}, okResult, { bpm: 201 })).ok, false);
  assert.equal(Core.pulseSaveCheck(Object.assign({}, okResult, { bpm: 35 })).ok, true);
  assert.equal(Core.pulseSaveCheck(Object.assign({}, okResult, { bpm: 200 })).ok, true);
});

test("確定できなかった測定は保存しない", () => {
  assert.equal(Core.pulseSaveCheck({ ok: false, reason: "だめ" }).ok, false);
  assert.equal(Core.pulseSaveCheck(null).ok, false);
});

test("保存できないときに出す文言は、いつも同じ1つ", () => {
  assert.equal(Core.PULSE_FAIL_MSG, "測定品質が不足しています。安静にして再測定してください。");
  const r = Core.pulseSaveCheck(Object.assign({}, okResult, { fps: 10 }));
  assert.equal(r.msg, Core.PULSE_FAIL_MSG);
  assert.match(appSrc, /PULSE_FAIL_MSG|pulseCheck\.msg/, "画面が決まった文言を出していない");
});

/* =========================================================================
   4. 履歴の正規化・並び・上限
   ========================================================================= */
const rec = (over) => Object.assign({
  id: "a1", date: "2026-08-03", time: "21:20", ts: "2026-08-03 21:20:31",
  bpm: 72, stars: 4, quality: 0.8, kept: 8, wins: 9, spread: 2, fps: 30,
  cond: "rest", device: "iPhone 18.0 390x844", cam: "640×480", torch: true }, over || {});

test("正常な1件は、そのまま整えて受け入れる", () => {
  const r = Core.normalizePulseEntry(rec());
  assert.equal(r.bpm, 72);
  assert.equal(r.stars, 4);
  assert.equal(r.kept, 8);
  assert.equal(r.torch, true);
  assert.equal(r.cond, "rest");
});

test("心拍数が範囲外・日付が不正な1件は捨てる", () => {
  assert.equal(Core.normalizePulseEntry(rec({ bpm: 34 })), null);
  assert.equal(Core.normalizePulseEntry(rec({ bpm: 201 })), null);
  assert.equal(Core.normalizePulseEntry(rec({ bpm: "abc" })), null);
  assert.equal(Core.normalizePulseEntry(rec({ date: "2026-02-31" })), null, "存在しない日付を受け入れている");
  assert.equal(Core.normalizePulseEntry(rec({ date: "" })), null);
  assert.equal(Core.normalizePulseEntry(null), null);
});

test("知らない測定状態は「安静時」へ、ライトは真偽値だけにする", () => {
  assert.equal(Core.normalizePulseEntry(rec({ cond: "ほげ" })).cond, "rest");
  assert.equal(Core.normalizePulseEntry(rec({ torch: "yes" })).torch, false);
  assert.equal(Core.normalizePulseEntry(rec({ time: "99:99" })).time, "00:00");
});

test("履歴は日時の古い順にそろえ、idの重複には新しいidを振る", () => {
  const list = Core.normalizePulseList([
    rec({ id: "x", date: "2026-08-03", time: "21:20", bpm: 72 }),
    rec({ id: "x", date: "2026-08-01", time: "07:00", bpm: 60 }),
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0].bpm, 60, "古い順に並んでいない");
  assert.notEqual(list[0].id, list[1].id, "idが重複したまま");
});

test("履歴の件数には上限があり、古いものから落とす", () => {
  const many = [];
  for (let i = 0; i < Core.PULSE_MAX + 20; i++) {
    many.push(rec({ id: "i" + i, bpm: 40 + (i % 100), time: "00:00" }));
  }
  const list = Core.normalizePulseList(many);
  assert.equal(list.length, Core.PULSE_MAX);
});

test("配列でないものを渡しても落ちない", () => {
  assert.deepEqual(Core.normalizePulseList(null), []);
  assert.deepEqual(Core.normalizePulseList({ a: 1 }), []);
  assert.equal(Core.pulseLatest([]), null);
});

/* =========================================================================
   5. グラフ・CSV
   ========================================================================= */
test("グラフは1日1点。同じ日に何度か測ったらその日の平均", () => {
  const list = Core.normalizePulseList([
    rec({ id: "1", date: "2026-08-01", time: "07:00", bpm: 60 }),
    rec({ id: "2", date: "2026-08-03", time: "07:00", bpm: 70 }),
    rec({ id: "3", date: "2026-08-03", time: "21:00", bpm: 80 }),
  ]);
  const s = Core.pulseSeries(list);
  assert.deepEqual(s, [{ date: "2026-08-01", value: 60 }, { date: "2026-08-03", value: 75 }]);
});

test("グラフは期間で絞れる（日／週／月の切り替え用）", () => {
  const list = Core.normalizePulseList([
    rec({ id: "1", date: "2026-07-01", bpm: 60 }),
    rec({ id: "2", date: "2026-08-03", bpm: 70 }),
  ]);
  assert.equal(Core.pulseSeries(list, "2026-08-01", "2026-08-31").length, 1);
  assert.equal(Core.pulseSeries(list, "2026-01-01", "2026-12-31").length, 2);
});

test("CSVに、保存している項目がすべて出る", () => {
  const csv = Core.pulseCsv(Core.normalizePulseList([rec()]));
  const head = csv.split("\n")[0];
  for (const col of ["日時", "心拍数", "測定品質", "採用窓", "ばらつき", "fps", "測定状態", "使用端末", "カメラ解像度", "ライト"]) {
    assert.ok(head.includes(col), `CSVの見出しに「${col}」が無い`);
  }
  const line = csv.split("\n")[1];
  assert.ok(line.includes("72"), "心拍数が出ていない");
  assert.ok(line.includes("8/9"), "採用窓が出ていない");
  assert.ok(line.includes("安静時"), "測定状態が出ていない");
  assert.ok(line.includes("640×480"), "カメラ解像度が出ていない");
  assert.ok(line.includes("ON"), "ライトの状態が出ていない");
});

test("CSVの中の引用符でも列がずれない", () => {
  const csv = Core.pulseCsv(Core.normalizePulseList([rec({ device: 'iPhone "18"' })]));
  assert.ok(csv.includes('""18""'), "引用符をエスケープしていない");
});

/* =========================================================================
   6. 画面（最小DOMで実際に描く）
   ========================================================================= */
const someState = () => ({
  settings: {}, tx: [], health: {},
  pulse: [rec({ id: "p1", date: "2026-08-03", time: "21:20", bpm: 72 })] });

test("心拍の画面が白画面にならず、心拍数・日時・測定品質が出る", () => {
  const app = bootApp({ state: someState() });
  const out = app.run(`view="pulse"; render(); document.getElementById("app").innerHTML`);
  assert.ok(out.length > 200, "画面が空");
  assert.match(out, /72/, "心拍数が出ていない");
  assert.match(out, /8\/3 21:20/, "測定日時が出ていない");
  assert.match(out, /★★★★☆/, "測定品質の★が出ていない");
  assert.match(out, /良好/, "測定品質の言葉が出ていない");
});

test("通常の一覧に、採用窓やfpsなどの細かい数字は出さない", () => {
  const app = bootApp({ state: someState() });
  const closed = app.run(`view="pulse"; pulseOpenId=null; render(); document.getElementById("app").innerHTML`);
  assert.equal(closed.includes("採用窓"), false, "たたんだ状態で採用窓が出ている");
  assert.equal(closed.includes("カメラ解像度"), false, "たたんだ状態でカメラ情報が出ている");
});

test("詳細を開くと、採用窓・ばらつき・fps・カメラ・端末が見られる", () => {
  const app = bootApp({ state: someState() });
  const open = app.run(`view="pulse"; pulseOpenId="p1"; render(); document.getElementById("app").innerHTML`);
  for (const k of ["採用窓", "ばらつき", "fps", "カメラ解像度", "使用端末", "ライト", "測定状態"]) {
    assert.ok(open.includes(k), `詳細に「${k}」が無い`);
  }
  assert.match(open, /8 \/ 9/, "採用窓の数が出ていない");
});

test("免責（参考値であること）を必ず出す", () => {
  const app = bootApp({ state: someState() });
  const p = app.run(`view="pulse"; render(); document.getElementById("app").innerHTML`);
  const h = app.run(`view="health"; render(); document.getElementById("app").innerHTML`);
  const msg = "この測定値は健康管理の参考値です。診断・治療目的では使用できません。";
  assert.ok(p.includes(msg), "心拍の画面に免責が無い");
  assert.ok(h.includes(msg), "健康ページに免責が無い");
});

test("健康ページに心拍数カードと、カメラ測定の推移グラフが出る", () => {
  const app = bootApp({ state: someState() });
  const out = app.run(`view="health"; render(); document.getElementById("app").innerHTML`);
  assert.match(out, /心拍数（カメラ測定）/, "心拍数カードが無い");
  assert.match(out, /心拍数の推移（カメラ測定・bpm）/, "カメラ測定のグラフが無い");
  assert.match(out, /心拍数の推移（手入力・bpm）/, "手入力のグラフが消えている");
  assert.match(out, /data-act="pulse-go"/, "測定開始ボタンが無い");
});

test("健康ページのグラフは、日／週／月で切り替えられる", () => {
  const app = bootApp({ state: someState() });
  const out = app.run(`view="health"; render(); document.getElementById("app").innerHTML`);
  for (const r of ["day", "week", "month"]) {
    assert.ok(out.includes(`data-range="${r}"`), `${r} の切り替えが無い`);
  }
  assert.match(appSrc, /pulseSeries\(state\.pulse,from,today\)/, "グラフが期間の指定を使っていない");
});

test("下のタブに心拍があり、せっていは右上へ移した", () => {
  assert.match(html, /<button data-nav="pulse">/, "下のタブに心拍が無い");
  assert.equal(/<button data-nav="settings">/.test(html), false, "下のタブにせっていが残っている");
  assert.match(html, /id="gearbtn"[^>]*data-go="settings"/, "右上のせっていボタンが無い");
  assert.match(html, /\.gearbtn\{position:fixed/, "右上に固定されていない");
  assert.match(html, /\.screen\{padding:52px/, "右上のボタンと重ならない余白が無い");
});

/* =========================================================================
   7. 保存・編集・削除・健康記録への受け渡し
   ========================================================================= */
test("測定できたら履歴に残り、いちばん新しいものが最新になる", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {}, pulse: [] } });
  const saved = app.run(`
    pulseCond="rest";
    pulseEnv={cam:"640×480", torch:false, device:"testPhone"};
    pulseSaveRecord({bpm:66, stars:4, quality:0.8, kept:8, wins:9, spread:2, fps:30});
  `);
  assert.equal(saved, true, "保存できていない");
  assert.equal(app.run(`state.pulse.length`), 1);
  assert.equal(app.run(`Core.pulseLatest(state.pulse).bpm`), 66);
  assert.equal(app.run(`Core.pulseLatest(state.pulse).torch`), false, "ライトOFFが残っていない");
});

test("保存できなかったら、履歴は1件も増やさない", () => {
  const app = bootApp({ state: { settings: {}, tx: [], health: {}, pulse: [] }, storageFull: true });
  const saved = app.run(`
    pulseEnv={cam:"640×480", torch:true, device:"testPhone"};
    pulseSaveRecord({bpm:66, stars:4, quality:0.8, kept:8, wins:9, spread:2, fps:30});
  `);
  assert.equal(saved, false);
  assert.equal(app.run(`state.pulse.length`), 0, "保存に失敗したのに増えている");
});

test("履歴を削除できる（保存に失敗したら元へ戻す）", () => {
  const app = bootApp({ state: someState() });
  app.run(`confirm=()=>true; pulseDelete("p1");`);
  assert.equal(app.run(`state.pulse.length`), 0);

  const app2 = bootApp({ state: someState(), storageFull: true });
  app2.run(`confirm=()=>true; pulseDelete("p1");`);
  assert.equal(app2.run(`state.pulse.length`), 1, "消せなかったのに消えている");
});

test("履歴の心拍数と測定状態を直せる。範囲外は受け付けない", () => {
  const app = bootApp({ state: someState() });
  app.run(`
    view="pulse"; pulseEditId="p1"; render();
    document.getElementById("pe-bpm").value="80";
    document.getElementById("pe-cond").value="post";
    pulseEditSave("p1");
  `);
  assert.equal(app.run(`state.pulse[0].bpm`), 80);
  assert.equal(app.run(`state.pulse[0].cond`), "post");
  assert.equal(app.run(`state.pulse[0].id`), "p1", "idが変わっている");

  app.run(`
    view="pulse"; pulseEditId="p1"; render();
    document.getElementById("pe-bpm").value="999";
    pulseEditSave("p1");
  `);
  assert.equal(app.run(`state.pulse[0].bpm`), 80, "範囲外を受け入れている");
});

test("測った心拍数を、健康記録へそのまま入れられる（1日1件・上書き）", () => {
  const app = bootApp({ state: someState() });
  app.run(`pulseToHealth(72);`);
  assert.equal(app.run(`state.health[todayISO()].pulse`), 72);
  app.run(`pulseToHealth(80);`);
  assert.equal(app.run(`state.health[todayISO()].pulse`), 80, "上書きされていない");
});

test("健康記録へ入れるとき、体重や血圧は消さない", () => {
  const app = bootApp({ state: someState() });
  app.run(`view="health"; render();
    document.getElementById("h-weight").value="62.5";
    document.getElementById("h-bphigh").value="120";
    document.getElementById("h-bplow").value="78";
    saveHealth(); pulseToHealth(72);`);
  const rec2 = app.run(`state.health[todayISO()]`);
  assert.equal(rec2.weight, 62.5, "体重が消えている");
  assert.equal(rec2.bpHigh, 120, "血圧が消えている");
  assert.equal(rec2.pulse, 72);
});

test("健康記録へ入れられなかったら、元へ完全に戻す", () => {
  const app = bootApp({ state: someState(), storageFull: true });
  app.run(`pulseToHealth(72);`);
  assert.equal(app.run(`JSON.stringify(state.health)`), "{}", "保存に失敗したのに残っている");
});

test("結果画面と詳細に、健康記録へ入れるボタンがある", () => {
  const app = bootApp({ state: someState() });
  const open = app.run(`view="pulse"; pulseOpenId="p1"; render(); document.getElementById("app").innerHTML`);
  assert.match(open, /data-act="pulse-to-health"/, "健康記録へ入れるボタンが無い");
  assert.match(open, /72bpm を健康記録に入れる/, "ボタンの文言が無い");
});

/* =========================================================================
   8. バックアップ
   ========================================================================= */
test("バックアップに心拍数の履歴が入り、読み込みで戻る", () => {
  const st = { settings: {}, tx: [], health: {}, pulse: [rec({ id: "p1" })] };
  const b = Core.buildBackup(st);
  assert.equal(b.pulse.length, 1);
  const back = Core.normalizeBackup(JSON.parse(JSON.stringify(b)));
  assert.equal(back.pulse.length, 1);
  assert.equal(back.pulse[0].bpm, 72);
});

test("心拍数が入っていない古いバックアップも読める", () => {
  const back = Core.normalizeBackup({ settings: {}, tx: [] });
  assert.deepEqual(back.pulse, []);
});

test("バックアップの中の壊れた心拍数は取り込まない", () => {
  const back = Core.normalizeBackup({ settings: {}, tx: [], pulse: [rec({ bpm: 999 }), rec({ id: "ok" })] });
  assert.equal(back.pulse.length, 1);
});

test("復元のときに心拍数の履歴も入れ替える（入れ忘れると古い履歴が残る）", () => {
  assert.match(appSrc, /state\.pulse = restored\.pulse/, "復元処理に心拍数が入っていない");
});

/* =========================================================================
   9. カメラの後始末（点けっぱなしにしない）
   ========================================================================= */
test("止めるときは、ライトを消してカメラも止める", () => {
  const src = appSrc.slice(appSrc.indexOf("function pulseStopAll"));
  assert.match(src, /torch:false/, "ライトを消していない");
  assert.match(src, /getTracks\(\)\.forEach\(t=>t\.stop\(\)\)/, "カメラを止めていない");
  assert.match(src, /clearInterval\(pTickId\)/, "時計を止めていない");
});

test("画面を離れる・別の画面へ移るときも必ず止める", () => {
  /* 止める条件は pRunning だけでは足りない。
     pRunning はカメラの許可が下りたあとに立つので、許可を待っている最中は
     false のまま。その隙に画面を移られると止め損ね、あとから届いた映像で
     カメラとライトが点いたまま残る。待機中（pStream / pGen!==pStopGen）も見る。 */
  const stopCond = String.raw`\(pRunning \|\| pStream \|\| pGen!==pStopGen\)`;
  assert.match(appSrc, new RegExp(`if\\(view!=="pulse" && ${stopCond}\\) pulseStopAll\\(\\);`),
    "画面を移ったときに止めていない");
  assert.match(appSrc, new RegExp(`if\\(document\\.hidden\\)\\{ if${stopCond}`),
    "画面を離れたときに止めていない");
  assert.match(appSrc, new RegExp(`"pagehide",\\(\\)=>\\{ if${stopCond}`),
    "閉じるときに止めていない");
  assert.match(appSrc, /"pagehide"/, "閉じるときに止めていない");
});

test("カメラの許可を待っている間に離れたら、届いた映像はその場で捨てる", () => {
  /* 世代トークンで守る。許可待ちの最中に中止・画面移動があったら、
     あとから解決した stream を state に入れず、その場で止める。 */
  assert.match(appSrc, /const gen=\+\+pGen;/, "世代トークンを取っていない");
  assert.match(appSrc, /if\(gen!==pGen \|\| view!=="pulse"\)\{/, "届いた映像を捨てる判定が無い");
  assert.match(appSrc, /stream\.getTracks\(\)\.forEach\(t=>t\.stop\(\)\);/, "捨てる側で止めていない");
  assert.match(appSrc, /pGen\+\+;\s*\/\/ 許可を待っている最中の測定も/, "停止時に世代を進めていない");
});

test("映像・画像を保存も送信もしない", () => {
  const src = appSrc.slice(appSrc.indexOf("心拍数（β版）"));
  assert.equal(/fetch\(/.test(src), false, "通信している");
  assert.equal(/XMLHttpRequest/.test(src), false, "通信している");
  assert.equal(/toDataURL/.test(src), false, "画像を取り出している");
  /* 保存するのは数値だけ。normalizePulseEntry が受け付ける項目に画像は無い。 */
  const saved = Core.normalizePulseEntry(rec({ photo: "data:image/png;base64,AAAA" }));
  assert.equal("photo" in saved, false, "画像が記録に混ざっている");
});

/* =========================================================================
   カメラの許可（iPhoneのホーム画面アプリで確認が出ない問題）
   -------------------------------------------------------------------------
   ホーム画面に追加したアプリでは「ボタンを押した直後」でないと許可の確認が
   出ず、そのまま NotAllowedError になる。画面を描き直してから頼むと間に合わ
   ないので、カメラを頼むのが先であることを固定する。
   ========================================================================= */
test("カメラの許可は、画面を描き直すより先に求める", async () => {
  const app = bootApp({});
  app.run(`
    __order = [];
    render = function(){ __order.push("render"); };
    navigator.mediaDevices = { getUserMedia: function(){
      __order.push("camera");
      const e = new Error("denied"); e.name = "NotAllowedError";
      return Promise.reject(e);
    } };
  `);
  await app.run(`pulseStart()`);
  assert.equal(app.run(`__order[0]`), "camera");
});

test("ホーム画面のアプリで断られたら、Safariの設定まで案内する", async () => {
  const app = bootApp({});
  app.run(`
    render = function(){};
    navigator.standalone = true;
    navigator.mediaDevices = { getUserMedia: function(){
      const e = new Error("denied"); e.name = "NotAllowedError";
      return Promise.reject(e);
    } };
  `);
  await app.run(`pulseStart()`);
  const msg = app.run(`pulseErr`);
  assert.match(msg, /開くたびに確認/);
  assert.match(msg, /Safari/);
});

test("ほかのアプリがカメラを使っているときは、その旨を伝える", async () => {
  const app = bootApp({});
  app.run(`
    render = function(){};
    navigator.mediaDevices = { getUserMedia: function(){
      const e = new Error("busy"); e.name = "NotReadableError";
      return Promise.reject(e);
    } };
  `);
  await app.run(`pulseStart()`);
  assert.match(app.run(`pulseErr`), /ほかのアプリ/);
});
