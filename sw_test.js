/* =========================================================================
   かけいぼ ― Service Worker のテスト
   -------------------------------------------------------------------------
   文字列の一致だけでなく、install / activate / fetch を実際に発火させて
   「古いアプリが残らないこと」「オフラインでも起動すること」を確かめる。
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootSW, ORIGIN, swSrc } = require("./boot-sw.cjs");

const INDEX = ORIGIN + "/index.html";
const ROOT = ORIGIN + "/";
const CORE = ORIGIN + "/core.js";
const ICON = ORIGIN + "/icon-192.png";

/* ---------- 1. キャッシュ名 ---------- */
test("キャッシュ名が新しくなっている（kakeibo-v6）", () => {
  assert.match(swSrc, /const CACHE = "kakeibo-v6";/, "版数が上がっていない");
  for (const old of ["kakeibo-v1", "kakeibo-v2", "kakeibo-v3", "kakeibo-v4", "kakeibo-v5"]) {
    assert.equal(swSrc.includes('"' + old + '"'), false, "古い版数が残っている: " + old);
  }
});

test("install で必要な部品が先に取り込まれる", async () => {
  const sw = bootSW({});
  await sw.install();
  const urls = sw.cachedUrls("kakeibo-v6");
  for (const must of [ROOT, INDEX, CORE, ORIGIN + "/manifest.webmanifest", ICON]) {
    assert.ok(urls.includes(must), must + " が取り込まれていない");
  }
});

/* ---------- 2. activate で古いキャッシュを消す ---------- */
test("activate で古いキャッシュを削除する", async () => {
  const sw = bootSW({ oldCaches: ["kakeibo-v1", "kakeibo-v2", "kakeibo-v3", "kakeibo-v4", "kakeibo-v5"] });
  await sw.seedOld();
  assert.equal(sw.cacheNames().length, 5, "前提の古いキャッシュが用意できていない");

  await sw.install();
  await sw.activate();

  const names = sw.cacheNames();
  assert.deepEqual(names, ["kakeibo-v6"], "古いキャッシュが残っている: " + names.join(", "));
});

test("activate 後、すぐに制御を引き継ぐ", async () => {
  const sw = bootSW({});
  await sw.install();
  await sw.activate();
  assert.equal(sw.ctx.self._skipWaiting, true, "skipWaiting していない");
  assert.equal(sw.ctx.self._claimed, true, "clients.claim していない");
});

/* ---------- 3. 画面はネットワーク優先 ---------- */
test("画面（index.html）はネットワークを先に見る", async () => {
  const sw = bootSW({});
  await sw.install();
  await sw.activate();

  const res = await sw.fetchEvent(INDEX, { mode: "navigate" });
  assert.equal(res.from, "network", "キャッシュを先に返している（古い画面が残る原因）");
  assert.ok(sw.fetchLog.includes(INDEX), "ネットワークへ取りに行っていない");
});

test("ルート（/）を開いたときもネットワーク優先", async () => {
  const sw = bootSW({});
  await sw.install();
  const res = await sw.fetchEvent(ROOT, { mode: "navigate" });
  assert.equal(res.from, "network");
});

test("画面を取り直したら、その内容をキャッシュに入れ直す", async () => {
  const sw = bootSW({});
  await sw.install();
  await sw.fetchEvent(INDEX, { mode: "navigate" });
  const stored = await (await sw.caches.open("kakeibo-v6")).match(INDEX);
  assert.equal(stored.body, "network:" + INDEX, "新しい画面がキャッシュに反映されていない");
});

test("index.html を更新すれば、次に開いたとき新しい画面になる", async () => {
  const sw = bootSW({});
  await sw.install();
  await sw.activate();
  // 初回：キャッシュには install 時の内容が入っている
  const cachedFirst = await (await sw.caches.open("kakeibo-v6")).match(INDEX);
  assert.match(cachedFirst.body, /^precached:/);
  // 画面を開くとネットワークの新しい内容になる
  const res = await sw.fetchEvent(INDEX, { mode: "navigate" });
  assert.equal(res.from, "network", "古い画面が返っている");
});

/* ---------- 4. 通信が切れてもオフラインで起動する ---------- */
test("通信できないときは、キャッシュした index.html を返す", async () => {
  const sw = bootSW({});
  await sw.install();
  await sw.activate();

  sw.setOffline(true);
  const res = await sw.fetchEvent(INDEX, { mode: "navigate" });
  assert.ok(res, "オフラインで何も返っていない（アプリが開けない）");
  assert.equal(res.from, "cache", "キャッシュから返していない");
  assert.match(res.body, /index\.html/, "index.html が返っていない");
});

test("オフラインでルート（/）を開いても起動する", async () => {
  const sw = bootSW({});
  await sw.install();
  await sw.activate();
  sw.setOffline(true);
  const res = await sw.fetchEvent(ROOT, { mode: "navigate" });
  assert.ok(res, "オフラインでアプリが開けない");
});

/* ---------- 5. 部品のオフライン利用を壊していない ---------- */
test("オンラインでは core.js も最新版を取りにいく（更新直後に古い版を出さない）", async () => {
  const sw = bootSW({});
  await sw.install();
  await sw.activate();
  const res = await sw.fetchEvent(CORE);
  assert.equal(res.from, "network", "キャッシュの古い core.js を返している");
  assert.ok(sw.fetchLog.includes(CORE), "ネットワークへ取りに行っていない");
});

test("core.js を取り直したら、その内容をキャッシュに入れ直す", async () => {
  const sw = bootSW({});
  await sw.install();
  await sw.fetchEvent(CORE);
  const stored = await (await sw.caches.open("kakeibo-v6")).match(CORE);
  assert.equal(stored.body, "network:" + CORE, "新しい core.js がキャッシュに反映されていない");
});

test("オフラインでは core.js をキャッシュから返す（オフライン起動を壊さない）", async () => {
  const sw = bootSW({});
  await sw.install();
  await sw.activate();

  sw.setOffline(true);
  const res = await sw.fetchEvent(CORE);
  assert.ok(res, "オフラインで core.js が取れない");
  assert.equal(res.from, "cache");
});

test("アイコン・manifest もオフラインで取れる", async () => {
  const sw = bootSW({});
  await sw.install();
  await sw.activate();
  sw.setOffline(true);
  for (const url of [ICON, ORIGIN + "/manifest.webmanifest"]) {
    const res = await sw.fetchEvent(url);
    assert.ok(res, url + " がオフラインで取れない");
    assert.equal(res.from, "cache");
  }
});

test("変わらない部品（アイコン）はキャッシュを返しつつ、裏で取り直す", async () => {
  const sw = bootSW({});
  await sw.install();
  await sw.activate();
  const res = await sw.fetchEvent(ICON);
  assert.equal(res.from, "cache", "アイコンでキャッシュ優先になっていない");
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(sw.fetchLog.includes(ICON), "裏でネットワークへ取りに行っていない（更新されなくなる）");
});

/* ---------- 6. 触ってはいけないもの ---------- */
test("外部（CDN）のリクエストには手を出さない", async () => {
  const sw = bootSW({});
  await sw.install();
  const res = await sw.fetchEvent("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js");
  assert.equal(res, null, "外部の取得に割り込んでいる（OCR部品が取れなくなる恐れ）");
});

test("GET 以外のリクエストには手を出さない", async () => {
  const sw = bootSW({});
  await sw.install();
  const res = await sw.fetchEvent(INDEX, { method: "POST", mode: "navigate" });
  assert.equal(res, null, "GET以外に割り込んでいる");
});

/* =========================================================================
   登録処理（index.html 側）― 更新が届くこと・無限再読み込みしないこと
   ========================================================================= */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const regBlock = /\/\* --- SW-REGISTRATION-START ---[\s\S]*?\/\* --- SW-REGISTRATION-END --- \*\//.exec(html);

/* 登録処理だけを取り出して、偽の navigator で実際に動かす */
async function runRegistration(opts) {
  const o = opts || {};
  const calls = { register: [], update: 0, reload: 0, errors: [] };
  const swListeners = {};
  const sandbox = {
    console: { error: (...a) => calls.errors.push(a.join(" ")) },
    navigator: {
      serviceWorker: {
        // すでに Service Worker に制御されている端末かどうか
        controller: o.controller ? { scriptURL: "./sw.js" } : null,
        register: async (url, options) => {
          calls.register.push({ url, options });
          if (o.failRegister) throw new Error("registration blocked");
          return { update: async () => { calls.update++; } };
        },
        addEventListener: (type, fn) => { (swListeners[type] = swListeners[type] || []).push(fn); },
      },
    },
    window: {},
  };
  sandbox.window.addEventListener = (type, fn) => { (sandbox._load = sandbox._load || []).push({ type, fn }); };
  sandbox.window.location = { reload: () => { calls.reload++; } };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(regBlock[0], ctx, { filename: "index.html:sw-registration" });

  // load イベントを発火し、中の非同期処理が終わるまで待つ
  for (const l of (sandbox._load || [])) if (l.type === "load") await l.fn();
  return { calls, fire: (type) => (swListeners[type] || []).forEach((f) => f()) };
}

test("登録処理が取り出せる（目印が入っている）", () => {
  assert.ok(regBlock, "SW-REGISTRATION の目印が無い");
});

test("sw.js をキャッシュから読ませない（updateViaCache: none）", async () => {
  const { calls } = await runRegistration({ controller: true });
  assert.equal(calls.register.length, 1, "登録していない");
  assert.equal(calls.register[0].url, "./sw.js");
  // 別の実行環境で作られたオブジェクトなので、中身だけを見る
  const opt = calls.register[0].options || {};
  assert.equal(opt.updateViaCache, "none",
    "updateViaCache が指定されていない（Safariが古いsw.jsを使い続ける）");
  assert.deepEqual(Object.keys(opt), ["updateViaCache"], "余計な指定が入っている");
});

test("登録後に update() で更新確認をしている", async () => {
  const { calls } = await runRegistration({ controller: true });
  assert.equal(calls.update, 1, "update() を呼んでいない");
});

test("更新のとき（すでに制御されていた端末）は、画面を1回だけ読み直す", async () => {
  const { calls, fire } = await runRegistration({ controller: true });
  assert.equal(calls.reload, 0, "まだ読み直してはいけない");
  fire("controllerchange");
  assert.equal(calls.reload, 1, "切り替わったのに読み直していない");
});

test("何度切り替わっても、読み直しは1回きり（無限再読み込みしない）", async () => {
  const { calls, fire } = await runRegistration({ controller: true });
  for (let i = 0; i < 10; i++) fire("controllerchange");
  assert.equal(calls.reload, 1, "繰り返し読み直している: " + calls.reload + "回");
});

test("登録に失敗しても、アプリは落ちない", async () => {
  const { calls } = await runRegistration({ failRegister: true, controller: true });
  assert.equal(calls.reload, 0);
  assert.ok(calls.errors.length > 0, "失敗を握りつぶしている");
});

/* ---------- 初回登録では読み直さない ---------- */
test("初めて開いた人（もともと制御されていない）は、読み直さない", async () => {
  const { calls, fire } = await runRegistration({ controller: false });
  assert.equal(calls.register.length, 1, "登録していない");
  assert.equal(calls.update, 1, "update() を呼んでいない");
  fire("controllerchange");            // 初回登録でも発火する
  assert.equal(calls.reload, 0, "初回登録なのに画面を読み直している（余計なリロード）");
});

test("初回登録では、何度発火しても読み直さない", async () => {
  const { calls, fire } = await runRegistration({ controller: false });
  for (let i = 0; i < 10; i++) fire("controllerchange");
  assert.equal(calls.reload, 0, "初回登録で読み直している: " + calls.reload + "回");
});

test("制御の有無で挙動が分かれる（同じ発火でも結果が違う）", async () => {
  const first = await runRegistration({ controller: false });
  const update = await runRegistration({ controller: true });
  first.fire("controllerchange");
  update.fire("controllerchange");
  assert.equal(first.calls.reload, 0, "初回登録で読み直している");
  assert.equal(update.calls.reload, 1, "更新なのに読み直していない");
});

test("制御の有無は、登録する前に控えている", () => {
  const code = regBlock[0];
  const check = code.indexOf("navigator.serviceWorker.controller");
  const register = code.indexOf("navigator.serviceWorker.register");
  assert.ok(check > 0, "制御の有無を見ていない");
  assert.ok(check < register, "登録より後に見ている（登録で状態が変わる可能性がある）");
});

test("初回判定を入れても、更新の仕組みは残っている", () => {
  const code = regBlock[0];
  assert.match(code, /updateViaCache: "none"/, "updateViaCache が消えた");
  assert.match(code, /registration\.update\(\)/, "update() が消えた");
  assert.match(code, /if \(refreshing\) return;/, "無限リロード防止が消えた");
  assert.match(code, /window\.location\.reload\(\)/, "読み直しが消えた");
});
