/* =============================================================================
   かけいぼ ― service worker
   -----------------------------------------------------------------------------
   方針を2つに分ける。

   ① 画面（index.html / ナビゲーション）＝ ネットワーク優先
      キャッシュを先に返すと、index.html や core.js だけを更新したとき、
      すでにアプリを開いたことのある端末に古い画面が残り続ける。
      そこで画面は必ず最新を取りにいき、**通信に失敗したときだけ**
      キャッシュした index.html を返す（オフライン起動は維持）。

   ② それ以外の部品（core.js・アイコン・manifest）＝ キャッシュ優先
      表示を速くするため。ただし裏でネットワークからも取り直し、
      次回に備えてキャッシュを更新する。

   CACHE の名前を変えると、activate で古いキャッシュを丸ごと捨てる。
   アプリを更新したら、この版数を必ず上げること。
   ============================================================================= */
const CACHE = "kakeibo-v4";
const INDEX = "./index.html";
const ASSETS = [
  "./",
  "./index.html",
  "./core.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
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

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // 外部（CDN等）は素通し。キャッシュにも触れない。
  if (url.origin !== location.origin) return;
  if (e.request.method !== "GET") return;

  // --- ① 画面：ネットワーク優先、失敗したらキャッシュ ---
  if (isNavigation(e.request, url)) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(INDEX, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(INDEX).then((hit) => hit || caches.match(e.request))
        )
    );
    return;
  }

  // --- ② 部品：キャッシュ優先、裏で更新 ---
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const fromNet = fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => hit);
      return hit || fromNet;
    })
  );
});
