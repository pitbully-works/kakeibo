/* =========================================================================
   テスト用：index.html のアプリを最小のDOMで実際に起動する
   （node --test はこのファイルをテストとして拾いません）
   ========================================================================= */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const coreSrc = fs.readFileSync(path.join(__dirname, "core.js"), "utf8");
const appSrc = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].pop()[1];

function makeEl(id) {
  return {
    id, innerHTML: "", textContent: "", value: "", dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, appendChild() {}, click() {}, focus() {}, remove() {},
    closest: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 100, height: 100 }),
  };
}

/**
 * opts:
 *   state        起動時に端末へ入っている保存データ
 *   storageFull  true なら保存が必ず失敗する
 *   maxBytes     保存する文字列がこの長さを超えたら失敗する（容量超過の再現）
 */
function bootApp(opts) {
  const o = opts || {};
  /* 端末に前回の続きが入っている状態から起動する（再起動の再現） */
  const seedStore = o.store || null;
  const els = {};
  const get = (id) => (els[id] = els[id] || makeEl(id));
  const store = {};
  /* 作りものの保存データは「いまのアプリが保存した形」＝最小通貨単位とみなす。
     印（dataVersion）を付けておかないと、起動のたびに移行が走って
     JP以外の金額が100倍になってしまう。
     移行そのものを試したいテストは、fixture 側で dataVersion を
     わざと省く（または古い値にする）ことで、移行の経路を通せる。 */
  if (seedStore) Object.keys(seedStore).forEach((k) => { store[k] = seedStore[k]; });
  if (o.rawState !== undefined) store["kakeibo:v1:state"] = o.rawState;
  if (o.state) {
    const seed = Object.assign({}, o.state);
    if (!("dataVersion" in seed)) seed.dataVersion = 2;
    store["kakeibo:v1:state"] = JSON.stringify(seed);
  }

  const quota = () => {
    const e = new Error("QuotaExceededError");
    e.name = "QuotaExceededError"; e.code = 22;
    throw e;
  };
  const setItem = (k, v) => {
    /* 特定の鍵だけ書けない状況（移行の控えだけが置けない、など）。
       storageFull だと何も書けなくなり、
       「控えが取れないときに本体を守れているか」を試し分けられない。 */
    if (Array.isArray(o.failKeys) && o.failKeys.indexOf(k) >= 0) quota();
    if (o.storageFull) quota();
    if (o.maxBytes && String(v).length > o.maxBytes) quota();
    store[k] = String(v);
  };

  /* 画像の読み込みは onerror を返す。resizeDataUrl は元の画像をそのまま返す作りなので、
     縮小はされないが、処理の流れ（成功／失敗の分岐）はそのまま確認できる。 */
  function ImageStub() {
    const self = this;
    Object.defineProperty(this, "src", {
      set(v) { self._src = v; if (self.onerror) self.onerror(); },
      get() { return self._src; },
    });
  }

  const sandbox = {
    console,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { onLine: true },
    location: { hash: String(o.hash || ""), pathname: "/", search: "" },
    history: { replaceState(_a,_b,url) { sandbox.location.hash = ""; sandbox.location.replacedUrl = url; } },
    setTimeout: (f) => { try { f(); } catch (e) {} return 0; },
    clearTimeout() {}, scrollTo() {},
    Blob: function () {}, URL: { createObjectURL: () => "blob:", revokeObjectURL() {} },
    FileReader: function () {}, Image: ImageStub,
  };
  /* 下のタブ。国を切り替えたときに、ことばが入れ替わるかを確かめるために要る。 */
  const navButtons = ["home", "summary", "calendar", "diary", "health", "calc", "pulse"].map((k) => {
    const el = makeEl("nav-" + k);
    el.dataset = { nav: k };
    el.setAttribute = function (n, v) { el["attr:" + n] = v; };
    el.removeAttribute = function (n) { delete el["attr:" + n]; };
    return el;
  });
  const docEl = makeEl("html");
  docEl.setAttribute = function (n, v) { docEl["attr:" + n] = v; };
  sandbox.document = {
    getElementById: get, querySelector: () => null,
    querySelectorAll: (sel) => (String(sel) === "#nav button" ? navButtons : []),
    documentElement: docEl,
    addEventListener() {}, createElement: () => makeEl("tmp"),
    head: { appendChild() {} }, body: makeEl("body"),
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(coreSrc, ctx, { filename: "core.js" });
  vm.runInContext(appSrc, ctx, { filename: "index.html:inline" });

  return {
    ctx,
    run: (code) => vm.runInContext(code, ctx),
    el: get,
    nav: () => navButtons,
    htmlLang: () => docEl["attr:lang"],
    toastText: () => get("toast").innerHTML,
    saved: () => store["kakeibo:v1:state"],
    /* 移行の控え（移行直前の、そのままの保存データ） */
    migrationBackup: () => store["kakeibo:v1:backup-before-minor-units"],
    /* 端末に残っているものを、そのまま次の起動へ渡す（再起動の再現） */
    storeDump: () => JSON.parse(JSON.stringify(store)),
    /* 記録シートを開き、金額を入れて保存する */
    record: async (amount, photo, photoHi) => {
      vm.runInContext(`openRecord(null);`, ctx);
      if (photo) vm.runInContext(`sheetState.photo=${JSON.stringify(photo)};`, ctx);
      if (photoHi) vm.runInContext(`sheetState.photoHi=${JSON.stringify(photoHi)};`, ctx);
      vm.runInContext(`
        document.getElementById("s-amt").value=${JSON.stringify(String(amount))};
        document.getElementById("s-date").value="2026-07-24";
        sheetState.cat="food";
      `, ctx);
      return vm.runInContext(`saveTx()`, ctx);
    },
    /* OCRの外側だけ差し替えて、どの画像から切り抜いたかを記録する */
    spyReadCrop: async () => {
      vm.runInContext(`
        __usedSource = null;
        cropToDataUrl = async function(src, crop, style){ __usedSource = src; return "data:image/png;base64,AAAA"; };
        ocrCandidates = async function(jobs){ return []; };
      `, ctx);
      await vm.runInContext(`readCrop()`, ctx);
      return vm.runInContext(`__usedSource`, ctx);
    },
  };
}

module.exports = { bootApp, appSrc, coreSrc, html };
