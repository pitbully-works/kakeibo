/* =============================================================================
   かけいぼ ― service worker
   -----------------------------------------------------------------------------
   方針を2つに分ける。

   ① 画面（index.html / ナビゲーション）＝ ネットワーク優先
      キャッシュを先に返すと、index.html や core.js だけを更新したとき、
      すでにアプリを開いたことのある端末に古い画面が残り続ける。
      そこで画面は必ず最新を取りにいき、**通信に失敗したときだけ**
      キャッシュした index.html を返す（オフライン起動は維持）。

   ② アプリのコード（core.js などの .js / .html）＝ ネットワーク優先
      ここもキャッシュ優先にすると、更新した直後の1回だけ古い core.js が
      読み込まれてしまう。画面と足並みを揃えて必ず最新を取りにいく。

   ③ 変わらない部品（アイコン・manifest）＝ キャッシュ優先
      表示を速くするため。裏でネットワークからも取り直して次回に備える。

   CACHE の名前を変えると、activate で古いキャッシュを丸ごと捨てる。
   アプリを更新したら、この版数を必ず上げること。
   ============================================================================= */
const CACHE = "kakeibo-v52";
const INDEX = "./index.html";
const ASSETS = [
  "./",
  "./index.html",
  "./core.js",
  "./manifest.webmanifest",
  "./manifest-en.webmanifest",
  "./android-chrome-192x192.png",
  "./android-chrome-512x512.png",
  /* アイコンも先に入れておく。入れておかないと、
     初回にオフラインで開いたときだけアイコンが出ない。 */
  "./android-chrome-maskable-192x192.png",
  "./android-chrome-maskable-512x512.png",
  "./apple-touch-icon.png",
  "./favicon-32x32.png",
  "./favicon-16x16.png",
  "./favicon.svg",
  "./favicon.ico",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* 画面の読み込みかどうか（新しいURLを開く／index.html を取りに行く） */
function isNavigation(request, url) {
  if (request.mode === "navigate") return true;
  const p = url.pathname;
  return p.endsWith("/") || p.endsWith("/index.html");
}

/* アプリのコードかどうか（core.js など）。更新が即座に効いてほしいもの。 */
function isAppCode(url) {
  return /\.(js|html)$/i.test(url.pathname);
}

/* ネットワーク優先で取り、成功したらキャッシュも更新する。
   失敗したらキャッシュへ落とす（オフラインでも動く）。 */
/* キャッシュに入れてよい返事かどうか。
   -----------------------------------------------------------------------
   res.ok を見ずに入れると、デプロイの最中に一瞬返った 404 や 500 が
   index.html として焼き付き、以後オフラインで開くたびにエラー画面が出る。
   キャッシュ名を上げるまで直らないので、必ずここで止める。
   206（部分）と opaque も put できないので入れない。 */
function cacheable(res) {
  return !!res && res.ok && res.status === 200 && res.type === "basic";
}

function putIfOk(cacheKey, res) {
  if (!cacheable(res)) return;
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(cacheKey, copy)).catch(() => {});
}

function networkFirst(request, cacheKey) {
  const key = cacheKey || request;
  return fetch(request)
    .then((res) => {
      putIfOk(key, res);
      return res;
    })
    .catch(() =>
      caches.match(key)
        .then((hit) => hit || caches.match(request))
        /* キャッシュにも無いときは undefined になる。
           respondWith(undefined) は TypeError になって画面が真っ白になるので、
           必ず「返事らしい返事」を返す。 */
        .then((hit) => hit || new Response("", {
          status: 503,
          statusText: "offline",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }))
    );
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // 外部（CDN等）は素通し。キャッシュにも触れない。
  if (url.origin !== location.origin) return;
  if (e.request.method !== "GET") return;

  // --- ① 画面：ネットワーク優先、失敗したらキャッシュ ---
  if (isNavigation(e.request, url)) {
    e.respondWith(networkFirst(e.request, INDEX));
    return;
  }

  // --- ② アプリのコード（core.js など）：ネットワーク優先 ---
  if (isAppCode(url)) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // --- ③ 変わらない部品：キャッシュ優先、裏で更新 ---
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const fromNet = fetch(e.request)
        .then((res) => {
          putIfOk(e.request, res);
          return res;
        })
        .catch(() => hit || new Response("", { status: 503, statusText: "offline" }));
      return hit || fromNet;
    })
  );
});
