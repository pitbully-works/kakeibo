# かけいぼ ― 夢に近づく家計簿

「面倒で続かなかった人でも続く家計簿」を目指した、ビルド不要の自己完結アプリです。
開いた瞬間に「今つかえるお金」がひと目でわかり、記録は 1〜2 タップ。将来は「資産形成総合ライフプラン」へ自然につながります。

- **ひと目でわかるホーム**：主役は「今月あと使えるお金」。
- **1〜2タップで記録**：手入力、またはレシート撮影（任意のOCRで金額を自動読み取り、いつでも手直し可）。
- **端末内だけに保存**：データは `localStorage` に保存し、外部に送信しません。
- **PWA**：ホーム画面に追加でき、2回目以降はオフラインでも起動します。

---

## 計算仕様（唯一の正）

計算は **`core.js` だけ** に置いてあります。ホーム・まとめ・連携JSONは、
すべて `core.js` の `computeMonth()` の結果を読むだけで、画面ごとに足し算をしません。

### 正式な計算式

```
使える額 = 通常収入 + 臨時収入 － 固定費 － 先取り貯金 － NISA積立 － 変動支出
```

ホームの「今月 あと つかえるお金」、まとめの「のこり」、連携JSONの
`available_to_spend` は、**必ず同じ値**になります。

### 二重計上を防ぐ2つの原則

**① 固定費は「項目ごとの予定額」。実績を記録した月は、予定額のかわりに実績を使う。**

設定には家賃・電気・ガス・水道・通信・サブスク・保険・その他固定費の予定額を項目別に入れます。
電気の実績を記録した月は、電気だけが「予定 → 実績」に置きかわります。足し算はしません。
記録していない項目は予定額のままです。

**② 給料の入力口は「記録」の収入ひとつだけ。設定に手取り収入は持たない。**

同じ給料を2か所に入れられると必ず混乱と二重計上のもとになるため、
設定の「手取り収入」欄は廃止しました。給料日に、記録から
「収入 → 💴 通常給与」で入れてください。

- 通常収入 ＝ その月に記録した「通常給与」の合計
- 臨時収入 ＝ 「臨時・賞与」「贈与」「その他臨時」の合計（別枠で上のせ）
- 給与を記録していない月は収入0。ホームは「使えるお金」ではなく
  「今月つかった金額」を表示し、給与の記録をうながします。

### 先取り貯金・NISAは「予定額」

どちらも入金確認をしていないため、**予定額**として扱います。
画面の表記も「先取り貯金・NISA積立の予定額を除いています」で統一しています。

---

## ライフプラン連携スナップショット（schema_version 2.1）

```json
{
  "schema_version": "2.1",
  "country_code": "JP",
  "base_currency": "JPY",
  "year_month": "2026-07",

  "income_regular": 290000,
  "income_regular_basis": "actual",
  "income_regular_recorded": true,
  "income_extra": 50000,
  "income_actual_total": 340000,
  "income_net": 340000,

  "fixed_cost_planned": 98000,
  "fixed_cost_actual": 15000,
  "fixed_cost": 101000,
  "fixed_cost_items": [
    { "key": "power", "name": "電気", "planned": 12000, "actual": 15000, "applied": 15000, "basis": "actual" }
  ],
  "variable_spend": 20000,
  "spend_total": 121000,

  "planned_set_aside": 73000,
  "accounts": [
    { "type": "CASH_SAVINGS",    "local": "貯金", "basis": "planned", "planned_contribution": 40000 },
    { "type": "TAX_FREE_INVEST", "local": "NISA", "basis": "planned", "planned_contribution": 33000 }
  ],

  "available_to_spend": 149000
}
```

**2.0 からの変更点（ライフプラン側の読み取りを直す必要があります）**

| 旧 (2.0) | 新 (2.1) | 理由 |
| --- | --- | --- |
| `income_net` は設定の手取りのみ | `income_regular` / `income_extra` / `income_actual_total` に分離。`income_net` は実収入合計。すべて記録した実績 | 臨時収入が抜けていた／設定と記録の二重入力をやめた |
| `fixed_cost` は設定値のみ | `fixed_cost_planned` / `fixed_cost_actual` / `fixed_cost`（採用値） | 予定と実績の区別がなかった |
| `accounts[].contribution` | `accounts[].planned_contribution` ＋ `basis: "planned"` | 実績と誤解される名前だった |

`type`（汎用の資産クラス）は既存ライフプランアプリと共通です。

---

## ファイル構成

```
index.html                  画面とUI
core.js                     計算コア（唯一の正・UI非依存）
core.test.js                計算仕様の自動テスト
render.test.js              3画面のレンダリングテスト（白画面の検出）
integrity.test.js           静的チェック（仕様の逆戻り防止）
sw.js                       Service Worker（オフライン対応）
manifest.webmanifest        PWA設定
icon-*.png                  アイコン
.github/workflows/test.yml  push のたびに自動テスト
```

## テストの実行

追加インストールは不要です（Node 18以降の標準機能だけを使います）。

```bash
node --test
```

GitHubへ push すると、`.github/workflows/test.yml` により自動で同じテストが走ります。
リポジトリの **Actions** タブで結果（緑／赤）を確認できます。

## すぐ試す

```bash
python3 -m http.server 8000
# → ブラウザで http://localhost:8000
```

※ レシート撮影（カメラ）はブラウザの仕様上 **https か localhost** でのみ動きます。

## 公開する（GitHub + Vercel）

静的サイトなのでビルド設定は不要です。Framework Preset は **Other**、
ビルドコマンドは空欄のまま Deploy してください。

## 免責

本アプリは家計の記録・概算の補助を目的としたもので、投資・税務・保険に関する助言ではありません。
