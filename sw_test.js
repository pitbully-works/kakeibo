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
test("キャッシュ名が新しくなっている（kakeibo-v4）", () => {
  assert.match(swSrc, /const CACHE = "kakeibo-v4";/, "版数が上がっていない");
  assert.equal(swSrc.includes("kakeibo-v3"), false, "古い版数が残っている");
});

test("install で必要な部品が先に取り込まれる", async () => {
  const sw = bootSW({});
  await sw.install();
  const urls = sw.cachedUrls("kakeibo-v4");
  for (const must of [ROOT, INDEX, CORE, ORIGIN + "/manifest.webmanifest", ICON]) {
    assert.ok(urls.includes(must), must + " が取り込まれていない");
  }
});

/* ---------- 2. activate で古いキャッシュを消す ---------- */
test("activate で古いキャッシュを削除する", async () => {
  const sw = bootSW({ oldCaches: ["kakeibo-v1", "kakeibo-v2", "kakeibo-v3"] });
  await sw.seedOld();
  assert.equal(sw.cacheNames().length, 3, "前提の古いキャッシュが用意できていない");

  await sw.install();
  await sw.activate();

  const names = sw.cacheNames();
  assert.deepEqual(names, ["kakeibo-v4"], "古いキャッシュが残っている: " + names.join(", "));
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
  const stored = await (await sw.caches.open("kakeibo-v4")).match(INDEX);
  assert.equal(stored.body, "network:" + INDEX, "新しい画面がキャッシュに反映されていない");
});

test("index.html を更新すれば、次に開いたとき新しい画面になる", async () => {
  const sw = bootSW({});
  await sw.install();
  await sw.activate();
  // 初回：キャッシュには install 時の内容が入っている
  const cachedFirst = await (await sw.caches.open("kakeibo-v4")).match(INDEX);
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
test("core.js はキャッシュから即座に返る（オフラインでも動く）", async () => {
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

test("部品はキャッシュを返しつつ、裏でネットワークからも取り直す", async () => {
  const sw = bootSW({});
  await sw.install();
  await sw.activate();
  const res = await sw.fetchEvent(CORE);
  assert.equal(res.from, "cache", "部品でキャッシュ優先になっていない");
  // 少し待って、裏の取り直しが走ったことを確認する
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(sw.fetchLog.includes(CORE), "裏でネットワークへ取りに行っていない（更新されなくなる）");
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
