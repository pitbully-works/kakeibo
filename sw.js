/* かけいぼ ― service worker（オフライン対応・最小構成）
   アプリ本体をキャッシュし、2回目以降はオフラインでも開けるようにする。
   OCR用のTesseract.jsはCDNから都度取得（オンライン時のみ・任意機能）。 */
const CACHE = "kakeibo-v2";
const ASSETS = ["./", "./index.html", "./core.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 同一オリジンのみキャッシュ・ファースト。外部（CDN等）は素通し。
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
