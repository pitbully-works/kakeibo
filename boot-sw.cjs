/* =========================================================================
   テスト用：sw.js を本物のブラウザなしで実際に動かす
   （node --test はこのファイルをテストとして拾いません）
   -------------------------------------------------------------------------
   ServiceWorker の世界（self / caches / fetch / event）を最小限に作り、
   install・activate・fetch の各イベントを本当に発火させて挙動を見る。
   ========================================================================= */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const swSrc = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");
const ORIGIN = "https://kakeibo.example.app";

/* --- 最小の Response / Request --- */
function makeResponse(body, meta) {
  return {
    body,
    from: (meta && meta.from) || "network",
    clone() { return makeResponse(body, { from: this.from }); },
  };
}
function makeRequest(url, opts) {
  const o = opts || {};
  return { url, method: o.method || "GET", mode: o.mode || "no-cors" };
}

/* --- 最小の CacheStorage --- */
function makeCaches() {
  const stores = new Map();               // name -> Map(url -> Response)
  const keyOf = (req) => (typeof req === "string" ? new URL(req, ORIGIN + "/").href : req.url);
  const api = {
    _stores: stores,
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        addAll: async (list) => { list.forEach((u) => m.set(keyOf(u), makeResponse("precached:" + u, { from: "cache" }))); },
        put: async (req, res) => { m.set(keyOf(req), res); },
        match: async (req) => m.get(keyOf(req)) || undefined,
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (req) => {
      for (const m of stores.values()) {
        const hit = m.get(keyOf(req));
        if (hit) return hit;
      }
      return undefined;
    },
  };
  return api;
}

/**
 * sw.js を読み込んで、イベントを発火できる状態にする。
 * opts.oldCaches : 事前に存在させておく古いキャッシュ名の配列
 * opts.offline   : true なら fetch が必ず失敗する
 */
function bootSW(opts) {
  const o = opts || {};
  const listeners = {};
  const cachesApi = makeCaches();
  const fetchLog = [];
  let offline = !!o.offline;

  const sandbox = {
    console,
    caches: cachesApi,
    URL,
    Promise,
    location: { origin: ORIGIN },
    fetch: async (req) => {
      const url = typeof req === "string" ? req : req.url;
      fetchLog.push(url);
      if (offline) throw new Error("offline");
      return makeResponse("network:" + url, { from: "network" });
    },
  };
  sandbox.self = {
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    skipWaiting: async () => { sandbox.self._skipWaiting = true; },
    clients: { claim: async () => { sandbox.self._claimed = true; } },
  };
  sandbox.addEventListener = sandbox.self.addEventListener;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(swSrc, ctx, { filename: "sw.js" });

  /* 事前に古いキャッシュを置いておく */
  const seedOld = async () => {
    for (const name of (o.oldCaches || [])) {
      const c = await cachesApi.open(name);
      await c.put(ORIGIN + "/index.html", makeResponse("OLD-INDEX", { from: "cache" }));
    }
  };

  /* イベントを発火する。waitUntil / respondWith を待つ。 */
  const fire = async (type, request) => {
    const waits = [];
    let responded = null;
    const event = {
      request,
      waitUntil: (p) => waits.push(p),
      respondWith: (p) => { responded = p; },
    };
    for (const fn of (listeners[type] || [])) fn(event);
    await Promise.all(waits);
    return responded ? await responded : null;
  };

  return {
    ctx, listeners, caches: cachesApi, fetchLog,
    seedOld,
    setOffline: (v) => { offline = v; },
    install: () => fire("install"),
    activate: () => fire("activate"),
    fetchEvent: (url, opts2) => fire("fetch", makeRequest(url, opts2)),
    cacheNames: () => [...cachesApi._stores.keys()],
    cachedUrls: (name) => [...(cachesApi._stores.get(name) || new Map()).keys()],
    ORIGIN,
  };
}

module.exports = { bootSW, ORIGIN, swSrc };
