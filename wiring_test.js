/* =========================================================================
   かけいぼ ― 「呼んでいる関数が実在するか」の検査
   -------------------------------------------------------------------------
   編集を重ねるうちに関数ごと消えてしまい、呼び出すたびに例外になる——
   という事故を二度と起こさないための砦。
   実行： node --test
   ========================================================================= */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const coreSrc = fs.readFileSync(path.join(__dirname, "core.js"), "utf8");
const appSrc = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].pop()[1];

/* ブラウザ/言語が用意しているもの。ここに無い名前は自前で定義されているはず。 */
const KNOWN_GLOBALS = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "function", "await", "new",
  "Promise", "Object", "Array", "String", "Number", "Boolean", "Math", "JSON", "Date", "Error",
  "Image", "Blob", "URL", "FileReader", "RegExp", "Set", "Map", "parseInt", "parseFloat",
  "isNaN", "setTimeout", "clearTimeout", "queueMicrotask", "requestAnimationFrame",
  "encodeURIComponent", "decodeURIComponent", "alert", "confirm", "console",
  "localStorage", "sessionStorage", "document", "window", "navigator", "location",
  "Uint8ClampedArray", "Uint8Array", "Float64Array", "Float32Array", "Int32Array", "Intl", "Symbol", "WeakMap",
  "var", "let", "const", "async", "else", "do", "try", "finally", "of", "in",
  "delete", "void", "yield", "throw", "case",
]);

/* コメントを取り除く。説明文の中の「update() で〜」のような日本語を
   関数呼び出しと誤認しないため。文字列中のURLを壊さないよう、
   ブロックコメントと行頭の // だけを対象にする。 */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ");
}

/* 呼び出している名前をすべて集める（obj.method() は対象外＝自前関数だけ見る） */
function calledNames(src) {
  const names = new Set();
  const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) names.add(m[2]);
  return names;
}

/* 定義されている名前（関数・変数・引数）をすべて集める */
function declaredNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // 引数名（function(...) と (...)=> と x=>）
  const addParams = (list) => String(list).split(",").forEach((raw) => {
    const n = raw.trim().replace(/=.*$/, "").replace(/^\.\.\./, "").trim();
    if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
  });
  for (const m of src.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) addParams(m[1]);
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) addParams(m[1]);
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  return names;
}

test("画面のスクリプトが、存在しない関数を呼んでいない", () => {
  const declared = declaredNames(stripComments(appSrc));
  const missing = [...calledNames(stripComments(appSrc))].filter(
    (n) => !declared.has(n) && !KNOWN_GLOBALS.has(n)
  );
  assert.deepEqual(missing, [], `定義が見つからない関数: ${missing.join(", ")}`);
});

test("計算コアが、存在しない関数を呼んでいない", () => {
  const declared = declaredNames(stripComments(coreSrc));
  const missing = [...calledNames(stripComments(coreSrc))].filter(
    (n) => !declared.has(n) && !KNOWN_GLOBALS.has(n)
  );
  assert.deepEqual(missing, [], `定義が見つからない関数: ${missing.join(", ")}`);
});

/* ---------- 実際に動かして確かめる ---------- */
function boot(scriptLoads) {
  const els = {};
  const makeEl = (id) => ({
    id, innerHTML: "", textContent: "", value: "", dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, appendChild() {}, click() {}, focus() {}, remove() {},
    closest: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ width: 100, height: 100 }),
  });
  const get = (id) => (els[id] = els[id] || makeEl(id));
  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { onLine: true },
    setTimeout: (f) => { try { f(); } catch (e) {} return 0; },
    clearTimeout() {},
    scrollTo() {},
    Blob: function () {}, URL: { createObjectURL: () => "blob:", revokeObjectURL() {} },
    FileReader: function () {}, Image: function () {},
  };
  sandbox.document = {
    getElementById: get,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => {
      const el = makeEl("script");
      el.dataset = {};
      return el;
    },
    head: {
      appendChild(el) {
        if (scriptLoads) { sandbox.Tesseract = { createWorker: async () => ({}) }; if (el.onload) el.onload(); }
        else if (el.onerror) el.onerror();
      },
    },
    body: makeEl("body"),
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(coreSrc, ctx, { filename: "core.js" });
  vm.runInContext(appSrc, ctx, { filename: "index.html:inline" });
  return sandbox;
}

test("読み取り部品の取得が、例外ではなく正しく完了する", async () => {
  const sb = boot(true);
  const T = await vm.runInContext("loadTesseract()", vm.createContext(sb));
  assert.ok(T, "Tesseract が返ってこない");
});

test("取得に失敗したときは、通信状態つきの説明が返る（ReferenceErrorではない）", async () => {
  const sb = boot(false);
  await assert.rejects(
    () => vm.runInContext("loadTesseract()", vm.createContext(sb)),
    (err) => {
      assert.equal(err instanceof ReferenceError, false, "関数が存在せず ReferenceError になっている");
      assert.match(String(err.message), /読み取り部品を取得できません/);
      assert.match(String(err.message), /通信あり|オフライン/);
      return true;
    }
  );
});
