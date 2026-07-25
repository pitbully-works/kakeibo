import React, { useState, useMemo, useEffect, useCallback, useContext } from "react";
import { createPortal } from "react-dom";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, BarChart, Bar, Legend, Cell
} from "recharts";
import { Plus, Trash2, TrendingUp, HeartPulse, Landmark, Users, Ruler, Info, Coins, PiggyBank, ChevronUp } from "lucide-react";
import "./storageShim.js";
// 総資産推移・純資産の唯一の計算源（全資産・負債・収支を1本の月次ループで扱う統合エンジン）。
// 各パネル個別のシミュレーション（runSimulation / runGoldSimulation など）は表示用にそのまま残す。
import { runIntegratedPlan, buildAgeSteps, NOT_DRAWABLE } from "./lifePlanEngine.js";
// 国別ルール（NISA/iDeCo・401(k)/IRA・ISA/SIPP・RRSP/TFSA・Super など）は
// src/countryRules/ 配下の各国ファイルに分離。取得は従来どおり getCountryRules(country)。
import {
  JP_COUNTRY_RULES,
  US_COUNTRY_RULES,
  GB_COUNTRY_RULES,
  CA_COUNTRY_RULES,
  AU_COUNTRY_RULES,
  getCountryRules,
} from "./countryRules/index.js";
// 画面文言（翻訳辞書）は translations/ 配下に言語別で分離。
// JP→ja / US・CA・AU→en / GB→en-GB（en + EN_GB_OVERRIDES）。取得は従来どおり translateWith()。
import { translateWith } from "./translations/index.js";
// 診断コメント：既存の計算結果だけを見てルールで判定する純粋関数（外部AIは使わない）。
import { generateAdvice } from "./utils/generateAdvice.js";
// 国に依存しない共通UI部品（入力欄・ガイド・内訳グラフ）と表示基盤（LocaleContext等）は ui/ 配下へ分離。
import {
  yen,
  CURRENCY_BY_CODE,
  getCategoryLabel,
  LocaleContext,
  GuideButton,
  SectionGuide,
  GuideLabel,
  MoneyInput,
  MoneyField,
  Field,
  AgeField,
  AgeYMInput,
  LabeledMiniInput,
  CustomBenefitEditor,
  PIE_COLORS,
  AllocationCharts,
  AllocationBreakdown,
  StatCard,
  ScenarioComparisonCard,
} from "./ui/index.js";
// 各国パネル（アメリカの投資口座 / イギリス・カナダ・オーストラリアの退職後）は panels/ 配下へ分離。
// いずれも state を持たず、App.jsx から props で値を受け取るだけ（計算式は移動前と同一）。
import {
  USInvestmentAccountsPanel,
  GBRetirementPanel,
  CARetirementPanel,
  AURetirementPanel,
} from "./panels/index.js";


// ============================================================================
// ---------- 家計簿アプリ（同シリーズの関連機能）への入口 ----------
// 家計簿アプリは別プロジェクト（別リポジトリ・別ドメイン）として公開しているため、
// ここではリンク先URLだけを持つ。ソースコードの統合も iframe 埋め込みも行わない。
// このアプリの計算・保存データ・ルーティングには一切関与しない。
// ============================================================================
const KAKEIBO_APP_URL = "https://kakeibo-lemon.vercel.app/";

// ホーム画面に追加したPWA（standalone表示）で開いているかどうか。
// iPhoneでは開き方によって最適な挙動が異なるため、この判定で target を切り替える。
//   ・PWA（standalone）  … target="_blank"。iOSはPWA内のブラウザで開き、「完了」または
//                          左端からのスワイプでこの画面へ戻れる。_blank を付けない場合、
//                          戻ったときにライフプラン側が読み込み直しになる。
//   ・通常のSafariのタブ … 同じタブで開く。戻るボタン／左端スワイプで一発で戻れるうえ、
//                          新しいタブが増えない（iPhoneではタブ切り替えより押しやすい）。
// jsdom など matchMedia を持たない環境でも落ちないよう、必ず存在確認をしてから呼ぶ。
function isStandalonePWA() {
  if (typeof window === "undefined") return false;
  try {
    if (window.navigator && window.navigator.standalone === true) return true;
    if (typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(display-mode: standalone)").matches === true;
  } catch {
    return false;
  }
}


// ============================================================================
// ---------- 国際化（i18n）基盤 ----------
// 目的：既存の日本版の挙動・計算ロジック・見た目は一切変更せず、
// 「国を選択すると表示ラベル・通貨表記だけが切り替わる」土台を追加する。
// 将来的に国が増えても、下記のテーブルに1行追加するだけで拡張できる設計。
// 注意：各国固有の制度計算（NISA枠・iDeCoの拠出上限・401(k)拠出上限・
// 健康保険の自己負担ルール等）は今回のスコープ外。今回は「表示層」の
// 多言語・多通貨対応のみを行い、計算ロジックは日本の現行ルールのまま。
// ============================================================================

// 初期対応国（将来ここに追加するだけで選択肢が増える設計）。コードはISO 3166-1 alpha-2に統一
// （イギリスは "UK" ではなく ISO準拠の "GB" を使用）。
// enabled: false の国は「Coming Soon」として選択肢に表示されるが選べない（内部コード・設定はそのまま残す）。
export const SUPPORTED_COUNTRIES = [
  { code: "JP", flag: "🇯🇵", name: "日本", enabled: true },
  { code: "US", flag: "🇺🇸", name: "United States", enabled: true },
  { code: "GB", flag: "🇬🇧", name: "United Kingdom", enabled: true },
  { code: "CA", flag: "🇨🇦", name: "Canada", enabled: true },
  { code: "AU", flag: "🇦🇺", name: "Australia", enabled: true },
];

// 通貨（コード・記号・ロケール）。キーは通貨コード（ISO 4217）そのものにし、
// 「表示国」からは独立したデータとして管理する（例：日本在住でもUSD表示、海外在住の日本人でもJPY表示、が将来可能）。
// 将来通貨を追加する場合もここに1行追加するだけでよい。

// 国を選んだ際に「初期値として」自動設定する基準通貨・表示言語。
// あくまで初期値であり、保存データ上は country / baseCurrency / language は別項目として保持される
// （将来、この自動連動を切り離して個別に変更できるUIを追加しても、データ構造の変更は不要）。
const DEFAULT_CURRENCY_BY_COUNTRY = { JP: "JPY", US: "USD", GB: "GBP", CA: "CAD", AU: "AUD" };
const DEFAULT_LANGUAGE_BY_COUNTRY = { JP: "ja", US: "en", GB: "en-GB", CA: "en", AU: "en" };



// ============================================================================
// ---------- 翻訳辞書（translations/） ----------
// 旧・App.jsx 内に直書きしていた TRANSLATIONS / EN_GB_OVERRIDES / translateWith() は、
// 以下のファイルへそのまま切り出した。
//   translations/ja.js    … TRANSLATIONS.ja（日本語辞書）
//   translations/en.js    … TRANSLATIONS.en（英語辞書。US / CA / AU が共用）
//   translations/enGB.js  … EN_GB_OVERRIDES（英国向け差分）
//   translations/index.js … TRANSLATIONS の集約 / en-GB のマージ / translateWith(language, key, vars)
//
// キー名・訳文・フォールバック方針（未登録キーはキー名をそのまま返す）は一切変更していない。
// 参照方法も従来どおり `t("キー")` → translateWith(language, key, vars)。
// ============================================================================

// 金額フォーマットは「表示国」ではなく「基準通貨（baseCurrency）」に基づく。
// 国と通貨は別データとして保持するため、将来は国と無関係に通貨だけを切り替えられる。
// baseCurrencyがJPY（＝未設定を含む）の場合は、既存のyen()と完全に同一の出力を維持する
// （＝国・通貨を選択しない/日本のままなら、見た目は1文字も変わらない）。
function formatMoneyFor(baseCurrency, n) {
  if (!baseCurrency || baseCurrency === "JPY") return yen(n);
  if (n === null || n === undefined || isNaN(n)) n = 0;
  const cfg = CURRENCY_BY_CODE[baseCurrency] || CURRENCY_BY_CODE.JPY;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.round(n));
  return `${sign}${cfg.symbol}${abs.toLocaleString(cfg.locale)}`;
}

// ============================================================================
// 【移設】純粋な計算関数は utils/simulations.js へ切り出した（中身は1行も変えていない）。
// utils/buildPlanInput.js がこれらを必要とするため、App.jsx に置いたままだと
// App.jsx → buildPlanInput → App.jsx の循環参照になってしまう。
// 既存のテストや外部からの `import { runSimulation } from "./App.jsx"` を壊さないよう、
// ここで再エクスポートして後方互換を保つ。
// ============================================================================
import {
  DRAWDOWN_CATEGORIES,
  drawOrderOf,
  ACCOUNT_DRAW_CATEGORY,
  NISA_LIMITS,
  guessDefaultReturn,
  estimateMarginalTaxRate,
  computeAgeFromBirthDate,
  healthAnnualCost,
  runSimulation,
  buildNisaContributionPlan,
  runGoldSimulation,
  runBankSimulation,
  runStockSim,
  runLoanSimulation,
  runInsuranceSimulation,
  runPrivatePensionSimulation,
  runIdecoSimulation,
  scheduledAmount,
  elapsedScheduleAmount,
  compoundedElapsedValue,
  compoundPrincipal,
  elapsedLumpSumAmount,
  compoundedLumpSumValue,
} from "./utils/simulations.js";

export {
  DRAWDOWN_CATEGORIES,
  drawOrderOf,
  ACCOUNT_DRAW_CATEGORY,
  NISA_LIMITS,
  guessDefaultReturn,
  estimateMarginalTaxRate,
  computeAgeFromBirthDate,
  healthAnnualCost,
  runSimulation,
  buildNisaContributionPlan,
  runGoldSimulation,
  runBankSimulation,
  runStockSim,
  runLoanSimulation,
  runInsuranceSimulation,
  runPrivatePensionSimulation,
  runIdecoSimulation,
  scheduledAmount,
  elapsedScheduleAmount,
  compoundedElapsedValue,
  compoundPrincipal,
  elapsedLumpSumAmount,
  compoundedLumpSumValue,
};

// 後方互換：国別ルールの再エクスポート（移設前の App.jsx が持っていたもの）。
export {
  JP_COUNTRY_RULES,
  US_COUNTRY_RULES,
  GB_COUNTRY_RULES,
  CA_COUNTRY_RULES,
  AU_COUNTRY_RULES,
};

// 統合プラン入力の組み立て（React の外に出した純粋関数）。
import { buildPlanInput, CONTRIBUTION_MULTIPLIERS, readLivingCostMonthly } from "./utils/buildPlanInput.js";
// シナリオ比較（現在プラン vs 比較プラン）。既存エンジンを2回呼ぶだけで、新しい計算式は無い。
import { runScenarioComparison, createComparisonDraft, attachComparisonLine } from "./utils/scenarioComparison.js";
import { validateAgeInputs, hasEnoughInputForAdvice, AGE_VALIDATION } from "./utils/inputValidation.js";

// ---------- default watchlist ----------
// 以前はサンプルの保有銘柄を初期表示していたが、初回起動時の画面を完全に空にするため、
// 日本・アメリカとも初期候補は空リストにしている。銘柄は「追加」ボタンから自由に登録できる。
// （参考：以前の日本版サンプル銘柄は 東京エレクトロン／アドバンテスト／信越化学工業／東京応化工業／
//  ローム／ファナック／安川電機／ダイキン工業／三菱重工業／INPEX。米国版サンプル銘柄は
//  Apple／Microsoft／NVIDIA／Amazon／Alphabet／Tesla／Berkshire Hathaway／JPMorgan Chase。
//  再度サンプルを表示したい場合は、この配列にオブジェクトを追加すればよい。）
const DEFAULT_WATCHLIST_JP = [];
const DEFAULT_WATCHLIST_US = [];
const DEFAULT_WATCHLIST_GB = [];
const DEFAULT_WATCHLIST_CA = [];
const DEFAULT_WATCHLIST_AU = [];

// 既存の呼び出し箇所（初期状態の既定値）との後方互換のための別名。
const DEFAULT_WATCHLIST = DEFAULT_WATCHLIST_JP;

function defaultWatchlistFor(country) {
  if (country === "US") return DEFAULT_WATCHLIST_US;
  if (country === "GB") return DEFAULT_WATCHLIST_GB;
  if (country === "CA") return DEFAULT_WATCHLIST_CA;
  if (country === "AU") return DEFAULT_WATCHLIST_AU;
  return DEFAULT_WATCHLIST_JP;
}


// NISA合計の見出し（span内に置くため、GuideLabelとは別に用意した専用のガイド）
function NisaTotalGuide() {
  const { t } = useContext(LocaleContext);
  const [open, setOpen] = useState(false);
  return (
    <>
      <GuideButton open={open} onToggle={() => setOpen((v) => !v)} />
      {open && <span className="guide-text">{t("nisaTotalGuide")}</span>}
    </>
  );
}



// ---------- アメリカ選択時：退職後パネル（Social Security → Expenses → Withdrawal） ----------
function USRetirementPanel({ usInvestment, onUpdateSS, onUpdate, retirementRules, claimAge, ssMonthly, ssAnnual, expensesAnnual, healthcareAnnual, withdrawalNeeded, incomeSurplus }) {
  const { t, money } = useContext(LocaleContext);
  const ss = retirementRules.socialSecurity;
  return (
    <div>
      <div className="note" style={{ marginBottom: 12 }}>
        <Info size={13} />
        <span>{t("usSsSourceNote")}</span>
      </div>
      <Field guide={t("usPiaGuide")} label={t("usPiaLabel")} unit="$" step={50} value={usInvestment.socialSecurity.piaMonthly} onChange={(v) => onUpdateSS("piaMonthly", v)} />
      <AgeField
        label={t("usClaimAgeLabel")}
        value={claimAge}
        onChange={(v) => onUpdateSS("claimAge", Math.min(ss.latestClaimAge, Math.max(ss.earliestClaimAge, Math.round(v))))}
      />
      <div className="stat-sub">{t("usFraNote", { age: ss.fullRetirementAge })}</div>
      <div className="stat-grid" style={{ marginTop: 10, marginBottom: 14 }}>
        <StatCard label={t("usSsMonthlyLabel")} value={money(ssMonthly)} sub={t("usSsMonthlySub", { age: claimAge })} />
        <StatCard label={t("usSsAnnualLabel")} value={money(ssAnnual)} sub={t("usSsAnnualSub")} />
      </div>

      <div className="field-label" style={{ marginBottom: 6 }}>{t("usExpensesLabel")}</div>
      <Field guide={t("usExpensesMonthlyGuide")} label={t("usExpensesMonthlyLabel")} unit="$" step={100} value={usInvestment.expensesMonthly} onChange={(v) => onUpdate("expensesMonthly", v)} />

      <div className="stat-grid" style={{ marginTop: 10 }}>
        <StatCard label={t("usRetirementIncomeLabel")} value={money(ssAnnual)} sub={t("usRetirementIncomeSub")} tone="good" />
        <StatCard label={t("usExpensesTotalLabel")} value={money(expensesAnnual + healthcareAnnual)} sub={t("usExpensesTotalSub")} />
        {withdrawalNeeded > 0 ? (
          <StatCard label={t("usWithdrawalLabel")} value={money(withdrawalNeeded)} sub={t("usWithdrawalSub")} tone="danger" />
        ) : (
          <StatCard label={t("usSurplusLabel")} value={money(incomeSurplus)} sub={t("usSurplusSub")} tone="good" />
        )}
      </div>
    </div>
  );
}

// ---------- アメリカ選択時：医療費パネル（Medicare / Health Insurance / Out of Pocket） ----------
function USHealthcarePanel({ usInvestment, onUpdate, medicareAnnual, healthInsuranceAnnual, outOfPocketAnnual, totalAnnual }) {
  const { t, money } = useContext(LocaleContext);
  return (
    <div>
      <div className="note" style={{ marginBottom: 12 }}>
        <Info size={13} />
        <span>{t("usHealthcareSourceNote")}</span>
      </div>
      <div className="stat-sub">{t("usMedicareAutoLabel")}：<span className="mono">{money(medicareAnnual)}</span></div>
      <div className="note" style={{ marginTop: -4, marginBottom: 12 }}>
        <Info size={13} />
        <span>{t("usMedicareAutoNote")}</span>
      </div>
      <Field guide={t("usHealthInsuranceGuide")} label={t("usHealthInsuranceLabel")} unit="$" step={50} value={usInvestment.healthcare.healthInsuranceMonthly} onChange={(v) => onUpdate("healthInsuranceMonthly", v)} />
      <Field guide={t("usOutOfPocketGuide")} label={t("usOutOfPocketLabel")} unit="$" step={100} value={usInvestment.healthcare.outOfPocketAnnual} onChange={(v) => onUpdate("outOfPocketAnnual", v)} />
      <div className="stat-grid" style={{ marginTop: 10 }}>
        <StatCard label={t("usMedicareLabel")} value={money(medicareAnnual)} sub={t("usMedicareSub")} />
        <StatCard label={t("usHealthInsuranceTotalLabel")} value={money(healthInsuranceAnnual)} sub={t("usHealthInsuranceSub")} />
        <StatCard label={t("usOutOfPocketTotalLabel")} value={money(outOfPocketAnnual)} sub={t("usOutOfPocketSub")} />
      </div>
      <div className="stat-grid" style={{ marginTop: 10 }}>
        <StatCard label={t("usHealthcareTotalLabel")} value={money(totalAnnual)} sub={t("usHealthcareTotalSub")} tone="danger" />
      </div>
    </div>
  );
}

// ---------- イギリス選択時：1口座分の入力欄（現在額・年間積立額・想定利回り・積立終了年齢） ----------
// 6口座（Stocks and Shares ISA / Cash ISA / SIPP / Workplace Pension / GIA / Cash Savings）で共通利用する。
function GBAccountFields({ accountKey, title, account, onUpdateAccount, borderColor, note }) {
  const { t } = useContext(LocaleContext);
  return (
    <div className="section-block" style={{ borderColor, marginTop: 12 }}>
      <div className="field-label" style={{ marginBottom: 6 }}>{title}</div>
      <Field guide={t("gbCurrentValueGuide")} label={t("gbCurrentValueLabel")} unit="£" step={500} value={account.currentValue} onChange={(v) => onUpdateAccount(accountKey, "currentValue", v)} />
      <Field guide={t("gbAnnualContributionGuide")} label={t("gbAnnualContributionLabel")} unit="£" step={100} value={account.annualContribution} onChange={(v) => onUpdateAccount(accountKey, "annualContribution", v)} />
      <Field guide={t("gbExpectedReturnGuide")} label={t("expectedAnnualReturnLabel")} unit="%" step={0.5} value={account.expectedReturnPct} onChange={(v) => onUpdateAccount(accountKey, "expectedReturnPct", v)} />
      <AgeField guide={t("gbContributionEndAgeGuide")} label={t("gbContributionEndAgeLabel")} value={account.contributionEndAge} onChange={(v) => onUpdateAccount(accountKey, "contributionEndAge", v)} />
      {note && <div className="stat-sub">{note}</div>}
    </div>
  );
}

// ---------- イギリス選択時：投資口座パネル（ISA / SIPP / Workplace Pension / GIA / Cash Savings ＋ 税制） ----------
// JPのNISA関連UI・USの401(k)関連UIとは完全に独立しており、GB_COUNTRY_RULES の関数のみを使用する。
function GBInvestmentAccountsPanel({ gbInvestment, onUpdate, onUpdateAccount, age, investmentRules, taxRules, taxResult, pensionAllowance }) {
  const { t, money } = useContext(LocaleContext);

  // 画面に出す数値・年度・税率はすべて GB_COUNTRY_RULES（investmentRules / taxRules）から取り出す。
  // 表示文にリテラルの数値を書かないことで、制度改正時に計算と説明文が食い違う事故を防ぐ。
  const pct = (rate) => `${Number((rate * 100).toFixed(2))}`;

  const isaAllowance = investmentRules.getIsaAnnualAllowance();
  const isaContributed = investmentRules.getIsaContributed(gbInvestment);
  const isaRemaining = isaAllowance - isaContributed;

  const pensionContributed = investmentRules.getPensionContributed(gbInvestment);
  const pensionRemaining = pensionAllowance - pensionContributed;
  const isTapered = pensionAllowance < investmentRules.limits.pensionAnnualAllowance;

  const split = investmentRules.splitAssets(age, gbInvestment);
  const accessAge = investmentRules.pensionAccessAge;
  const cgtExempt = taxRules.capitalGains.annualExemptAmount;

  return (
    <div>
      <div className="note" style={{ marginBottom: 14 }}>
        <Info size={13} />
        <span>{t("gbInvestmentSourceNote", { taxYear: investmentRules.effectiveTaxYear, region: taxRules.region })}</span>
      </div>

      <Field guide={t("gbAnnualIncomeGuide")} label={t("gbAnnualIncomeLabel")} unit="£" step={1000} value={gbInvestment.annualIncome} onChange={(v) => onUpdate("annualIncome", v)} />
      <Field guide={t("gbAdjustedIncomeGuide")} label={t("gbAdjustedIncomeLabel")} unit="£" step={1000} value={gbInvestment.adjustedIncome} onChange={(v) => onUpdate("adjustedIncome", v)} />

      <GBAccountFields
        accountKey="stocksSharesIsa" title={t("gbStocksSharesIsaLabel")} account={gbInvestment.stocksSharesIsa}
        onUpdateAccount={onUpdateAccount} borderColor="#8FBF7F"
      />
      <GBAccountFields
        accountKey="cashIsa" title={t("gbCashIsaLabel")} account={gbInvestment.cashIsa}
        onUpdateAccount={onUpdateAccount} borderColor="#8FBF7F"
      />

      <div className="stat-grid" style={{ marginTop: 12 }}>
        <StatCard
          label={t("gbIsaAllowanceLabel", { taxYear: investmentRules.effectiveTaxYear })}
          value={money(isaAllowance)}
          sub={t("gbIsaRemainingSub", { amount: money(isaAllowance) })}
        />
        <StatCard
          label={t("gbIsaRemainingLabel")}
          value={money(Math.max(0, isaRemaining))}
          sub={t("gbIsaTaxFreeNote")}
          tone={isaRemaining < 0 ? "danger" : "good"}
        />
      </div>
      {isaRemaining < 0 && (
        <div className="note" style={{ borderLeftColor: "#C2694F", marginTop: 10 }}>
          <Info size={13} style={{ color: "#C2694F" }} />
          <span>{t("gbIsaOverLabel", { amount: money(-isaRemaining) })}</span>
        </div>
      )}

      <GBAccountFields
        accountKey="sipp" title={t("gbSippLabel")} account={gbInvestment.sipp}
        onUpdateAccount={onUpdateAccount} borderColor="#B08FD6"
      />
      <GBAccountFields
        accountKey="workplacePension" title={t("gbWorkplacePensionLabel")} account={gbInvestment.workplacePension}
        onUpdateAccount={onUpdateAccount} borderColor="#B08FD6"
      />

      <div className="stat-grid" style={{ marginTop: 12 }}>
        <StatCard
          label={t("gbPensionAllowanceLabel", { taxYear: investmentRules.effectiveTaxYear })}
          value={money(pensionAllowance)}
          sub={t("gbPensionRemainingSub", { amount: money(pensionAllowance) })}
        />
        <StatCard
          label={t("gbPensionRemainingLabel")}
          value={money(Math.max(0, pensionRemaining))}
          sub={t("gbPensionAccessNote", {
            age: accessAge,
            futureAge: investmentRules.scheduled.pensionAccessAgeFrom2028,
            date: investmentRules.scheduled.pensionAccessAgeEffectiveDate,
          })}
          tone={pensionRemaining < 0 ? "danger" : "good"}
        />
      </div>
      {isTapered && (
        <div className="note" style={{ borderLeftColor: "#D9A54F", marginTop: 10 }}>
          <Info size={13} style={{ color: "#D9A54F" }} />
          <span>{t("gbPensionTaperNote", {
            amount: money(pensionAllowance),
            threshold: money(investmentRules.limits.pensionTaperAdjustedIncome),
            floor: money(investmentRules.limits.pensionAnnualAllowanceFloor),
          })}</span>
        </div>
      )}
      {pensionRemaining < 0 && (
        <div className="note" style={{ borderLeftColor: "#C2694F", marginTop: 10 }}>
          <Info size={13} style={{ color: "#C2694F" }} />
          <span>{t("gbPensionOverLabel", { amount: money(-pensionRemaining) })}</span>
        </div>
      )}
      <div className="note" style={{ marginTop: 10 }}>
        <Info size={13} />
        <span>{t("gbLumpSumNote", {
          amount: money(investmentRules.lumpSumAllowance),
          pct: pct(investmentRules.taxFreeLumpSumRate),
        })}</span>
      </div>

      <GBAccountFields
        accountKey="gia" title={t("gbGiaLabel")} account={gbInvestment.gia}
        onUpdateAccount={onUpdateAccount} borderColor="#D9A54F"
      />
      <GBAccountFields
        accountKey="cashSavings" title={t("gbCashSavingsLabel")} account={gbInvestment.cashSavings}
        onUpdateAccount={onUpdateAccount} borderColor="#7BC9E0"
      />

      <div className="stat-grid" style={{ marginTop: 16 }}>
        <StatCard label={t("gbTotalAssetsLabel")} value={money(split.total)} sub={t("gbTotalAssetsSub")} />
      </div>
      <div className="stat-grid" style={{ marginTop: 10 }}>
        <StatCard
          label={t("gbLiquidAssetsLabel")}
          value={money(split.liquid)}
          sub={t("gbLiquidAssetsSub", { age: accessAge })}
          tone="good"
        />
        <StatCard
          label={t("gbRestrictedAssetsLabel")}
          value={money(split.restricted)}
          sub={split.isAccessibleAge
            ? t("gbRestrictedAssetsSubAccessible", { age: accessAge })
            : t("gbRestrictedAssetsSubLocked", { age: accessAge })}
        />
        <StatCard
          label={t("gbTaxAdvantagedLabel")}
          value={money(split.taxAdvantaged)}
          sub={t("gbTaxAdvantagedSub")}
        />
      </div>

      <div className="section-block" style={{ borderColor: "#5FB0A0", marginTop: 16 }}>
        <div className="field-label" style={{ marginBottom: 6 }}>
          {t("gbTaxSectionLabel", { taxYear: taxRules.effectiveTaxYear, region: taxRules.region })}
        </div>
        <div className="note" style={{ marginBottom: 12 }}>
          <Info size={13} />
          <span>{t("gbTaxSourceNote", { taxYear: taxRules.effectiveTaxYear, region: taxRules.region })}</span>
        </div>
        <Field guide={t("gbDividendIncomeGuide")} label={t("gbDividendIncomeLabel")} unit="£" step={100} value={gbInvestment.dividendIncomeAnnual} onChange={(v) => onUpdate("dividendIncomeAnnual", v)} />
        <Field guide={t("gbCapitalGainGuide")} label={t("gbCapitalGainLabel")} unit="£" step={500} value={gbInvestment.estimatedCapitalGainAnnual} onChange={(v) => onUpdate("estimatedCapitalGainAnnual", v)} />
        <div className="stat-grid" style={{ marginTop: 10 }}>
          <StatCard label={t("gbIncomeTaxLabel")} value={money(taxResult.incomeTax)} sub={t("gbIncomeTaxSub", { amount: money(taxResult.taxableIncome) })} />
          <StatCard
            label={t("gbDividendTaxLabel")}
            value={money(taxResult.dividendTax)}
            sub={t("gbDividendTaxSub", {
              amount: money(taxRules.dividend.allowance),
              basic: pct(taxRules.dividend.basicRate),
              higher: pct(taxRules.dividend.higherRate),
              additional: pct(taxRules.dividend.additionalRate),
            })}
          />
          <StatCard
            label={t("gbCgtLabel")}
            value={money(taxResult.capitalGainsTax)}
            sub={t("gbCgtSub", {
              amount: money(cgtExempt),
              basic: pct(taxRules.capitalGains.basicRate),
              higher: pct(taxRules.capitalGains.higherRate),
            })}
          />
          <StatCard
            label={t("gbPensionReliefLabel")}
            value={money(taxResult.pensionTaxRelief)}
            sub={t("gbPensionReliefSub", { pct: Math.round(taxResult.marginalRate * 100) })}
            tone="good"
          />
        </div>
        <div className="stat-grid" style={{ marginTop: 10 }}>
          <StatCard label={t("gbTotalTaxLabel")} value={money(taxResult.totalTax)} sub={t("gbTotalTaxSub")} tone="danger" />
        </div>
        <div className="note" style={{ marginTop: 10 }}>
          <Info size={13} />
          <span>{t("gbIsaTaxFreeNote")}</span>
        </div>
      </div>
    </div>
  );
}


// ---------- イギリス選択時：医療費パネル（NHS前提の簡易モデル） ----------
function GBHealthcarePanel({ gbInvestment, onUpdate, totalAnnual }) {
  const { t, money } = useContext(LocaleContext);
  const h = gbInvestment.healthcare;
  return (
    <div>
      <div className="note" style={{ marginBottom: 12 }}>
        <Info size={13} />
        <span>{t("gbHealthcareSourceNote")}</span>
      </div>
      <Field guide={t("gbHealthcareGuide")} label={t("gbNhsBasicLabel")} unit="£" step={50} value={h.nhsBasicAnnual} onChange={(v) => onUpdate("nhsBasicAnnual", v)} />
      <Field label={t("gbPrivateHealthLabel")} unit="£" step={10} value={h.privateHealthInsuranceMonthly} onChange={(v) => onUpdate("privateHealthInsuranceMonthly", v)} />
      <Field label={t("gbDentalLabel")} unit="£" step={50} value={h.dentalAnnual} onChange={(v) => onUpdate("dentalAnnual", v)} />
      <Field label={t("gbPrescriptionLabel")} unit="£" step={10} value={h.prescriptionAnnual} onChange={(v) => onUpdate("prescriptionAnnual", v)} />
      <Field label={t("gbLongTermCareLabel")} unit="£" step={500} value={h.longTermCareAnnual} onChange={(v) => onUpdate("longTermCareAnnual", v)} />
      <Field label={t("gbOtherOutOfPocketLabel")} unit="£" step={50} value={h.otherOutOfPocketAnnual} onChange={(v) => onUpdate("otherOutOfPocketAnnual", v)} />
      <div className="stat-grid" style={{ marginTop: 10 }}>
        <StatCard label={t("gbHealthcareTotalLabel")} value={money(totalAnnual)} sub={t("gbHealthcareTotalSub")} tone="danger" />
      </div>
    </div>
  );
}

// ---------- カナダ選択時：1口座分の入力欄（現在額・年間積立額・想定利回り・積立終了年齢） ----------
function CAAccountFields({ accountKey, title, account, onUpdateAccount, borderColor, note }) {
  const { t } = useContext(LocaleContext);
  return (
    <div className="section-block" style={{ borderColor, marginTop: 12 }}>
      <div className="field-label" style={{ marginBottom: 6 }}>{title}</div>
      <Field guide={t("caCurrentValueGuide")} label={t("caCurrentValueLabel")} unit="C$" step={500} value={account.currentValue} onChange={(v) => onUpdateAccount(accountKey, "currentValue", v)} />
      <Field guide={t("caAnnualContributionGuide")} label={t("caAnnualContributionLabel")} unit="C$" step={100} value={account.annualContribution} onChange={(v) => onUpdateAccount(accountKey, "annualContribution", v)} />
      <Field guide={t("gbExpectedReturnGuide")} label={t("expectedAnnualReturnLabel")} unit="%" step={0.5} value={account.expectedReturnPct} onChange={(v) => onUpdateAccount(accountKey, "expectedReturnPct", v)} />
      <AgeField guide={t("gbContributionEndAgeGuide")} label={t("caContributionEndAgeLabel")} value={account.contributionEndAge} onChange={(v) => onUpdateAccount(accountKey, "contributionEndAge", v)} />
      {note && <div className="stat-sub">{note}</div>}
    </div>
  );
}

// ---------- カナダ選択時：投資口座パネル（TFSA / RRSP / 非登録口座 / 現金 ＋ 税制） ----------
// 他国のUIとは完全に独立しており、CA_COUNTRY_RULES の関数のみを使用する。
function CAInvestmentAccountsPanel({ caInvestment, onUpdate, onUpdateAccount, age, investmentRules, taxRules, taxResult, rrspRoom }) {
  const { t, money } = useContext(LocaleContext);
  // 画面に出す数値・年度・税率はすべて CA_COUNTRY_RULES から取り出す（表示文にリテラルを書かない）。
  const pct = (rate) => `${Number((rate * 100).toFixed(2))}`;

  const tfsaLimit = investmentRules.getTfsaAnnualLimit();
  const tfsaRemaining = investmentRules.getTfsaRemaining(caInvestment);
  const rrspRemaining = rrspRoom - (Number(caInvestment.rrsp.annualContribution) || 0);
  const split = investmentRules.splitAssets(age, caInvestment);
  const rrifAge = investmentRules.rrifConversionAge;

  return (
    <div>
      <div className="note" style={{ marginBottom: 14 }}>
        <Info size={13} />
        <span>{t("caInvestmentSourceNote", { taxYear: investmentRules.effectiveTaxYear, region: taxRules.region })}</span>
      </div>

      <Field guide={t("caAnnualIncomeGuide")} label={t("caAnnualIncomeLabel")} unit="C$" step={1000} value={caInvestment.annualIncome} onChange={(v) => onUpdate("annualIncome", v)} />
      <Field guide={t("caPriorEarnedIncomeGuide")} label={t("caPriorEarnedIncomeLabel")} unit="C$" step={1000} value={caInvestment.priorEarnedIncome} onChange={(v) => onUpdate("priorEarnedIncome", v)} />

      <CAAccountFields
        accountKey="tfsa" title={t("caTfsaLabel")} account={caInvestment.tfsa}
        onUpdateAccount={onUpdateAccount} borderColor="#8FBF7F"
      />
      <div className="stat-grid" style={{ marginTop: 12 }}>
        <StatCard
          label={t("caTfsaLimitLabel", { taxYear: investmentRules.effectiveTaxYear })}
          value={money(tfsaLimit)}
          sub={t("caTfsaRemainingSub", { amount: money(tfsaLimit) })}
        />
        <StatCard
          label={t("caTfsaRemainingLabel")}
          value={money(Math.max(0, tfsaRemaining))}
          sub={t("caTfsaTaxFreeNote")}
          tone={tfsaRemaining < 0 ? "danger" : "good"}
        />
      </div>
      {tfsaRemaining < 0 && (
        <div className="note" style={{ borderLeftColor: "#C2694F", marginTop: 10 }}>
          <Info size={13} style={{ color: "#C2694F" }} />
          <span>{t("caTfsaOverLabel", { amount: money(-tfsaRemaining) })}</span>
        </div>
      )}

      <CAAccountFields
        accountKey="rrsp" title={t("caRrspLabel")} account={caInvestment.rrsp}
        onUpdateAccount={onUpdateAccount} borderColor="#B08FD6"
      />
      <div className="stat-grid" style={{ marginTop: 12 }}>
        <StatCard
          label={t("caRrspRoomLabel")}
          value={money(rrspRoom)}
          sub={t("caRrspRoomSub", {
            pct: pct(investmentRules.limits.rrspIncomePercent),
            cap: money(investmentRules.limits.rrspAnnualDollarLimit),
          })}
        />
        <StatCard
          label={t("caRrspRemainingLabel")}
          value={money(Math.max(0, rrspRemaining))}
          sub={t("caRrspTaxSavingSub", { pct: pct(taxResult.marginalRate) })}
          tone={rrspRemaining < 0 ? "danger" : "good"}
        />
      </div>
      {rrspRemaining < 0 && (
        <div className="note" style={{ borderLeftColor: "#C2694F", marginTop: 10 }}>
          <Info size={13} style={{ color: "#C2694F" }} />
          <span>{t("caRrspOverLabel", { amount: money(-rrspRemaining) })}</span>
        </div>
      )}
      <div className="note" style={{ marginTop: 10 }}>
        <Info size={13} />
        <span>{t("caRrifNote", {
          age: rrifAge,
          firstAge: investmentRules.rrifFirstWithdrawalAge,
          pct: pct(investmentRules.getRrifMinimumFactor(investmentRules.rrifFirstWithdrawalAge)),
          pct80: pct(investmentRules.getRrifMinimumFactor(80)),
          pct95: pct(investmentRules.rrifMinimumFactorAt95Plus),
          taxPct: Number(caInvestment.rrsp.withdrawalTaxPct) || 0,
        })}</span>
      </div>

      <CAAccountFields
        accountKey="nonRegistered" title={t("caNonRegisteredLabel")} account={caInvestment.nonRegistered}
        onUpdateAccount={onUpdateAccount} borderColor="#D9A54F"
      />
      <CAAccountFields
        accountKey="cashSavings" title={t("caCashSavingsLabel")} account={caInvestment.cashSavings}
        onUpdateAccount={onUpdateAccount} borderColor="#7BC9E0"
      />

      <div className="stat-grid" style={{ marginTop: 16 }}>
        <StatCard label={t("caTotalAssetsLabel")} value={money(split.total)} sub={t("caTotalAssetsSub")} />
      </div>
      <div className="stat-grid" style={{ marginTop: 10 }}>
        <StatCard label={t("caLiquidAssetsLabel")} value={money(split.liquid)} sub={t("caLiquidAssetsSub")} tone="good" />
        <StatCard label={t("caRestrictedAssetsLabel")} value={money(split.restricted)} sub={t("caRestrictedAssetsSub", { age: rrifAge })} />
        <StatCard label={t("caTaxAdvantagedLabel")} value={money(split.taxAdvantaged)} sub={t("caTaxAdvantagedSub")} />
      </div>

      <div className="section-block" style={{ borderColor: "#5FB0A0", marginTop: 16 }}>
        <div className="field-label" style={{ marginBottom: 6 }}>
          {t("caTaxSectionLabel", { taxYear: taxRules.effectiveTaxYear })}
        </div>
        <div className="note" style={{ marginBottom: 12 }}>
          <Info size={13} />
          <span>{t("caTaxSourceNote", { taxYear: taxRules.effectiveTaxYear })}</span>
        </div>
        <Field guide={t("caCapitalGainGuide")} label={t("caCapitalGainLabel")} unit="C$" step={500} value={caInvestment.estimatedCapitalGainAnnual} onChange={(v) => onUpdate("estimatedCapitalGainAnnual", v)} />
        <div className="stat-grid" style={{ marginTop: 10 }}>
          <StatCard
            label={t("caFederalTaxLabel")}
            value={money(taxResult.federalTax)}
            sub={t("caFederalTaxSub", { amount: money(taxResult.basicPersonalAmount) })}
          />
          <StatCard
            label={t("caCgtLabel")}
            value={money(taxResult.capitalGainsTax)}
            sub={t("caCgtSub", { pct: pct(taxRules.capitalGains.inclusionRate) })}
          />
          <StatCard
            label={t("caRrspTaxSavingLabel")}
            value={money(taxResult.rrspTaxSaving)}
            sub={t("caRrspTaxSavingSub", { pct: pct(taxResult.marginalRate) })}
            tone="good"
          />
        </div>
        <div className="stat-grid" style={{ marginTop: 10 }}>
          <StatCard label={t("caTotalTaxLabel")} value={money(taxResult.totalTax)} sub={t("caTotalTaxSub")} tone="danger" />
        </div>
        <div className="note" style={{ marginTop: 10 }}>
          <Info size={13} />
          <span>{t("caTfsaTaxFreeNote")}</span>
        </div>
      </div>
    </div>
  );
}


// ---------- カナダ選択時：医療費パネル（州の公的医療保険を前提とした簡易モデル） ----------
function CAHealthcarePanel({ caInvestment, onUpdate, totalAnnual }) {
  const { t, money } = useContext(LocaleContext);
  const h = caInvestment.healthcare;
  return (
    <div>
      <div className="note" style={{ marginBottom: 12 }}>
        <Info size={13} />
        <span>{t("caHealthcareSourceNote")}</span>
      </div>
      <Field guide={t("caHealthcareGuide")} label={t("caBasicHealthLabel")} unit="C$" step={50} value={h.basicAnnual} onChange={(v) => onUpdate("basicAnnual", v)} />
      <Field label={t("caPrivateHealthLabel")} unit="C$" step={10} value={h.privateHealthInsuranceMonthly} onChange={(v) => onUpdate("privateHealthInsuranceMonthly", v)} />
      <Field label={t("caPrescriptionLabel")} unit="C$" step={50} value={h.prescriptionAnnual} onChange={(v) => onUpdate("prescriptionAnnual", v)} />
      <Field label={t("caDentalLabel")} unit="C$" step={50} value={h.dentalAnnual} onChange={(v) => onUpdate("dentalAnnual", v)} />
      <Field label={t("caVisionLabel")} unit="C$" step={50} value={h.visionAnnual} onChange={(v) => onUpdate("visionAnnual", v)} />
      <Field label={t("caLongTermCareLabel")} unit="C$" step={500} value={h.longTermCareAnnual} onChange={(v) => onUpdate("longTermCareAnnual", v)} />
      <Field label={t("caOtherOutOfPocketLabel")} unit="C$" step={50} value={h.otherOutOfPocketAnnual} onChange={(v) => onUpdate("otherOutOfPocketAnnual", v)} />
      <div className="stat-grid" style={{ marginTop: 10 }}>
        <StatCard label={t("caHealthcareTotalLabel")} value={money(totalAnnual)} sub={t("caHealthcareTotalSub")} tone="danger" />
      </div>
    </div>
  );
}

// ---------- オーストラリア選択時：1口座分の入力欄 ----------
function AUAccountFields({ accountKey, title, account, onUpdateAccount, borderColor, contributionLabel, note }) {
  const { t } = useContext(LocaleContext);
  return (
    <div className="section-block" style={{ borderColor, marginTop: 12 }}>
      <div className="field-label" style={{ marginBottom: 6 }}>{title}</div>
      <Field guide={t("auCurrentValueGuide")} label={t("auCurrentValueLabel")} unit="A$" step={500} value={account.currentValue} onChange={(v) => onUpdateAccount(accountKey, "currentValue", v)} />
      <Field guide={t("auAnnualContributionGuide")} label={contributionLabel || t("auAnnualContributionLabel")} unit="A$" step={100} value={account.annualContribution} onChange={(v) => onUpdateAccount(accountKey, "annualContribution", v)} />
      <Field guide={t("gbExpectedReturnGuide")} label={t("expectedAnnualReturnLabel")} unit="%" step={0.5} value={account.expectedReturnPct} onChange={(v) => onUpdateAccount(accountKey, "expectedReturnPct", v)} />
      <AgeField guide={t("gbContributionEndAgeGuide")} label={t("auContributionEndAgeLabel")} value={account.contributionEndAge} onChange={(v) => onUpdateAccount(accountKey, "contributionEndAge", v)} />
      {note && <div className="stat-sub">{note}</div>}
    </div>
  );
}

// ---------- オーストラリア選択時：投資口座パネル（Super / 投資口座 / 現金 ＋ 税制） ----------
function AUInvestmentAccountsPanel({
  auInvestment, onUpdate, onUpdateAccount, age, investmentRules, taxRules,
  sgContribution, totalConcessional, concessionalRemaining, nonConcessionalRemaining,
  superContributionTax, salarySacrificeSaving, taxResult, capitalGainsTax, totalTax, marginalRate,
}) {
  const { t, money } = useContext(LocaleContext);
  // 画面に出す数値・年度・税率はすべて AU_COUNTRY_RULES から取り出す。
  const pct = (rate) => `${Number((rate * 100).toFixed(2))}`;
  const l = investmentRules.limits;
  const superTax = taxRules.superannuation;
  const split = investmentRules.splitAssets(age, auInvestment);
  const preservationAge = investmentRules.preservationAge;
  // Division 293：どの所得を使ったか（概算か明示入力か）と、税の支払元
  const div293Estimated = taxRules.resolveDivision293Income(
    Math.max(0, (Number(auInvestment.annualSalary) || 0) - (Number(auInvestment.voluntaryConcessional) || 0)),
    auInvestment.div293Income
  ).isEstimated;
  const div293PaidFrom = taxRules.normalizeDiv293PaidFrom(auInvestment.div293PaidFrom);

  return (
    <div>
      <div className="note" style={{ marginBottom: 14 }}>
        <Info size={13} />
        <span>{t("auInvestmentSourceNote", { taxYear: investmentRules.effectiveTaxYear })}</span>
      </div>

      <Field guide={t("auAnnualSalaryGuide")} label={t("auAnnualSalaryLabel")} unit="A$" step={1000} value={auInvestment.annualSalary} onChange={(v) => onUpdate("annualSalary", v)} />
      <Field guide={t("auSalarySacrificeGuide")} label={t("auSalarySacrificeLabel")} unit="A$" step={500} value={auInvestment.voluntaryConcessional} onChange={(v) => onUpdate("voluntaryConcessional", v)} />
      <Field guide={t("auDiv293IncomeGuide")} label={t("auDiv293IncomeLabel")} unit="A$" step={1000} value={auInvestment.div293Income} onChange={(v) => onUpdate("div293Income", v)} />
      <div className="note" style={{ marginBottom: 10 }}>
        <Info size={13} />
        <span>{div293Estimated ? t("auDiv293IncomeEstimatedNote") : t("auDiv293IncomeExplicitNote")}</span>
      </div>

      <div className="field-label" style={{ marginBottom: 6 }}>{t("auDiv293PaidFromLabel")}</div>
      <div className="chip-row" style={{ marginBottom: 6 }}>
        <button
          className={`chip ${div293PaidFrom === "super" ? "chip-active" : ""}`}
          onClick={() => onUpdate("div293PaidFrom", "super")}
        >{t("auDiv293FromSuperLabel")}</button>
        <button
          className={`chip ${div293PaidFrom === "outside" ? "chip-active" : ""}`}
          onClick={() => onUpdate("div293PaidFrom", "outside")}
        >{t("auDiv293FromOutsideLabel")}</button>
      </div>
      <div className="note" style={{ marginBottom: 10 }}>
        <Info size={13} />
        <span>{div293PaidFrom === "super" ? t("auDiv293FromSuperNote") : t("auDiv293FromOutsideNote")}</span>
      </div>

      <div className="stat-grid" style={{ marginTop: 12 }}>
        <StatCard
          label={t("auSgContributionLabel", { pct: pct(l.superGuaranteeRate) })}
          value={money(sgContribution)}
          sub={t("auSgContributionSub", { pct: pct(l.superGuaranteeRate) })}
        />
        <StatCard
          label={t("auConcessionalCapLabel", { taxYear: investmentRules.effectiveTaxYear })}
          value={money(l.concessionalCap)}
          sub={t("auConcessionalCapSub", { amount: money(l.concessionalCap) })}
        />
        <StatCard
          label={t("auConcessionalRemainingLabel")}
          value={money(Math.max(0, concessionalRemaining))}
          sub={t("auContributionTaxSub")}
          tone={concessionalRemaining < 0 ? "danger" : "good"}
        />
      </div>
      {concessionalRemaining < 0 && (
        <>
          <div className="note" style={{ borderLeftColor: "#C2694F", marginTop: 10 }}>
            <Info size={13} style={{ color: "#C2694F" }} />
            <span>{t("auConcessionalOverLabel", { amount: money(-concessionalRemaining) })}</span>
          </div>
          <div className="note" style={{ borderLeftColor: "#C2694F", marginTop: 6 }}>
            <Info size={13} style={{ color: "#C2694F" }} />
            <span>{t("auConcessionalOverProjectionNote", {
              cap: money(l.concessionalCap),
              excess: money(-concessionalRemaining),
            })}</span>
          </div>
        </>
      )}
      {superContributionTax.div293Applies && (
        <div className="note" style={{ borderLeftColor: "#D9A54F", marginTop: 10 }}>
          <Info size={13} style={{ color: "#D9A54F" }} />
          <span>{t("auDiv293Note", {
            threshold: money(superTax.div293Threshold),
            pct: pct(superTax.contributionsTaxRate + superTax.div293AdditionalRate),
          })}</span>
        </div>
      )}

      <AUAccountFields
        accountKey="superannuation" title={t("auSuperLabel")} account={auInvestment.superannuation}
        onUpdateAccount={onUpdateAccount} borderColor="#B08FD6"
      />
      <div className="stat-grid" style={{ marginTop: 12 }}>
        <StatCard
          label={t("auContributionTaxLabel", { pct: pct(superTax.contributionsTaxRate) })}
          value={money(superContributionTax.total)}
          sub={t("auContributionTaxSub")}
          tone="danger"
        />
        <StatCard
          label={t("auSalarySacrificeSavingLabel")}
          value={money(salarySacrificeSaving)}
          sub={t("auSalarySacrificeSavingSub", { pct: pct(marginalRate) })}
          tone="good"
        />
      </div>
      <div className="note" style={{ marginTop: 10 }}>
        <Info size={13} />
        <span>{t("auPreservationAgeNote", { age: preservationAge, unrestricted: investmentRules.unrestrictedAccessAge })}</span>
      </div>
      <div className="note" style={{ marginTop: 8 }}>
        <Info size={13} />
        <span>{t("auSuperEarningsTaxNote", {
          pct: pct(superTax.earningsTaxAccumulation),
          age: preservationAge,
          tbc: money(l.transferBalanceCap),
        })}</span>
      </div>
      <div className="note" style={{ marginTop: 8 }}>
        <Info size={13} />
        <span>{t("auMinimumDrawdownNote", {
          under65: pct(investmentRules.minimumDrawdownFactors.under65),
          age65: pct(investmentRules.minimumDrawdownFactors["65to74"]),
          age75: pct(investmentRules.minimumDrawdownFactors["75to79"]),
          age95: pct(investmentRules.minimumDrawdownFactors["95plus"]),
        })}</span>
      </div>

      <AUAccountFields
        accountKey="investmentAccount" title={t("auInvestmentAccountLabel")} account={auInvestment.investmentAccount}
        onUpdateAccount={onUpdateAccount} borderColor="#D9A54F"
      />
      <AUAccountFields
        accountKey="cashSavings" title={t("auCashSavingsLabel")} account={auInvestment.cashSavings}
        onUpdateAccount={onUpdateAccount} borderColor="#7BC9E0"
      />

      <div className="stat-grid" style={{ marginTop: 16 }}>
        <StatCard label={t("auTotalAssetsLabel")} value={money(split.total)} sub={t("auTotalAssetsSub")} />
      </div>
      <div className="stat-grid" style={{ marginTop: 10 }}>
        <StatCard label={t("auLiquidAssetsLabel")} value={money(split.liquid)} sub={t("auLiquidAssetsSub", { age: preservationAge })} tone="good" />
        <StatCard
          label={t("auRestrictedAssetsLabel")}
          value={money(split.restricted)}
          sub={split.isAccessibleAge
            ? t("auRestrictedAssetsSubAccessible", { age: preservationAge })
            : t("auRestrictedAssetsSubLocked", { age: preservationAge })}
        />
        <StatCard label={t("auTaxAdvantagedLabel")} value={money(split.taxAdvantaged)} sub={t("auTaxAdvantagedSub")} />
      </div>

      <div className="section-block" style={{ borderColor: "#5FB0A0", marginTop: 16 }}>
        <div className="field-label" style={{ marginBottom: 6 }}>
          {t("auTaxSectionLabel", { taxYear: taxRules.effectiveTaxYear })}
        </div>
        <div className="note" style={{ marginBottom: 12 }}>
          <Info size={13} />
          <span>{t("auTaxSourceNote", { taxYear: taxRules.effectiveTaxYear })}</span>
        </div>
        <Field guide={t("auCapitalGainGuide")} label={t("auCapitalGainLabel")} unit="A$" step={500} value={auInvestment.estimatedCapitalGainAnnual} onChange={(v) => onUpdate("estimatedCapitalGainAnnual", v)} />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={!!auInvestment.capitalGainHeldOver12Months}
            onChange={(e) => onUpdate("capitalGainHeldOver12Months", e.target.checked)}
          />
          <span>{t("auCapitalGainDiscountLabel", { pct: pct(taxRules.capitalGains.discountRate) })}</span>
        </label>
        <div className="stat-grid" style={{ marginTop: 10 }}>
          <StatCard
            label={t("auIncomeTaxLabel")}
            value={money(taxResult.incomeTax)}
            sub={t("auIncomeTaxSub", { taxYear: taxRules.effectiveTaxYear })}
          />
          <StatCard
            label={t("auMedicareLevyLabel", { pct: pct(taxRules.medicareLevy.rate) })}
            value={money(taxResult.medicareLevy)}
            sub={t("auMedicareLevySub")}
          />
          <StatCard
            label={t("auCgtLabel")}
            value={money(capitalGainsTax)}
            sub={t("auCgtSub", { pct: pct(taxRules.capitalGains.discountRate) })}
          />
        </div>
        <div className="stat-grid" style={{ marginTop: 10 }}>
          <StatCard label={t("auTotalTaxLabel")} value={money(totalTax)} sub={t("auTotalTaxSub")} tone="danger" />
        </div>
        <div className="note" style={{ marginTop: 10 }}>
          <Info size={13} />
          <span>{t("auSuperTaxFreeNote", { age: preservationAge })}</span>
        </div>
      </div>
    </div>
  );
}


// ---------- オーストラリア選択時：医療費パネル（Medicare前提の簡易モデル） ----------
function AUHealthcarePanel({ auInvestment, onUpdate, totalAnnual }) {
  const { t, money } = useContext(LocaleContext);
  const h = auInvestment.healthcare;
  return (
    <div>
      <div className="note" style={{ marginBottom: 12 }}>
        <Info size={13} />
        <span>{t("auTaxSourceNote", { taxYear: "2026-27" })}</span>
      </div>
      <Field guide={t("auHealthcareGuide")} label={t("auGapLabel")} unit="A$" step={50} value={h.gapAnnual} onChange={(v) => onUpdate("gapAnnual", v)} />
      <Field label={t("auPrivateHealthLabel")} unit="A$" step={10} value={h.privateHealthInsuranceMonthly} onChange={(v) => onUpdate("privateHealthInsuranceMonthly", v)} />
      <Field label={t("auPharmaceuticalLabel")} unit="A$" step={50} value={h.pharmaceuticalAnnual} onChange={(v) => onUpdate("pharmaceuticalAnnual", v)} />
      <Field label={t("auDentalLabel")} unit="A$" step={50} value={h.dentalAnnual} onChange={(v) => onUpdate("dentalAnnual", v)} />
      <Field label={t("auOpticalLabel")} unit="A$" step={50} value={h.opticalAnnual} onChange={(v) => onUpdate("opticalAnnual", v)} />
      <Field label={t("auAgedCareLabel")} unit="A$" step={500} value={h.agedCareAnnual} onChange={(v) => onUpdate("agedCareAnnual", v)} />
      <Field label={t("auOtherOutOfPocketLabel")} unit="A$" step={50} value={h.otherOutOfPocketAnnual} onChange={(v) => onUpdate("otherOutOfPocketAnnual", v)} />
      <div className="stat-grid" style={{ marginTop: 10 }}>
        <StatCard label={t("auTotalTaxLabel")} value={money(totalAnnual)} sub={t("auExpensesTotalSub")} tone="danger" />
      </div>
    </div>
  );
}

// ---------- 取り崩し順序の表示（実装 DRAWDOWN_CATEGORIES と必ず一致する） ----------
function DrawdownOrderPanel({ order, accountsByCategory }) {
  const { t } = useContext(LocaleContext);
  const catLabel = {
    cash: t("drawCatCash"),
    taxable: t("drawCatTaxable"),
    taxFree: t("drawCatTaxFree"),
    restricted: t("drawCatRestricted"),
    physical: t("drawCatPhysical"),
  };
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="chart-label">{t("drawdownOrderTitle")}</div>
      <ol style={{ margin: "8px 0 10px 18px", padding: 0, fontSize: 13, lineHeight: 1.9 }}>
        {order.map((cat) => (
          <li key={cat}>
            <strong>{catLabel[cat] || cat}</strong>
            {accountsByCategory[cat] && accountsByCategory[cat].length > 0 && (
              <span style={{ opacity: 0.75 }}>　{accountsByCategory[cat].join(" / ")}</span>
            )}
          </li>
        ))}
      </ol>
      <div className="note">
        <Info size={13} />
        <span>{t("drawdownOrderNote")}</span>
      </div>
    </div>
  );
}

// ---------- 引出時課税（各口座ごとに利用者が変更できる） ----------
function WithdrawalTaxPanel({ accounts, onUpdateAccount }) {
  const { t } = useContext(LocaleContext);
  if (!accounts.length) return null;
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="chart-label">{t("withdrawalTaxTitle")}</div>
      {accounts.map((a) => (
        <Field
          key={a.key}
          label={`${a.label} — ${t("withdrawalTaxLabel")}`}
          unit="%"
          step={0.5}
          min={0}
          max={99}
          value={a.withdrawalTaxPct}
          onChange={(v) => onUpdateAccount(a.key, "withdrawalTaxPct", v)}
        />
      ))}
      <div className="note">
        <Info size={13} />
        <span>{t("withdrawalTaxNote")}</span>
      </div>
    </div>
  );
}

function SectionTitle({ index, title, icon: Icon }) {
  const { t } = useContext(LocaleContext);
  const backToNav = () => {
    // 項目一覧（ショートカットボタン群）へ戻る。無ければページ先頭へ。
    const el = document.getElementById("section-nav");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    // id を付けて、上部のショートカットボタンからここへ飛べるようにする
    <div className="section-title" id={`section-${index}`}>
      <span className="section-index">{index}</span>

      <Icon size={15} strokeWidth={1.75} />
      <h2>{title}</h2>
      {/* 各項目から項目一覧へ戻る */}
      <button className="back-to-nav no-print" onClick={backToNav} title={t("backToNavLabel")}>
        <ChevronUp size={13} strokeWidth={2} />
        <span>{t("backToNavLabel")}</span>
      </button>
    </div>
  );
}

// ---------- セクションへのショートカット（トップ画面のジャンプボタン） ----------
function SectionNav({ items }) {
  const { t } = useContext(LocaleContext);
  const jump = (anchor) => {
    const el = document.getElementById(anchor);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    // id="section-nav" は、各セクションの「一覧へ戻る」ボタンの戻り先
    <div className="card section-block no-print" id="section-nav" style={{ borderColor: "#4FA8D8", marginBottom: 18 }}>
      <div className="chart-label">{t("sectionNavTitle")}</div>
      <div className="section-nav">
        {items.map(({ index, anchor, title, icon: Icon }) => {
          // 入力セクション（00〜11）は section-NN、それ以外は anchor を直接使う。
          const target = anchor || `section-${index}`;
          return (
            <button key={target} className="section-nav-btn" onClick={() => jump(target)}>
              {Icon && <Icon size={14} strokeWidth={1.75} />}
              <span>{title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}


// 保存データを既定値へ深くマージする。
// 【修正】従来は { ...prev, ...parsed.inputs } の浅いマージだったため、旧バージョンで保存された
// 入れ子オブジェクト（ideco / usInvestment / gbInvestment / gold / healthBrackets 等）が
// 既定値をまるごと置き換えてしまい、後から追加したフィールドが undefined になっていた。
// undefined が Field の value に入ると React が非制御コンポーネント警告を出し、計算もNaNになりうる。
// 配列（銘柄リスト等）は「保存された内容そのもの」が正しいため、マージせず置き換える。
export function mergeSavedInputs(defaults, saved) {
  if (!saved || typeof saved !== "object") return defaults;
  const out = { ...defaults };
  Object.keys(saved).forEach((key) => {
    const savedValue = saved[key];
    const defaultValue = defaults[key];
    const bothPlainObjects =
      savedValue && typeof savedValue === "object" && !Array.isArray(savedValue) &&
      defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue);
    out[key] = bothPlainObjects ? mergeSavedInputs(defaultValue, savedValue) : savedValue;
  });
  return out;
}

const STORAGE_KEY = "nisa-lifeplan-inputs-v1";
// 使い方ガイドを一度閉じたかどうかだけを覚えるキー。入力データ（STORAGE_KEY）とは完全に別枠で、
// 読めなくても書けなくても、シミュレーションの計算・保存には一切影響しない。
const GUIDE_SEEN_KEY = "nisa-lifeplan-guide-seen-v1";
const SNAPSHOT_PREFIX = "snapshot:";
const todayKey = () => new Date().toISOString().slice(0, 10);
const formatDateLabel = (d) => {
  const dt = new Date(d + "T00:00:00");
  return `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
};

export default function NisaLifePlan({ onOpenBlog } = {}) {
  const [inputs, setInputs] = useState({
    country: "JP", // 表示名の切替に使用。計算ロジックは現状すべて日本のルールのまま
    baseCurrency: "JPY", // 金額表示に使用。countryとは別データ（将来、国と通貨の組み合わせを自由に変更可能にするため）
    language: "ja", // 将来のUI言語切替用（現時点ではlabel()は country ベースの表示名切替のみ）
    userName: "",
    birthDate: "",
    currentAge: 35,
    retireAge: 65,
    deathAge: 90,
    currentAssets: 0,
    currentAssetHoldings: [],
    tsumitateHoldings: [],
    tsumitateHoldingsAsOfYears: "", tsumitateHoldingsAsOfMonths: "", // この残高の基準年齢（未入力なら現在の年齢＝追加計算なし）
    growthHoldings: [],
    growthHoldingsAsOfYears: "", growthHoldingsAsOfMonths: "", // この残高の基準年齢（未入力なら現在の年齢＝追加計算なし）
    tsumitateSchedule: [],
    growthSchedule: [],
    tsumitateUsed: 0,
    growthUsed: 0,
    lumpSums: [],
    lumpAllocation: [],
    tsumitateAllocation: [],
    growthAllocation: [],
    extraFundReturns: {},
    pensionMonthly: 0,
    // 【追加】公的年金の受給開始年齢。退職年齢とは独立（未入力＝65歳）。
    // 退職60歳・年金65歳なら、60〜64歳は公的年金収入が0になる。
    publicPensionStartAge: 65,
    pensionSources: [],
    livingCostMonthly: 0,
    postRetireReturn: 3,
    postRetireReturnAuto: true,
    healthBrackets: { b60: 0, b70: 0, b80: 0 },
    inheritanceTarget: 0,
    inheritancePlans: [],
    gold: {
      currentGrams: 0,
      pricePerGram: 0,
      priceGrowthPct: 3,
      priceGrowthPctAuto: true,
      monthlyYen: 0,
      accumulateUntilAge: 65,
      asOfYears: "",
      asOfMonths: "",
    },
    banks: [],
    stockReturnPct: 6,
    stockReturnPctAuto: true,
    ideco: {
      currentValue: 0,
      principalTotal: 0,
      monthlyContribution: 0,
      startAge: 35,
      endAge: 60,
      productName: "", // 初期値は空。国を切り替えても、未入力のままなら何も入れ替わらない
      returnPct: 5,
      returnPctAuto: true,
      payoutStartAge: 60,
      payoutMethod: "lump", // "lump" | "pension" | "both"
      payoutYears: 10,
      lumpPortionPct: 50, // 併用時の一時金割合（%）
      payoutReturnPct: 0, // 受取中の想定運用利回り
      annualIncome: 0,
      asOfYears: "",
      asOfMonths: "",
    },
    loans: [],
    insurancePolicies: [],
    privatePensionPlans: [],
    // アメリカ選択時の投資口座（401(k) / Traditional IRA / Roth IRA / Brokerage）。
    // JP側のNISA関連フィールド（tsumitateSchedule等）とは完全に独立した専用データ。
    usInvestment: {
      filingStatus: "single", // "single" | "marriedJoint" | "marriedSeparate" | "headOfHousehold"
      modifiedAGI: 0,
      coveredByWorkplacePlan: false,
      spouseCoveredByWorkplacePlan: false,
      // withdrawalTaxPct = 引出時にかかる税率（%）。総資産推移の取り崩し計算に反映される。
      // 初期値は代表的な実効税率。利用者が各口座ごとに変更できる。
      // 401(k)/Traditional IRA は引出額が通常所得として課税される（初期値22%）。
      // Roth IRA は適格引出なら非課税（0%）。Brokerage は長期キャピタルゲイン（初期値15%）。
      k401: { currentValue: 0, annualContribution: 0, withdrawalTaxPct: 22 },
      traditionalIra: { currentValue: 0, annualContribution: 0, withdrawalTaxPct: 22 },
      rothIra: { currentValue: 0, annualContribution: 0, withdrawalTaxPct: 0 },
      brokerage: { currentValue: 0, annualContribution: 0, withdrawalTaxPct: 15 },
      expectedReturnPct: 6, // 資産推移グラフ用の想定年率（JP版のデフォルト想定に準じた参考値）
      // ① Social Security（公的年金）
      socialSecurity: {
        piaMonthly: 0, // Full Retirement Age（67歳）時点の月額見込み（ユーザー入力・SSA statement等を参照）
        claimAge: 67, // 62〜70の範囲で選択（早期受給／通常受給／繰下げ受給）
      },
      // ③ Healthcare（米国向け）
      healthcare: {
        healthInsuranceMonthly: 0, // Medicare以外の民間医療保険料（該当する場合）
        outOfPocketAnnual: 0, // 自己負担分の年間見込み額
      },
      // ④ Tax（簡易版）
      stateTaxRatePct: 0, // 州税は州により大きく異なるため、概算の実効税率をユーザーが入力する
      estimatedCapitalGainAnnual: 0, // 年間のキャピタルゲイン実現見込み額（Brokerage口座想定）
      // ⑤ 退職後の生活費（Expenses）。JPのlivingCostMonthlyとは別データ
      expensesMonthly: 0,
    },
    // イギリス選択時の投資口座・年金・医療費。
    // JP側（NISA/iDeCo）・US側（usInvestment）とは完全に独立した専用データ。
    // 6口座それぞれが「現在額・年間積立額・想定利回り・積立終了年齢」を個別に持つ。
    gbInvestment: {
      annualIncome: 0,   // 年間総所得（Income Tax・配当税・CGT・年金税軽減の判定に使用）
      adjustedIncome: 0, // 年金拠出上限のテーパリング判定用（0なら annualIncome を使用）
      dividendIncomeAnnual: 0,
      estimatedCapitalGainAnnual: 0,
      // withdrawalTaxPct：ISAは非課税(0%)。SIPP・職域年金は25%が非課税で残り75%が所得課税
      // されるため、基本税率20%なら実効15%（初期値）。GIAはCGT（初期値10%）。
      stocksSharesIsa:  { currentValue: 0, annualContribution: 0, expectedReturnPct: 5, contributionEndAge: 65, withdrawalTaxPct: 0 },
      cashIsa:          { currentValue: 0, annualContribution: 0, expectedReturnPct: 3, contributionEndAge: 65, withdrawalTaxPct: 0 },
      sipp:             { currentValue: 0, annualContribution: 0, expectedReturnPct: 5, contributionEndAge: 65, withdrawalTaxPct: 15 },
      workplacePension: { currentValue: 0, annualContribution: 0, expectedReturnPct: 5, contributionEndAge: 65, withdrawalTaxPct: 15 },
      gia:              { currentValue: 0, annualContribution: 0, expectedReturnPct: 5, contributionEndAge: 65, withdrawalTaxPct: 10 },
      cashSavings:      { currentValue: 0, annualContribution: 0, expectedReturnPct: 2, contributionEndAge: 65, withdrawalTaxPct: 0 },
      // ② State Pension（英国の公的年金）
      statePension: {
        // State Pension age は生年月日から法律に従って自動算出する（Pensions Act 2007/2014）。
        // ここは「手動で上書きしたい場合のみ」使う任意項目。0 / 空 なら自動算出値を使う。
        statePensionAgeOverride: 0,
        claimAge: 67,              // 繰下げ受給する場合はここを引き上げる（繰上げ受給は不可）
        // 初期値は2026/27年度の満額（参考値）。実際の受給額はNational Insuranceの加入記録により
        // 異なるため、利用者がGOV.UKのforecastで確認した見込額で必ず上書きできる。
        // 数値そのものは GB_COUNTRY_RULES にのみ持たせ、ここでは参照するだけにしている。
        estimatedAnnual: Math.round(GB_COUNTRY_RULES.retirement.statePension.fullAnnualRate),
        incomeOverlapYears: 0,     // 受給開始後も収入が続く年数
        additionalPensionAnnual: 0,
      },
      // ④ Healthcare（NHS前提の簡易モデル）
      healthcare: {
        nhsBasicAnnual: 0,
        privateHealthInsuranceMonthly: 0,
        dentalAnnual: 0,
        prescriptionAnnual: 0,
        longTermCareAnnual: 0,
        otherOutOfPocketAnnual: 0,
      },
      // ⑤ 退職後の生活費。JPのlivingCostMonthly・USのusInvestment.expensesMonthlyとは別データ
      expensesMonthly: 0,
    },
    // カナダ選択時の投資口座・年金・医療費。
    // JP（NISA/iDeCo）・US（usInvestment）・GB（gbInvestment）とは完全に独立した専用データ。
    // 4口座それぞれが「現在額・年間積立額・想定利回り・積立終了年齢」を個別に持つ。
    caInvestment: {
      annualIncome: 0,        // 年間総所得（連邦所得税・RRSP税軽減・OASクローバックの判定に使用）
      priorEarnedIncome: 0,   // 前年の稼得所得（RRSP拠出枠 = この18% と $33,810 の低い方）
      estimatedCapitalGainAnnual: 0,
      // withdrawalTaxPct：TFSAは非課税(0%)。RRSP/RRIFからの引出は全額が課税所得（初期値25%）。
      // 非登録口座はキャピタルゲインの50%課税（初期値12%）。
      tfsa:          { currentValue: 0, annualContribution: 0, expectedReturnPct: 5, contributionEndAge: 65, withdrawalTaxPct: 0 },
      rrsp:          { currentValue: 0, annualContribution: 0, expectedReturnPct: 5, contributionEndAge: 65, withdrawalTaxPct: 25 },
      nonRegistered: { currentValue: 0, annualContribution: 0, expectedReturnPct: 5, contributionEndAge: 65, withdrawalTaxPct: 12 },
      cashSavings:   { currentValue: 0, annualContribution: 0, expectedReturnPct: 2, contributionEndAge: 65, withdrawalTaxPct: 0 },
      // CPP（拠出型の公的年金）
      cpp: {
        startAge: 65,           // 60〜70歳で選択可
        // 初期値は2026年の満額（参考値）。実際の受給額は拠出履歴により大きく異なるため、
        // My Service Canada Account で確認した見込額で必ず上書きできる。
        estimatedAnnualAt65: Math.round(CA_COUNTRY_RULES.retirement.getCppMaxAnnualAt65()),
      },
      // OAS（居住年数ベースの公的年金）
      oas: {
        startAge: 65,           // 65〜70歳（繰上げ不可）
        residenceYears: 40,     // 18歳以降のカナダ居住年数（40年で満額）
      },
      additionalPensionAnnual: 0, // 職域年金など、任意の追加年金収入（年額）
      // 医療費（州の公的医療保険でカバーされる前提の簡易モデル）
      healthcare: {
        basicAnnual: 0,
        privateHealthInsuranceMonthly: 0,
        prescriptionAnnual: 0,
        dentalAnnual: 0,
        visionAnnual: 0,
        longTermCareAnnual: 0,
        otherOutOfPocketAnnual: 0,
      },
      // 退職後の生活費。他国のデータとは別項目
      expensesMonthly: 0,
    },
    // オーストラリア選択時の投資口座・年金・医療費。
    // 他国（JP/US/GB/CA）とは完全に独立した専用データ。
    auInvestment: {
      annualSalary: 0,             // 年間給与（SG拠出額・所得税・Div293の判定に使用）
      voluntaryConcessional: 0,    // 給与犠牲などの任意の税引前拠出（年額）
      // Division 293 income（概算）。ATOの定義は課税所得＋報告対象フリンジベネフィット＋
      // 純投資損失＋純賃貸損失等の合計で、年収そのものではない。0（未入力）なら
      // annualSalary で代用し、画面に簡易計算である旨を表示する。
      div293Income: 0,
      // Division 293 税の支払元："super"（Super残高から）／"outside"（口座外の現金から）
      div293PaidFrom: "super",
      estimatedCapitalGainAnnual: 0,
      capitalGainHeldOver12Months: true,
      // withdrawalTaxPct：60歳以降のSuperからの引出は非課税(0%)。
      // 課税投資口座はキャピタルゲイン50%割引後の課税（初期値15%）。
      superannuation:    { currentValue: 0, annualContribution: 0, expectedReturnPct: 7, contributionEndAge: 65, withdrawalTaxPct: 0 }, // annualContributionは税引後（non-concessional）拠出
      investmentAccount: { currentValue: 0, annualContribution: 0, expectedReturnPct: 7, contributionEndAge: 65, withdrawalTaxPct: 15 },
      cashSavings:       { currentValue: 0, annualContribution: 0, expectedReturnPct: 2, contributionEndAge: 65, withdrawalTaxPct: 0 },
      // Age Pension（資産・所得テストあり）
      agePension: {
        status: "single",          // "single" または "couple"
        homeowner: true,           // 持家かどうか（資産テストの無影響枠が変わる）
        // カップルのとき、双方が受給資格年齢（67歳）に達しているか。
        // 双方なら世帯の年金収入は1人あたりの2倍になる。片方だけなら1人分。
        bothQualified: true,
        // Age Pensionの所得テストで評価される、年金以外の年間収入。
        // 金融資産からのみなし収入（Deeming）は別途自動で加算されるので、ここには含めない。
        otherAnnualIncome: 0,
      },
      // 医療費（Medicare前提の簡易モデル）
      healthcare: {
        gapAnnual: 0,
        privateHealthInsuranceMonthly: 0,
        pharmaceuticalAnnual: 0,
        dentalAnnual: 0,
        opticalAnnual: 0,
        agedCareAnnual: 0,
        otherOutOfPocketAnnual: 0,
      },
      expensesMonthly: 0,
    },
  });
  const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST);

  // ---------- 国際化（i18n）：国が"JP"のままなら、moneyはyenと完全に同じ結果を返す ----------
  // 重要：このブロックはファイル内で最初期（他のuseMemo/useCallbackより前）に置くこと。
  // useMemoのファクトリ関数はレンダー中に同期的に即時実行されるため、
  // t/money/label をこれより後方で定義すると初期化前アクセスのエラーになる。
  const country = inputs.country || "JP";
  const baseCurrency = inputs.baseCurrency || "JPY";
  const language = inputs.language || "ja";
  // 国別計算エンジンのルールセット。投資/年金/医療費/税制それぞれの implemented フラグを
  // 見て、未実装の国では日本の数値をそのまま見せないよう画面側で分岐する。
  // 使い方ガイド：初回は開いた状態で始まり、「閉じる」を押すと次回以降は折りたたまれた状態で始まる。
  // 既読判定が終わるまでは null（＝折りたたみ表示）にしておく。判定後に true/false が入る。
  // これにより、2回目以降の利用者に「一瞬開いてから閉じる」ちらつきが出ない。
  const [showGettingStarted, setShowGettingStarted] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 保存領域が使えない環境（プライベートブラウズ等）では、毎回「初回」として開く
      if (!window.storage) {
        if (!cancelled) setShowGettingStarted(true);
        return;
      }
      try {
        const res = await window.storage.get(GUIDE_SEEN_KEY, false);
        // 既読フラグがあれば折りたたみ、無ければ（＝キーが無く例外になる場合も含め）開く
        if (!cancelled) setShowGettingStarted(!(res && res.value));
      } catch {
        if (!cancelled) setShowGettingStarted(true); // 未読とみなして開く
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const closeGettingStarted = () => {
    setShowGettingStarted(false);
    // 保存に失敗しても表示上は閉じる。await せず投げっぱなしにすると未処理の Promise 拒否に
    // なるため、必ず catch でつぶす（既存の入力データの保存処理には一切影響しない）。
    try {
      Promise.resolve(window.storage?.set(GUIDE_SEEN_KEY, "1", false)).catch(() => {});
    } catch {
      /* 保存領域が使えない環境では何もしない */
    }
  };

  const rules = useMemo(() => getCountryRules(country), [country]);
  const countryDisplayName = useMemo(
    () => SUPPORTED_COUNTRIES.find((c) => c.code === country)?.name || country,
    [country]
  );

  // 生年月日が入力されていれば、今日時点での正確な年齢（日単位）をそこから自動計算し、
  // 現在の年齢として全体のシミュレーションに反映する
  // ※ AU など各国の派生計算（useMemo の依存配列を含む）から参照されるため、
  //    必ず国別派生計算より前に宣言する（後ろに置くと TDZ で白画面になる）
  const preciseAge = useMemo(() => computeAgeFromBirthDate(inputs.birthDate), [inputs.birthDate]);
  const effectiveCurrentAge = preciseAge ? preciseAge.decimal : inputs.currentAge;

  // ---------- アメリカ選択時の派生計算（すべて US_COUNTRY_RULES の関数のみを使用） ----------
  // country !== "US" のときは呼び出さない（JP_COUNTRY_RULES 等には同名メソッドが存在しないため）。
  const usFilingStatus = inputs.usInvestment.filingStatus;
  const usMagi = Number(inputs.usInvestment.modifiedAGI) || 0;
  const usFederalTaxResult = (country === "US" && rules.tax.implemented)
    ? rules.tax.calculateFederalTax(usMagi, usFilingStatus)
    : { taxableIncome: 0, tax: 0 };
  const usCapitalGain = Number(inputs.usInvestment.estimatedCapitalGainAnnual) || 0;
  const usLtcgTax = (country === "US" && rules.tax.implemented)
    ? rules.tax.calculateLtcgTax(usFederalTaxResult.taxableIncome, usCapitalGain, usFilingStatus)
    : 0;
  const usNiit = (country === "US" && rules.tax.implemented)
    ? rules.tax.calculateNiit(usMagi, usCapitalGain, usFilingStatus)
    : 0;
  const usStateTax = country === "US" ? usMagi * ((Number(inputs.usInvestment.stateTaxRatePct) || 0) / 100) : 0;
  const usTotalTax = usFederalTaxResult.tax + usLtcgTax + usNiit + usStateTax;

  // RMDのうち生活費を超えて引き出した分にかかる税の概算率。
  // 課税繰延口座（Traditional IRA / 401(k)）からの引出は通常所得として課税されるため、
  // 「連邦の限界税率 ＋ ユーザー入力の州税率」で概算する。確定申告の計算ではない。
  const usRmdTaxRatePct = useMemo(() => {
    if (country !== "US" || !rules.tax.implemented) return 0;
    const fs = rules.tax.federalBrackets2026[usFilingStatus] ? usFilingStatus : "single";
    const brackets = rules.tax.federalBrackets2026[
      fs === "marriedSeparate" || fs === "headOfHousehold" ? "single" : fs
    ] || rules.tax.federalBrackets2026.single;
    const taxable = usFederalTaxResult.taxableIncome;
    const bracket = brackets.find((b) => taxable <= b.upTo) || brackets[brackets.length - 1];
    const federalPct = bracket.rate * 100;
    const statePct = Number(inputs.usInvestment.stateTaxRatePct) || 0;
    return Math.min(federalPct + statePct, 100);
  }, [country, rules, usFilingStatus, usFederalTaxResult.taxableIncome, inputs.usInvestment.stateTaxRatePct]);

  const usMedicareAnnual = (country === "US" && rules.healthcare.implemented)
    ? rules.healthcare.getAnnualMedicarePartB(usFilingStatus, usMagi)
    : 0;
  const usHealthInsuranceAnnual = (Number(inputs.usInvestment.healthcare.healthInsuranceMonthly) || 0) * 12;
  const usOutOfPocketAnnual = Number(inputs.usInvestment.healthcare.outOfPocketAnnual) || 0;
  const usTotalHealthcareAnnual = usMedicareAnnual + usHealthInsuranceAnnual + usOutOfPocketAnnual;

  const usClaimAge = Number(inputs.usInvestment.socialSecurity.claimAge) || 67;
  const usPiaMonthly = Number(inputs.usInvestment.socialSecurity.piaMonthly) || 0;
  const usSSMonthlyBenefit = (country === "US" && rules.retirement.implemented)
    ? rules.retirement.getMonthlyBenefit(usPiaMonthly, usClaimAge)
    : 0;
  const usSSAnnualBenefit = usSSMonthlyBenefit * 12;

  const usExpensesAnnual = (Number(inputs.usInvestment.expensesMonthly) || 0) * 12;
  const usRetirementIncomeAnnual = usSSAnnualBenefit;
  const usWithdrawalNeeded = Math.max(0, usExpensesAnnual + usTotalHealthcareAnnual - usRetirementIncomeAnnual);
  const usIncomeSurplus = Math.max(0, usRetirementIncomeAnnual - (usExpensesAnnual + usTotalHealthcareAnnual));
  const usTotalInvestmentBalance =
    (Number(inputs.usInvestment.k401.currentValue) || 0) +
    (Number(inputs.usInvestment.traditionalIra.currentValue) || 0) +
    (Number(inputs.usInvestment.rothIra.currentValue) || 0) +
    (Number(inputs.usInvestment.brokerage.currentValue) || 0);

  // ---------- イギリス選択時の派生計算（すべて GB_COUNTRY_RULES の関数のみを使用） ----------
  // country !== "GB" のときは各ルール関数を呼び出さない（JP/USのルールには同名メソッドが存在しないため）。
  const gbInvestment = inputs.gbInvestment;
  const gbIsGB = country === "GB";
  const gbGrossIncome = Number(gbInvestment.annualIncome) || 0;
  const gbAdjustedIncome = Number(gbInvestment.adjustedIncome) || gbGrossIncome;

  const gbIncomeTaxResult = (gbIsGB && rules.tax.implemented)
    ? rules.tax.calculateIncomeTax(gbGrossIncome)
    : { personalAllowance: 0, taxableIncome: 0, tax: 0 };
  const gbDividendTax = (gbIsGB && rules.tax.implemented)
    ? rules.tax.calculateDividendTax(gbInvestment.dividendIncomeAnnual, gbGrossIncome)
    : 0;
  const gbCapitalGainsTax = (gbIsGB && rules.tax.implemented)
    ? rules.tax.calculateCapitalGainsTax(gbInvestment.estimatedCapitalGainAnnual, gbGrossIncome)
    : 0;
  const gbMarginalRate = (gbIsGB && rules.tax.implemented)
    ? rules.tax.getMarginalRate(gbGrossIncome)
    : 0;
  const gbPensionAnnualAllowance = (gbIsGB && rules.investment.implemented)
    ? rules.investment.getPensionAnnualAllowance(gbAdjustedIncome)
    : 0;
  const gbPensionContribution = (gbIsGB && rules.investment.implemented)
    ? rules.investment.getPensionContributed(gbInvestment)
    : 0;
  const gbPensionTaxRelief = (gbIsGB && rules.tax.implemented)
    ? rules.tax.calculatePensionTaxRelief(gbPensionContribution, gbGrossIncome, gbPensionAnnualAllowance)
    : 0;
  // 年金拠出による軽減額が税額を上回る場合でもマイナス表示にはしない
  const gbTotalTax = Math.max(0, gbIncomeTaxResult.tax + gbDividendTax + gbCapitalGainsTax - gbPensionTaxRelief);

  const gbHealthcareAnnual = (gbIsGB && rules.healthcare.implemented)
    ? rules.healthcare.getAnnualTotal(gbInvestment.healthcare)
    : 0;

  // State Pension age は生年月日から自動算出する（法定スケジュール）。
  // 利用者が statePensionAgeOverride に値を入れた場合のみ、その値で上書きする。
  const gbStatePensionAgeInfo = (gbIsGB && rules.retirement.implemented)
    ? rules.retirement.resolveStatePensionAge(inputs.birthDate, gbInvestment.statePension.statePensionAgeOverride)
    : { ageInYears: 67, isAuto: false, detail: null };
  const gbStatePensionAge = gbStatePensionAgeInfo.ageInYears;
  const gbClaimAge = Number(gbInvestment.statePension.claimAge) || gbStatePensionAge;
  const gbEffectiveClaimAge = (gbIsGB && rules.retirement.implemented)
    ? rules.retirement.getEffectiveClaimAge(gbClaimAge, gbStatePensionAge)
    : gbClaimAge;
  const gbDeferralFactor = (gbIsGB && rules.retirement.implemented)
    ? rules.retirement.getDeferralFactor(gbEffectiveClaimAge, gbStatePensionAge)
    : 1;
  const gbStatePensionAnnual = (gbIsGB && rules.retirement.implemented)
    ? rules.retirement.getAnnualBenefit(gbInvestment.statePension.estimatedAnnual, gbEffectiveClaimAge, gbStatePensionAge)
    : 0;
  const gbFullStatePensionAnnual = (gbIsGB && rules.retirement.implemented)
    ? rules.retirement.getFullAnnualRate()
    : 0;
  const gbAdditionalPensionAnnual = Number(gbInvestment.statePension.additionalPensionAnnual) || 0;
  const gbRetirementIncomeAnnual = gbStatePensionAnnual + gbAdditionalPensionAnnual;
  const gbExpensesAnnual = (Number(gbInvestment.expensesMonthly) || 0) * 12;
  const gbWithdrawalNeeded = Math.max(0, gbExpensesAnnual + gbHealthcareAnnual - gbRetirementIncomeAnnual);
  const gbIncomeSurplus = Math.max(0, gbRetirementIncomeAnnual - (gbExpensesAnnual + gbHealthcareAnnual));

  // ---------- カナダ選択時の派生計算（すべて CA_COUNTRY_RULES の関数のみを使用） ----------
  // country !== "CA" のときは各ルール関数を呼び出さない（他国のルールには同名メソッドが存在しないため）。
  const caInvestment = inputs.caInvestment;
  const caIsCA = country === "CA";
  const caGrossIncome = Number(caInvestment.annualIncome) || 0;
  const caPriorEarnedIncome = Number(caInvestment.priorEarnedIncome) || caGrossIncome;

  const caFederalTaxResult = (caIsCA && rules.tax.implemented)
    ? rules.tax.calculateFederalTax(caGrossIncome)
    : { taxableIncome: 0, grossTax: 0, basicPersonalAmount: 0, bpaCredit: 0, tax: 0 };
  const caCapitalGainsTax = (caIsCA && rules.tax.implemented)
    ? rules.tax.calculateCapitalGainsTax(caInvestment.estimatedCapitalGainAnnual, caGrossIncome)
    : 0;
  const caMarginalRate = (caIsCA && rules.tax.implemented) ? rules.tax.getMarginalRate(caGrossIncome) : 0;
  const caRrspRoom = (caIsCA && rules.investment.implemented)
    ? rules.investment.getRrspRoom(caPriorEarnedIncome)
    : 0;
  const caRrspTaxSaving = (caIsCA && rules.tax.implemented)
    ? rules.tax.calculateRrspTaxSaving(caInvestment.rrsp.annualContribution, caGrossIncome, caRrspRoom)
    : 0;
  // 税額合計（RRSP拠出による軽減後）。軽減が税額を上回ってもマイナス表示にはしない。
  const caTotalTax = Math.max(0, caFederalTaxResult.tax + caCapitalGainsTax - caRrspTaxSaving);

  const caHealthcareAnnual = (caIsCA && rules.healthcare.implemented)
    ? rules.healthcare.getAnnualTotal(caInvestment.healthcare)
    : 0;

  const caCppStartAge = Number(caInvestment.cpp.startAge) || 65;
  const caCppFactor = (caIsCA && rules.retirement.implemented) ? rules.retirement.getCppFactor(caCppStartAge) : 1;
  const caCppAnnual = (caIsCA && rules.retirement.implemented)
    ? rules.retirement.getCppAnnualBenefit(caInvestment.cpp.estimatedAnnualAt65, caCppStartAge)
    : 0;
  const caCppMaxAnnual = (caIsCA && rules.retirement.implemented) ? rules.retirement.getCppMaxAnnualAt65() : 0;

  const caOasStartAge = Number(caInvestment.oas.startAge) || 65;
  const caOasEffectiveStartAge = (caIsCA && rules.retirement.implemented)
    ? rules.retirement.getOasEffectiveStartAge(caOasStartAge)
    : caOasStartAge;
  const caOasFactor = (caIsCA && rules.retirement.implemented) ? rules.retirement.getOasFactor(caOasStartAge) : 1;
  const caOasResidenceFraction = (caIsCA && rules.retirement.implemented)
    ? rules.retirement.getOasResidenceFraction(caInvestment.oas.residenceYears)
    : 0;
  // ここで求めるのは「受給開始時点」のOAS年額（＝画面のカード表示に使う初年度の金額）。
  // 第1引数の age に受給開始年齢（65〜70）を渡すため、この値は必ず65〜74歳のレートになる。
  // 75歳到達による10%上乗せは受給開始後に起きる変化なので、この表示値ではなく
  // utils/buildPlanInput.js の publicPensions.monthlyAmountAt(age) 側で年齢に応じて反映される。
  // （上乗せ後の金額そのものは caOasEnhancedNote で別途案内している）
  const caOasBeforeClawback = (caIsCA && rules.retirement.implemented)
    ? rules.retirement.getOasAnnualBeforeClawback(caOasEffectiveStartAge, caOasStartAge, caInvestment.oas.residenceYears)
    : 0;
  // クローバックの判定に使う純所得＝年間総所得（利用者が退職後の想定所得を入力する）。
  // ※ 本来はその年の純世界所得で毎年再計算すべきもの。将来対応（CA.js の
  //    retirement.notImplemented に記載）。
  const caOasClawback = (caIsCA && rules.retirement.implemented)
    ? rules.retirement.getOasClawback(caGrossIncome, caOasBeforeClawback)
    : 0;
  const caOasAnnual = caOasBeforeClawback - caOasClawback;

  const caAdditionalPensionAnnual = Number(caInvestment.additionalPensionAnnual) || 0;
  const caRetirementIncomeAnnual = caCppAnnual + caOasAnnual + caAdditionalPensionAnnual;
  const caExpensesAnnual = (Number(caInvestment.expensesMonthly) || 0) * 12;
  const caWithdrawalNeeded = Math.max(0, caExpensesAnnual + caHealthcareAnnual - caRetirementIncomeAnnual);
  const caIncomeSurplus = Math.max(0, caRetirementIncomeAnnual - (caExpensesAnnual + caHealthcareAnnual));

  // ---------- オーストラリア選択時の派生計算（すべて AU_COUNTRY_RULES の関数のみを使用） ----------
  const auInvestment = inputs.auInvestment;
  const auIsAU = country === "AU";
  const auSalary = Number(auInvestment.annualSalary) || 0;
  const auVoluntaryConcessional = Number(auInvestment.voluntaryConcessional) || 0;

  const auSgContribution = (auIsAU && rules.investment.implemented)
    ? rules.investment.getEmployerSgContribution(auSalary) : 0;
  const auTotalConcessional = (auIsAU && rules.investment.implemented)
    ? rules.investment.getTotalConcessional(auSalary, auVoluntaryConcessional) : 0;
  const auConcessionalCap = (auIsAU && rules.investment.implemented)
    ? rules.investment.getConcessionalCap() : 0;
  const auConcessionalRemaining = auConcessionalCap - auTotalConcessional;
  const auNonConcessionalRemaining = (auIsAU && rules.investment.implemented)
    ? rules.investment.getNonConcessionalRemaining(auInvestment.superannuation.annualContribution) : 0;

  // 課税所得＝給与 − 給与犠牲（税引前拠出は課税所得から控除される）
  const auTaxableIncome = Math.max(0, auSalary - auVoluntaryConcessional);
  const auTaxResult = (auIsAU && rules.tax.implemented)
    ? rules.tax.calculateTotalTax(auTaxableIncome)
    : { incomeTax: 0, medicareLevy: 0, total: 0 };
  const auMarginalRate = (auIsAU && rules.tax.implemented)
    ? rules.tax.getMarginalRateWithLevy(auTaxableIncome) : 0;
  // Division 293 income：入力があればそれを、無ければ課税所得の概算（年収 − 給与犠牲）を使う。
  // 画面カードと本番投影（buildPlanInput）で同じ基準を使うこと。
  // 【重要】AU専用のルール関数は他国のルールに存在しない。
  //   rules.tax.implemented は JP/US/GB/CA でも true なので、それだけでは
  //   ガードにならず、他国選択時に TypeError で画面が真っ白になる。
  //   必ず auIsAU で country を見たうえで、関数の存在も確認してから呼ぶこと。
  const auDiv293IncomeResolved =
    auIsAU
    && rules.tax.implemented
    && typeof rules.tax.resolveDivision293Income === "function"
      ? rules.tax.resolveDivision293Income(auTaxableIncome, auInvestment.div293Income)
      : { income: 0, isEstimated: true };
  const auDiv293PaidFrom =
    auIsAU
    && rules.tax.implemented
    && typeof rules.tax.normalizeDiv293PaidFrom === "function"
      ? rules.tax.normalizeDiv293PaidFrom(auInvestment.div293PaidFrom)
      : "super";
  // 拠出課税・Division 293 の課税標準には concessional cap 適用後の額を使う
  // （cap超過分は low tax contributions ではなく、別枠で課税されるため）。
  const auCappedConcessional = (auIsAU && rules.investment.implemented)
    ? rules.investment.getCappedConcessional(auSalary, auVoluntaryConcessional) : 0;
  const auSuperContributionTax = (auIsAU && rules.tax.implemented)
    ? rules.tax.calculateSuperContributionTax(auCappedConcessional, auDiv293IncomeResolved.income)
    : { baseTax: 0, div293Tax: 0, total: 0, effectiveRate: 0, div293Applies: false };
  const auDiv293Tax = auSuperContributionTax.div293Tax;
  const auSalarySacrificeSaving = (auIsAU && rules.tax.implemented)
    ? rules.tax.calculateSalarySacrificeSaving(auVoluntaryConcessional, auSalary) : 0;
  const auCapitalGainsTax = (auIsAU && rules.tax.implemented)
    ? rules.tax.calculateCapitalGainsTax(
        auInvestment.estimatedCapitalGainAnnual,
        auTaxableIncome,
        auInvestment.capitalGainHeldOver12Months
      )
    : 0;
  const auTotalTax = auTaxResult.total + auCapitalGainsTax;

  const auHealthcareAnnual = (auIsAU && rules.healthcare.implemented)
    ? rules.healthcare.getAnnualTotal(auInvestment.healthcare) : 0;

  // ---------- Age Pension（画面カードに出す「受給開始時点の見込額」）----------
  // ここで求めるのは画面表示用の値であって、投影に使う値ではない。
  // 投影中のAge Pensionは lifePlanEngine 側が毎ステップその時点の資産で再判定している
  //   （utils/buildPlanInput.js の publicPensions.monthlyAmountAt + assessedPoolIds /
  //     deemedPoolIds を参照）。資産が減れば受給額は増える。
  // 画面カードには「受給資格年齢に到達した時点の見込額」を出す。
  // 取り崩し額そのものがAge Pensionに依存して循環するため、算定は2パスに分ける。
  //   パス1：Age Pensionを一切見込まない取り崩し額で資産を投影し、受給資格年齢時点の総資産を得る
  //   パス2：その資産額で所得テスト（Deeming込み）・資産テストを行い、見込額を確定する
  const auAgePensionQualifyingAge = (auIsAU && rules.retirement.implemented)
    ? rules.retirement.getQualifyingAge() : 67;
  const auOtherAnnualIncome = Number(auInvestment.agePension.otherAnnualIncome) || 0;
  const auExpensesAnnual = (Number(auInvestment.expensesMonthly) || 0) * 12;
  // 【重要】Age Pension の資産テスト／Deemingの対象は、AU版の3口座だけではない。
  //   共通で持っている銀行預金・個別株・金・民間年金原資も対象に含まれる
  //   （utils/buildPlanInput.js の assessedPoolIds / deemedPoolIds を参照）。
  //   3口座だけで画面カード用に別計算すると、カードの金額と総資産グラフの内側で
  //   使われる金額が食い違う。そこでカードの値は runIntegratedPlan の結果から読み取る。
  //   ここではまだ integrated が無いので、planCtx へ渡すシードだけを置く。
  //   buildPlanInput は retirement.implemented のとき publicPensions に monthlyAmountAt を
  //   積み、monthlyAmount（＝このシード）は必ず上書きされるため、投影結果には影響しない。
  const auAgePensionAnnualSeed = 0;
  const auAgePensionMaxAnnual = (auIsAU && rules.retirement.implemented)
    ? rules.retirement.getMaxAnnual(auInvestment.agePension.status) : 0;

  const money = useCallback((n) => formatMoneyFor(baseCurrency, n), [baseCurrency]);
  const label = useCallback((key) => getCategoryLabel(key, country), [country]);
  const t = useCallback((key, vars) => translateWith(language, key, vars), [language]);
  // 海外（日本語以外）でコラムを開こうとしたときに「準備中」表示を出すためのフラグ
  const [blogComingSoon, setBlogComingSoon] = useState(false);
  // Field/表示用の単位文字列（通貨のみ切替、円建て表示のロジック自体は変更しない）
  const currencySymbol = (CURRENCY_BY_CODE[baseCurrency] || CURRENCY_BY_CODE.JPY).symbol;
  const localeValue = useMemo(
    () => ({ country, baseCurrency, language, money, label, t, rules, currencySymbol }),
    [country, baseCurrency, language, money, label, t, rules, currencySymbol]
  );
  const uCurrency = baseCurrency === "JPY" ? "円" : currencySymbol;
  const uPerMonth = baseCurrency === "JPY" ? "円/月" : `${currencySymbol}/month`;
  const uPerYear = baseCurrency === "JPY" ? "円/年" : `${currencySymbol}/year`;
  const uPerGram = baseCurrency === "JPY" ? "円/g" : `${currencySymbol}/g`;
  const uYears = language === "ja" ? "年" : "years";
  const dateLocale = language === "ja" ? "ja-JP" : (language === "en-GB" ? "en-GB" : "en-US");
  const formatAge = useCallback((age) => {
    const y = Math.floor(age + 1e-9);
    const m = Math.round((age - y) * 12);
    return m > 0 ? t("ageYM", { years: y, months: m }) : t("ageYears", { age: y });
  }, [t]);
  const [newStock, setNewStock] = useState({ name: "", sector: "" });
  const [newLump, setNewLump] = useState({ years: "", months: "", amount: "" });
  const [newTsumitateRange, setNewTsumitateRange] = useState({
    fromYears: "", fromMonths: "", toYears: "", toMonths: "", monthlyYen: "",
  });
  const [newGrowthRange, setNewGrowthRange] = useState({
    fromYears: "", fromMonths: "", toYears: "", toMonths: "", monthlyYen: "",
  });
  const [newBank, setNewBank] = useState({ name: "", balance: "", monthlyDeposit: "", interestPct: "" });
  const [newInheritance, setNewInheritance] = useState({ name: "", relation: "", amount: "" });
  const [newPensionSource, setNewPensionSource] = useState({ name: "", monthlyAmount: "" });
  const [newAssetHolding, setNewAssetHolding] = useState({ name: "", value: "" });
  const [newTsumitateHolding, setNewTsumitateHolding] = useState({ name: "", value: "" });
  const [newGrowthHolding, setNewGrowthHolding] = useState({ name: "", value: "" });
  const [newLoan, setNewLoan] = useState({ name: "", principal: "", annualRatePct: "", monthlyPayment: "" });
  const [newInsurance, setNewInsurance] = useState({
    name: "",
    premiumFromYears: "", premiumFromMonths: "",
    premiumToYears: "", premiumToMonths: "",
    monthlyPremium: "",
    coverageUntilYears: "", coverageUntilMonths: "",
    hospitalizationPerDay: "", hospitalizationDaysLimit: "", hospitalizationSurgery: "", daySurgery: "",
    radiationPerSession: "", advancedMedical: "", death: "",
  });
  const [newPension, setNewPension] = useState({
    name: "",
    contribFromYears: "", contribFromMonths: "",
    contribToYears: "", contribToMonths: "",
    monthlyContribution: "",
    payoutFromYears: "", payoutFromMonths: "",
    payoutToYears: "", payoutToMonths: "",
    monthlyPayout: "",
    currentBalance: "",
  });
  const [newLumpAllocItem, setNewLumpAllocItem] = useState({ name: "", amount: "" });
  const [newTsumitateAllocItem, setNewTsumitateAllocItem] = useState({ name: "", amount: "" });
  const [newGrowthAllocItem, setNewGrowthAllocItem] = useState({ name: "", amount: "" });
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error | unavailable
  const [saveMessage, setSaveMessage] = useState("");

  // load persisted inputs
  useEffect(() => {
    (async () => {
      if (!window.storage) {
        setSaveStatus("unavailable");
        setSaveMessage(t("saveMessageUnavailable"));
        setLoaded(true);
        return;
      }
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res?.value) {
          const parsed = JSON.parse(res.value);
          if (parsed.inputs) setInputs((prev) => mergeSavedInputs(prev, parsed.inputs));
          if (parsed.watchlist) setWatchlist(parsed.watchlist);
        }
      } catch (e) {
        // no saved data yet — this is normal on first use, not an error
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const [historyDebug, setHistoryDebug] = useState("");
  const [showBackup, setShowBackup] = useState(false);
  const [showTodayTotal, setShowTodayTotal] = useState(false);
  // シナリオ比較。inputs とは別の一時的な state に置くため、
  // 保存処理・自動保存・入力履歴には一切影響しない（保存もされない）。
  const [comparisonDraft, setComparisonDraft] = useState(null); // null＝比較していない
  // 余剰金残高の表示対象年齢（第3段階・表示専用）。inputs とは別の一時 state なので
  // 保存処理・自動保存・入力履歴には一切影響しない。null＝既定（想定寿命）を表示する。
  const [surplusFocusAge, setSurplusFocusAge] = useState(null);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [importOk, setImportOk] = useState(false);

  const backupText = useMemo(() => {
    try {
      return JSON.stringify({ inputs, watchlist }, null, 2);
    } catch (e) {
      return "";
    }
  }, [inputs, watchlist]);

  const importBackup = () => {
    setImportError("");
    setImportOk(false);
    try {
      const parsed = JSON.parse(importText);
      if (!parsed.inputs) throw new Error(t("importInputsNotFoundError"));
      setInputs((prev) => mergeSavedInputs(prev, parsed.inputs));
      if (parsed.watchlist) setWatchlist(parsed.watchlist);
      setImportOk(true);
    } catch (e) {
      setImportError(t("importFailedError", { message: e?.message || "" }));
    }
  };

  const refreshHistory = useCallback(async () => {
    if (!window.storage) {
      setHistoryDebug(t("storageUnavailableDebug"));
      return;
    }
    try {
      const list = await window.storage.list(SNAPSHOT_PREFIX, false);
      const keys = list?.keys || [];
      setHistoryDebug(t("storageKeyCountDebug", { count: keys.length }));
      if (!keys.length) return; // nothing stored yet — leave any locally-known entries as-is
      const entries = await Promise.all(
        keys.map(async (k) => {
          try {
            const res = await window.storage.get(k, false);
            return res?.value ? JSON.parse(res.value) : null;
          } catch (e) { return null; }
        })
      );
      const clean = entries.filter(Boolean);
      // merge with whatever is already in local state instead of replacing outright,
      // so an in-progress save from this session is never clobbered by a stale fetch
      setHistory((prev) => {
        const map = new Map(prev.map((h) => [h.date, h]));
        clean.forEach((h) => map.set(h.date, h));
        return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
      });
    } catch (e) {
      setHistoryDebug(t("historyFetchErrorDebug", { message: e?.message || t("unknownShort") }));
    }
  }, [t]);

  const save = useCallback(async (nextInputs, nextWatchlist) => {
    if (!window.storage) {
      setSaveStatus("unavailable");
      setSaveMessage(t("saveMessageUnavailable"));
      return;
    }
    setSaveStatus("saving");
    try {
      await window.storage.set(
        STORAGE_KEY,
        JSON.stringify({ inputs: nextInputs, watchlist: nextWatchlist }),
        false
      );
      // record (or overwrite) today's dated snapshot so history builds up day by day
      const date = todayKey();
      const bankTotal = (nextInputs.banks || []).reduce((s, b) => s + (b.balance || 0), 0);
      const snapshot = {
        date,
        currentAssets: (nextInputs.tsumitateHoldings || []).reduce((s, h) => s + (h.value || 0), 0)
          + (nextInputs.growthHoldings || []).reduce((s, h) => s + (h.value || 0), 0),
        tsumitateUsed: nextInputs.tsumitateUsed,
        growthUsed: nextInputs.growthUsed,
        goldGrams: nextInputs.gold?.currentGrams ?? 0,
        bankTotal,
        inputs: nextInputs,
        watchlist: nextWatchlist,
      };
      await window.storage.set(SNAPSHOT_PREFIX + date, JSON.stringify(snapshot), false);
      // upsert today's entry locally so the history list reflects it immediately
      // without re-fetching every stored snapshot on each keystroke
      setHistory((prev) => {
        const others = prev.filter((h) => h.date !== date);
        return [snapshot, ...others].sort((a, b) => (a.date < b.date ? 1 : -1));
      });
      setSaveStatus("saved");
      setSaveMessage(t("saveMessageLastSaved", { time: new Date().toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" }) }));
    } catch (e) {
      setSaveStatus("error");
      setSaveMessage(t("saveMessageFailed", { error: e?.message || t("unknownError") }));
    }
  }, [t, dateLocale]);

  useEffect(() => {
    if (loaded) save(inputs, watchlist);
  }, [inputs, watchlist, loaded, save]);

  useEffect(() => {
    if (loaded) refreshHistory();
  }, [loaded, refreshHistory]);

  const restoreSnapshot = (entry) => {
    if (entry.inputs) setInputs((prev) => mergeSavedInputs(prev, entry.inputs));
    if (entry.watchlist) setWatchlist(entry.watchlist);
  };
  const scrollToSimulator = () => {
    document.getElementById("simulator")?.scrollIntoView({ behavior: "smooth" });
  };
  const deleteSnapshot = async (date) => {
    try {
      await window.storage?.delete(SNAPSHOT_PREFIX + date, false);
      setHistory((prev) => prev.filter((h) => h.date !== date));
    } catch (e) {
      // ignore
    }
  };

  const update = (patch) => setInputs((prev) => ({ ...prev, ...patch }));
  const updateExtraFundReturn = (name, val) =>
    setInputs((prev) => ({ ...prev, extraFundReturns: { ...prev.extraFundReturns, [name]: val } }));
  const updateHealth = (key, val) =>
    setInputs((prev) => ({ ...prev, healthBrackets: { ...prev.healthBrackets, [key]: val } }));
  const updateGold = (key, val) =>
    setInputs((prev) => ({ ...prev, gold: { ...prev.gold, [key]: val } }));
  const updateIdeco = (key, val) =>
    setInputs((prev) => ({ ...prev, ideco: { ...prev.ideco, [key]: val } }));
  const updateUsInvestment = (key, val) =>
    setInputs((prev) => ({ ...prev, usInvestment: { ...prev.usInvestment, [key]: val } }));
  const updateUsInvestmentAccount = (accountKey, field, val) =>
    setInputs((prev) => ({
      ...prev,
      usInvestment: {
        ...prev.usInvestment,
        [accountKey]: { ...prev.usInvestment[accountKey], [field]: val },
      },
    }));
  // socialSecurity / healthcare も同じ入れ子構造なので同じ更新関数を流用できる
  const updateUsInvestmentNested = updateUsInvestmentAccount;

  const updateGbInvestment = (key, val) =>
    setInputs((prev) => ({ ...prev, gbInvestment: { ...prev.gbInvestment, [key]: val } }));
  const updateGbInvestmentAccount = (accountKey, field, val) =>
    setInputs((prev) => ({
      ...prev,
      gbInvestment: {
        ...prev.gbInvestment,
        [accountKey]: { ...prev.gbInvestment[accountKey], [field]: val },
      },
    }));
  // statePension / healthcare も同じ入れ子構造なので同じ更新関数を流用できる
  const updateGbInvestmentNested = updateGbInvestmentAccount;

  const updateCaInvestment = (key, val) =>
    setInputs((prev) => ({ ...prev, caInvestment: { ...prev.caInvestment, [key]: val } }));
  const updateCaInvestmentAccount = (accountKey, field, val) =>
    setInputs((prev) => ({
      ...prev,
      caInvestment: {
        ...prev.caInvestment,
        [accountKey]: { ...prev.caInvestment[accountKey], [field]: val },
      },
    }));
  // cpp / oas / healthcare も同じ入れ子構造なので同じ更新関数を流用できる
  const updateCaInvestmentNested = updateCaInvestmentAccount;

  const updateAuInvestment = (key, val) =>
    setInputs((prev) => ({ ...prev, auInvestment: { ...prev.auInvestment, [key]: val } }));
  const updateAuInvestmentAccount = (accountKey, field, val) =>
    setInputs((prev) => ({
      ...prev,
      auInvestment: {
        ...prev.auInvestment,
        [accountKey]: { ...prev.auInvestment[accountKey], [field]: val },
      },
    }));
  // agePension / healthcare も同じ入れ子構造なので同じ更新関数を流用できる
  const updateAuInvestmentNested = updateAuInvestmentAccount;

  // 積立・成長投資枠・一括投資の銘柄別内訳、および「つみたて/成長投資枠：実際の残高」に入力された銘柄を集約して、
  // そのままスライダー（自動計算・操作不可）として表示する
  const allBreakdownItems = [
    ...(inputs.lumpAllocation || []),
    ...(inputs.tsumitateAllocation || []),
    ...(inputs.growthAllocation || []),
    ...(inputs.tsumitateHoldings || []).map((h) => ({ name: h.name, amount: h.value })),
    ...(inputs.growthHoldings || []).map((h) => ({ name: h.name, amount: h.value })),
  ];
  const fundNames = [...new Set(allBreakdownItems.filter((it) => it.name && it.name.trim()).map((it) => it.name))];
  const fundAmounts = fundNames.reduce((acc, name) => {
    acc[name] = allBreakdownItems.reduce((s, it) => (it.name === name ? s + (it.amount || 0) : s), 0);
    return acc;
  }, {});
  const combinedGrandTotal = fundNames.reduce((s, n) => s + fundAmounts[n], 0);
  const dynamicFunds = combinedGrandTotal > 0
    ? fundNames.map((name) => ({
        id: name,
        pct: (fundAmounts[name] / combinedGrandTotal) * 100,
        returnPct: (inputs.extraFundReturns && inputs.extraFundReturns[name] !== undefined) ? inputs.extraFundReturns[name] : guessDefaultReturn(name),
      }))
    : [];

  // ①401(k)②Traditional IRA③Roth IRA④Brokerageを、現在の年齢時点で
  // Liquid/Accessible（引き出し可能）とRetirement/Restricted（制約付き）に分ける。
  // 合計は必ずusTotalInvestmentBalanceと一致する（内訳のみの分離のため）。
  const usLiquidRestrictedSplit = (country === "US" && rules.investment.implemented)
    ? rules.investment.splitLiquidRestricted(effectiveCurrentAge, {
        k401: inputs.usInvestment.k401.currentValue,
        traditionalIra: inputs.usInvestment.traditionalIra.currentValue,
        rothIra: inputs.usInvestment.rothIra.currentValue,
        brokerage: inputs.usInvestment.brokerage.currentValue,
      })
    : { liquid: 0, restricted: 0, isAccessibleAge: false };

  // イギリス選択時：6口座を Liquid / Restricted / Tax-Advantaged に分ける。
  // total は6口座の単純合計（＝ Liquid + Restricted）。Tax-Advantaged は横断的な内訳のため合計には含めない。
  const gbAssetSplit = (country === "GB" && rules.investment.implemented)
    ? rules.investment.splitAssets(effectiveCurrentAge, inputs.gbInvestment)
    : { liquid: 0, restricted: 0, taxAdvantaged: 0, total: 0, isAccessibleAge: false };

  // カナダ選択時：4口座を Liquid / Restricted / Tax-Advantaged に分ける。
  // total は4口座の単純合計（＝ Liquid + Restricted）。
  const caAssetSplit = (country === "CA" && rules.investment.implemented)
    ? rules.investment.splitAssets(effectiveCurrentAge, inputs.caInvestment)
    : { liquid: 0, restricted: 0, taxAdvantaged: 0, total: 0, isRrifPhase: false };

  // オーストラリア選択時：3口座を Liquid / Restricted / Tax-Advantaged に分ける。
  const auAssetSplit = (country === "AU" && rules.investment.implemented)
    ? rules.investment.splitAssets(effectiveCurrentAge, inputs.auInvestment)
    : { liquid: 0, restricted: 0, taxAdvantaged: 0, total: 0, isAccessibleAge: false };

  // 銘柄名から、その銘柄の想定年率（利回り）を取得する（銘柄別内訳のスライダーで手動調整した値があればそちらを優先）
  const getFundReturnPct = (name) =>
    (inputs.extraFundReturns && inputs.extraFundReturns[name] !== undefined) ? inputs.extraFundReturns[name] : guessDefaultReturn(name);

  // カテゴリ（つみたて／成長／一括投資）の銘柄別内訳から、加重平均の想定利回りを算出する
  // （経過分の積立額を複利で運用成長させる際の利回りとして使う。内訳が空ならフォールバック値を使う）
  const categoryWeightedReturn = (allocationList, fallback) => {
    const named = (allocationList || []).filter((it) => it.name && it.name.trim());
    if (!named.length) return fallback;
    const total = named.reduce((s, it) => s + (it.amount || 0), 0);
    if (total <= 0) return fallback;
    return named.reduce((s, it) => s + (it.amount / total) * getFundReturnPct(it.name), 0);
  };

  // 一括投資：それぞれの投資日から現在まで、想定利回りで複利運用したものとして評価額を計算する
  // （投資した金額をそのまま元本として加え、その時点から利回りを積み上げていく）
  const lumpScheduleReturn = categoryWeightedReturn(inputs.lumpAllocation, guessDefaultReturn("全世界株式"));
  const lumpElapsedTotal = compoundedLumpSumValue(inputs.lumpSums, effectiveCurrentAge, lumpScheduleReturn);

  const autoHoldingRowsFor = (allocationList, elapsedTotal, categoryLabel) => {
    const named = (allocationList || []).filter((it) => it.name && it.name.trim());
    if (named.length === 0) return [];
    const listTotal = named.reduce((s, it) => s + (it.amount || 0), 0);
    return named.map((it) => ({
      name: `${it.name}（${categoryLabel}）`,
      value: listTotal > 0 ? (it.amount / listTotal) * elapsedTotal : 0,
    }));
  };

  // 「実際の残高」の基準年齢（年・月の入力から小数年齢に変換。未入力なら null＝現在の年齢として扱う＝追加計算なし）
  const tsumitateHoldingsAsOfAge = (inputs.tsumitateHoldingsAsOfYears !== "" && inputs.tsumitateHoldingsAsOfYears !== undefined && inputs.tsumitateHoldingsAsOfYears !== null)
    ? Number(inputs.tsumitateHoldingsAsOfYears || 0) + Number(inputs.tsumitateHoldingsAsOfMonths || 0) / 12
    : null;
  const growthHoldingsAsOfAge = (inputs.growthHoldingsAsOfYears !== "" && inputs.growthHoldingsAsOfYears !== undefined && inputs.growthHoldingsAsOfYears !== null)
    ? Number(inputs.growthHoldingsAsOfYears || 0) + Number(inputs.growthHoldingsAsOfMonths || 0) / 12
    : null;

  // 手入力した「実際の残高」（＝基準年齢時点で実際にいくらだったかという金額）を、
  // その銘柄の想定利回りで基準年齢〜現在まで複利成長させる（基準年齢が未入力ならそのままの金額を使う）
  const tsumitateHoldingsManualTotal = (inputs.tsumitateHoldings || []).reduce((s, h) => {
    const rate = getFundReturnPct(h.name);
    return s + compoundPrincipal(h.value || 0, tsumitateHoldingsAsOfAge, effectiveCurrentAge, rate);
  }, 0);
  const growthHoldingsManualTotal = (inputs.growthHoldings || []).reduce((s, h) => {
    const rate = getFundReturnPct(h.name);
    return s + compoundPrincipal(h.value || 0, growthHoldingsAsOfAge, effectiveCurrentAge, rate);
  }, 0);

  // つみたて・成長投資枠のスケジュール（毎月投資額）に沿って、これまで実際に引き落とされてきたはずの金額を、
  // その都度（引き落とされた月ごとに）想定利回りで複利運用したものとして自動計算する
  // （一括投資と同様、これは基準年齢の入力有無に関わらず常に自動で計算される。手入力の「実際の残高」とは別建てで加算されるため、
  // 　手入力欄にはスケジュールで既に積み立てられている分を重複して含めないよう入力してください）
  const tsumitateScheduleReturn = categoryWeightedReturn(inputs.tsumitateAllocation, guessDefaultReturn("全世界株式"));
  const growthScheduleReturn = categoryWeightedReturn(inputs.growthAllocation, guessDefaultReturn("全世界株式"));
  const tsumitateCatchUp = compoundedElapsedValue(inputs.tsumitateSchedule, 0, effectiveCurrentAge, tsumitateScheduleReturn);
  const growthCatchUp = compoundedElapsedValue(inputs.growthSchedule, 0, effectiveCurrentAge, growthScheduleReturn);

  const tsumitateHoldingsTotal = tsumitateHoldingsManualTotal + tsumitateCatchUp;
  const growthHoldingsTotal = growthHoldingsManualTotal + growthCatchUp;

  // 時価（自動計算）の一覧：一括投資に加え、つみたて・成長投資枠のスケジュール分もまとめて銘柄別に表示する
  const autoHoldingRows = [
    ...autoHoldingRowsFor(inputs.tsumitateAllocation, tsumitateCatchUp, t("tsumitateScheduleCategoryLabel")),
    ...autoHoldingRowsFor(inputs.growthAllocation, growthCatchUp, t("growthScheduleCategoryLabel")),
    ...autoHoldingRowsFor(inputs.lumpAllocation, lumpElapsedTotal, t("lumpSumCategoryLabel")),
  ];
  const autoHoldingsTotal = lumpElapsedTotal;

  // 現在のNISA資産は手入力せず、つみたて/成長投資枠の実際の残高（＋基準年齢以降の複利成長分）＋一括投資の自動計算分から完全に自動算出する
  const currentAssetHoldingsTotal = tsumitateHoldingsTotal + growthHoldingsTotal + autoHoldingsTotal;
  const effectiveCurrentAssets = currentAssetHoldingsTotal;

  // 退職後の想定利回りを、現役時代（銘柄別スライダー）の加重平均利回りの半分から自動で仮設定する
  const weightedAvgReturn = dynamicFunds.reduce((s, f) => s + (f.pct / 100) * f.returnPct, 0);
  const autoPostRetireReturn = dynamicFunds.length > 0 ? Math.round((weightedAvgReturn / 2) * 10) / 10 : inputs.postRetireReturn;
  const effectivePostRetireReturn = (inputs.postRetireReturnAuto && dynamicFunds.length > 0) ? autoPostRetireReturn : inputs.postRetireReturn;

  // iDeCo：NISAとは別の専用計算関数（受取前は生活費に使わず増やすだけ）。
  // ここで先に受取額を算出し、年金・併用の場合のみ「追加収入」としてNISA側の取り崩し計算へ渡す。
  const effectiveIdecoReturn = inputs.ideco.returnPctAuto ? guessDefaultReturn(inputs.ideco.productName) : inputs.ideco.returnPct;
  // 「現在評価額」の基準年齢（年・月の入力から小数年齢に変換。未入力なら null＝現在の年齢として扱う＝追加計算なし）
  const idecoAsOfAge = (inputs.ideco.asOfYears !== "" && inputs.ideco.asOfYears !== undefined && inputs.ideco.asOfYears !== null)
    ? Number(inputs.ideco.asOfYears || 0) + Number(inputs.ideco.asOfMonths || 0) / 12
    : null;
  const idecoSim = useMemo(
    () => runIdecoSimulation({
      currentAge: effectiveCurrentAge, deathAge: inputs.deathAge,
      ideco: { ...inputs.ideco, returnPct: effectiveIdecoReturn, asOfAge: idecoAsOfAge },
    }),
    [effectiveCurrentAge, inputs.deathAge, inputs.ideco, effectiveIdecoReturn, idecoAsOfAge]
  );
  const idecoPayoutMethod = inputs.ideco.payoutMethod;
  const getIdecoMonthlyIncome = useMemo(() => {
    if (idecoPayoutMethod !== "pension" && idecoPayoutMethod !== "both") return null;
    return (age) => (age >= idecoSim.payoutStartAge && age < idecoSim.payoutEndAge) ? idecoSim.annualPayout / 12 : 0;
  }, [idecoPayoutMethod, idecoSim.payoutStartAge, idecoSim.payoutEndAge, idecoSim.annualPayout]);

  const getIdecoSpendableLump = useMemo(() => {
    if (idecoPayoutMethod !== "lump" && idecoPayoutMethod !== "both") return null;
    // 月次シミュレーションのうち、受取開始月にだけ一時金を返す。
    return (age) => Math.abs(age - idecoSim.payoutStartAge) < (1 / 24) ? idecoSim.lumpAmount : 0;
  }, [idecoPayoutMethod, idecoSim.payoutStartAge, idecoSim.lumpAmount]);

  // 年金受給見込み額：国民年金・企業年金基金など複数の項目を追加すると、その合計が自動的に使われる
  const pensionSourcesTotal = inputs.pensionSources.reduce((s, p) => s + (p.monthlyAmount || 0), 0);
  const effectivePensionMonthly = inputs.pensionSources.length > 0 ? pensionSourcesTotal : inputs.pensionMonthly;

  const effectiveInputs = useMemo(
    () => ({
      ...inputs, dynamicFunds, currentAge: effectiveCurrentAge, currentAssets: effectiveCurrentAssets,
      postRetireReturn: effectivePostRetireReturn,
      extraRetirementIncomeMonthly: getIdecoMonthlyIncome,
      extraSpendableLumpSum: getIdecoSpendableLump,
      pensionMonthly: effectivePensionMonthly,
    }),
    [inputs, JSON.stringify(dynamicFunds), effectiveCurrentAge, effectiveCurrentAssets, effectivePostRetireReturn, getIdecoMonthlyIncome, getIdecoSpendableLump, effectivePensionMonthly]
  );

  const sim = useMemo(
    () => runSimulation(effectiveInputs, t("uncategorizedLabel"), t("phaseAccumulation"), t("phaseDrawdown")),
    [effectiveInputs, t]
  );
  const autoGoldReturn = guessDefaultReturn("金");
  const effectiveGoldReturnPct = inputs.gold.priceGrowthPctAuto ? autoGoldReturn : inputs.gold.priceGrowthPct;
  // 「現在の保有量」の基準年齢（年・月の入力から小数年齢に変換。未入力なら null＝現在の年齢として扱う＝追加計算なし）
  const goldAsOfAge = (inputs.gold.asOfYears !== "" && inputs.gold.asOfYears !== undefined && inputs.gold.asOfYears !== null)
    ? Number(inputs.gold.asOfYears || 0) + Number(inputs.gold.asOfMonths || 0) / 12
    : null;
  const goldSim = useMemo(
    () => runGoldSimulation({ currentAge: effectiveCurrentAge, deathAge: inputs.deathAge, gold: { ...inputs.gold, priceGrowthPct: effectiveGoldReturnPct, asOfAge: goldAsOfAge } }),
    [effectiveCurrentAge, inputs.deathAge, inputs.gold, effectiveGoldReturnPct, goldAsOfAge]
  );
  const bankSim = useMemo(
    () => runBankSimulation({
      currentAge: effectiveCurrentAge, retireAge: inputs.retireAge, deathAge: inputs.deathAge, banks: inputs.banks,
    }),
    [effectiveCurrentAge, inputs.retireAge, inputs.deathAge, inputs.banks]
  );
  const stockTotalNow = useMemo(() => watchlist.reduce((s, w) => s + (w.value || 0), 0), [watchlist]);
  const stockAllocationItems = useMemo(
    () => watchlist.filter((w) => (w.value || 0) > 0).map((w) => ({ name: w.name, amount: w.value })),
    [watchlist]
  );
  const autoStockReturn = useMemo(() => {
    const held = watchlist.filter((w) => (w.value || 0) > 0);
    const total = held.reduce((s, w) => s + w.value, 0);
    if (total <= 0) return inputs.stockReturnPct;
    return Math.round((held.reduce((s, w) => s + (w.value / total) * guessDefaultReturn(w.name), 0)) * 10) / 10;
  }, [watchlist, inputs.stockReturnPct]);
  const effectiveStockReturnPct = inputs.stockReturnPctAuto ? autoStockReturn : inputs.stockReturnPct;
  const stockSim = useMemo(
    () => runStockSim({ currentAge: effectiveCurrentAge, deathAge: inputs.deathAge, totalValue: stockTotalNow, returnPct: effectiveStockReturnPct }),
    [effectiveCurrentAge, inputs.deathAge, stockTotalNow, effectiveStockReturnPct]
  );
  const loanSim = useMemo(
    () => runLoanSimulation({ currentAge: effectiveCurrentAge, deathAge: inputs.deathAge, loans: inputs.loans }),
    [effectiveCurrentAge, inputs.deathAge, inputs.loans]
  );
  const insuranceSim = useMemo(
    () => runInsuranceSimulation({ currentAge: effectiveCurrentAge, deathAge: inputs.deathAge, policies: inputs.insurancePolicies }),
    [effectiveCurrentAge, inputs.deathAge, inputs.insurancePolicies]
  );
  const pensionSim = useMemo(
    () => runPrivatePensionSimulation({ currentAge: effectiveCurrentAge, deathAge: inputs.deathAge, plans: inputs.privatePensionPlans }),
    [effectiveCurrentAge, inputs.deathAge, inputs.privatePensionPlans]
  );

  // アメリカ選択時：401(k)/Traditional IRA/Roth IRA/Brokerageの残高推移シミュレーション。
  // JPのrunSimulation（NISA専用）とは完全に独立しており、US_COUNTRY_RULES.investment.simulateGrowth
  // のみを使用する。country !== "US" のときは計算自体を行わない（空データを返すだけ）。
  // RMD（必須最低引出）の開始年齢は生年で決まる（SECURE 2.0：1960年以降生まれは75歳、それ以前は73歳）。
  // 生年月日が入力されていればその年を、未入力なら「今年 − 現在の年齢」で推定する。
  const usBirthYear = useMemo(() => {
    const fromInput = String(inputs.birthDate || "").slice(0, 4);
    const parsed = Number(fromInput);
    if (Number.isFinite(parsed) && parsed > 1900) return parsed;
    const est = new Date().getFullYear() - Math.floor(Number(effectiveCurrentAge) || 0);
    return Number.isFinite(est) ? est : 0;
  }, [inputs.birthDate, effectiveCurrentAge]);

  const usInvestmentSim = useMemo(() => {
    if (country !== "US" || !rules.investment.implemented) {
      return { yearly: [], finalValue: 0 };
    }
    return rules.investment.simulateGrowth({
      currentAge: effectiveCurrentAge,
      retireAge: inputs.retireAge,
      deathAge: inputs.deathAge,
      accounts: inputs.usInvestment,
      returnPct: inputs.usInvestment.expectedReturnPct,
      // Social Securityの課税を有効にする場合、生活費はSS控除“前”の総額を渡す
      // （SS給付は engine 内で手取りの原資として差し引かれるため、二重に引かない）。
      annualWithdrawalNeeded: usSSAnnualBenefit > 0
        ? usExpensesAnnual + usTotalHealthcareAnnual
        : usWithdrawalNeeded,
      // ここから下がRMD・税グロスアップ用。
      // retirementRules を渡したときだけRMDが有効になる。
      retirementRules: rules.retirement,
      birthYear: usBirthYear,
      // 課税繰延口座（Traditional IRA / 401(k)）からの引出にかかる概算税率。
      // 生活費は税引後の手取りで必要なため、この税率ぶんグロスアップして引き出す。
      // 内部では用途ごとに税率を分離しているが、UIでは同じ概算税率を使用する。
      taxRatePct: usRmdTaxRatePct,
      rmdTaxRatePct: usRmdTaxRatePct,
      // Social Security給付の課税（IRC §86 / Pub 915）。
      // taxRules と給付額を渡したときだけ有効になる。
      taxRules: rules.tax,
      socialSecurityAnnual: usSSAnnualBenefit,
      socialSecurityStartAge: usClaimAge,
      filingStatus: usFilingStatus,
    });
  }, [country, rules, effectiveCurrentAge, inputs.retireAge, inputs.deathAge, inputs.usInvestment, usWithdrawalNeeded, usBirthYear, usRmdTaxRatePct, usSSAnnualBenefit, usExpensesAnnual, usTotalHealthcareAnnual, usClaimAge, usFilingStatus]);

  // イギリス選択時：ISA / SIPP / 職域年金 / GIA / Cash Savings の残高推移シミュレーション。
  // GB_COUNTRY_RULES.investment.simulateGrowth のみを使用し、JP（runSimulation）・US（US側のsimulateGrowth）
  // とは完全に独立している。country !== "GB" のときは計算自体を行わない（空データを返すだけ）。
  const gbInvestmentSim = useMemo(() => {
    if (country !== "GB" || !rules.investment.implemented) {
      return { yearly: [], finalValue: 0 };
    }
    return rules.investment.simulateGrowth({
      currentAge: effectiveCurrentAge,
      retireAge: inputs.retireAge,
      deathAge: inputs.deathAge,
      accounts: inputs.gbInvestment,
      annualWithdrawalNeeded: gbWithdrawalNeeded,
    });
  }, [country, rules, effectiveCurrentAge, inputs.retireAge, inputs.deathAge, inputs.gbInvestment, gbWithdrawalNeeded]);

  // カナダ選択時：TFSA / RRSP / 非登録口座 / 現金 の残高推移シミュレーション。
  // CA_COUNTRY_RULES.investment.simulateGrowth のみを使用し、他国とは完全に独立している。
  // country !== "CA" のときは計算自体を行わない（空データを返すだけ）。
  const caInvestmentSim = useMemo(() => {
    if (country !== "CA" || !rules.investment.implemented) {
      return { yearly: [], finalValue: 0 };
    }
    return rules.investment.simulateGrowth({
      currentAge: effectiveCurrentAge,
      retireAge: inputs.retireAge,
      deathAge: inputs.deathAge,
      accounts: inputs.caInvestment,
      annualWithdrawalNeeded: caWithdrawalNeeded,
    });
  }, [country, rules, effectiveCurrentAge, inputs.retireAge, inputs.deathAge, inputs.caInvestment, caWithdrawalNeeded]);

  // オーストラリア選択時：Superannuation / 投資口座 / 現金 の残高推移シミュレーション。
  // AU_COUNTRY_RULES.investment.simulateGrowth のみを使用し、他国とは完全に独立している。

  // iDeCo 自動計算項目
  const idecoAnnualContribution = (inputs.ideco.monthlyContribution || 0) * 12;
  const idecoRemainingContribYears = Math.max(0, inputs.ideco.endAge - Math.max(inputs.ideco.startAge, effectiveCurrentAge));
  const idecoContributionTotal = (inputs.ideco.principalTotal || 0) + idecoAnnualContribution * idecoRemainingContribYears;
  const idecoInvestmentGain = (inputs.ideco.currentValue || 0) - (inputs.ideco.principalTotal || 0);
  // iDeCo 節税シミュレーション（概算）
  const idecoMarginalTaxRate = estimateMarginalTaxRate(inputs.ideco.annualIncome);
  const idecoAnnualTaxSaving = idecoAnnualContribution * idecoMarginalTaxRate;
  const idecoCumulativeTaxSaving = idecoAnnualTaxSaving * idecoRemainingContribYears;

  // merge NISA + gold + bank + stocks + 民間年金積立 + iDeCo一時金 - loans - 保険料累計 into one net-worth-by-age series for the combined chart
  // ==========================================================================
  // 【全面改修】総資産推移・純資産は「統合キャッシュフローエンジン」を唯一の計算源とする。
  //
  // 旧方式（8本の独立シミュレーションを [i] で単純合算）で起きていた不整合：
  //   ① 退職後の不足額がNISA/主要投資口座からしか引かれず、そこが0になると
  //      不足が消滅し、銀行預金・個別株・金が減らないまま総資産が過大表示された。
  //   ② ローン返済の原資がどの資産からも出ておらず、借入残高が減った分だけ
  //      純資産が「湧いて」いた（退職後は給与が無いので明確な誤り）。
  //   ③ 民間年金が残高0になった後も monthlyPayout 全額が収入計上され続けていた。
  //   ④ 保険料が資産からではなく純資産からだけ恒久控除され、
  //      「帯の最上部 − 借入 ＝ 純資産線」が数学的に成立していなかった。
  //
  // 新方式では、すべての資産を「プール」として1本の月次ループで扱い、
  // 収入・支出・取り崩しを一度だけ処理する（＝二重控除・二重加算が構造的に起きない）。
  // 各パネル個別のシミュレーション（sim / goldSim / bankSim ...）は表示用にそのまま残す。
  // 配列は [i] ではなく age で照合する（下の netWorthByAge を参照）。
  // ==========================================================================

  // 公的年金の受給開始年齢（日本）。未入力なら65歳。退職年齢とは独立。
  const effectivePublicPensionStartAge =
    (inputs.publicPensionStartAge === null || inputs.publicPensionStartAge === undefined || inputs.publicPensionStartAge === "")
      ? 65 : Number(inputs.publicPensionStartAge);

  // 【移設】境界年齢（planBoundaries）とNISA枠計算（nisaPlan）は、
  // utils/buildPlanInput.js の中で組み立てるようになったため、ここでは持たない。
  // （比較プランでは退職年齢・積立額が変わり、境界もNISA枠も作り直す必要があるため。）

  // 取り崩し順（利用者設定に対応できるよう配列で保持する）
  const drawdownOrder = inputs.drawdownOrder && inputs.drawdownOrder.length
    ? inputs.drawdownOrder : DRAWDOWN_CATEGORIES;

  // ==========================================================================
  // 【移設】runIntegratedPlan に渡す引数の組み立ては utils/buildPlanInput.js の
  // 純粋関数へ切り出した。中身（プール定義・境界年齢・NISA枠・iDeCo・公的年金）は
  // 移設前と1行も変えていない。React のクロージャから出したことで、
  // シナリオ比較が「同じ組み立てを別の条件でもう一度」実行できるようになる。
  //
  // planCtx は「シナリオ比較の3項目（積立額・退職年齢・生活費）に影響されない派生値」
  // だけを集めたもの。比較プランはこの同じ planCtx に overrides を渡して計算する。
  // ==========================================================================
  const planCtx = useMemo(() => ({
    country, rules, inputs,
    effectiveCurrentAge, effectiveCurrentAssets, effectivePostRetireReturn,
    dynamicFunds, stockTotalNow, effectiveStockReturnPct,
    goldCurrentValue: goldSim.currentValue, effectiveGoldReturnPct,
    effectivePensionMonthly, effectivePublicPensionStartAge,
    drawdownOrder,
    uncategorizedLabel: t("uncategorizedLabel"),
    countryDerived: {
      usSSMonthlyBenefit, usTotalHealthcareAnnual, usClaimAge,
      gbStatePensionAnnual, gbAdditionalPensionAnnual, gbEffectiveClaimAge, gbHealthcareAnnual,
      caCppAnnual, caCppStartAge, caOasAnnual, caOasStartAge, caAdditionalPensionAnnual, caHealthcareAnnual,
      // Age Pension はエンジン側が毎ステップ再判定するため、ここはシード（上書きされる）
      auAgePensionAnnual: auAgePensionAnnualSeed,
      auAgePensionQualifyingAge, auOtherAnnualIncome, auHealthcareAnnual,
    },
  }), [
    country, rules, effectiveCurrentAge, effectiveCurrentAssets, effectivePostRetireReturn,
    inputs, dynamicFunds, drawdownOrder,
    stockTotalNow, effectiveStockReturnPct,
    goldSim.currentValue, effectiveGoldReturnPct,
    effectivePensionMonthly, effectivePublicPensionStartAge,
    usSSMonthlyBenefit, usTotalHealthcareAnnual, usClaimAge,
    gbStatePensionAnnual, gbAdditionalPensionAnnual, gbEffectiveClaimAge, gbHealthcareAnnual,
    caCppAnnual, caCppStartAge, caOasAnnual, caOasStartAge, caAdditionalPensionAnnual, caHealthcareAnnual,
    auAgePensionAnnualSeed, auAgePensionQualifyingAge, auOtherAnnualIncome, auHealthcareAnnual, t,
  ]);

  const integrated = useMemo(() => runIntegratedPlan(buildPlanInput(planCtx)), [planCtx]);

  // ---------- Age Pension：画面カードの値は本番投影（integrated）から読み取る ----------
  // 【なぜ再計算しないのか】
  //   資産テストとDeemingの対象は AU版3口座 ＋ 銀行預金・個別株・金・民間年金原資。
  //   これを画面用に別計算すると対象範囲がずれ、カードとグラフで金額が食い違う。
  //   lifePlanEngine は毎ステップ assessedPoolIds / deemedPoolIds の残高で再判定し、
  //   実際に使った値を各行に publicPensionAnnual / meansTestedAssessedAssets /
  //   meansTestedDeemedAssets として残している。カードはそれをそのまま読む。
  //   これにより、銀行・株・金・民間年金を変えるとカードの金額も必ず動く
  //   （integrated → planCtx → inputs の依存で再計算される）。
  const auAgePensionFromEngine = useMemo(() => {
    const empty = {
      assessableAssets: 0, deemedAssets: 0, deemedIncomeAnnual: 0,
      recipients: 1, agePensionPerPersonAnnual: 0, agePensionAnnual: 0,
    };
    if (country !== "AU" || !rules.retirement.implemented) return empty;
    const rows = (integrated && integrated.yearly) || [];
    if (!rows.length) return empty;
    // スナップショットの行は「その年齢までの1年」を表すため、受給資格年齢ちょうどの行では
    // まだ受給が始まっていない。実際に受給が始まっている最初の行を選ぶ。
    // 想定寿命が受給資格年齢より手前なら最後の行で代用する。
    const target = Math.round(auAgePensionQualifyingAge);
    const row =
      rows.find((y) => y.age >= target && y.meansTestedStreamsActive > 0)
      || rows.find((y) => y.age >= target)
      || rows[rows.length - 1];
    const assessableAssets = Number(row.meansTestedAssessedAssets) || 0;
    const deemedAssets = Number(row.meansTestedDeemedAssets) || 0;
    const status = inputs.auInvestment.agePension.status;
    const recipients = rules.retirement.getHouseholdRecipients(
      status, inputs.auInvestment.agePension.bothQualified
    );
    const agePensionAnnual = Number(row.meansTestedPensionAnnual) || 0;
    return {
      assessableAssets,
      deemedAssets,
      deemedIncomeAnnual: rules.retirement.getDeemedIncomeAnnual(deemedAssets, status),
      recipients,
      agePensionPerPersonAnnual: recipients > 0 ? agePensionAnnual / recipients : 0,
      agePensionAnnual,
    };
  }, [country, rules, integrated, auAgePensionQualifyingAge, inputs.auInvestment]);

  const auAssessableAssetsAtQualifyingAge = auAgePensionFromEngine.assessableAssets;
  const auAgePensionAnnual = auAgePensionFromEngine.agePensionAnnual;
  const auRetirementIncomeAnnual = auAgePensionAnnual + auOtherAnnualIncome;
  const auWithdrawalNeeded = Math.max(0, auExpensesAnnual + auHealthcareAnnual - auRetirementIncomeAnnual);
  const auIncomeSurplus = Math.max(0, auRetirementIncomeAnnual - (auExpensesAnnual + auHealthcareAnnual));

  const auInvestmentSim = useMemo(() => {
    if (country !== "AU" || !rules.investment.implemented) {
      return { yearly: [], finalValue: 0 };
    }
    return rules.investment.simulateGrowth({
      currentAge: effectiveCurrentAge,
      retireAge: inputs.retireAge,
      deathAge: inputs.deathAge,
      accounts: inputs.auInvestment,
      annualWithdrawalNeeded: auWithdrawalNeeded,
      annualSalary: inputs.auInvestment.annualSalary,
      voluntaryConcessional: inputs.auInvestment.voluntaryConcessional,
      contributionsTaxRate: rules.tax.superannuation.contributionsTaxRate,
      earningsTaxAccumulation: rules.tax.superannuation.earningsTaxAccumulation,
      div293TaxAnnual: auDiv293Tax,
      div293PaidFrom: auDiv293PaidFrom,
    });
  }, [country, rules, effectiveCurrentAge, inputs.retireAge, inputs.deathAge, inputs.auInvestment, auWithdrawalNeeded, auDiv293Tax, auDiv293PaidFrom]);


  // チャート用データ。行の age は「その時点で実際に到達している年齢」（整数）で、
  // 計算に使った小数年齢は exactAge に保持されている。
  const netWorthYearly = useMemo(() => {
    return integrated.yearly.map((r) => ({
      ...r,
      phase: r.exactAge < inputs.retireAge ? t("phaseAccumulation") : t("phaseDrawdown"),
      // 生活費に使える資産（iDeCo受取前残高・民間年金積立を除く）から借入を引いたもの
      spendableNetWorth: r.spendableAssets - r.loanBalance,
      // 旧キーの互換（他の表示が参照している場合に備える）
      loanValue: r.loanBalance,
      insuranceValue: r.cumulativePremiums,
      total: r.investmentValue,
    }));
  }, [integrated, inputs.retireAge, t]);
  // 投資口座の帯の凡例名は国ごとに変える（各国の口座名称はそのまま維持する）
  const investmentLegendKey =
    country === "US" ? "legendUsInvestment"
    : country === "GB" ? "legendGbInvestment"
    : country === "CA" ? "legendCaInvestment"
    : country === "AU" ? "legendAuInvestment"
    : "legendNisaAssets";

  // トップのショートカットボタン。SectionTitle の index と1対1で対応する。
  const sectionNavItems = useMemo(() => ([
    // 表示ページの順番（上→下）。各セクションの見出しをそのまま名前に使う。
    // 「概要」と「トップページ」だけは見出しが同じ（資産形成 総合ライフプラン）で紛らわしいため専用名。
    { anchor: "section-overview", title: t("navFullOverview") },        // 概要（一番上の紹介ページ）
    { anchor: "section-column", title: t("landingBlogTitle") },         // 資産形成コラム
    { anchor: "simulator", title: t("navFullTop") },                    // トップページ（国切り替え）
    { anchor: "section-wallet", title: t("walletDashboardTitle") },     // 統合財布ダッシュボード
    { index: "00", title: label("personalInfo"), icon: Users },
    { index: "01", title: label("basicInfo"), icon: Ruler },
    { index: "02", title: label("investmentTaxAdvantaged"), icon: TrendingUp },
    { index: "03", title: label("retirementAccount"), icon: Landmark },
    { index: "04", title: label("pensionRetirement"), icon: Landmark },
    { index: "05", title: label("healthCost"), icon: HeartPulse },
    { index: "06", title: label("inheritance"), icon: Users },
    { index: "07", title: label("gold"), icon: Coins },
    { index: "08", title: label("cash"), icon: PiggyBank },
    { anchor: "section-surplus-balance", title: t("surplusBalanceTitle") }, // 余剰金残高（※預金の下）
    { index: "09", title: label("loan"), icon: Landmark },
    { index: "10", title: label("insurance"), icon: HeartPulse },
    { index: "11", title: label("privatePension"), icon: PiggyBank },
    { anchor: "section-advice", title: t("adviceCardTitle") },          // 診断コメント
    { anchor: "section-comparison", title: t("scenarioCompareTitle") }, // シナリオ比較
    { anchor: "section-networth-chart", title: t("navFullChart") },     // 総資産推移グラフ
    { anchor: "section-stock", title: t("stockWatchlistTitle") },       // 個別株 保有一覧
  ]), [label, t]);

  // 画面右下に縦並びで出す「クイックジャンプ」用の短縮ラベル一覧。
  // 各入力セクション（section-00〜11）に加えて、個別株と総資産グラフへも飛べる。
  // anchor はスクロール先の要素id。short は被りを避けるための短い表示名。
  const quickNavItems = useMemo(() => ([
    // 表示ページの順番（上→下）に合わせて並べている。
    { anchor: "section-overview", short: t("navShortOverview") },      // 概要（一番上の紹介ページ）
    { anchor: "section-column", short: t("navShortColumn") },          // コラム（資産形成コラム）
    { anchor: "simulator", short: t("backToTopShort") },              // トップ（国切り替えのある見出し）
    { anchor: "section-wallet", short: t("navShortWallet") },          // 総財布（統合財布ダッシュボード）
    { anchor: "section-nav", short: t("navShortItems") },              // 項目（入力する項目を選ぶ）
    { anchor: "section-00", short: t("navShortPersonal") },            // 本人
    { anchor: "section-01", short: t("navShortBasic") },               // 基本
    { anchor: "section-02", short: t("navShortInvestment") },          // NISA
    { anchor: "section-03", short: t("navShortRetirementAcct") },      // iDeCo
    { anchor: "section-04", short: t("navShortPension") },             // 年金
    { anchor: "section-05", short: t("navShortHealth") },              // 健康
    { anchor: "section-06", short: t("navShortInheritance") },         // 相続
    { anchor: "section-07", short: t("navShortGold") },                // 金
    { anchor: "section-08", short: t("navShortCash") },                // 預金（銀行）
    { anchor: "section-surplus-balance", short: t("navShortSurplus") },// 余剰金（※預金の下）
    { anchor: "section-09", short: t("navShortLoan") },                // 借入
    { anchor: "section-10", short: t("navShortInsurance") },           // 保険
    { anchor: "section-11", short: t("navShortPrivatePension") },      // 私年金
    { anchor: "section-advice", short: t("navShortDiagnosis") },       // 診断
    { anchor: "section-comparison", short: t("navShortComparison") },  // 比較
    { anchor: "section-networth-chart", short: t("navShortChart") },   // グラフ
    { anchor: "section-stock", short: t("navShortStock") },            // 個別株
  ]), [t]);

  const netWorthFinal = integrated.finalNetWorth;
  const inheritanceTotal = inputs.inheritancePlans.reduce((s, p) => s + (p.amount || 0), 0);
  const effectiveInheritanceTarget = inputs.inheritancePlans.length > 0 ? inheritanceTotal : inputs.inheritanceTarget;

  // 比較プラン。draft が null のときは計算自体を行わない（＝比較していないときの負荷ゼロ）。
  // planCtx は現在プランと同じものを使い、3項目だけを overrides として渡す。
  const comparison = useMemo(() => {
    if (!comparisonDraft) return null;
    return runScenarioComparison(planCtx, comparisonDraft, {
      inheritanceTarget: effectiveInheritanceTarget,
    });
  }, [planCtx, comparisonDraft, effectiveInheritanceTarget]);

  const startComparison = useCallback(() => {
    // 現在プランをコピーして比較プランの初期値にする（元データには触らない）
    setComparisonDraft(createComparisonDraft(country, inputs));
  }, [country, inputs]);
  const endComparison = useCallback(() => setComparisonDraft(null), []);

  // 国を切り替えたら、比較プランは必ず破棄する。
  //
  // 【なぜ必要か】
  // 比較プランは「退職後の生活費」を数値として持つが、その単位（円・ドル・ポンド…）は
  // 国に紐づいている。国を切り替えても比較プランが残っていると、日本で入れた
  // 23万（円）が、そのまま £230,000/月 として計算されてしまう。
  // 実際にそれで資産が72歳で尽き、比較線が0に張り付く不具合が出た。
  // 単位の異なる値を引き継ぐ意味は無いため、国が変わったら比較そのものを終了する。
  useEffect(() => {
    setComparisonDraft(null);
  }, [country]);

  // グラフ用データ。比較中でなければ netWorthYearly をそのまま返す（＝既存の描画と完全に同一）。
  // 比較中は「現在プランの行に comparisonNetWorth を1キー足すだけ」なので、
  // 資産内訳の面グラフが参照するキーは一切変わらない。
  const netWorthChartData = useMemo(
    () => (comparison ? attachComparisonLine(netWorthYearly, comparison.compareYearly) : netWorthYearly),
    [comparison, netWorthYearly]
  );

  const netInheritanceGap = netWorthFinal - effectiveInheritanceTarget;

  // ==========================================================================
  // 【統一】総資産に関わる内訳表示は、すべて統合エンジンの pool_* 残高から作る。
  // 旧 bankSim / sim / 各国 InvestmentSim を参照していたときは、取り崩しが反映されず
  // 「内訳の合計 ≠ 総資産帯」になっていた。ageで照合し、全内訳の合計は必ず
  // その年齢のグループ残高（bankValue / investmentValue …）と一致する。
  // ==========================================================================
  const integratedRowAt = useCallback((age) => {
    const target = Math.round(age);
    const rows = integrated.yearly;
    return rows.find((y) => y.age >= target) || rows[rows.length - 1];
  }, [integrated]);

  const breakdownAges = useMemo(() => ([
    { label: t("currentLabelShort"), age: effectiveCurrentAge },
    { label: t("ageYears", { age: inputs.retireAge }), age: inputs.retireAge },
    { label: t("ageYears", { age: inputs.deathAge }), age: inputs.deathAge },
  ]), [effectiveCurrentAge, inputs.retireAge, inputs.deathAge, t]);

  const loanBreakdownByAge = useMemo(() => {
    return inputs.loans.map((l, i) => {
      const row = { name: l.name };
      breakdownAges.forEach(({ label, age }) => {
        const yr = integratedRowAt(age);
        row[label] = Math.round(yr ? (yr[`loan_${i}`] ?? 0) : l.principal);
      });
      return row;
    });
  }, [inputs.loans, breakdownAges, integratedRowAt]);

  const bankBreakdownByAge = useMemo(() => {
    return inputs.banks.map((b, i) => {
      const row = { name: b.name };
      breakdownAges.forEach(({ label, age }) => {
        const yr = integratedRowAt(age);
        row[label] = Math.round(yr ? (yr[`pool_bank_${i}`] ?? 0) : b.balance);
      });
      return row;
    });
  }, [inputs.banks, breakdownAges, integratedRowAt]);

  // 余剰金残高（surplusBalance）の表示用。第3段階：表示のみ。エンジン計算は不変。
  const surplusAgeOptions = useMemo(
    () => integrated.yearly.map((r) => r.age),
    [integrated]
  );
  // 選択年齢が未設定、または現在のスナップショットに存在しない場合は想定寿命を既定に使う。
  const effectiveSurplusFocusAge =
    surplusFocusAge !== null && surplusAgeOptions.includes(surplusFocusAge)
      ? surplusFocusAge
      : inputs.deathAge;

  // 【統一】余剰金残高カードは、総資産グラフ・銀行残高と同じ integrated の
  // surplusBalance をそのまま読む（別シミュレーションはしない）。余剰金は銀行預金の
  // 内数なので bankValue に一度だけ含まれており、ここでは表示のために読み出すだけ。
  //   現在時点    = integrated.yearly[0].surplusBalance（積み上がりの起点＝0）
  //   選択年齢時点 = integratedRowAt(effectiveSurplusFocusAge).surplusBalance
  // これにより、公的年金・iDeCo・民間年金いずれの余剰も、総資産グラフと同じ計算源から
  // 一貫して表示される（旧 surplusPrivateUpTo の民間年金だけの別計算は廃止）。
  // 【現在時点の残高】先頭スナップショット（yearly[0]）は「現在年齢の処理を行う前」の値なので、
  // 積み上がりの起点として必ず 0 になる。以降の年齢の残高は integrated から読むだけ。
  const surplusAtCurrent = integrated.yearly[0]?.surplusBalance ?? 0;
  const surplusAtFocus = integratedRowAt(effectiveSurplusFocusAge)?.surplusBalance ?? 0;

  // 【表示専用】現在使える資産（ダッシュボード表示用）。単一の integrated から読み出すだけで、
  // エンジンには一切渡さないので、資産・純資産・余剰金の計算は 1 円も変わらない。
  const accessibleNow = integrated.yearly[0]?.accessibleAssets ?? 0;

  const fundBreakdownAtRetire = useMemo(() => {
    if (country !== "JP") return [];
    const row = integratedRowAt(inputs.retireAge);
    if (!row) return [];
    return dynamicFunds.map((f, i) => ({
      name: f.id,
      value: Math.round(row[`pool_nisa_${i}`] ?? 0),
      color: PIE_COLORS[i % PIE_COLORS.length],
    }));
  }, [country, integratedRowAt, inputs.retireAge, JSON.stringify(dynamicFunds)]);

  // 各国の退職時点の口座別内訳。口座名称は各国のものをそのまま維持する。
  const accountBreakdownDefs = useMemo(() => ({
    US: [
      { key: "k401", label: t("us401kLabel") },
      { key: "traditionalIra", label: t("usTraditionalIraLabel") },
      { key: "rothIra", label: t("usRothIraLabel") },
      { key: "brokerage", label: t("usBrokerageLabel") },
    ],
    GB: [
      { key: "stocksSharesIsa", label: t("gbStocksSharesIsaLabel") },
      { key: "cashIsa", label: t("gbCashIsaLabel") },
      { key: "sipp", label: t("gbSippLabel") },
      { key: "workplacePension", label: t("gbWorkplacePensionLabel") },
      { key: "gia", label: t("gbGiaLabel") },
      { key: "cashSavings", label: t("gbCashSavingsLabel") },
    ],
    CA: [
      { key: "tfsa", label: t("caTfsaLabel") },
      { key: "rrsp", label: t("caRrspLabel") },
      { key: "nonRegistered", label: t("caNonRegisteredLabel") },
      { key: "cashSavings", label: t("caCashSavingsLabel") },
    ],
    AU: [
      { key: "superannuation", label: t("auSuperLabel") },
      { key: "investmentAccount", label: t("auInvestmentAccountLabel") },
      { key: "cashSavings", label: t("auCashSavingsLabel") },
    ],
  }), [t]);

  const buildAccountBreakdown = useCallback((c) => {
    if (country !== c || !rules.investment.implemented) return [];
    const row = integratedRowAt(inputs.retireAge);
    if (!row) return [];
    return (accountBreakdownDefs[c] || []).map((l, i) => ({
      name: l.label,
      value: Math.round(row[`pool_${l.key}`] ?? 0),
      color: PIE_COLORS[i % PIE_COLORS.length],
    }));
  }, [country, rules, integratedRowAt, inputs.retireAge, accountBreakdownDefs]);

  const usAccountBreakdownAtRetire = useMemo(() => buildAccountBreakdown("US"), [buildAccountBreakdown]);
  const gbAccountBreakdownAtRetire = useMemo(() => buildAccountBreakdown("GB"), [buildAccountBreakdown]);
  const caAccountBreakdownAtRetire = useMemo(() => buildAccountBreakdown("CA"), [buildAccountBreakdown]);
  const auAccountBreakdownAtRetire = useMemo(() => buildAccountBreakdown("AU"), [buildAccountBreakdown]);

  // 画面に表示する取り崩し順序。実装（ACCOUNT_DRAW_CATEGORY / drawOrderOf）から
  // 生成するので、コメントや表示と実際の順序が食い違うことがない。
  const drawdownAccountsByCategory = useMemo(() => {
    const catMap = ACCOUNT_DRAW_CATEGORY[country] || ACCOUNT_DRAW_CATEGORY.JP;
    const nameOf = (key) => {
      const defs = accountBreakdownDefs[country] || [];
      const hit = defs.find((d) => d.key === key);
      if (hit) return hit.label;
      if (key === "nisa") return t("legendNisaAssets");
      if (key === "ideco") return t("legendIdecoAssets");
      if (key === "stock") return t("legendStocks");
      if (key === "gold") return t("legendGoldAssets");
      if (key === "bank") return t("legendBankDeposits");
      return key;
    };
    const out = {};
    DRAWDOWN_CATEGORIES.forEach((c) => { out[c] = []; });
    Object.entries(catMap).forEach(([key, cat]) => {
      if (!out[cat]) out[cat] = [];
      out[cat].push(nameOf(key));
    });
    // 銀行預金・個別株・金は全ての国で共通
    if (!out.cash.includes(t("legendBankDeposits"))) out.cash.push(t("legendBankDeposits"));
    if (!out.taxable.includes(t("legendStocks"))) out.taxable.push(t("legendStocks"));
    if (!out.physical.includes(t("legendGoldAssets"))) out.physical.push(t("legendGoldAssets"));
    return out;
  }, [country, accountBreakdownDefs, t]);

  // 引出時課税を編集できる口座一覧（国別）
  const withdrawalTaxAccounts = useMemo(() => {
    const defs = accountBreakdownDefs[country] || [];
    const src = country === "US" ? inputs.usInvestment
      : country === "GB" ? inputs.gbInvestment
      : country === "CA" ? inputs.caInvestment
      : country === "AU" ? inputs.auInvestment : null;
    if (!src) return [];
    return defs.map((d) => ({
      key: d.key, label: d.label,
      withdrawalTaxPct: Number((src[d.key] || {}).withdrawalTaxPct) || 0,
    }));
  }, [country, accountBreakdownDefs, inputs.usInvestment, inputs.gbInvestment, inputs.caInvestment, inputs.auInvestment]);

  const updateWithdrawalTaxAccount = useCallback((key, field, val) => {
    if (country === "US") updateUsInvestmentAccount(key, field, val);
    else if (country === "GB") updateGbInvestmentAccount(key, field, val);
    else if (country === "CA") updateCaInvestmentAccount(key, field, val);
    else if (country === "AU") updateAuInvestmentAccount(key, field, val);
  }, [country, updateUsInvestmentAccount, updateGbInvestmentAccount, updateCaInvestmentAccount, updateAuInvestmentAccount]);


  const addBank = () => {
    const balance = Number(newBank.balance) || 0;
    if (!newBank.name.trim()) return;
    setInputs((prev) => ({
      ...prev,
      banks: [...prev.banks, {
        name: newBank.name.trim(),
        balance,
        monthlyDeposit: Number(newBank.monthlyDeposit) || 0,
        interestPct: Number(newBank.interestPct) || 0,
      }],
    }));
    setNewBank({ name: "", balance: "", monthlyDeposit: "", interestPct: "" });
  };
  const removeBank = (idx) => setInputs((prev) => ({ ...prev, banks: prev.banks.filter((_, i) => i !== idx) }));

  const addInheritancePlan = () => {
    if (!newInheritance.name.trim()) return;
    setInputs((prev) => ({
      ...prev,
      inheritancePlans: [...prev.inheritancePlans, {
        name: newInheritance.name.trim(),
        relation: newInheritance.relation.trim(),
        amount: Number(newInheritance.amount) || 0,
      }],
    }));
    setNewInheritance({ name: "", relation: "", amount: "" });
  };
  const removeInheritancePlan = (idx) =>
    setInputs((prev) => ({ ...prev, inheritancePlans: prev.inheritancePlans.filter((_, i) => i !== idx) }));

  const addPensionSource = () => {
    if (!newPensionSource.name.trim()) return;
    setInputs((prev) => ({
      ...prev,
      pensionSources: [...prev.pensionSources, {
        name: newPensionSource.name.trim(),
        monthlyAmount: Number(newPensionSource.monthlyAmount) || 0,
      }],
    }));
    setNewPensionSource({ name: "", monthlyAmount: "" });
  };
  const removePensionSource = (idx) =>
    setInputs((prev) => ({ ...prev, pensionSources: prev.pensionSources.filter((_, i) => i !== idx) }));

  const addAssetHolding = () => {
    if (!newAssetHolding.name.trim()) return;
    setInputs((prev) => ({
      ...prev,
      currentAssetHoldings: [...prev.currentAssetHoldings, {
        name: newAssetHolding.name.trim(),
        value: Number(newAssetHolding.value) || 0,
        currency: baseCurrency, // 将来の複数通貨管理用（今回は為替換算は未実装）
      }],
    }));
    setNewAssetHolding({ name: "", value: "" });
  };
  const removeAssetHolding = (idx) =>
    setInputs((prev) => ({ ...prev, currentAssetHoldings: prev.currentAssetHoldings.filter((_, i) => i !== idx) }));

  const addTsumitateHolding = () => {
    if (!newTsumitateHolding.name.trim()) return;
    setInputs((prev) => ({
      ...prev,
      tsumitateHoldings: [...prev.tsumitateHoldings, {
        name: newTsumitateHolding.name.trim(),
        value: Number(newTsumitateHolding.value) || 0,
        currency: baseCurrency, // 将来の複数通貨管理用（今回は為替換算は未実装）
      }],
    }));
    setNewTsumitateHolding({ name: "", value: "" });
  };
  const removeTsumitateHolding = (idx) =>
    setInputs((prev) => ({ ...prev, tsumitateHoldings: prev.tsumitateHoldings.filter((_, i) => i !== idx) }));

  const addGrowthHolding = () => {
    if (!newGrowthHolding.name.trim()) return;
    setInputs((prev) => ({
      ...prev,
      growthHoldings: [...prev.growthHoldings, {
        name: newGrowthHolding.name.trim(),
        value: Number(newGrowthHolding.value) || 0,
        currency: baseCurrency, // 将来の複数通貨管理用（今回は為替換算は未実装）
      }],
    }));
    setNewGrowthHolding({ name: "", value: "" });
  };
  const removeGrowthHolding = (idx) =>
    setInputs((prev) => ({ ...prev, growthHoldings: prev.growthHoldings.filter((_, i) => i !== idx) }));

  const addLoan = () => {
    const principal = Number(newLoan.principal) || 0;
    if (!newLoan.name.trim() || !principal) return;
    setInputs((prev) => ({
      ...prev,
      loans: [...prev.loans, {
        name: newLoan.name.trim(),
        principal,
        annualRatePct: Number(newLoan.annualRatePct) || 0,
        monthlyPayment: Number(newLoan.monthlyPayment) || 0,
      }],
    }));
    setNewLoan({ name: "", principal: "", annualRatePct: "", monthlyPayment: "" });
  };
  const removeLoan = (idx) => setInputs((prev) => ({ ...prev, loans: prev.loans.filter((_, i) => i !== idx) }));

  const addInsurance = () => {
    const ni = newInsurance;
    if (!ni.name.trim() || !ni.premiumFromYears || !ni.premiumToYears || !ni.coverageUntilYears) return;
    const premiumFromAge = Number(ni.premiumFromYears || 0) + Number(ni.premiumFromMonths || 0) / 12;
    const premiumToAge = Number(ni.premiumToYears || 0) + Number(ni.premiumToMonths || 0) / 12;
    const coverageUntilAge = Number(ni.coverageUntilYears || 0) + Number(ni.coverageUntilMonths || 0) / 12;
    setInputs((prev) => ({
      ...prev,
      insurancePolicies: [...prev.insurancePolicies, {
        name: ni.name.trim(),
        premiumFromAge, premiumToAge,
        monthlyPremium: Number(ni.monthlyPremium) || 0,
        coverageUntilAge,
        benefits: {
          hospitalizationPerDay: Number(ni.hospitalizationPerDay) || 0,
          hospitalizationDaysLimit: Number(ni.hospitalizationDaysLimit) || 0,
          hospitalizationSurgery: Number(ni.hospitalizationSurgery) || 0,
          daySurgery: Number(ni.daySurgery) || 0,
          radiationPerSession: Number(ni.radiationPerSession) || 0,
          advancedMedical: Number(ni.advancedMedical) || 0,
          death: Number(ni.death) || 0,
        },
        customBenefits: [],
      }],
    }));
    setNewInsurance({
      name: "",
      premiumFromYears: "", premiumFromMonths: "",
      premiumToYears: "", premiumToMonths: "",
      monthlyPremium: "",
      coverageUntilYears: "", coverageUntilMonths: "",
      hospitalizationPerDay: "", hospitalizationDaysLimit: "", hospitalizationSurgery: "", daySurgery: "",
      radiationPerSession: "", advancedMedical: "", death: "",
    });
  };
  const addCustomBenefit = (policyIdx, name, amount) =>
    setInputs((prev) => ({
      ...prev,
      insurancePolicies: prev.insurancePolicies.map((p, i) =>
        i === policyIdx ? { ...p, customBenefits: [...(p.customBenefits || []), { name, amount }] } : p
      ),
    }));
  const removeCustomBenefit = (policyIdx, itemIdx) =>
    setInputs((prev) => ({
      ...prev,
      insurancePolicies: prev.insurancePolicies.map((p, i) =>
        i === policyIdx ? { ...p, customBenefits: p.customBenefits.filter((_, j) => j !== itemIdx) } : p
      ),
    }));

  const addPension = () => {
    const np = newPension;
    if (!np.name.trim() || !np.contribFromYears || !np.contribToYears || !np.payoutFromYears || !np.payoutToYears) return;
    const contribFromAge = Number(np.contribFromYears || 0) + Number(np.contribFromMonths || 0) / 12;
    const contribToAge = Number(np.contribToYears || 0) + Number(np.contribToMonths || 0) / 12;
    const payoutFromAge = Number(np.payoutFromYears || 0) + Number(np.payoutFromMonths || 0) / 12;
    const payoutToAge = Number(np.payoutToYears || 0) + Number(np.payoutToMonths || 0) / 12;
    setInputs((prev) => ({
      ...prev,
      privatePensionPlans: [...prev.privatePensionPlans, {
        name: np.name.trim(),
        contribFromAge, contribToAge,
        monthlyContribution: Number(np.monthlyContribution) || 0,
        payoutFromAge, payoutToAge,
        monthlyPayout: Number(np.monthlyPayout) || 0,
        // 任意：現在すでにある実際の残高（証書記載の解約返戻金額など）。未入力なら積立実績から自動概算する。
        currentBalance: np.currentBalance === "" ? null : Number(np.currentBalance) || 0,
      }],
    }));
    setNewPension({
      name: "",
      contribFromYears: "", contribFromMonths: "",
      contribToYears: "", contribToMonths: "",
      monthlyContribution: "",
      payoutFromYears: "", payoutFromMonths: "",
      payoutToYears: "", payoutToMonths: "",
      monthlyPayout: "",
      currentBalance: "",
    });
  };
  const removePension = (idx) =>
    setInputs((prev) => ({ ...prev, privatePensionPlans: prev.privatePensionPlans.filter((_, i) => i !== idx) }));
  const removeInsurance = (idx) =>
    setInputs((prev) => ({ ...prev, insurancePolicies: prev.insurancePolicies.filter((_, i) => i !== idx) }));

  // 汎用：銘柄別内訳リスト（一括投資／つみたて／成長投資枠で共用）の追加・削除・編集
  const addAllocationItem = (field, newItem, resetNewItem) => {
    if (!newItem.name.trim()) return;
    setInputs((prev) => ({
      ...prev,
      [field]: [...prev[field], { name: newItem.name.trim(), amount: Number(newItem.amount) || 0 }],
    }));
    resetNewItem({ name: "", amount: "" });
  };
  const removeAllocationItem = (field, idx) =>
    setInputs((prev) => ({ ...prev, [field]: prev[field].filter((_, i) => i !== idx) }));
  const updateAllocationItem = (field, idx, key, val) =>
    setInputs((prev) => ({
      ...prev,
      [field]: prev[field].map((it, i) => (i === idx ? { ...it, [key]: val } : it)),
    }));

  const addStock = () => {
    if (!newStock.name.trim()) return;
    setWatchlist((prev) => [...prev, { name: newStock.name.trim(), sector: newStock.sector.trim() || t("uncategorizedLabel"), shares: 0, value: 0, currency: baseCurrency }]);
    setNewStock({ name: "", sector: "" });
  };
  const removeStock = (idx) => setWatchlist((prev) => prev.filter((_, i) => i !== idx));
  const updateStockField = (idx, field, val) =>
    setWatchlist((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: val } : s)));

  const addLump = () => {
    const age = Number(newLump.years || 0) + Number(newLump.months || 0) / 12;
    const amount = Number(newLump.amount);
    if (!newLump.years || !amount) return;
    setInputs((prev) => ({
      ...prev,
      lumpSums: [...prev.lumpSums, { age, amount }].sort((a, b) => a.age - b.age),
    }));
    setNewLump({ years: "", months: "", amount: "" });
  };
  const removeLump = (idx) =>
    setInputs((prev) => ({ ...prev, lumpSums: prev.lumpSums.filter((_, i) => i !== idx) }));

  const addTsumitateRange = () => {
    const fromAge = Number(newTsumitateRange.fromYears || 0) + Number(newTsumitateRange.fromMonths || 0) / 12;
    const toAge = Number(newTsumitateRange.toYears || 0) + Number(newTsumitateRange.toMonths || 0) / 12;
    const monthlyYen = Number(newTsumitateRange.monthlyYen);
    if (!newTsumitateRange.fromYears || !newTsumitateRange.toYears || toAge < fromAge || !monthlyYen) return;
    if (tsumitateHoldingsAsOfAge !== null && fromAge < tsumitateHoldingsAsOfAge) {
      window.alert(t("scheduleBeforeBaseAgeAlert", { age: formatAge(tsumitateHoldingsAsOfAge) }));
      return;
    }
    setInputs((prev) => ({
      ...prev,
      tsumitateSchedule: [...prev.tsumitateSchedule, { fromAge, toAge, monthlyYen }].sort((a, b) => a.fromAge - b.fromAge),
    }));
    setNewTsumitateRange({ fromYears: "", fromMonths: "", toYears: "", toMonths: "", monthlyYen: "" });
  };
  const removeTsumitateRange = (idx) =>
    setInputs((prev) => ({ ...prev, tsumitateSchedule: prev.tsumitateSchedule.filter((_, i) => i !== idx) }));

  const addGrowthRange = () => {
    const fromAge = Number(newGrowthRange.fromYears || 0) + Number(newGrowthRange.fromMonths || 0) / 12;
    const toAge = Number(newGrowthRange.toYears || 0) + Number(newGrowthRange.toMonths || 0) / 12;
    const monthlyYen = Number(newGrowthRange.monthlyYen);
    if (!newGrowthRange.fromYears || !newGrowthRange.toYears || toAge < fromAge || !monthlyYen) return;
    if (growthHoldingsAsOfAge !== null && fromAge < growthHoldingsAsOfAge) {
      window.alert(t("scheduleBeforeBaseAgeAlert", { age: formatAge(growthHoldingsAsOfAge) }));
      return;
    }
    setInputs((prev) => ({
      ...prev,
      growthSchedule: [...prev.growthSchedule, { fromAge, toAge, monthlyYen }].sort((a, b) => a.fromAge - b.fromAge),
    }));
    setNewGrowthRange({ fromYears: "", fromMonths: "", toYears: "", toMonths: "", monthlyYen: "" });
  };
  const removeGrowthRange = (idx) =>
    setInputs((prev) => ({ ...prev, growthSchedule: prev.growthSchedule.filter((_, i) => i !== idx) }));

  const netMonthlyGap = inputs.livingCostMonthly - inputs.pensionMonthly;

  // ---------- 診断コメント ----------
  // 新しい計算は一切せず、すでに算出済みの値だけを generateAdvice に渡す。
  //
  // 【retirementMonthlyGap を全ての国で null にしている理由】
  // これは「退職後に毎月いくら足りないか」を表す値。
  // 当初は日本版に netMonthlyGap（= livingCostMonthly - pensionMonthly）を渡していたが、
  // 統合シミュレーション（runIntegratedPlan）は医療費・民間年金収入・iDeCoの年金受取なども
  // 織り込んで資産推移を出しているため、この簡易な引き算とは前提が食い違う。
  // 「グラフでは足りているのに診断は赤字」といった矛盾が起きうるので採用しない。
  //
  // 統合計算の結果（integrated.yearly の各行）が持つのは残高系の値だけで、
  // 「その年の収入・支出」に当たるフィールドは無い。純資産の増減から逆算する方法もあるが、
  // それには運用益が混ざるため“収支”にはならず、新しい計算式を作ることになってしまう。
  //
  // 根拠のない数字で断定するくらいなら黙るほうが正しいので、いまは null を渡して
  // 「老後収支」の診断項目そのものを出さない。将来、統合エンジンが退職後の月次収支を
  // 返すようになったら、ここに渡すだけで generateAdvice 側は無変更のまま5か国に対応できる。
  const advice = useMemo(
    () =>
      generateAdvice({
        currentAge: effectiveCurrentAge,
        retireAge: inputs.retireAge,
        deathAge: inputs.deathAge,
        depletionAge: integrated.depletionAge,
        netWorthNow: netWorthYearly[0]?.netWorth,
        netWorthAtRetire: integratedRowAt(inputs.retireAge)?.netWorth,
        netWorthFinal,
        inheritanceTarget: effectiveInheritanceTarget,
        retirementMonthlyGap: null, // 上記の理由により、いまは全ての国で判定しない
      }),
    [
      effectiveCurrentAge, inputs.retireAge, inputs.deathAge,
      integrated.depletionAge, netWorthYearly, integratedRowAt,
      netWorthFinal, effectiveInheritanceTarget,
    ]
  );
  // 【診断のゲート】最低限の入力（現在年齢・生活費・資産）が揃うまで診断を出さない。
  // 初期状態は生活費0のため資産が減らず、何も入力していないのに「資産が持ちます」と
  // 緑の判定が出てしまう。未入力の人に安心を与えないよう、案内文に差し替える。
  // 生活費は国ごとに置き場所が違うため、エンジンへ渡すのと同じ readLivingCostMonthly で読む。
  const adviceReady = useMemo(
    () => hasEnoughInputForAdvice({
      currentAge: effectiveCurrentAge,
      livingCostMonthly: readLivingCostMonthly(country, inputs),
      totalAssets: integrated.yearly[0]?.totalAssets ?? 0,
    }),
    [effectiveCurrentAge, country, inputs, integrated]
  );

  // 【年齢の整合チェック】表示専用。計算は止めず、入力欄の近くに理由を出すためだけに使う。
  const ageWarnings = useMemo(
    () => validateAgeInputs({
      currentAge: effectiveCurrentAge,
      retireAge: inputs.retireAge,
      deathAge: inputs.deathAge,
    }),
    [effectiveCurrentAge, inputs.retireAge, inputs.deathAge]
  );

  // 総合評価（配列の先頭）の重さで、カードの枠線の色を決める。
  // 診断できる状態でないときは、緑（＝良い状態）に見えないよう中立色にする。
  const adviceBorderColor =
    !adviceReady ? "#2A363C"
    : advice[0]?.severity === "danger" ? "#C2694F"
    : advice[0]?.severity === "warning" ? "#D9A54F"
    : "#6FA88A";

  // つみたて枠・成長投資枠の「これまでの使用累計」は、手入力の基準額に加えて
  // スケジュール（過去分）・一括投資（実行済み分）から自動集計した金額を合算する
  const tsumitateElapsed = elapsedScheduleAmount(inputs.tsumitateSchedule, effectiveCurrentAge);
  const growthElapsed =
    elapsedScheduleAmount(inputs.growthSchedule, effectiveCurrentAge) +
    elapsedLumpSumAmount(inputs.lumpSums, effectiveCurrentAge);
  const computedTsumitateUsed = inputs.tsumitateUsed + tsumitateElapsed;
  const computedGrowthUsed = inputs.growthUsed + growthElapsed;

  // 現在のNISA資産の内訳（つみたて投資枠 / 成長投資枠）— 円グラフ・棒グラフ用
  const nisaFrameAllocationItems = [
    { name: t("tsumitateFrameLabel"), amount: Math.max(0, computedTsumitateUsed) },
    { name: t("growthFrameLabel"), amount: Math.max(0, computedGrowthUsed) },
  ];

  const growthDiff = NISA_LIMITS.growthLifetime - computedGrowthUsed;
  const remainingGrowth = Math.max(0, growthDiff);
  const growthOverage = Math.max(0, -growthDiff);

  const totalDiff = NISA_LIMITS.totalLifetime - computedTsumitateUsed - computedGrowthUsed;
  const remainingTotal = Math.max(0, totalDiff);
  const totalOverage = Math.max(0, -totalDiff);

  // つみたて投資枠には単独の生涯上限はなく、総枠(1,800万円)を成長投資枠と共有する。
  // そのため「つみたて分の残り」は、総枠の残りのうち今後つみたてに割り当てられる分として扱う。
  const remainingTsumitate = remainingTotal;
  const tsumitateOverage = Math.max(0, computedTsumitateUsed - NISA_LIMITS.totalLifetime);

  // 今年時点でのペース（現在の年齢での積立額 × 12ヶ月）が年間上限に対してどうかを表示
  const currentTsumitateMonthly = scheduledAmount(inputs.tsumitateSchedule, effectiveCurrentAge);
  const tsumitateAnnualPace = currentTsumitateMonthly * 12;
  const tsumitateAnnualDiff = NISA_LIMITS.tsumitateAnnual - tsumitateAnnualPace;
  const tsumitateAnnualRemaining = Math.max(0, tsumitateAnnualDiff);
  const tsumitateAnnualOverage = Math.max(0, -tsumitateAnnualDiff);

  const currentGrowthMonthly = scheduledAmount(inputs.growthSchedule, effectiveCurrentAge);
  const growthAnnualPace = currentGrowthMonthly * 12;
  const growthAnnualDiff = NISA_LIMITS.growthAnnual - growthAnnualPace;
  const growthAnnualRemaining = Math.max(0, growthAnnualDiff);
  const growthAnnualOverage = Math.max(0, -growthAnnualDiff);

  // 各スケジュール区間の横に「月上限まであと幾ら」「その区間終了時点で生涯投資枠があと幾ら残るか」を表示するためのヘルパー
  const tsumitateMonthlyCapValue = NISA_LIMITS.tsumitateAnnual / 12;
  const growthMonthlyCapValue = NISA_LIMITS.growthAnnual / 12;

  const formatCapDiff = (diff, periodLabel) => (diff >= 0 ? t("capDiffRemaining", { period: periodLabel, amount: money(diff) }) : t("capDiffExceeded", { period: periodLabel, amount: money(-diff) }));

  const lifetimeRemainingAtAge = (age) => {
    const row = sim.yearly.find((y) => y.age >= age) || sim.yearly[sim.yearly.length - 1];
    const cum = row ? row.tsumitateCum + row.growthCum : computedTsumitateUsed + computedGrowthUsed;
    return NISA_LIMITS.totalLifetime - cum;
  };

  return (
    <LocaleContext.Provider value={localeValue}>
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&family=Noto+Sans+JP:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
        html, body {
          background: #0E1316;
        }

        * { box-sizing: border-box; }
        .app {
          --bg: #0E1316;
          --panel: #151C20;
          --panel-2: #182027;
          --line: #2A363C;
          --line-faint: rgba(79,168,216,0.14);
          --blue: #4FA8D8;
          --blue-dim: #2E5F78;
          --amber: #D9A54F;
          --green: #8FBF7F;
          --text: #E7ECEE;
          --muted: #E7ECEE; /* 淡いグレーをやめ、はっきりした白に統一（全体） */
          --danger: #C2694F;
          /* 右端のクイックジャンプ列に、色付きの囲い線がちょうど届く幅。
             ボタンは右端から10px＋幅60px＝右端70pxの位置にある。
             この値を小さくすると囲い線が右（ボタン側）へ伸び、大きくすると左へ寄る。 */
          --quicknav-space: 66px;
          font-family: 'Noto Sans JP', sans-serif;
          background: var(--bg);
          color: var(--text);
          min-height: 100vh;
          padding: 0 var(--quicknav-space) 60px 6px;
        }
        .mono { font-family: 'JetBrains Mono', monospace; }

        /* ---------- responsive safety ---------- */
        .app, .app * { box-sizing: border-box; }
        .app { width: 100%; max-width: 100%; overflow-x: hidden; }
        .grid-main, .panel, .content, .two-col, .stat-grid, .chart-frame { min-width: 0; }
        img, svg, canvas { max-width: 100%; }
        img { height: auto; }
        input, select, textarea, button { max-width: 100%; }
        input:disabled {
          color: var(--text) !important;
          -webkit-text-fill-color: var(--text) !important;
          opacity: 1 !important;
        }
        .field-input-wrap, .add-row { min-width: 0; }
        .add-row input { min-width: 0; }
        table.watchlist { table-layout: fixed; }
        table.watchlist th, table.watchlist td { overflow-wrap: anywhere; word-break: break-word; }

        @media (max-width: 640px) {
          .titleblock { padding: 16px 14px 12px; align-items: flex-start; }
          .titleblock h1 { font-size: 19px; line-height: 1.35; }
          .titleblock .meta { width: 100%; gap: 6px 12px; }
          .save-warning, .history-panel { padding-left: 14px; padding-right: 14px; }
          .footer-note { padding-left: 14px; padding-right: 14px; }
          .stat-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
          .stat-card { padding: 12px; }
          .stat-value { font-size: 17px; overflow-wrap: anywhere; }
          .chart-frame { padding-left: 0; padding-right: 0; }
          .chart-frame .chart-label { padding-left: 10px; padding-right: 10px; }
          .add-row { flex-wrap: wrap; }
          .add-row input { flex: 1 1 140px; }
          .add-btn { min-height: 36px; }
          table.watchlist { width: 100%; table-layout: fixed; }
          table.watchlist th, table.watchlist td { white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
          .landing { padding: 30px 14px 28px; }
          .landing-hero h1 { font-size: 22px; }
          .landing-screenshot { width: 100%; }
          .landing-screenshot img { width: 100%; max-width: 100%; margin: 0; border-radius: 10px; }
        }

        @media (max-width: 420px) {
          .stat-grid { grid-template-columns: 1fr; }
          .titleblock .meta { display: grid; grid-template-columns: 1fr; }
          .landing-cta { width: 100%; }
        }

        .titleblock {
          border-bottom: 1px solid var(--line);
          padding: 22px 28px 16px;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          flex-wrap: wrap;
          gap: 12px;
        }
        .titleblock h1 {
          font-family: 'Zen Kaku Gothic New', sans-serif;
          font-weight: 700;
          font-size: 22px;
          letter-spacing: 0.02em;
          margin: 0;
          color: var(--text);
        }
        .titleblock .sub {
          color: var(--muted);
          font-size: 12px;
          margin-top: 4px;
          font-family: 'JetBrains Mono', monospace;
        }
        .titleblock .meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px 18px;
          font-size: 11px;
          color: var(--muted);
          font-family: 'JetBrains Mono', monospace;
        }
        .titleblock .meta div span { color: var(--blue); }

        .grid-main {
          display: grid;
          grid-template-columns: 340px 1fr;
          gap: 0;
        }
        @media (max-width: 880px) {
          .grid-main { grid-template-columns: 1fr; }
        }

        .panel {
          padding: 20px 24px;
          border-right: 1px solid var(--line);
        }
        .content { padding: 20px 28px; }

        /* スマホなど1カラム表示（≤880px）では、パネル／コンテンツの左右パディングを
           0にして、中のカード（section-block）を上部ダッシュボードと同じ幅に揃える。
           横フレームは .app のパディング（左6px／右 --quicknav-space）だけで決める。
           ※このブロックは .panel / .content の基本ルールより後ろに置くこと。
             CSSは同じ詳細度なら後勝ちなので、前に置くと基本ルールに負けて効かない。 */
        @media (max-width: 880px) {
          .panel, .content {
            padding-left: 0;
            padding-right: 0;
            padding-top: 16px;
            padding-bottom: 16px;
            border-right: none;
          }
        }

        .section-block {
          /* 個別株カード（.chart-frame）と同じ、色なしの落ち着いた見た目に統一。
             各セクションはインラインで borderColor を指定しているため、
             border-color を !important で上書きして色を打ち消す。 */
          border: 1px solid var(--line);
          border-color: var(--line) !important;
          background: var(--panel);
          border-radius: 8px;
          padding: 14px 14px 4px;
          margin-bottom: 18px;
        }
        /* タイトル内のお名前（○○様）。見出しより小さく控えめに。 */
        .title-username {
          display: block;
          font-size: 0.5em;
          font-weight: 500;
          color: #7C8A90;
          letter-spacing: 0.04em;
          margin-top: 6px;
        }
        /* 入力セクションへのショートカットボタン */
        .section-nav {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }
        .section-nav-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 12px;
          border-radius: 8px;
          border: 1px solid #2A3439;
          background: #161E22;
          color: #C9D6DC;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: border-color .15s, background .15s;
        }
        .section-nav-btn:hover, .section-nav-btn:active {
          border-color: #4FA8D8;
          background: #1B262B;
        }
        /* 各セクションの見出し右端に置く「項目一覧へ戻る」ボタン */
        .back-to-nav {
          margin-left: auto;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 5px 9px;
          border-radius: 6px;
          border: 1px solid #2A3439;
          background: transparent;
          color: #7C8A90;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          transition: color .15s, border-color .15s;
        }
        .back-to-nav:hover, .back-to-nav:active {
          color: #4FA8D8;
          border-color: #4FA8D8;
        }

        /* 右下に常駐するフローティング領域（クイックジャンプ＋トップへ戻る）。
           領域を fixed にし、中のボタンは通常フローで縦積みする。 */
        .quicknav-wrap {
          position: fixed;
          right: 10px;
          /* ボタンが22個に増えたので、全部が画面に収まるよう下端を少し上げ、
             表示高さの上限を広げ、隙間とボタンの高さを詰める。 */
          bottom: calc(50px + env(safe-area-inset-bottom, 0px));
          z-index: 50;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
          /* 画面高を超えたらこの領域内だけスクロール（項目が多いため）。
             背景は透明なので、はみ出しても後ろは見える。 */
          max-height: 90vh;
          overflow-y: auto;
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          pointer-events: none; /* 透明な余白部分はタップを透過させる */
        }
        .quicknav-wrap > * { pointer-events: auto; } /* ボタン自体は押せる */

        .quicknav {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 5px;
        }
        /* 各項目ボタン：背景透明・アクセント色・小さめだが指で押せるサイズ。 */
        .quicknav-btn {
          width: 60px;            /* 全ボタン共通の固定幅。文字数に関係なく横幅を統一 */
          min-height: 26px;
          padding: 3px 0;         /* 幅を固定したので左右パディングは0にして中央寄せ */
          text-align: center;
          border-radius: 999px;
          border: 1px solid rgba(79, 168, 216, 0.55);
          background: transparent;
          color: #6FC0EC;
          font-size: 12px;
          font-weight: 700;
          line-height: 1;
          white-space: nowrap;
          cursor: pointer;
          text-shadow: 0 0 4px #000, 0 0 3px #000;
          transition: color .12s, border-color .12s, background .12s;
        }
        .quicknav-btn:hover, .quicknav-btn:active {
          color: #0E1316;
          background: #6FC0EC;
          border-color: #6FC0EC;
        }

        /* 「トップへ戻る」ボタン。項目ボタンと同じ小型・背景透明のピル。
           区別できるよう文字色だけピンクにする。着地先は #simulator（入力フォーム先頭）。 */
        .back-to-top {
          width: 60px;            /* クイックジャンプと同じ固定幅で統一 */
          min-height: 30px;
          padding: 5px 0;
          text-align: center;
          border-radius: 999px;
          border: 1px solid rgba(230, 138, 176, 0.6);
          background: transparent;
          color: #F0A6C4;
          font-size: 12px;
          font-weight: 700;
          line-height: 1;
          white-space: nowrap;
          cursor: pointer;
          text-shadow: 0 0 4px #000, 0 0 3px #000;
          transition: color .12s, border-color .12s, background .12s;
        }
        .back-to-top:hover, .back-to-top:active {
          color: #0E1316;
          background: #F0A6C4;
          border-color: #F0A6C4;
        }

        /* 入力フォーム末尾に置く、通常フローの「トップへ戻る」ボタン（全幅）。 */
        .back-to-top-inline {
          width: 100%;
          margin-top: 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 13px 0;
          border-radius: 8px;
          border: 1px solid #2A363C;
          background: var(--panel-2);
          color: #E7ECEE;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: color .15s, border-color .15s, background .15s;
        }
        .back-to-top-inline:hover, .back-to-top-inline:active {
          color: #4FA8D8;
          border-color: #4FA8D8;
        }

        /* 上部固定ヘッダーに隠れないよう、ジャンプ先に余白を確保する */
        #simulator { scroll-margin-top: 12px; }
        #section-overview, #section-column, #section-wallet, #section-nav,
        #section-surplus-balance, #section-advice, #section-comparison { scroll-margin-top: 12px; }

        /* 上部固定ヘッダーに隠れないよう、ジャンプ先に余白を確保する */
        .section-title { scroll-margin-top: 16px; }

        .section-block .section-title {
          margin-top: 4px;
        }
        .section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 26px 0 12px;
        }
        .section-title:first-child { margin-top: 4px; }
        .section-title .section-index {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--blue);
          border: 1px solid var(--blue-dim);
          padding: 1px 6px;
          border-radius: 2px;
        }
        .section-title h2 {
          font-family: 'Zen Kaku Gothic New', sans-serif;
          font-size: 13px;
          font-weight: 700;
          margin: 0;
          letter-spacing: 0.02em;
        }
        .section-title svg { color: var(--muted); }

        .field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 12px;
        }
        .field-label {
          font-size: 11px;
          color: var(--muted);
        }
        .field-input-wrap {
          display: flex;
          align-items: center;
          border: 1px solid var(--line);
          background: var(--panel-2);
          border-radius: 3px;
          overflow: hidden;
        }
        .field-input-wrap:focus-within { border-color: var(--blue-dim); }
        .field input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text);
          padding: 8px 10px;
          font-size: 13px;
          min-width: 0;
        }
        .field-unit {
          padding: 0 10px;
          font-size: 11px;
          color: var(--muted);
          border-left: 1px solid var(--line);
          align-self: stretch;
          display: flex;
          align-items: center;
        }

        .alloc-row {
          display: grid;
          grid-template-columns: 16px 1fr 56px;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .alloc-dot { width: 8px; height: 8px; border-radius: 50%; }
        .alloc-row input[type="range"] {
          width: 100%;
          accent-color: var(--blue);
        }
        .alloc-row .alloc-val {
          font-size: 12px;
          text-align: right;
          font-family: 'JetBrains Mono', monospace;
          color: var(--muted);
        }
        .alloc-sum {
          font-size: 11px;
          margin-top: 4px;
          color: var(--muted);
        }
        .alloc-sum.warn { color: var(--danger); }

        .note {
          display: flex;
          gap: 6px;
          font-size: 11px;
          color: var(--muted);
          background: var(--panel-2);
          border: 1px solid var(--line);
          border-left: 2px solid var(--blue-dim);
          padding: 8px 10px;
          border-radius: 2px;
          line-height: 1.5;
          margin: 10px 0 16px;
        }
        .note svg { flex-shrink: 0; margin-top: 1px; color: var(--blue); }

        .stat-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 22px;
        }
        @media (max-width: 880px) {
          .stat-grid { grid-template-columns: repeat(2, 1fr); }
          .stat-grid > *:last-child:nth-child(odd) { grid-column: 1 / -1; }
        }
        .stat-card {
          border: 1px solid var(--line);
          background: var(--panel);
          padding: 14px 16px;
          border-radius: 3px;
          position: relative;
        }
        .stat-card::before {
          content: "";
          position: absolute; top: 0; left: 0; width: 100%; height: 2px;
          background: var(--blue-dim);
        }
        .stat-card.danger::before { background: var(--danger); }
        .stat-card.good::before { background: var(--green); }
        .surplus-why {
          border: 1px solid var(--line);
          border-left: 3px solid #7FB3A6;
          background: rgba(127, 179, 166, 0.06);
          border-radius: 6px;
          padding: 12px 14px;
          margin-top: 12px;
          font-size: 12.5px;
          line-height: 1.75;
        }
        .surplus-why-title { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
        .surplus-why p { margin: 0 0 8px; }
        .surplus-why p:last-child { margin-bottom: 0; }
        .surplus-why ul { margin: 0 0 8px; padding-left: 1.2em; }
        .surplus-why li { margin: 2px 0; }
        .stat-label { font-size: 11px; color: var(--muted); margin-bottom: 6px; }
        .stat-value { font-size: 19px; font-weight: 600; }
        .stat-sub { font-size: 11px; color: var(--muted); margin-top: 4px; }

        .chart-frame {
          border: 1px solid var(--line);
          background: var(--panel);
          padding: 16px 8px 8px;
          border-radius: 3px;
          margin-bottom: 22px;
        }
        .chart-frame .chart-label {
          font-size: 11px;
          color: var(--muted);
          padding: 0 12px 8px;
          font-family: 'JetBrains Mono', monospace;
        }

        .two-col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        @media (max-width: 880px) { .two-col { grid-template-columns: 1fr; } }

        table.watchlist { width: 100%; border-collapse: collapse; font-size: 12px; }
        table.watchlist th {
          text-align: left; color: var(--muted); font-weight: 500;
          border-bottom: 1px solid var(--line); padding: 6px 8px; font-size: 11px;
        }
        table.watchlist td { padding: 7px 8px; border-bottom: 1px solid rgba(42,54,60,0.5); }
        table.watchlist tr:hover { background: rgba(79,168,216,0.05); }
        .del-btn {
          background: none; border: none; color: var(--muted); cursor: pointer;
          display: flex; align-items: center; padding: 2px;
        }
        .del-btn:hover { color: var(--danger); }

        .add-row {
          display: flex; gap: 8px; margin-top: 10px;
        }
        .add-row input {
          flex: 1; background: var(--panel-2); border: 1px solid var(--line);
          color: var(--text); padding: 7px 9px; border-radius: 3px; font-size: 12px; outline: none;
        }
        .add-row input:focus { border-color: var(--blue-dim); }
        .add-btn {
          background: var(--blue-dim); border: 1px solid var(--blue);
          color: var(--text); border-radius: 3px; padding: 0 12px;
          display: flex; align-items: center; cursor: pointer;
        }
        .add-btn:hover { background: var(--blue); }

        .history-toggle {
          background: var(--panel-2); border: 1px solid var(--line);
          color: var(--blue); font-size: 11px; font-family: 'JetBrains Mono', monospace;
          padding: 5px 10px; border-radius: 3px; cursor: pointer; white-space: nowrap;
        }
        .history-toggle:hover { border-color: var(--blue-dim); }

        .country-select {
          background: var(--panel-2); border: 1px solid var(--line);
          color: var(--text); font-size: 11px; font-family: 'JetBrains Mono', monospace;
          padding: 5px 8px; border-radius: 3px; cursor: pointer; white-space: nowrap;
        }
        .country-select:hover { border-color: var(--blue-dim); }

        .save-badge {
          font-size: 10.5px; font-family: 'JetBrains Mono', monospace;
          padding: 4px 8px; border-radius: 3px; border: 1px solid var(--line);
          cursor: default; white-space: nowrap;
        }
        .save-saved { color: var(--green); border-color: rgba(143,191,127,0.35); }
        .save-saving { color: var(--muted); }
        .save-error, .save-unavailable { color: var(--danger); border-color: rgba(194,105,79,0.4); }
        .save-warning {
          display: flex; gap: 8px; align-items: flex-start;
          font-size: 12px; color: var(--danger); background: rgba(194,105,79,0.08);
          border-bottom: 1px solid var(--line); padding: 10px 28px;
        }
        .locale-preview-warning {
          display: flex; gap: 8px; align-items: flex-start;
          font-size: 12px; color: var(--amber); background: rgba(217,165,79,0.10);
          border-bottom: 1px solid var(--line); padding: 10px 28px; line-height: 1.6;
        }
        /* 免責表示：全ての国で常時表示し、印刷・PDFにも必ず残す（no-printを付けない） */
        .disclaimer-banner {
          display: flex; gap: 8px; align-items: flex-start;
          font-size: 12px; color: var(--muted); background: rgba(124,138,144,0.08);
          border-bottom: 1px solid var(--line); padding: 10px 28px; line-height: 1.6;
        }
        @media (max-width: 640px) { .disclaimer-banner { padding: 10px 16px; font-size: 11px; } }
        /* オーストラリア版で使用する、チェックボックスと選択チップ（他国の画面には影響しない） */
        .checkbox-row {
          display: flex; gap: 8px; align-items: flex-start;
          font-size: 13px; color: var(--text); line-height: 1.6;
          margin: 4px 0 12px; cursor: pointer;
        }
        .checkbox-row input[type="checkbox"] {
          width: 16px; height: 16px; margin-top: 2px; flex-shrink: 0; cursor: pointer;
          accent-color: var(--blue);
        }
        .chip-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .chip {
          padding: 7px 16px; border-radius: 999px; cursor: pointer;
          border: 1px solid var(--line); background: transparent; color: var(--muted);
          font-size: 13px; font-family: inherit; transition: all 0.15s;
        }
        .chip:hover { border-color: var(--blue); color: var(--text); }
        .chip-active {
          border-color: var(--blue); background: rgba(79,168,216,0.14); color: var(--text); font-weight: 600;
        }
        /* 入力ガイド（「?」ボタンと、開いたときの説明文） */
        .field-label-row {
          display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
        }
        .guide-btn {
          width: 17px; height: 17px; flex-shrink: 0; padding: 0;
          border-radius: 50%; cursor: pointer;
          border: 1px solid var(--line); background: transparent; color: var(--muted);
          font-size: 11px; font-weight: 700; line-height: 1; font-family: inherit;
          display: inline-flex; align-items: center; justify-content: center;
          transition: all 0.15s;
        }
        .guide-btn:hover { border-color: var(--blue); color: var(--blue); }
        .guide-btn-open {
          border-color: var(--blue); background: var(--blue); color: var(--bg);
        }
        /* 注記内の改行（\n）を反映させる。既存の1行の注記には影響しない。 */
        .note span { white-space: pre-line; }
        .guide-text {
          display: block;
          font-size: 11px; color: var(--muted); line-height: 1.7;
          background: rgba(79,168,216,0.07);
          border-left: 2px solid var(--blue);
          padding: 7px 10px; margin: 5px 0 3px;
          border-radius: 0 4px 4px 0;
          white-space: pre-line;
        }
        .section-guide-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 0; border: none; background: transparent; cursor: pointer;
          color: var(--muted); font-size: 11px; font-family: inherit;
        }
        .section-guide-btn:hover { color: var(--blue); }
        .section-guide-btn:hover .guide-btn { border-color: var(--blue); color: var(--blue); }
        .section-guide-btn.guide-btn-open .guide-btn {
          border-color: var(--blue); background: var(--blue); color: var(--bg);
        }
        @media print { .guide-btn, .section-guide-btn { display: none; } }

        /* NISAセクションの4ブロックを、背景のグラデーションで視覚的に区切る。
           入力欄そのものには手を加えず、囲みの背景色だけで境界を示す。 */
        .nisa-group {
          position: relative;
          padding: 30px 14px 14px;
          margin: 0 -4px 20px;
          border-radius: 10px;
          border: 1px solid var(--line);
        }
        .nisa-group-title {
          position: absolute; top: 9px; left: 14px;
          font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
          color: var(--muted); text-transform: uppercase;
        }
        /* ① いま溜まっている金額：青（現状の把握） */
        .nisa-group-holdings {
          background: linear-gradient(160deg, rgba(79,168,216,0.10) 0%, rgba(79,168,216,0.02) 55%, transparent 100%);
          border-color: rgba(79,168,216,0.28);
        }
        .nisa-group-holdings .nisa-group-title { color: #4FA8D8; }
        /* ② つみたて投資枠：緑（コツコツ積み上げる） */
        .nisa-group-tsumitate {
          background: linear-gradient(160deg, rgba(143,191,127,0.10) 0%, rgba(143,191,127,0.02) 55%, transparent 100%);
          border-color: rgba(143,191,127,0.28);
        }
        .nisa-group-tsumitate .nisa-group-title { color: #8FBF7F; }
        /* ③ 成長投資枠：琥珀（攻めの枠） */
        .nisa-group-growth {
          background: linear-gradient(160deg, rgba(217,165,79,0.10) 0%, rgba(217,165,79,0.02) 55%, transparent 100%);
          border-color: rgba(217,165,79,0.28);
        }
        .nisa-group-growth .nisa-group-title { color: #D9A54F; }
        /* ④ 一括投資：紫（まとまった資金） */
        .nisa-group-lump {
          background: linear-gradient(160deg, rgba(176,143,214,0.10) 0%, rgba(176,143,214,0.02) 55%, transparent 100%);
          border-color: rgba(176,143,214,0.28);
        }
        .nisa-group-lump .nisa-group-title { color: #B08FD6; }
        @media (max-width: 640px) {
          .nisa-group { padding: 28px 10px 12px; margin: 0 -2px 16px; }
          .nisa-group-title { left: 10px; }
        }
        @media print {
          .nisa-group { background: none; border-color: var(--line); }
        }
        .history-panel {
          padding: 14px 28px; border-bottom: 1px solid var(--line);
          background: var(--panel);
        }
        .history-empty { font-size: 12px; color: var(--muted); }
        .history-action {
          background: none; border: 1px solid var(--line); color: var(--blue);
          font-size: 11px; padding: 3px 8px; border-radius: 3px; cursor: pointer;
        }
        .history-action:hover { border-color: var(--blue-dim); }

        .inline-num {
          width: 100%; background: var(--panel-2); border: 1px solid var(--line);
          color: var(--text); padding: 4px 6px; border-radius: 3px; font-size: 12px; outline: none;
        }
        .inline-num:focus { border-color: var(--blue-dim); }

        .footer-note {
          font-size: 10.5px; color: var(--muted); padding: 20px 28px 0;
          line-height: 1.6; border-top: 1px solid var(--line); margin-top: 10px;
        }
        /* 画面最下部のクレジット（4行） */
        .footer-credit {
          margin-top: 22px;
          padding: 18px 28px 26px;
          border-top: 1px solid var(--line);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          line-height: 1.9;
          color: var(--muted);
          text-align: center;
        }
        .footer-mail {
          color: var(--blue); text-decoration: none;
          border-bottom: 1px solid rgba(79,168,216,0.5);
        }
        .footer-mail:hover { border-bottom-color: var(--blue); }

        @media print {
          .app { background: #fff !important; color: #111 !important; background-image: none !important; }
          button, .add-row, .history-panel, .save-warning, .history-toggle, .country-select, .no-print { display: none !important; }
          .grid-main { grid-template-columns: 1fr !important; }
          .panel { border-right: none !important; border-bottom: 2px solid #ccc; }
          .stat-card, .chart-frame, .panel, .content { background: #fff !important; border-color: #ccc !important; color: #111 !important; }
          .stat-value, h1, h2, .field-label, .stat-label, .stat-sub { color: #111 !important; }
          input, select { border: none !important; background: transparent !important; color: #111 !important; }
          .field-input-wrap { border: none !important; }
          .field-unit { border-left: none !important; color: #555 !important; }
          table.watchlist th, table.watchlist td { color: #111 !important; }
          .chart-frame { break-inside: avoid; }
          .stat-card { break-inside: avoid; }
        }

        /* ---------- Intro section (for first-time visitors) ---------- */
        .landing {
          padding: 40px 24px 36px;
          border-bottom: 1px solid var(--line);
        }
        .landing-hero { max-width: 640px; margin: 0 auto; text-align: center; }
        .landing-hero h1 {
          font-family: 'Zen Kaku Gothic New', sans-serif;
          font-size: 26px; font-weight: 700; line-height: 1.4;
          margin: 0 0 14px; color: var(--text);
        }
        .landing-free-notice {
          font-size: 11.5px; line-height: 1.6; color: var(--green);
          margin: -6px 0 16px;
        }
        .landing-free-notice strong { color: var(--green); font-weight: 700; }
        .landing-catch {
          font-size: 16px; line-height: 1.7; color: var(--blue);
          margin: 0 0 16px; font-weight: 500;
        }
        .landing-sub {
          font-size: 13.5px; line-height: 1.8; color: var(--muted);
          margin: 0 0 26px;
        }
        .landing-cta {
          display: inline-block; width: 100%; max-width: 360px;
          background: var(--blue); color: #0E1316; border: none;
          font-family: 'Zen Kaku Gothic New', sans-serif;
          font-size: 15px; font-weight: 700; letter-spacing: 0.02em;
          padding: 15px 20px; border-radius: 6px; cursor: pointer;
        }
        .landing-cta:hover { background: #6BB8E0; }

        .landing-screenshot {
          max-width: 900px; margin: 36px auto 0; text-align: center;
        }
        .landing-screenshot h2 {
          font-family: 'Zen Kaku Gothic New', sans-serif; font-size: 16px; font-weight: 700;
          margin: 0 0 8px; color: var(--text);
        }
        .landing-screenshot p {
          font-size: 12.5px; line-height: 1.7; color: var(--muted);
          margin: 0 0 18px; max-width: 480px; margin-left: auto; margin-right: auto;
        }
        .landing-screenshot img {
          width: 100%; max-width: 900px; height: auto;
          border-radius: 16px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.35);
          border: 1px solid var(--line);
          display: block; margin: 0 auto;
        }

        .landing-features {
          max-width: 640px; margin: 40px auto 0;
          display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
        }
        @media (max-width: 520px) { .landing-features { grid-template-columns: 1fr; } }
        .landing-feature-card {
          border: 1px solid var(--line); background: var(--panel);
          border-radius: 6px; padding: 16px 18px; text-align: left;
          position: relative;
        }
        .landing-feature-card::before {
          content: ""; position: absolute; top: 0; left: 0; width: 100%; height: 2px;
          background: var(--blue-dim);
        }
        .landing-feature-num {
          font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--blue);
          margin-bottom: 6px; display: block;
        }
        .landing-feature-card h3 {
          font-family: 'Zen Kaku Gothic New', sans-serif; font-size: 14.5px; font-weight: 700;
          margin: 0 0 6px; color: var(--text);
        }
        .landing-feature-card p {
          font-size: 12.5px; line-height: 1.6; color: var(--muted); margin: 0;
        }

        .landing-audience {
          max-width: 640px; margin: 34px auto 0;
          border: 1px solid var(--line); border-left: 2px solid var(--amber);
          background: var(--panel); border-radius: 4px; padding: 18px 20px;
        }
        .landing-audience h4 {
          font-family: 'Zen Kaku Gothic New', sans-serif; font-size: 13.5px; font-weight: 700;
          margin: 0 0 10px; color: var(--amber);
        }
        .landing-audience ul { margin: 0; padding-left: 18px; }
        .landing-audience li { font-size: 13px; line-height: 1.9; color: var(--text); }

        /* 家計簿への入口カード。コラムのカード（.landing-blog-section）と
           枠線・余白・角丸・背景・文字サイズをすべて同じにして、
           別サイトではなく同じサービス内の関連機能として見えるようにする。 */
        .landing-kakeibo {
          max-width: 640px; margin: 34px auto 0; padding: 30px 24px;
          text-align: center; border: 1px solid var(--line); border-radius: 8px;
          background: var(--panel);
        }
        .landing-kakeibo h3 {
          font-family: 'Zen Kaku Gothic New', sans-serif; font-size: 18px; font-weight: 700;
          margin: 0 0 12px; color: var(--text);
        }
        .landing-kakeibo p {
          font-size: 13px; line-height: 1.8; color: var(--muted);
          margin: 0 0 20px;
        }
        /* 見た目は既存のボタン（.landing-cta）と完全に同じ。<a> なので下線を消し、
           文字を上下中央に置く。高さはiOSの推奨タップ領域（44px）より大きい52pxにして、
           スマートフォンで指を置くだけで押せるようにする。 */
        .landing-cta-link {
          display: inline-flex; align-items: center; justify-content: center;
          min-height: 52px; text-decoration: none;
          -webkit-tap-highlight-color: transparent;
        }
        .landing-cta-link:active { background: #6BB8E0; }

        .landing-blog-section {
          max-width: 640px; margin: 34px auto 0; padding: 30px 24px;
          text-align: center; border: 1px solid var(--line); border-radius: 8px;
          background: var(--panel);
        }
        .landing-blog-section h3 {
          font-family: 'Zen Kaku Gothic New', sans-serif; font-size: 18px; font-weight: 700;
          margin: 0 0 12px; color: var(--text);
        }
        .landing-blog-section p {
          font-size: 13px; line-height: 1.8; color: var(--muted);
          margin: 0 0 20px;
        }

        .landing-disclaimer {
          max-width: 640px; margin: 22px auto 0;
          font-size: 11px; line-height: 1.7; color: var(--muted); text-align: center;
        }
        /* 紹介ページ＋見出しの本文（説明・サブ・免責）を、見出しと同じはっきりした白に統一。
           数値のアクセント色（.meta の青い span 等）は、より詳細度が高いので影響しない。 */
        .landing-sub,
        .landing-screenshot p,
        .landing-blog-section p,
        .landing-kakeibo p,
        .landing-disclaimer,
        .titleblock .sub,
        .titleblock .meta { color: var(--text); }
        /* 「このアプリについて」の免責事項の下に出す開発者クレジット。 */
        .app-credit {
          margin: 10px 0 0;
          padding: 14px 4px 0;
          border-top: 1px solid var(--line);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          line-height: 1.9;
          color: var(--muted);
          text-align: center;
        }
      `}</style>

      <div className="landing" id="section-overview" style={{ border: "1px solid #2A363C", background: "#151C20", borderRadius: 8, marginBottom: 16 }}>
        <div className="landing-hero">
          <h1>{t("landingTitle")}</h1>
          <p className="landing-free-notice">
            <strong>{t("landingFreeBadge")}</strong><br />
            {t("landingFreeNotice")}
          </p>
          <p className="landing-catch">
            {t("landingCatch")}
          </p>
          <p className="landing-sub">
            {t("landingSub1")}<br />
            {t("landingSub2")}
          </p>
          <button className="landing-cta" onClick={scrollToSimulator}>
            {t("landingCta")}
          </button>
        </div>

        <div className="landing-screenshot">
          <h2>{t("landingScreenshotTitle")}</h2>
          <p>{t("landingScreenshotDesc")}</p>
          <img src="/ogp.png" alt={t("landingScreenshotAlt")} loading="lazy" />
        </div>

        <div className="landing-features">
          <div className="landing-feature-card">
            <span className="landing-feature-num">01</span>
            <h3>{t("landingFeature1Title")}</h3>
            <p>{t("landingFeature1Desc")}</p>
          </div>
          <div className="landing-feature-card">
            <span className="landing-feature-num">02</span>
            <h3>{t("landingFeature2Title")}</h3>
            <p>{t("landingFeature2Desc")}</p>
          </div>
          <div className="landing-feature-card">
            <span className="landing-feature-num">03</span>
            <h3>{t("landingFeature3Title")}</h3>
            <p>{t("landingFeature3Desc")}</p>
          </div>
          <div className="landing-feature-card">
            <span className="landing-feature-num">04</span>
            <h3>{t("landingFeature4Title")}</h3>
            <p>{t("landingFeature4Desc")}</p>
          </div>
        </div>

        <div className="landing-audience">
          <h4>{t("landingAudienceTitle")}</h4>
          <ul>
            <li>{t("landingAudience1")}</li>
            <li>{t("landingAudience2")}</li>
            <li>{t("landingAudience3")}</li>
            <li>{t("landingAudience4")}</li>
            <li>{t("landingAudience5")}</li>
          </ul>
        </div>

        {/* 家計簿アプリへの入口（同じシリーズの関連機能として表示する）。
            日本語表示のときだけ出す。家計簿アプリ側の画面が日本語のみのため、
            英語版・各国版では見せない。全言語で出したい場合はこの条件を外す。 */}
        {language === "ja" && (
          <div className="landing-kakeibo">
            <h3>{t("landingKakeiboTitle")}</h3>
            <p>{t("landingKakeiboDesc")}</p>
            <a
              className="landing-cta landing-cta-link"
              href={KAKEIBO_APP_URL}
              target={isStandalonePWA() ? "_blank" : "_self"}
              rel="noopener noreferrer"
            >
              {t("landingKakeiboCta")}
            </a>
          </div>
        )}

        {onOpenBlog && (
          <div className="landing-blog-section" id="section-column">
            <h3>{t("landingBlogTitle")}</h3>
            <p>
              {t("landingBlogDesc1")}<br />
              {t("landingBlogDesc2")}
            </p>
            <button
              className="landing-cta"
              onClick={() => {
                // 日本語表示のときだけコラムへ遷移。それ以外は「準備中」を表示して遷移しない。
                if (language === "ja") onOpenBlog();
                else setBlogComingSoon(true);
              }}
            >
              {t("landingBlogCta")}
            </button>
            {blogComingSoon && language !== "ja" && (
              <p style={{ marginTop: 12, fontSize: 13, color: "#D9A54F" }}>
                {t("landingBlogComingSoon")}
              </p>
            )}
          </div>
        )}

        <p className="landing-disclaimer">
          {t("landingDisclaimer")}
        </p>
      </div>

      {/* トップの見出しブロックにも、他のセクションと同じ枠（囲い線）を付ける。
          中の各要素は元々パディングを持つので、枠側の padding は 0 にして二重にしない。 */}
      <div className="section-block" style={{ borderColor: "#4FA8D8", padding: 0, overflow: "hidden", marginBottom: 12 }}>
      <div className="titleblock" id="simulator">
        <div>
          <h1>
            {t("appTitle")}
            {/* お名前はタイトルより小さく、控えめに表示する */}
            {inputs.userName && (
              <span className="title-username">
                {t("appTitleWithName", { name: inputs.userName })}
              </span>
            )}
          </h1>
          <div className="sub">
            {t("appSubtitle")}
            <br />
            {t("todayLabel")}：{new Date().toLocaleDateString(dateLocale, { year: "numeric", month: "long", day: "numeric" })}
          </div>
        </div>
        <div className="meta" style={{ alignItems: "center" }}>
          <div className="no-print">
            <select
              className="country-select"
              value={country}
              onChange={(e) => {
                const nextCountry = e.target.value;
                const meta = SUPPORTED_COUNTRIES.find((c) => c.code === nextCountry);
                if (!meta || !meta.enabled) return; // Coming Soon の国は選択不可
                update({
                  country: nextCountry,
                  baseCurrency: DEFAULT_CURRENCY_BY_COUNTRY[nextCountry] || "JPY",
                  language: DEFAULT_LANGUAGE_BY_COUNTRY[nextCountry] || "ja",
                });
                // 個別株の初期候補も国別に切り替える。ただし、現在のリストが
                // どちらかの国の「未編集の初期候補」と完全一致する場合のみ入れ替え、
                // ユーザーが実際に入力した保有銘柄は絶対に上書きしない。
                const currentJson = JSON.stringify(watchlist);
                const isUntouchedDefault =
                  currentJson === JSON.stringify(DEFAULT_WATCHLIST_JP) ||
                  currentJson === JSON.stringify(DEFAULT_WATCHLIST_US) ||
                  currentJson === JSON.stringify(DEFAULT_WATCHLIST_GB) ||
                  currentJson === JSON.stringify(DEFAULT_WATCHLIST_CA) ||
                  currentJson === JSON.stringify(DEFAULT_WATCHLIST_AU);
                if (isUntouchedDefault) {
                  setWatchlist(defaultWatchlistFor(nextCountry));
                }
                // iDeCo「運用商品名」の初期値も、未編集（既定値のまま）の場合のみ国別に切り替える。
                const untouchedProductNames = [
                  translateWith("ja", "idecoProductDefault"),
                  translateWith("en", "idecoProductDefault"),
                ];
                if (untouchedProductNames.includes(inputs.ideco.productName)) {
                  updateIdeco("productName", translateWith(DEFAULT_LANGUAGE_BY_COUNTRY[nextCountry] || "ja", "idecoProductDefault"));
                }
              }}
              title={t("countrySelectTitle")}
            >
              {SUPPORTED_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code} disabled={!c.enabled}>
                  {c.flag} {c.name}{!c.enabled ? " (Coming Soon)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            {t("currentAgeLabel")}{" "}
            <span>
              {preciseAge
                ? t("ageYMD", { years: preciseAge.years, months: preciseAge.months, days: preciseAge.days })
                : t("ageYears", { age: effectiveCurrentAge })}
            </span>
          </div>
          <div>{t("retireAgeLabel")} <span>{t("ageYears", { age: inputs.retireAge })}</span></div>
          <div>{t("lifeExpectancyLabel")} <span>{t("ageYears", { age: inputs.deathAge })}</span></div>
          <div
            className={`save-badge save-${saveStatus}`}
            title={saveMessage}
          >
            {saveStatus === "saved" && `● ${t("saveSaved")}`}
            {saveStatus === "saving" && `○ ${t("saveSaving")}`}
            {saveStatus === "error" && `⚠ ${t("saveError")}`}
            {saveStatus === "unavailable" && `⚠ ${t("saveUnavailable")}`}
            {saveStatus === "idle" && "…"}
          </div>
          <button className="history-toggle" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? t("historyToggleClose") : t("historyToggleOpen", { count: history.length })}
          </button>
          <button className="history-toggle" onClick={() => setShowBackup((v) => !v)}>
            {showBackup ? t("backupToggleClose") : t("backupToggleOpen")}
          </button>
          <button className="history-toggle no-print" onClick={() => window.print()}>
            {t("printButton")}
          </button>
          <button className="history-toggle no-print" onClick={() => setShowTodayTotal((v) => !v)}>
            {showTodayTotal
              ? t("todayTotalShown", { amount: money(netWorthYearly[0]?.netWorth ?? netWorthFinal) })
              : t("todayTotalHidden")}
          </button>
        </div>
      </div>
      {/* 使い方ガイド：初回だけ自動で開く。閉じると次回以降は「?」を押したときだけ開く。 */}
      <div className="disclaimer-banner no-print" style={{ display: "block" }}>
        <div className="field-label-row">
          <span className="field-label">{t("gettingStartedTitle")}</span>
          <GuideButton
            open={showGettingStarted === true}
            onToggle={() => (showGettingStarted === true ? closeGettingStarted() : setShowGettingStarted(true))}
          />
        </div>
        {showGettingStarted === true && (
          <div className="guide-text">
            <p style={{ margin: "6px 0" }}>{t("gettingStartedIntro")}</p>
            <p style={{ margin: "10px 0 4px", fontWeight: 600 }}>{t("gettingStartedFlowTitle")}</p>
            <ol style={{ margin: "0 0 8px", paddingLeft: 20 }}>
              <li>{t("gettingStartedStep1")}</li>
              <li>{t("gettingStartedStep2")}</li>
              <li>{t("gettingStartedStep3")}</li>
              <li>{t("gettingStartedStep4")}</li>
              <li>{t("gettingStartedStep5")}</li>
              <li>{t("gettingStartedStep6")}</li>
              <li>{t("gettingStartedStep7")}</li>
            </ol>
            <p style={{ margin: "8px 0 6px" }}>💡 {t("gettingStartedTip")}</p>
            <button type="button" className="history-toggle" onClick={closeGettingStarted}>
              {t("gettingStartedClose")}
            </button>
          </div>
        )}
      </div>
      {/* 免責表示：国・言語を問わず常時表示する（印刷・PDFにも残す） */}
      <div className="disclaimer-banner">
        <Info size={13} />
        <span>{t("disclaimerBanner")}</span>
      </div>
      {/* 免責事項の下に開発者クレジットを表示する。 */}
      <div className="app-credit">
        <div>{"© 2026 Kunihiko Hioki"}</div>
        <div>{"Developed by Kunihiko Hioki"}</div>
        <div>{"Version 1.0.2"}</div>
        <div>
          <a className="footer-mail" href="mailto:pdr.gifu@gmail.com">{"✉️ pdr.gifu@gmail.com"}</a>
        </div>
      </div>
      {/* ← トップ見出しブロックの枠 ここまで */}
      </div>
      {/* 国別の注意書き。実装済みの4か国（US/GB/CA/AU）は、その国の制度で計算していることと
          実装していない範囲を明記する。以前はここに「計算は日本の制度基準」という
          プレビュー版の警告を出していたが、各国の制度を実装した現在は事実と異なるため廃止した。 */}
      {country !== "JP" && (
        <div className="locale-preview-warning no-print">
          <Info size={13} />
          <span>{t(`${country.toLowerCase()}CountryNote`)}</span>
        </div>
      )}
      {(saveStatus === "unavailable" || saveStatus === "error") && (
        <div className="save-warning">
          <Info size={13} />
          <span>{saveMessage}　{t("saveWarningHint")}</span>
        </div>
      )}
      {showBackup && (
        <div className="history-panel">
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {t("backupInstructions")}
          </div>
          <div className="field-label" style={{ marginBottom: 4 }}>{t("backupExportLabel")}</div>
          <textarea
            readOnly value={backupText}
            onClick={(e) => e.target.select()}
            style={{
              width: "100%", height: 120, background: "var(--panel-2)", color: "var(--text)",
              border: "1px solid var(--line)", borderRadius: 3, fontSize: 10.5,
              fontFamily: "'JetBrains Mono', monospace", padding: 8, marginBottom: 14,
            }}
          />
          <div className="field-label" style={{ marginBottom: 4 }}>{t("backupImportLabel")}</div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={t("backupImportPlaceholder")}
            style={{
              width: "100%", height: 100, background: "var(--panel-2)", color: "var(--text)",
              border: "1px solid var(--line)", borderRadius: 3, fontSize: 10.5,
              fontFamily: "'JetBrains Mono', monospace", padding: 8, marginBottom: 8,
            }}
          />
          <button className="history-action" onClick={importBackup}>{t("backupImportButton")}</button>
          {importOk && <span style={{ fontSize: 11, color: "var(--green)", marginLeft: 8 }}>{t("backupImportSuccess")}</span>}
          {importError && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 6 }}>{importError}</div>}
        </div>
      )}

      {showHistory && (
        <div className="history-panel">
          <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="history-action" onClick={() => save(inputs, watchlist)}>{t("historyRecordNow")}</button>
            <button className="history-action" onClick={refreshHistory}>{t("historyReload")}</button>
            {historyDebug && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{historyDebug}</span>}
          </div>
          {history.length === 0 ? (
            <div className="history-empty">{t("historyEmpty")}</div>
          ) : (
            <table className="watchlist">
              <thead>
                <tr>
                  <th>{t("historyColDate")}</th>
                  <th>{t("historyColNisaPrincipal")}</th>
                  <th>{t("historyColGoldGrams")}</th>
                  <th>{t("historyColBankTotal")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.date}>
                    <td className="mono">{formatDateLabel(h.date)}</td>
                    <td className="mono">{money(h.currentAssets)}</td>
                    <td className="mono">{(h.goldGrams || 0).toFixed(1)}g</td>
                    <td className="mono">{money(h.bankTotal)}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button className="history-action" onClick={() => restoreSnapshot(h)}>{t("historyRestore")}</button>
                      <button className="del-btn" onClick={() => deleteSnapshot(h.date)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ===== トップ統合ダッシュボード（フェーズ4＋UX改善 A〜F）=====
          単一の integrated と inputs から読み出す表示専用ブロック。エンジンは無変更。
          A: 総資産0のときは空状態の案内を出す（¥0の羅列を避ける）
          B: 各カードに一言ヘルプ（?）を付ける
          C: 「資産寿命（枯渇年齢）」「生涯の最終純資産」を結論として表示
          D: モバイルでも見やすい自動2列グリッド
          E: 「使える資産」の内訳（銀行・投資・金・株）を sub に表示（accessible* から）
          F: 余剰金セクションへのジャンプ導線 */}
      <div className="section-block wallet-dashboard" id="section-wallet" style={{ borderColor: "#5FB0A0", marginBottom: 12 }}>
        <div className="stat-sub" style={{ marginBottom: 8 }}>{t("walletDashboardTitle")}</div>
        {(integrated.yearly[0]?.totalAssets ?? 0) <= 0 ? (
          <div className="stat-sub" style={{ opacity: 0.8 }}>{t("dashEmptyHint")}</div>
        ) : (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
              <StatCard label={t("dashTotalAssetsLabel")} value={money(integrated.yearly[0]?.totalAssets ?? 0)} hint={t("dashTotalAssetsHint")} />
              <StatCard
                label={t("dashAccessibleLabel")}
                value={money(accessibleNow)}
                tone="good"
                hint={t("dashAccessibleHint")}
                sub={(() => {
                  const r = integrated.yearly[0] || {};
                  const parts = [
                    [t("dashGroupBank"), r.accessibleBank],
                    [t("dashGroupInvestment"), r.accessibleInvestment],
                    [t("dashGroupGold"), r.accessibleGold],
                    [t("dashGroupStock"), r.accessibleStock],
                  ].filter(([, v]) => Number(v) > 0).map(([lab, v]) => `${lab} ${money(v)}`);
                  return parts.length ? parts.join(" ・ ") : undefined;
                })()}
              />
              <StatCard label={t("dashSurplusLabel")} value={money(surplusAtCurrent)} hint={t("dashSurplusHint")} />
              {[65, 75, 95].map((age) => (
                <StatCard
                  key={age}
                  label={t("dashAssetsAtAgeLabel", { age })}
                  value={money(integratedRowAt(age)?.netWorth ?? 0)}
                  hint={t("dashAssetsAtAgeHint")}
                />
              ))}
              <StatCard
                label={t("dashLifespanLabel")}
                value={integrated.depletionAge ? t("statDepletionAtAge", { age: Math.round(integrated.depletionAge) }) : t("statNeverDepletes")}
                tone={integrated.depletionAge ? "danger" : "good"}
                hint={t("dashLifespanHint")}
              />
              <StatCard label={t("dashFinalNetWorthLabel")} value={money(integrated.finalNetWorth ?? 0)} hint={t("dashFinalNetWorthHint")} />
            </div>
            <button
              type="button"
              className="history-toggle no-print"
              style={{ marginTop: 10 }}
              onClick={() => document.getElementById("section-surplus-balance")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              {t("dashOpenSurplus")}
            </button>
            <div className="note" style={{ marginTop: 8 }}>
              <Info size={13} />
              <span>{t("walletDashboardNote")}</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid-main">
        {/* -------- LEFT: INPUT PANEL -------- */}
        <div className="panel">
          {/* 各入力セクションへのショートカット */}
          <SectionNav items={sectionNavItems} />
          <div className="section-block" style={{ borderColor: "#4FA8D8" }}>
          <SectionTitle index="00" title={label("personalInfo")} icon={Users} />
          <label className="field">
            <span className="field-label">{t("nameLabel")}</span>
            <div className="field-input-wrap">
              <input
                type="text"
                value={inputs.userName}
                onChange={(e) => update({ userName: e.target.value })}
                style={{ width: "100%" }}
              />
            </div>
          </label>
          <label className="field">
            <span className="field-label">{t("birthDateLabel")}</span>
            <div className="field-input-wrap">
              <input
                type="date" className="mono"
                value={inputs.birthDate}
                onChange={(e) => update({ birthDate: e.target.value })}
                style={{ width: "100%" }}
              />
            </div>
          </label>
          {preciseAge && (
            <div className="note">
              <Info size={13} />
              <span>
                {t("birthDateNotePrefix")}<strong>{t("ageYMD", { years: preciseAge.years, months: preciseAge.months, days: preciseAge.days })}</strong>
                {t("birthDateNoteSuffix")}
              </span>
            </div>
          )}

          </div>
          <div className="section-block" style={{ borderColor: "#D9A54F" }}>
          <SectionTitle index="01" title={label("basicInfo")} icon={Ruler} />
          <AgeField guide={t("currentAgeGuide")} label={t("currentAgeFieldLabel")} value={effectiveCurrentAge} disabled={!!preciseAge} onChange={(v) => update({ currentAge: v })} />
          {preciseAge && (
            <div className="note" style={{ marginTop: -8 }}>
              <Info size={13} />
              <span>{t("currentAgeAutoNote")}</span>
            </div>
          )}
          <AgeField guide={t("retireAgeGuide")} label={t("retireAgeFieldLabel")} value={inputs.retireAge} onChange={(v) => update({ retireAge: v })} />
          <AgeField guide={t("deathAgeGuide")} label={t("lifeExpectancyLabel")} value={inputs.deathAge} onChange={(v) => update({ deathAge: v })} />
          {/* 【入力チェック】矛盾した年齢でもエンジンは例外を出さずに走るが、結果（例：想定寿命が
              現在年齢以下だと将来の行が1つも作られない）は利用者には理解できない。
              計算は止めず、直し方が分かる警告を入力欄の直下に出す。 */}
          {ageWarnings.map((w) => (
            <div
              key={w}
              className="note"
              style={{ marginTop: 8, borderColor: "#C2694F", color: "#C2694F" }}
              role="alert"
            >
              <Info size={13} />
              {/* 警告の種類名（例 deathAgeTooLow）は翻訳キー（validationDeathAgeTooLow）と
                  1対1で対応させてあるので、種類が増えてもここは変更しなくてよい。 */}
              <span>{t(`validation${w.charAt(0).toUpperCase()}${w.slice(1)}`)}</span>
            </div>
          ))}

          </div>
          <div className="section-block" style={{ borderColor: "#8FBF7F" }}>
          <SectionTitle index="02" title={label("investmentTaxAdvantaged")} icon={TrendingUp} />
          <SectionGuide guide={t("nisaSectionGuide")} />

          {country === "JP" ? (
          <>
          {/* ① いま溜まっている金額（保有銘柄＋NISA合計） */}
          <div className="nisa-group nisa-group-holdings">
            <div className="nisa-group-title">{t("nisaGroupHoldings")}</div>
          <GuideLabel guide={t("tsumitateHoldingsGuide")}>{t("tsumitateHoldingsLabel")}</GuideLabel>
          {inputs.tsumitateHoldings.length > 0 && (
            <table className="watchlist" style={{ marginBottom: 8 }}>
              <thead><tr><th>{t("colName")}</th><th>{t("colAmount")}</th><th></th></tr></thead>
              <tbody>
                {inputs.tsumitateHoldings.map((h, i) => (
                  <tr key={i}>
                    <td>{h.name}</td>
                    <td className="mono">{money(h.value)}</td>
                    <td style={{ width: 24 }}>
                      <button className="del-btn" onClick={() => removeTsumitateHolding(i)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="add-row" style={{ marginBottom: 8 }}>
            <input placeholder={t("holdingNamePlaceholder")} value={newTsumitateHolding.name} onChange={(e) => setNewTsumitateHolding((p) => ({ ...p, name: e.target.value }))} />
            <MoneyInput placeholder={t("amountPlaceholderMan")} value={newTsumitateHolding.value} onChange={(v) => setNewTsumitateHolding((p) => ({ ...p, value: v }))} />
            <button className="add-btn" onClick={addTsumitateHolding}><Plus size={15} /></button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
            <span style={{ fontSize: 10, color: "#E07A5F", whiteSpace: "nowrap", fontWeight: 700 }}>{t("asOfAgeRequired")}</span>
            <AgeYMInput
              placeholder={t("asOfAgePlaceholder")} years={inputs.tsumitateHoldingsAsOfYears} months={inputs.tsumitateHoldingsAsOfMonths}
              onYears={(v) => update({ tsumitateHoldingsAsOfYears: v })}
              onMonths={(v) => update({ tsumitateHoldingsAsOfMonths: v })}
            />
          </div>
          <div className="note" style={{ marginBottom: 12 }}>
            <Info size={13} />
            <span>{t("tsumitateAsOfNote", { manual: money(tsumitateHoldingsManualTotal), catchup: money(tsumitateCatchUp) })}</span>
          </div>

          <GuideLabel guide={t("growthHoldingsGuide")}>{t("growthHoldingsLabel")}</GuideLabel>
          {inputs.growthHoldings.length > 0 && (
            <table className="watchlist" style={{ marginBottom: 8 }}>
              <thead><tr><th>{t("colName")}</th><th>{t("colAmount")}</th><th></th></tr></thead>
              <tbody>
                {inputs.growthHoldings.map((h, i) => (
                  <tr key={i}>
                    <td>{h.name}</td>
                    <td className="mono">{money(h.value)}</td>
                    <td style={{ width: 24 }}>
                      <button className="del-btn" onClick={() => removeGrowthHolding(i)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="add-row" style={{ marginBottom: 8 }}>
            <input placeholder={t("holdingNamePlaceholder")} value={newGrowthHolding.name} onChange={(e) => setNewGrowthHolding((p) => ({ ...p, name: e.target.value }))} />
            <MoneyInput placeholder={t("amountPlaceholderMan")} value={newGrowthHolding.value} onChange={(v) => setNewGrowthHolding((p) => ({ ...p, value: v }))} />
            <button className="add-btn" onClick={addGrowthHolding}><Plus size={15} /></button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
            <span style={{ fontSize: 10, color: "#E07A5F", whiteSpace: "nowrap", fontWeight: 700 }}>{t("asOfAgeRequired")}</span>
            <AgeYMInput
              placeholder={t("asOfAgePlaceholder")} years={inputs.growthHoldingsAsOfYears} months={inputs.growthHoldingsAsOfMonths}
              onYears={(v) => update({ growthHoldingsAsOfYears: v })}
              onMonths={(v) => update({ growthHoldingsAsOfMonths: v })}
            />
          </div>
          <div className="note" style={{ marginBottom: 12 }}>
            <Info size={13} />
            <span>{t("growthAsOfNote", { manual: money(growthHoldingsManualTotal), catchup: money(growthCatchUp) })}</span>
          </div>

          {autoHoldingRows.length > 0 && (
            <>
              <div className="field-label" style={{ marginBottom: 6 }}>
                {t("autoValuationLabel")}
              </div>
              <table className="watchlist" style={{ marginBottom: 8 }}>
                <thead><tr><th>{t("colName")}</th><th>{t("autoValuationCol")}</th></tr></thead>
                <tbody>
                  {autoHoldingRows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td className="mono">{money(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <label className="field">
            <span className="field-label-row">
              <span className="field-label">{t("nisaTotalLabel")}</span>
              <NisaTotalGuide />
            </span>
            <div className="field-input-wrap">
              <div className="mono" style={{ flex: 1, padding: "8px 10px", fontSize: 13 }}>
                {Math.round(effectiveCurrentAssets).toLocaleString()}
              </div>
              <span className="field-unit">{uCurrency}</span>
            </div>
          </label>
          <div className="note" style={{ marginTop: -8 }}>
            <Info size={13} />
            <span>
              {t("nisaTotalExplanation", {
                tsumitate: money(tsumitateHoldingsTotal),
                growth: money(growthHoldingsTotal),
                lump: money(autoHoldingsTotal),
                total: money(effectiveCurrentAssets),
                tsumitateCatchup: money(tsumitateCatchUp),
                growthCatchup: money(growthCatchUp),
              })}
            </span>
          </div>

          </div>

          {/* ② つみたて投資枠（毎月の投資＋銘柄配分） */}
          <div className="nisa-group nisa-group-tsumitate">
            <div className="nisa-group-title">{t("nisaGroupTsumitate")}</div>
          <GuideLabel guide={t("tsumitateScheduleGuide")}>{t("tsumitateScheduleLabel")}</GuideLabel>
          {inputs.tsumitateSchedule.length > 0 && (
            <table className="watchlist" style={{ marginBottom: 8 }}>
              <thead><tr><th>{t("colAge")}</th><th>{t("colMonthlyVsCap")}</th><th></th></tr></thead>
              <tbody>
                {inputs.tsumitateSchedule.map((r, i) => (
                  <tr key={i}>
                    <td>{formatAge(r.fromAge)}〜{formatAge(r.toAge)}</td>
                    <td className="mono">
                      <div>{money(r.monthlyYen)}{t("perMonthSuffix")}</div>
                      <div style={{ fontSize: 10, color: r.monthlyYen > tsumitateMonthlyCapValue ? "#C2694F" : "#7C8A90" }}>
                        {formatCapDiff(tsumitateMonthlyCapValue - r.monthlyYen, t("periodMonth"))}
                      </div>
                      <div style={{ fontSize: 10, color: "#7C8A90" }}>
                        {t("lifetimeRemainingAtEnd", { amount: money(lifetimeRemainingAtAge(r.toAge)) })}
                      </div>
                    </td>
                    <td style={{ width: 24 }}>
                      <button className="del-btn" onClick={() => removeTsumitateRange(i)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="add-row">
            <AgeYMInput
              placeholder={t("startPlaceholder")} years={newTsumitateRange.fromYears} months={newTsumitateRange.fromMonths}
              onYears={(v) => setNewTsumitateRange((p) => ({ ...p, fromYears: v }))}
              onMonths={(v) => setNewTsumitateRange((p) => ({ ...p, fromMonths: v }))}
            />
            <AgeYMInput
              placeholder={t("endPlaceholder")} years={newTsumitateRange.toYears} months={newTsumitateRange.toMonths}
              onYears={(v) => setNewTsumitateRange((p) => ({ ...p, toYears: v }))}
              onMonths={(v) => setNewTsumitateRange((p) => ({ ...p, toMonths: v }))}
            />
          </div>
          <div className="add-row" style={{ marginBottom: 14 }}>
            <MoneyInput placeholder={t("monthlyAmountPlaceholderMan")} value={newTsumitateRange.monthlyYen} onChange={(v) => setNewTsumitateRange((p) => ({ ...p, monthlyYen: v }))} />
            <button className="add-btn" onClick={addTsumitateRange}><Plus size={15} /></button>
          </div>
          <div className="note">
            <Info size={13} />
            <span>{t("scheduleExampleNote")}</span>
          </div>

          <GuideLabel guide={t("tsumitateAllocationGuide")}>{t("tsumitateAllocationLabel")}</GuideLabel>
          <AllocationBreakdown
            items={inputs.tsumitateAllocation}
            newItem={newTsumitateAllocItem}
            onNewItemChange={setNewTsumitateAllocItem}
            onAdd={() => addAllocationItem("tsumitateAllocation", newTsumitateAllocItem, setNewTsumitateAllocItem)}
            onRemove={(i) => removeAllocationItem("tsumitateAllocation", i)}
            onUpdate={(i, key, val) => updateAllocationItem("tsumitateAllocation", i, key, val)}
          />
          <div style={{ marginBottom: 18 }} />

          </div>

          {/* ③ 成長投資枠（毎月の投資＋銘柄配分） */}
          <div className="nisa-group nisa-group-growth">
            <div className="nisa-group-title">{t("nisaGroupGrowth")}</div>
          <GuideLabel guide={t("growthScheduleGuide")}>{t("growthScheduleLabel")}</GuideLabel>
          {inputs.growthSchedule.length > 0 && (
            <table className="watchlist" style={{ marginBottom: 8 }}>
              <thead><tr><th>{t("colAge")}</th><th>{t("colMonthlyVsCap")}</th><th></th></tr></thead>
              <tbody>
                {inputs.growthSchedule.map((r, i) => (
                  <tr key={i}>
                    <td>{formatAge(r.fromAge)}〜{formatAge(r.toAge)}</td>
                    <td className="mono">
                      <div>{money(r.monthlyYen)}{t("perMonthSuffix")}</div>
                      <div style={{ fontSize: 10, color: r.monthlyYen > growthMonthlyCapValue ? "#C2694F" : "#7C8A90" }}>
                        {formatCapDiff(growthMonthlyCapValue - r.monthlyYen, t("periodMonth"))}
                      </div>
                      <div style={{ fontSize: 10, color: "#7C8A90" }}>
                        {t("lifetimeRemainingAtEnd", { amount: money(lifetimeRemainingAtAge(r.toAge)) })}
                      </div>
                    </td>
                    <td style={{ width: 24 }}>
                      <button className="del-btn" onClick={() => removeGrowthRange(i)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="add-row">
            <AgeYMInput
              placeholder={t("startPlaceholder")} years={newGrowthRange.fromYears} months={newGrowthRange.fromMonths}
              onYears={(v) => setNewGrowthRange((p) => ({ ...p, fromYears: v }))}
              onMonths={(v) => setNewGrowthRange((p) => ({ ...p, fromMonths: v }))}
            />
            <AgeYMInput
              placeholder={t("endPlaceholder")} years={newGrowthRange.toYears} months={newGrowthRange.toMonths}
              onYears={(v) => setNewGrowthRange((p) => ({ ...p, toYears: v }))}
              onMonths={(v) => setNewGrowthRange((p) => ({ ...p, toMonths: v }))}
            />
          </div>
          <div className="add-row" style={{ marginBottom: 14 }}>
            <MoneyInput placeholder={t("monthlyAmountPlaceholderMan")} value={newGrowthRange.monthlyYen} onChange={(v) => setNewGrowthRange((p) => ({ ...p, monthlyYen: v }))} />
            <button className="add-btn" onClick={addGrowthRange}><Plus size={15} /></button>
          </div>
          <div className="note">
            <Info size={13} />
            <span>{t("growthScheduleExampleNote")}</span>
          </div>

          <GuideLabel guide={t("growthAllocationGuide")}>{t("growthAllocationLabel")}</GuideLabel>
          <AllocationBreakdown
            items={inputs.growthAllocation}
            newItem={newGrowthAllocItem}
            onNewItemChange={setNewGrowthAllocItem}
            onAdd={() => addAllocationItem("growthAllocation", newGrowthAllocItem, setNewGrowthAllocItem)}
            onRemove={(i) => removeAllocationItem("growthAllocation", i)}
            onUpdate={(i, key, val) => updateAllocationItem("growthAllocation", i, key, val)}
          />
          <div style={{ marginBottom: 18 }} />

          {rules.investment.implemented && (
            <div className="note">
              <Info size={13} />
              <span>
                {t("nisaCapSummaryNote")}
              </span>
            </div>
          )}

          </div>

          {/* ④ 一括投資枠（成長投資枠を使う一括投資＋銘柄配分） */}
          <div className="nisa-group nisa-group-lump">
            <div className="nisa-group-title">{t("nisaGroupLump")}</div>
          <GuideLabel guide={t("lumpSumGuide")}>{t("lumpSumLabel")}</GuideLabel>
          {inputs.lumpSums.length > 0 && (
            <table className="watchlist" style={{ marginBottom: 8 }}>
              <thead><tr><th>{t("colAge")}</th><th>{t("colAmountVsCap")}</th><th></th></tr></thead>
              <tbody>
                {inputs.lumpSums.map((entry, i) => {
                  const annualHeadroom = NISA_LIMITS.growthAnnual - (scheduledAmount(inputs.growthSchedule, entry.age) * 12 + entry.amount);
                  return (
                    <tr key={i}>
                      <td>{formatAge(entry.age)}</td>
                      <td className="mono">
                        <div>{money(entry.amount)}</div>
                        <div style={{ fontSize: 10, color: annualHeadroom < 0 ? "#C2694F" : "#7C8A90" }}>
                          {formatCapDiff(annualHeadroom, t("periodYear"))}
                        </div>
                        <div style={{ fontSize: 10, color: "#7C8A90" }}>
                          {t("lifetimeRemainingAfterInvestment", { amount: money(lifetimeRemainingAtAge(entry.age)) })}
                        </div>
                      </td>
                      <td style={{ width: 24 }}>
                        <button className="del-btn" onClick={() => removeLump(i)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="add-row" style={{ marginBottom: 14 }}>
            <AgeYMInput
              placeholder={t("investmentTimePlaceholder")} years={newLump.years} months={newLump.months}
              onYears={(v) => setNewLump((p) => ({ ...p, years: v }))}
              onMonths={(v) => setNewLump((p) => ({ ...p, months: v }))}
            />
            <MoneyInput placeholder={t("amountPlaceholderMan")} value={newLump.amount} onChange={(v) => setNewLump((p) => ({ ...p, amount: v }))} />
            <button className="add-btn" onClick={addLump}><Plus size={15} /></button>
          </div>

          <GuideLabel guide={t("lumpAllocationGuide")}>{t("lumpAllocationLabel")}</GuideLabel>
          <AllocationBreakdown
            items={inputs.lumpAllocation}
            newItem={newLumpAllocItem}
            onNewItemChange={setNewLumpAllocItem}
            onAdd={() => addAllocationItem("lumpAllocation", newLumpAllocItem, setNewLumpAllocItem)}
            onRemove={(i) => removeAllocationItem("lumpAllocation", i)}
            onUpdate={(i, key, val) => updateAllocationItem("lumpAllocation", i, key, val)}
          />
          </div>

          <GuideLabel guide={t("expectedReturnGuide")} style={{ marginTop: 16 }}>
            {t("nisaAllocationSlidersLabel")}
          </GuideLabel>
          {dynamicFunds.length > 0 ? (
            <>
              {dynamicFunds.map((f, i) => (
                <div key={f.id}>
                  <div className="alloc-row">
                    <span className="alloc-dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <div>
                      <div style={{ fontSize: 11, marginBottom: 2 }}>{f.id}</div>
                      <input type="range" min={0} max={100} value={f.pct} disabled />
                    </div>
                    <span className="alloc-val">{f.pct.toFixed(1)}%</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: -4, marginBottom: 10, paddingLeft: 24 }}>
                    <span style={{ fontSize: 10, color: "#7C8A90" }}>{t("expectedReturnLabel")}</span>
                    <input
                      type="number" step={0.5} className="inline-num" style={{ width: 60 }}
                      value={inputs.extraFundReturns[f.id] !== undefined ? inputs.extraFundReturns[f.id] : guessDefaultReturn(f.id)}
                      onChange={(e) => updateExtraFundReturn(f.id, Number(e.target.value))}
                    />
                    <span style={{ fontSize: 10, color: "#7C8A90" }}>%</span>
                  </div>
                </div>
              ))}
              <div className="alloc-sum">
                {t("allocSumNote", { amount: money(combinedGrandTotal) })}
              </div>
              <div className="note" style={{ marginTop: 8 }}>
                <Info size={13} />
                <span>{t("expectedReturnAutoNote")}</span>
              </div>
            </>
          ) : (
            <div className="note">
              <Info size={13} />
              <span>{t("noFundsYetNote")}</span>
            </div>
          )}

          <div className="note">
            <Info size={13} />
            <span>{t("overlapWarningNote")}</span>
          </div>
          </>
          ) : country === "US" && rules.investment.implemented ? (
            <USInvestmentAccountsPanel
              usInvestment={inputs.usInvestment}
              onUpdate={updateUsInvestment}
              onUpdateAccount={updateUsInvestmentAccount}
              age={effectiveCurrentAge}
              investmentRules={rules.investment}
              taxRules={rules.tax}
              taxResult={{
                federalTax: usFederalTaxResult.tax,
                taxableIncome: usFederalTaxResult.taxableIncome,
                ltcgTax: usLtcgTax,
                niit: usNiit,
                stateTax: usStateTax,
                totalTax: usTotalTax,
              }}
            />
          ) : country === "GB" && rules.investment.implemented ? (
            <GBInvestmentAccountsPanel
              gbInvestment={inputs.gbInvestment}
              onUpdate={updateGbInvestment}
              onUpdateAccount={updateGbInvestmentAccount}
              age={effectiveCurrentAge}
              investmentRules={rules.investment}
              taxRules={rules.tax}
              pensionAllowance={gbPensionAnnualAllowance}
              taxResult={{
                incomeTax: gbIncomeTaxResult.tax,
                taxableIncome: gbIncomeTaxResult.taxableIncome,
                dividendTax: gbDividendTax,
                capitalGainsTax: gbCapitalGainsTax,
                pensionTaxRelief: gbPensionTaxRelief,
                marginalRate: gbMarginalRate,
                totalTax: gbTotalTax,
              }}
            />
          ) : country === "CA" && rules.investment.implemented ? (
            <CAInvestmentAccountsPanel
              caInvestment={inputs.caInvestment}
              onUpdate={updateCaInvestment}
              onUpdateAccount={updateCaInvestmentAccount}
              age={effectiveCurrentAge}
              investmentRules={rules.investment}
              taxRules={rules.tax}
              rrspRoom={caRrspRoom}
              taxResult={{
                federalTax: caFederalTaxResult.tax,
                basicPersonalAmount: caFederalTaxResult.basicPersonalAmount,
                capitalGainsTax: caCapitalGainsTax,
                rrspTaxSaving: caRrspTaxSaving,
                marginalRate: caMarginalRate,
                totalTax: caTotalTax,
              }}
            />
          ) : country === "AU" && rules.investment.implemented ? (
            <AUInvestmentAccountsPanel
              auInvestment={inputs.auInvestment}
              onUpdate={updateAuInvestment}
              onUpdateAccount={updateAuInvestmentAccount}
              age={effectiveCurrentAge}
              investmentRules={rules.investment}
              taxRules={rules.tax}
              sgContribution={auSgContribution}
              totalConcessional={auTotalConcessional}
              concessionalRemaining={auConcessionalRemaining}
              nonConcessionalRemaining={auNonConcessionalRemaining}
              superContributionTax={auSuperContributionTax}
              salarySacrificeSaving={auSalarySacrificeSaving}
              taxResult={auTaxResult}
              capitalGainsTax={auCapitalGainsTax}
              totalTax={auTotalTax}
              marginalRate={auMarginalRate}
            />
          ) : (
            <div className="note" style={{ borderLeftColor: "#D9A54F" }}>
              <Info size={13} style={{ color: "#D9A54F" }} />
              <span>{t(rules.labels.investmentNote, { country: countryDisplayName })}</span>
            </div>
          )}

          </div>
          <div className="section-block" style={{ borderColor: "#B08FD6" }}>
          <SectionTitle index="03" title={label("retirementAccount")} icon={Landmark} />

          {!rules.retirement.implemented && (
            <div className="note" style={{ borderLeftColor: "#D9A54F", marginBottom: 12 }}>
              <Info size={13} style={{ color: "#D9A54F" }} />
              <span>{t(rules.labels.retirementNote, { country: countryDisplayName })}</span>
            </div>
          )}

          <div className="note">
            <Info size={13} />
            <span>
              {t("idecoIntroNote")}
            </span>
          </div>

          <MoneyField guide={t("idecoCurrentValueGuide")} label={t("idecoCurrentValueLabel")} value={inputs.ideco.currentValue} onChange={(v) => updateIdeco("currentValue", v)} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#E07A5F", whiteSpace: "nowrap", fontWeight: 700 }}>{t("asOfAgeRequired")}</span>
            <AgeYMInput
              placeholder={t("asOfAgePlaceholder")} years={inputs.ideco.asOfYears} months={inputs.ideco.asOfMonths}
              onYears={(v) => updateIdeco("asOfYears", v)}
              onMonths={(v) => updateIdeco("asOfMonths", v)}
            />
          </div>
          <div className="note" style={{ marginTop: -8 }}>
            <Info size={13} />
            <span>{t("idecoAsOfNote", { amount: money(idecoSim.currentValueAdjusted) })}</span>
          </div>
          <label className="field">
            <span className="field-label">{t("idecoCurrentValueAutoLabel")}</span>
            <div className="field-input-wrap">
              <div className="mono" style={{ flex: 1, padding: "8px 10px", fontSize: 13 }}>
                {Math.round(idecoSim.currentValueAdjusted).toLocaleString()}
              </div>
              <span className="field-unit">{uCurrency}</span>
            </div>
          </label>
          <MoneyField guide={t("idecoPrincipalGuide")} label={t("idecoPrincipalLabel")} value={inputs.ideco.principalTotal} onChange={(v) => updateIdeco("principalTotal", v)} />
          <MoneyField guide={t("idecoMonthlyContributionGuide")} label={t("idecoMonthlyContributionLabel")} value={inputs.ideco.monthlyContribution} onChange={(v) => updateIdeco("monthlyContribution", v)} />
          <AgeField label={t("idecoContributionStartAgeLabel")} value={inputs.ideco.startAge} onChange={(v) => updateIdeco("startAge", v)} />
          <AgeField label={t("idecoContributionEndAgeLabel")} value={inputs.ideco.endAge} onChange={(v) => updateIdeco("endAge", v)} />

          <label className="field">
            <span className="field-label">{t("idecoProductNameLabel")}</span>
            <div className="field-input-wrap">
              <input
                type="text" value={inputs.ideco.productName}
                onChange={(e) => updateIdeco("productName", e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
          </label>

          <Field
            label={`${t("expectedAnnualReturnLabel")}${inputs.ideco.returnPctAuto ? t("autoGuessedSuffix") : ""}`}
            unit="%" step={0.5}
            value={effectiveIdecoReturn}
            onChange={(v) => { updateIdeco("returnPct", v); updateIdeco("returnPctAuto", false); }}
          />
          {!inputs.ideco.returnPctAuto && (
            <div className="note" style={{ marginTop: -8 }}>
              <Info size={13} />
              <span>
                {t("manualOverrideNote")}
                <span
                  style={{ color: "#4FA8D8", textDecoration: "underline", cursor: "pointer", marginLeft: 4 }}
                  onClick={() => updateIdeco("returnPctAuto", true)}
                >
                  {t("revertToAutoLink")}
                </span>
              </span>
            </div>
          )}

          <AgeField label={t("payoutStartAgeLabel")} value={inputs.ideco.payoutStartAge} onChange={(v) => updateIdeco("payoutStartAge", v)} />

          <div className="field-label" style={{ marginBottom: 6 }}>{t("payoutMethodLabel")}</div>
          <div className="add-row" style={{ marginBottom: 14 }}>
            {[
              { key: "lump", label: t("payoutMethodLump") },
              { key: "pension", label: t("payoutMethodPension") },
              { key: "both", label: t("payoutMethodBoth") },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => updateIdeco("payoutMethod", opt.key)}
                style={{
                  flex: 1, padding: "9px 8px", borderRadius: 4, fontSize: 12.5, cursor: "pointer",
                  border: inputs.ideco.payoutMethod === opt.key ? "1px solid #4FA8D8" : "1px solid var(--line)",
                  background: inputs.ideco.payoutMethod === opt.key ? "rgba(79,168,216,0.15)" : "var(--panel)",
                  color: inputs.ideco.payoutMethod === opt.key ? "#4FA8D8" : "var(--text)",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {(inputs.ideco.payoutMethod === "pension" || inputs.ideco.payoutMethod === "both") && (
            <>
              <Field guide={t("idecoPayoutYearsGuide")} label={t("payoutYearsLabel")} unit={uYears} step={1} value={inputs.ideco.payoutYears} onChange={(v) => updateIdeco("payoutYears", v)} />
              <Field guide={t("idecoPayoutReturnGuide")} label={t("payoutReturnPctLabel")} unit="%" step={0.5} value={inputs.ideco.payoutReturnPct} onChange={(v) => updateIdeco("payoutReturnPct", v)} />
            </>
          )}
          {inputs.ideco.payoutMethod === "both" && (
            <Field guide={t("idecoLumpPortionGuide")} label={t("lumpPortionPctLabel")} unit="%" step={5} min={0} max={100} value={inputs.ideco.lumpPortionPct} onChange={(v) => updateIdeco("lumpPortionPct", v)} />
          )}

          <div className="stat-sub" style={{ marginBottom: 4 }}>{t("annualContributionLabel")}：<span className="mono">{money(idecoAnnualContribution)}</span></div>
          <div className="stat-sub" style={{ marginBottom: 4 }}>{t("contributionTotalLabel")}：<span className="mono">{money(idecoContributionTotal)}</span></div>
          <div className="stat-sub" style={{ marginBottom: 4 }}>{t("investmentGainLabel")}：<span className="mono">{money(idecoInvestmentGain)}</span></div>
          <div className="stat-sub" style={{ marginBottom: 4 }}>
            {t("estimatedAssetsAtPayoutLabel")}：<span className="mono">{idecoSim.valueAtPayout !== null ? money(idecoSim.valueAtPayout) : "—"}</span>
          </div>
          {(inputs.ideco.payoutMethod === "lump" || inputs.ideco.payoutMethod === "both") && (
            <div className="stat-sub" style={{ marginBottom: 4 }}>
              {t("lumpPayoutAmountLabel", { age: t("ageYears", { age: inputs.ideco.payoutStartAge }) })}：<span className="mono">{money(idecoSim.lumpAmount)}</span>
            </div>
          )}
          {(inputs.ideco.payoutMethod === "pension" || inputs.ideco.payoutMethod === "both") && (
            <div className="stat-sub" style={{ marginBottom: 14 }}>
              {t("annualPayoutAmountLabel", { from: inputs.ideco.payoutStartAge, to: idecoSim.payoutEndAge - 1 })}：<span className="mono">{money(idecoSim.annualPayout)}</span>
            </div>
          )}

          {country === "US" || country === "GB" || country === "CA" || country === "AU" ? (
            <div className="note" style={{ borderLeftColor: "#5FB0A0" }}>
              <Info size={13} style={{ color: "#5FB0A0" }} />
              <span>{t(rules.labels.taxNote)}</span>
            </div>
          ) : rules.tax.implemented ? (
            <>
              <div className="field-label" style={{ marginBottom: 6 }}>{t("taxSavingSimLabel")}</div>
              <MoneyField guide={t("annualIncomeGuide")} label={t("annualIncomeLabel")} value={inputs.ideco.annualIncome} onChange={(v) => updateIdeco("annualIncome", v)} />
              <div className="stat-sub" style={{ marginBottom: 4 }}>{t("annualTaxSavingLabel")}：<span className="mono">{money(idecoAnnualTaxSaving)}</span></div>
              <div className="stat-sub" style={{ marginBottom: 8 }}>{t("cumulativeTaxSavingLabel")}：<span className="mono">{money(idecoCumulativeTaxSaving)}</span></div>
              <div className="note" style={{ marginTop: -4 }}>
                <Info size={13} />
                <span>{t("taxSavingCaveatNote")}</span>
              </div>
            </>
          ) : (
            <div className="note" style={{ borderLeftColor: "#D9A54F" }}>
              <Info size={13} style={{ color: "#D9A54F" }} />
              <span>{t(rules.labels.taxNote, { country: countryDisplayName })}</span>
            </div>
          )}
          <div className="note">
            <Info size={13} />
            <span>{t("payoutAccountingNote")}</span>
          </div>

          </div>
          <div className="section-block" style={{ borderColor: "#C2694F" }}>
          <SectionTitle index="04" title={label("pensionRetirement")} icon={Landmark} />
          {country === "JP" ? (
          <>
          <GuideLabel guide={t("pensionSourcesGuide")}>{t("pensionSourcesLabel")}</GuideLabel>
          {inputs.pensionSources.length > 0 && (
            <table className="watchlist" style={{ marginBottom: 8 }}>
              <thead><tr><th>{t("pensionTypeCol")}</th><th>{t("monthlyAmountCol")}</th><th></th></tr></thead>
              <tbody>
                {inputs.pensionSources.map((p, i) => (
                  <tr key={i}>
                    <td>{p.name}</td>
                    <td className="mono">{money(p.monthlyAmount)}</td>
                    <td style={{ width: 24 }}>
                      <button className="del-btn" onClick={() => removePensionSource(i)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="add-row" style={{ marginBottom: 8 }}>
            <input placeholder={t("pensionNamePlaceholder")} value={newPensionSource.name} onChange={(e) => setNewPensionSource((p) => ({ ...p, name: e.target.value }))} />
            <MoneyInput placeholder={t("monthlyAmountPlaceholderMan")} value={newPensionSource.monthlyAmount} onChange={(v) => setNewPensionSource((p) => ({ ...p, monthlyAmount: v }))} />
            <button className="add-btn" onClick={addPensionSource}><Plus size={15} /></button>
          </div>
          <MoneyField
            unitPer="month"
            label={inputs.pensionSources.length > 0 ? t("pensionTotalAutoLabel") : t("pensionEstimateLabel")}
            value={effectivePensionMonthly}
            disabled={inputs.pensionSources.length > 0}
            onChange={(v) => update({ pensionMonthly: v })}
          />
          {inputs.pensionSources.length > 0 && (
            <div className="note" style={{ marginTop: -8 }}>
              <Info size={13} />
              <span>{t("pensionAutoNote")}</span>
            </div>
          )}
          {/* 【追加】公的年金の受給開始年齢。退職年齢とは独立して設定できる。 */}
          <AgeField
            guide={t("publicPensionStartAgeGuide")}
            label={t("publicPensionStartAgeLabel")}
            value={effectivePublicPensionStartAge}
            onChange={(v) => update({ publicPensionStartAge: v })}
          />
          <MoneyField unitPer="month" guide={t("livingCostGuide")} label={t("livingCostLabel")} value={inputs.livingCostMonthly} onChange={(v) => update({ livingCostMonthly: v })} />
          <Field
            label={`${t("postRetireReturnLabel")}${inputs.postRetireReturnAuto && dynamicFunds.length > 0 ? t("autoHalfWeightedSuffix") : ""}`}
            unit="%" step={0.5}
            value={effectivePostRetireReturn}
            onChange={(v) => update({ postRetireReturn: v, postRetireReturnAuto: false })}
          />
          {!inputs.postRetireReturnAuto && dynamicFunds.length > 0 && (
            <div className="note" style={{ marginTop: -8 }}>
              <Info size={13} />
              <span>
                {t("manualOverrideNote")}
                <span
                  style={{ color: "#4FA8D8", textDecoration: "underline", cursor: "pointer", marginLeft: 4 }}
                  onClick={() => update({ postRetireReturnAuto: true })}
                >
                  {t("revertToAutoLink")}
                </span>
              </span>
            </div>
          )}
          </>
          ) : country === "US" && rules.retirement.implemented ? (
            <USRetirementPanel
              usInvestment={inputs.usInvestment}
              onUpdateSS={(field, val) => updateUsInvestmentNested("socialSecurity", field, val)}
              onUpdate={updateUsInvestment}
              retirementRules={rules.retirement}
              claimAge={usClaimAge}
              ssMonthly={usSSMonthlyBenefit}
              ssAnnual={usSSAnnualBenefit}
              expensesAnnual={usExpensesAnnual}
              healthcareAnnual={usTotalHealthcareAnnual}
              withdrawalNeeded={usWithdrawalNeeded}
              incomeSurplus={usIncomeSurplus}
            />
          ) : country === "GB" && rules.retirement.implemented ? (
            <GBRetirementPanel
              gbInvestment={inputs.gbInvestment}
              onUpdateStatePension={(field, val) => updateGbInvestmentNested("statePension", field, val)}
              onUpdate={updateGbInvestment}
              retirementRules={rules.retirement}
              statePensionAge={gbStatePensionAge}
              statePensionAgeInfo={gbStatePensionAgeInfo}
              claimAge={gbClaimAge}
              effectiveClaimAge={gbEffectiveClaimAge}
              deferralFactor={gbDeferralFactor}
              statePensionAnnual={gbStatePensionAnnual}
              retirementIncomeAnnual={gbRetirementIncomeAnnual}
              fullStatePensionAnnual={gbFullStatePensionAnnual}
              expensesAnnual={gbExpensesAnnual}
              healthcareAnnual={gbHealthcareAnnual}
              withdrawalNeeded={gbWithdrawalNeeded}
              incomeSurplus={gbIncomeSurplus}
            />
          ) : country === "CA" && rules.retirement.implemented ? (
            <CARetirementPanel
              caInvestment={inputs.caInvestment}
              onUpdateCpp={(field, val) => updateCaInvestmentNested("cpp", field, val)}
              onUpdateOas={(field, val) => updateCaInvestmentNested("oas", field, val)}
              onUpdate={updateCaInvestment}
              retirementRules={rules.retirement}
              cppStartAge={caCppStartAge}
              cppFactor={caCppFactor}
              cppAnnual={caCppAnnual}
              cppMaxAnnual={caCppMaxAnnual}
              oasStartAge={caOasStartAge}
              oasEffectiveStartAge={caOasEffectiveStartAge}
              oasResidenceFraction={caOasResidenceFraction}
              oasBeforeClawback={caOasBeforeClawback}
              oasClawback={caOasClawback}
              oasAnnual={caOasAnnual}
              retirementIncomeAnnual={caRetirementIncomeAnnual}
              expensesAnnual={caExpensesAnnual}
              healthcareAnnual={caHealthcareAnnual}
              withdrawalNeeded={caWithdrawalNeeded}
              incomeSurplus={caIncomeSurplus}
            />
          ) : country === "AU" && rules.retirement.implemented ? (
            <AURetirementPanel
              auInvestment={inputs.auInvestment}
              onUpdateAgePension={(field, val) => updateAuInvestmentNested("agePension", field, val)}
              onUpdate={updateAuInvestment}
              retirementRules={rules.retirement}
              qualifyingAge={auAgePensionQualifyingAge}
              maxAnnual={auAgePensionMaxAnnual}
              agePensionAnnual={auAgePensionAnnual}
              agePensionPerPersonAnnual={auAgePensionFromEngine.agePensionPerPersonAnnual}
              recipients={auAgePensionFromEngine.recipients}
              deemedIncomeAnnual={auAgePensionFromEngine.deemedIncomeAnnual}
              retirementIncomeAnnual={auRetirementIncomeAnnual}
              assessableAssets={auAssessableAssetsAtQualifyingAge}
              expensesAnnual={auExpensesAnnual}
              healthcareAnnual={auHealthcareAnnual}
              withdrawalNeeded={auWithdrawalNeeded}
              incomeSurplus={auIncomeSurplus}
              retireAge={inputs.retireAge}
            />
          ) : (
            <div className="note" style={{ borderLeftColor: "#D9A54F" }}>
              <Info size={13} style={{ color: "#D9A54F" }} />
              <span>{t(rules.labels.retirementNote, { country: countryDisplayName })}</span>
            </div>
          )}

          </div>
          <div className="section-block" style={{ borderColor: "#7BC9E0" }}>
          <SectionTitle index="05" title={label("healthCost")} icon={HeartPulse} />
          {country === "JP" ? (
          <>
          <MoneyField unitPer={"year"} guide={t("health60sGuide")} label={t("health60sLabel")} value={inputs.healthBrackets.b60} onChange={(v) => updateHealth("b60", v)} />
          <MoneyField unitPer={"year"} guide={t("health70sGuide")} label={t("health70sLabel")} value={inputs.healthBrackets.b70} onChange={(v) => updateHealth("b70", v)} />
          <MoneyField unitPer={"year"} guide={t("health80sGuide")} label={t("health80sLabel")} value={inputs.healthBrackets.b80} onChange={(v) => updateHealth("b80", v)} />
          <div className="note">
            <Info size={13} />
            <span>{t("healthCostNote")}</span>
          </div>
          </>
          ) : country === "US" && rules.healthcare.implemented ? (
            <USHealthcarePanel
              usInvestment={inputs.usInvestment}
              onUpdate={(field, val) => updateUsInvestmentNested("healthcare", field, val)}
              medicareAnnual={usMedicareAnnual}
              healthInsuranceAnnual={usHealthInsuranceAnnual}
              outOfPocketAnnual={usOutOfPocketAnnual}
              totalAnnual={usTotalHealthcareAnnual}
            />
          ) : country === "GB" && rules.healthcare.implemented ? (
            <GBHealthcarePanel
              gbInvestment={inputs.gbInvestment}
              onUpdate={(field, val) => updateGbInvestmentNested("healthcare", field, val)}
              totalAnnual={gbHealthcareAnnual}
            />
          ) : country === "CA" && rules.healthcare.implemented ? (
            <CAHealthcarePanel
              caInvestment={inputs.caInvestment}
              onUpdate={(field, val) => updateCaInvestmentNested("healthcare", field, val)}
              totalAnnual={caHealthcareAnnual}
            />
          ) : country === "AU" && rules.healthcare.implemented ? (
            <AUHealthcarePanel
              auInvestment={inputs.auInvestment}
              onUpdate={(field, val) => updateAuInvestmentNested("healthcare", field, val)}
              totalAnnual={auHealthcareAnnual}
            />
          ) : (
            <div className="note" style={{ borderLeftColor: "#D9A54F" }}>
              <Info size={13} style={{ color: "#D9A54F" }} />
              <span>{t(rules.labels.healthcareNote, { country: countryDisplayName })}</span>
            </div>
          )}

          </div>
          <div className="section-block" style={{ borderColor: "#E6B0A6" }}>
          <SectionTitle index="06" title={label("inheritance")} icon={Users} />
          {inputs.inheritancePlans.length > 0 && (
            <table className="watchlist" style={{ marginBottom: 8 }}>
              <thead><tr><th>{t("nameCol")}</th><th>{t("relationCol")}</th><th>{t("colAmount")}</th><th></th></tr></thead>
              <tbody>
                {inputs.inheritancePlans.map((p, i) => (
                  <tr key={i}>
                    <td>{p.name}</td>
                    <td style={{ color: "#7C8A90" }}>{p.relation || "—"}</td>
                    <td className="mono">{money(p.amount)}</td>
                    <td style={{ width: 24 }}>
                      <button className="del-btn" onClick={() => removeInheritancePlan(i)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="add-row" style={{ flexWrap: "wrap" }}>
            <input placeholder={t("nameCol")} value={newInheritance.name} onChange={(e) => setNewInheritance((p) => ({ ...p, name: e.target.value }))} />
            <input placeholder={t("relationPlaceholder")} value={newInheritance.relation} onChange={(e) => setNewInheritance((p) => ({ ...p, relation: e.target.value }))} />
          </div>
          <div className="add-row" style={{ marginBottom: 10 }}>
            <MoneyInput placeholder={t("inheritanceAmountPlaceholderMan")} value={newInheritance.amount} onChange={(v) => setNewInheritance((p) => ({ ...p, amount: v }))} />
            <button className="add-btn" onClick={addInheritancePlan}><Plus size={15} /></button>
          </div>
          {inputs.inheritancePlans.length > 0 && (
            <div className="stat-sub" style={{ marginBottom: 10 }}>
              {t("inheritanceTotalLabel")}：<span className="mono">{money(inheritanceTotal)}</span>（{t("peopleCount", { count: inputs.inheritancePlans.length })}）
            </div>
          )}
          <MoneyField
            guide={t("inheritanceTargetGuide")}
            label={inputs.inheritancePlans.length > 0 ? t("inheritanceTargetAutoLabel") : t("inheritanceTargetLabel")}
            value={effectiveInheritanceTarget}
            disabled={inputs.inheritancePlans.length > 0}
            onChange={(v) => update({ inheritanceTarget: v })}
          />
          {inputs.inheritancePlans.length > 0 && (
            <div className="note" style={{ marginTop: -8 }}>
              <Info size={13} />
              <span>{t("inheritanceAutoNote")}</span>
            </div>
          )}

          </div>
          <div className="section-block" style={{ borderColor: "#6FA88A" }}>
          <SectionTitle index="07" title={label("gold")} icon={Coins} />
          <Field guide={t("goldCurrentHoldingGuide")} label={t("goldCurrentHoldingLabel")} unit="g" step={1} value={inputs.gold.currentGrams} onChange={(v) => updateGold("currentGrams", v)} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#E07A5F", whiteSpace: "nowrap", fontWeight: 700 }}>{t("asOfAgeRequired")}</span>
            <AgeYMInput
              placeholder={t("asOfAgePlaceholder")} years={inputs.gold.asOfYears} months={inputs.gold.asOfMonths}
              onYears={(v) => updateGold("asOfYears", v)}
              onMonths={(v) => updateGold("asOfMonths", v)}
            />
          </div>
          <div className="note" style={{ marginTop: -8 }}>
            <Info size={13} />
            <span>{t("goldAsOfNote", { grams: goldSim.currentGrams.toFixed(1), amount: money(goldSim.currentValue) })}</span>
          </div>
          <label className="field">
            <span className="field-label">{t("goldCurrentValueAutoLabel")}</span>
            <div className="field-input-wrap">
              <div className="mono" style={{ flex: 1, padding: "8px 10px", fontSize: 13 }}>
                {Math.round(goldSim.currentValue).toLocaleString()}
              </div>
              <span className="field-unit">{uCurrency}</span>
            </div>
          </label>
          <Field guide={t("goldPriceRefGuide")} label={t("goldPriceRefLabel")} unit={uPerGram} step={100} value={inputs.gold.pricePerGram} onChange={(v) => updateGold("pricePerGram", v)} />
          <Field
            guide={t("goldGrowthGuide")}
            label={`${t("goldGrowthRateLabel")}${inputs.gold.priceGrowthPctAuto ? t("autoEstimatedSuffix") : ""}`}
            unit="%" step={0.5}
            value={effectiveGoldReturnPct}
            onChange={(v) => { updateGold("priceGrowthPct", v); updateGold("priceGrowthPctAuto", false); }}
          />
          {!inputs.gold.priceGrowthPctAuto && (
            <div className="note" style={{ marginTop: -8 }}>
              <Info size={13} />
              <span>
                {t("manualOverrideNote")}
                <span
                  style={{ color: "#4FA8D8", textDecoration: "underline", cursor: "pointer", marginLeft: 4 }}
                  onClick={() => updateGold("priceGrowthPctAuto", true)}
                >
                  {t("revertToAutoLink")}
                </span>
              </span>
            </div>
          )}
          <MoneyField unitPer={"month"} guide={t("goldMonthlyContributionGuide")} label={t("goldMonthlyContributionLabel")} value={inputs.gold.monthlyYen} onChange={(v) => updateGold("monthlyYen", v)} />
          <AgeField label={t("goldAccumulateUntilLabel")} value={inputs.gold.accumulateUntilAge} onChange={(v) => updateGold("accumulateUntilAge", v)} />
          <div className="note">
            <Info size={13} />
            <span>{t("goldPriceRefNote")}</span>
          </div>

          </div>
          <div className="section-block" style={{ borderColor: "#E0C34F" }}>
          <SectionTitle index="08" title={label("cash")} icon={PiggyBank} />
          <SectionGuide guide={t("bankGuide")} />
          {inputs.banks.length > 0 && (
            <table className="watchlist" style={{ marginBottom: 8 }}>
              <thead><tr><th>{t("bankNameCol")}</th><th>{t("balanceCol")}</th><th>{t("monthlyDepositCol")}</th><th></th></tr></thead>
              <tbody>
                {inputs.banks.map((b, i) => (
                  <tr key={i}>
                    <td>{b.name}</td>
                    <td className="mono">{money(b.balance)}</td>
                    <td className="mono">{money(b.monthlyDeposit)}{t("perMonthSuffix")}</td>
                    <td style={{ width: 24 }}>
                      <button className="del-btn" onClick={() => removeBank(i)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {inputs.banks.length > 0 && (
            <div className="stat-sub" style={{ marginBottom: 10 }}>
              {t("bankTotalNowLabel")}：<span className="mono">{money(bankSim.totalNow)}</span>
            </div>
          )}
          <div className="add-row" style={{ flexWrap: "wrap" }}>
            <input placeholder={t("bankNameCol")} value={newBank.name} onChange={(e) => setNewBank((p) => ({ ...p, name: e.target.value }))} />
            <MoneyInput placeholder={t("currentBalancePlaceholderMan")} value={newBank.balance} onChange={(v) => setNewBank((p) => ({ ...p, balance: v }))} />
          </div>
          <div className="add-row">
            <MoneyInput placeholder={t("monthlyDepositPlaceholderMan")} value={newBank.monthlyDeposit} onChange={(v) => setNewBank((p) => ({ ...p, monthlyDeposit: v }))} />
            <input placeholder={t("interestRatePlaceholder")} type="number" value={newBank.interestPct} onChange={(e) => setNewBank((p) => ({ ...p, interestPct: e.target.value }))} />
            <button className="add-btn" onClick={addBank}><Plus size={15} /></button>
          </div>
          <div className="note">
            <Info size={13} />
            <span>{t("bankNote", { age: t("ageYears", { age: inputs.retireAge }) })}</span>
          </div>

          {/* 余剰金残高（surplusBalance）— 総資産グラフ・銀行残高と同一の integrated から
              読み出して表示する。余剰金は銀行預金の内数（bankValue に一度だけ含まれる）で、
              別帯にはしない（二重計上防止）。公的年金・iDeCo・民間年金いずれの余剰も
              同じ計算源で反映される。
              【Ver.1.0の位置づけ】これは「使う」機能ではなく、銀行預金がなぜ増えるのかを
              利用者に説明するための参考表示。入力欄は持たず、表示だけを行う。 */}
          <div id="section-surplus-balance" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #2A363C" }}>
            <div className="stat-sub" style={{ marginBottom: 8 }}>{t("surplusBalanceTitle")}</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <StatCard label={t("surplusBalanceCurrentLabel")} value={money(surplusAtCurrent)} sub={t("surplusBalanceCurrentSub")} />
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                {t("surplusBalanceSelectLabel")}
                <select
                  value={effectiveSurplusFocusAge}
                  onChange={(e) => setSurplusFocusAge(Number(e.target.value))}
                  style={{ fontSize: 13, padding: "4px 6px" }}
                >
                  {surplusAgeOptions.map((a) => (
                    <option key={a} value={a}>{t("ageYears", { age: a })}</option>
                  ))}
                </select>
              </label>
            </div>
            {/* 「現在の余剰金残高とは？」— この機能の主目的。銀行預金がなぜ増えるのかを
                最初に読ませる。箇条書きは翻訳側で1行1項目に分けて持つ。 */}
            <div className="surplus-why">
              <div className="surplus-why-title">{t("surplusWhyTitle")}</div>
              <p>{t("surplusWhyLead")}</p>
              <p>{t("surplusWhyFormulaIntro")}</p>
              <ul>
                {["living", "health", "insurance", "loan", "other"].map((k) => (
                  <li key={k}>{t("surplusWhyItem_" + k)}</li>
                ))}
              </ul>
              <p>{t("surplusWhyZeroDeposit")}</p>
              <p>{t("surplusWhyStartsAtZero")}</p>
              <p>{t("surplusWhyPurpose")}</p>
              <p>{t("surplusWhyNoDoubleCount")}</p>
            </div>
            {/* 選択した年齢時点の余剰金残高（銀行預金の内数・表示専用） */}
            <div style={{ marginTop: 12 }}>
              <StatCard label={t("surplusBalanceAtAgeLabel", { age: effectiveSurplusFocusAge })} value={money(surplusAtFocus)} tone="good" />
            </div>
            <div className="note" style={{ marginTop: 8 }}>
              <Info size={13} />
              <span>{t("surplusBalanceAtAgeExplain")}</span>
            </div>
            <div className="note" style={{ marginTop: 8 }}>
              <Info size={13} />
              <span>{t("surplusBalanceExplain")}</span>
            </div>

          </div>

          </div>
          <div className="section-block" style={{ borderColor: "#9D8FD6" }}>
          <SectionTitle index="09" title={label("loan")} icon={Landmark} />
          <SectionGuide guide={t("loanGuide")} />
          {inputs.loans.length > 0 && (
            <table className="watchlist" style={{ marginBottom: 8 }}>
              <thead><tr><th>{t("loanNameCol")}</th><th>{t("loanPrincipalCol")}</th><th>{t("interestRateCol")}</th><th>{t("monthlyPaymentCol")}</th><th></th></tr></thead>
              <tbody>
                {inputs.loans.map((l, i) => (
                  <tr key={i}>
                    <td>{l.name}</td>
                    <td className="mono">{money(l.principal)}</td>
                    <td className="mono">{l.annualRatePct}%</td>
                    <td className="mono">{money(l.monthlyPayment)}{t("perMonthSuffix")}</td>
                    <td style={{ width: 24 }}>
                      <button className="del-btn" onClick={() => removeLoan(i)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="add-row" style={{ flexWrap: "wrap" }}>
            <input placeholder={t("loanNamePlaceholder")} value={newLoan.name} onChange={(e) => setNewLoan((p) => ({ ...p, name: e.target.value }))} />
            <MoneyInput placeholder={t("loanBalancePlaceholderMan")} value={newLoan.principal} onChange={(v) => setNewLoan((p) => ({ ...p, principal: v }))} />
          </div>
          <div className="add-row">
            <input placeholder={t("annualRatePlaceholder")} type="number" value={newLoan.annualRatePct} onChange={(e) => setNewLoan((p) => ({ ...p, annualRatePct: e.target.value }))} />
            <MoneyInput placeholder={t("monthlyPaymentPlaceholderMan")} value={newLoan.monthlyPayment} onChange={(v) => setNewLoan((p) => ({ ...p, monthlyPayment: v }))} />
            <button className="add-btn" onClick={addLoan}><Plus size={15} /></button>
          </div>
          {integrated.loanPayoffAges.some((a) => a !== null) && (
            <div className="note">
              <Info size={13} />
              <span>
                {t("payoffScheduleLabel")}：{inputs.loans.map((l, i) => (
                  <span key={i}>{i > 0 && t("listSeparator")}{l.name} {integrated.loanPayoffAges[i] ? t("ageYears", { age: Math.round(integrated.loanPayoffAges[i]) }) : t("payoffInsufficientNote")}</span>
                ))}
              </span>
            </div>
          )}

          </div>
          <div className="section-block" style={{ borderColor: "#5FB0A0" }}>
          <SectionTitle index="10" title={label("insurance")} icon={HeartPulse} />
          <SectionGuide guide={t("insuranceGuide")} />
          {inputs.insurancePolicies.length > 0 && (
            <table className="watchlist" style={{ marginBottom: 10 }}>
              <thead><tr><th style={{ width: "26%" }}>{t("insuranceNameCol")}</th><th style={{ width: "62%" }}>{t("premiumCoverageCol")}</th><th style={{ width: "24px" }}></th></tr></thead>
              <tbody>
                {inputs.insurancePolicies.map((p, i) => (
                  <tr key={i}>
                    <td>{p.name}</td>
                    <td className="mono" style={{ fontSize: 10.5 }}>
                      <div>{t("premiumRangeLabel")} {formatAge(p.premiumFromAge)}〜{formatAge(p.premiumToAge)}：{money(p.monthlyPremium)}{t("perMonthSuffix")}</div>
                      <div style={{ color: "#7C8A90" }}>{t("coverageUntilLabel", { age: formatAge(p.coverageUntilAge) })}</div>
                      <div style={{ color: "#7C8A90" }}>
                        {t("benefitHospitalization", { amount: money(p.benefits.hospitalizationPerDay), limit: p.benefits.hospitalizationDaysLimit || 0 })}{t("benefitSeparator")}
                        {t("benefitSurgery", { amount: money(p.benefits.hospitalizationSurgery) })}{t("benefitSeparator")}
                        {t("benefitDaySurgery", { amount: money(p.benefits.daySurgery) })}{t("benefitSeparator")}{t("benefitRadiation", { amount: money(p.benefits.radiationPerSession) })}{t("benefitSeparator")}
                        {t("benefitAdvancedMedical", { amount: money(p.benefits.advancedMedical) })}{t("benefitSeparator")}{t("benefitDeath", { amount: money(p.benefits.death) })}
                      </div>
                      {(p.customBenefits || []).length > 0 && (
                        <div style={{ color: "#7C8A90", marginTop: 4 }}>
                          {p.customBenefits.map((cb, j) => (
                            <div key={j} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span>{cb.name}：{money(cb.amount)}</span>
                              <button className="del-btn" onClick={() => removeCustomBenefit(i, j)}><Trash2 size={11} /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      <CustomBenefitEditor onAdd={(name, amount) => addCustomBenefit(i, name, amount)} />
                    </td>
                    <td style={{ width: 24 }}>
                      <button className="del-btn" onClick={() => removeInsurance(i)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="field-label" style={{ marginBottom: 4 }}>{t("insuranceNameCol")}</div>
          <div className="add-row" style={{ marginBottom: 8 }}>
            <input placeholder={t("insuranceNamePlaceholder")} value={newInsurance.name} onChange={(e) => setNewInsurance((p) => ({ ...p, name: e.target.value }))} />
          </div>

          <div className="field-label" style={{ marginBottom: 4 }}>{t("premiumPeriodLabel")}</div>
          <div className="add-row" style={{ marginBottom: 8 }}>
            <AgeYMInput
              placeholder={t("startPlaceholder")} years={newInsurance.premiumFromYears} months={newInsurance.premiumFromMonths}
              onYears={(v) => setNewInsurance((p) => ({ ...p, premiumFromYears: v }))}
              onMonths={(v) => setNewInsurance((p) => ({ ...p, premiumFromMonths: v }))}
            />
            <AgeYMInput
              placeholder={t("endPlaceholder")} years={newInsurance.premiumToYears} months={newInsurance.premiumToMonths}
              onYears={(v) => setNewInsurance((p) => ({ ...p, premiumToYears: v }))}
              onMonths={(v) => setNewInsurance((p) => ({ ...p, premiumToMonths: v }))}
            />
          </div>
          <div className="add-row" style={{ marginBottom: 8 }}>
            <MoneyInput placeholder={t("monthlyPremiumPlaceholderMan")} value={newInsurance.monthlyPremium} onChange={(v) => setNewInsurance((p) => ({ ...p, monthlyPremium: v }))} />
          </div>

          <div className="field-label" style={{ marginBottom: 4 }}>{t("coverageUntilAgeLabel")}</div>
          <div className="add-row" style={{ marginBottom: 8 }}>
            <AgeYMInput
              placeholder={t("coveragePlaceholder")} years={newInsurance.coverageUntilYears} months={newInsurance.coverageUntilMonths}
              onYears={(v) => setNewInsurance((p) => ({ ...p, coverageUntilYears: v }))}
              onMonths={(v) => setNewInsurance((p) => ({ ...p, coverageUntilMonths: v }))}
            />
          </div>

          <div className="field-label" style={{ marginBottom: 4 }}>{t("benefitDetailsLabel")}</div>
          <div className="add-row" style={{ marginBottom: 6 }}>
            <LabeledMiniInput label={t("hospitalizationPerDayLabel")} money value={newInsurance.hospitalizationPerDay} onChangeValue={(v) => setNewInsurance((p) => ({ ...p, hospitalizationPerDay: v }))} />
            <LabeledMiniInput label={t("hospitalizationDaysLimitLabel")} value={newInsurance.hospitalizationDaysLimit} onChange={(e) => setNewInsurance((p) => ({ ...p, hospitalizationDaysLimit: e.target.value }))} />
          </div>
          <div className="add-row" style={{ marginBottom: 6 }}>
            <LabeledMiniInput label={t("hospitalizationSurgeryLabel")} money value={newInsurance.hospitalizationSurgery} onChangeValue={(v) => setNewInsurance((p) => ({ ...p, hospitalizationSurgery: v }))} />
            <LabeledMiniInput label={t("daySurgeryLabel")} money value={newInsurance.daySurgery} onChangeValue={(v) => setNewInsurance((p) => ({ ...p, daySurgery: v }))} />
          </div>
          <div className="add-row" style={{ marginBottom: 6 }}>
            <LabeledMiniInput label={t("radiationLabel")} money value={newInsurance.radiationPerSession} onChangeValue={(v) => setNewInsurance((p) => ({ ...p, radiationPerSession: v }))} />
            <LabeledMiniInput label={t("advancedMedicalLabel")} money value={newInsurance.advancedMedical} onChangeValue={(v) => setNewInsurance((p) => ({ ...p, advancedMedical: v }))} />
          </div>
          <div className="add-row" style={{ marginBottom: 10 }}>
            <LabeledMiniInput label={t("deathBenefitLabel")} money value={newInsurance.death} onChangeValue={(v) => setNewInsurance((p) => ({ ...p, death: v }))} />
          </div>
          <div className="add-row" style={{ marginBottom: 14 }}>
            <button className="add-btn" onClick={addInsurance} style={{ width: "100%" }}><Plus size={15} /></button>
          </div>
          <div className="note">
            <Info size={13} />
            <span>{t("insuranceNote")}</span>
          </div>

          </div>
          <div className="section-block" style={{ borderColor: "#D67F9E" }}>
          <SectionTitle index="11" title={label("privatePension")} icon={PiggyBank} />
          <SectionGuide guide={t("privatePensionGuide")} />
          {inputs.privatePensionPlans.length > 0 && (
            <table className="watchlist" style={{ marginBottom: 10 }}>
              <thead><tr><th style={{ width: "26%" }}>{t("pensionNameCol")}</th><th style={{ width: "62%" }}>{t("contribPayoutCol")}</th><th style={{ width: "24px" }}></th></tr></thead>
              <tbody>
                {inputs.privatePensionPlans.map((pl, i) => (
                  <tr key={i}>
                    <td>{pl.name}</td>
                    <td className="mono" style={{ fontSize: 10.5 }}>
                      <div>{t("contribLabel")} {formatAge(pl.contribFromAge)}〜{formatAge(pl.contribToAge)}：{money(pl.monthlyContribution)}{t("perMonthSuffix")}</div>
                      <div style={{ color: "#7C8A90" }}>{t("payoutLabel")} {formatAge(pl.payoutFromAge)}〜{formatAge(pl.payoutToAge)}：{money(pl.monthlyPayout)}{t("perMonthSuffix")}</div>
                      {pl.currentBalance !== null && pl.currentBalance !== undefined && (
                        <div style={{ color: "#6FA88A" }}>{t("currentBalanceManualLabel")}：{money(pl.currentBalance)}</div>
                      )}
                    </td>
                    <td style={{ width: 24 }}>
                      <button className="del-btn" onClick={() => removePension(i)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {inputs.privatePensionPlans.length > 0 && (
            <div className="stat-sub" style={{ marginBottom: 10 }}>
              {t("privatePensionTotalNowLabel")}：<span className="mono">{money(pensionSim.totalNow)}</span>
            </div>
          )}

          <div className="field-label" style={{ marginBottom: 4 }}>{t("pensionNameCol")}</div>
          <div className="add-row" style={{ marginBottom: 8 }}>
            <input placeholder={t("pensionNamePlaceholderPrivate")} value={newPension.name} onChange={(e) => setNewPension((p) => ({ ...p, name: e.target.value }))} />
          </div>

          <div className="field-label" style={{ marginBottom: 4 }}>{t("contribPeriodLabel")}</div>
          <div className="add-row" style={{ marginBottom: 8 }}>
            <AgeYMInput
              placeholder={t("startPlaceholder")} years={newPension.contribFromYears} months={newPension.contribFromMonths}
              onYears={(v) => setNewPension((p) => ({ ...p, contribFromYears: v }))}
              onMonths={(v) => setNewPension((p) => ({ ...p, contribFromMonths: v }))}
            />
            <AgeYMInput
              placeholder={t("endPlaceholder")} years={newPension.contribToYears} months={newPension.contribToMonths}
              onYears={(v) => setNewPension((p) => ({ ...p, contribToYears: v }))}
              onMonths={(v) => setNewPension((p) => ({ ...p, contribToMonths: v }))}
            />
          </div>
          <div className="add-row" style={{ marginBottom: 8 }}>
            <LabeledMiniInput label={t("monthlyContribAmountLabel")} money value={newPension.monthlyContribution} onChangeValue={(v) => setNewPension((p) => ({ ...p, monthlyContribution: v }))} />
          </div>

          <div className="field-label" style={{ marginBottom: 4 }}>{t("payoutPeriodLabel")}</div>
          <div className="add-row" style={{ marginBottom: 8 }}>
            <AgeYMInput
              placeholder={t("startPlaceholder")} years={newPension.payoutFromYears} months={newPension.payoutFromMonths}
              onYears={(v) => setNewPension((p) => ({ ...p, payoutFromYears: v }))}
              onMonths={(v) => setNewPension((p) => ({ ...p, payoutFromMonths: v }))}
            />
            <AgeYMInput
              placeholder={t("endPlaceholder")} years={newPension.payoutToYears} months={newPension.payoutToMonths}
              onYears={(v) => setNewPension((p) => ({ ...p, payoutToYears: v }))}
              onMonths={(v) => setNewPension((p) => ({ ...p, payoutToMonths: v }))}
            />
          </div>
          <div className="add-row" style={{ marginBottom: 10 }}>
            <LabeledMiniInput label={t("monthlyPayoutAmountLabel")} money value={newPension.monthlyPayout} onChangeValue={(v) => setNewPension((p) => ({ ...p, monthlyPayout: v }))} />
          </div>
          <div className="field-label" style={{ marginBottom: 4 }}>{t("currentBalanceOptionalLabel")}</div>
          <div className="add-row" style={{ marginBottom: 10 }}>
            <MoneyInput
              placeholder={t("currentBalanceAutoPlaceholder")}
              value={newPension.currentBalance}
              onChange={(v) => setNewPension((p) => ({ ...p, currentBalance: v }))}
            />
          </div>
          <div className="add-row" style={{ marginBottom: 14 }}>
            <button className="add-btn" onClick={addPension} style={{ width: "100%" }}><Plus size={15} /></button>
          </div>
          <div className="note">
            <Info size={13} />
            <span>{t("privatePensionNote")}</span>
          </div>
          </div>

          {/* 入力フォームの最後にも「トップへ戻る」を置く。
              民間年金まで入力し終えた人が、右下の常駐ボタンを探さずに
              その場で入力フォーム先頭（#simulator）へ戻れるようにする。 */}
          <button
            type="button"
            className="back-to-top-inline no-print"
            onClick={() => {
              const el = document.getElementById("simulator");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              else window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <ChevronUp size={16} strokeWidth={2.25} />
            <span>{t("backToTopLabel")}</span>
          </button>
        </div>

        {/* -------- RIGHT: DASHBOARD -------- */}
        <div className="content">
          <div className="stat-grid" style={{ marginBottom: 10 }}>
            {country === "US" ? (
              <>
                <StatCard
                  label={t("usLiquidAssetsLabel")}
                  value={money(usLiquidRestrictedSplit.liquid)}
                  sub={t("usLiquidAssetsSub")}
                  tone="good"
                />
                <StatCard
                  label={t("usRestrictedAssetsLabel")}
                  value={money(usLiquidRestrictedSplit.restricted)}
                  sub={usLiquidRestrictedSplit.isAccessibleAge ? t("usRestrictedAssetsSubOver595") : t("usRestrictedAssetsSubUnder595")}
                />
              </>
            ) : country === "GB" ? (
              <>
                <StatCard
                  label={t("gbLiquidAssetsLabel")}
                  value={money(gbAssetSplit.liquid)}
                  sub={t("gbLiquidAssetsSub", { age: rules.investment.pensionAccessAge })}
                  tone="good"
                />
                <StatCard
                  label={t("gbRestrictedAssetsLabel")}
                  value={money(gbAssetSplit.restricted)}
                  sub={gbAssetSplit.isAccessibleAge
                    ? t("gbRestrictedAssetsSubAccessible", { age: rules.investment.pensionAccessAge })
                    : t("gbRestrictedAssetsSubLocked", { age: rules.investment.pensionAccessAge })}
                />
                <StatCard
                  label={t("gbTaxAdvantagedLabel")}
                  value={money(gbAssetSplit.taxAdvantaged)}
                  sub={t("gbTaxAdvantagedSub")}
                />
                <StatCard
                  label={t("gbTotalAssetsLabel")}
                  value={money(gbAssetSplit.total)}
                  sub={t("gbTotalAssetsSub")}
                />
              </>
            ) : country === "CA" ? (
              <>
                <StatCard label={t("caLiquidAssetsLabel")} value={money(caAssetSplit.liquid)} sub={t("caLiquidAssetsSub")} tone="good" />
                <StatCard
                  label={t("caRestrictedAssetsLabel")}
                  value={money(caAssetSplit.restricted)}
                  sub={t("caRestrictedAssetsSub", { age: rules.investment.rrifConversionAge })}
                />
                <StatCard label={t("caTaxAdvantagedLabel")} value={money(caAssetSplit.taxAdvantaged)} sub={t("caTaxAdvantagedSub")} />
                <StatCard label={t("caTotalAssetsLabel")} value={money(caAssetSplit.total)} sub={t("caTotalAssetsSub")} />
              </>
            ) : country === "AU" ? (
              <>
                <StatCard label={t("auLiquidAssetsLabel")} value={money(auAssetSplit.liquid)} sub={t("auLiquidAssetsSub", { age: rules.investment.preservationAge })} tone="good" />
                <StatCard
                  label={t("auRestrictedAssetsLabel")}
                  value={money(auAssetSplit.restricted)}
                  sub={auAssetSplit.isAccessibleAge
                    ? t("auRestrictedAssetsSubAccessible", { age: rules.investment.preservationAge })
                    : t("auRestrictedAssetsSubLocked", { age: rules.investment.preservationAge })}
                />
                <StatCard label={t("auTaxAdvantagedLabel")} value={money(auAssetSplit.taxAdvantaged)} sub={t("auTaxAdvantagedSub")} />
                <StatCard label={t("auTotalAssetsLabel")} value={money(auAssetSplit.total)} sub={t("auTotalAssetsSub")} />
              </>
            ) : (
              <>
                <StatCard label={t("statNisaAssetsLabel")} value={money(effectiveCurrentAssets)} sub={t("statNisaAssetsSub")} />
                <StatCard label={t("statIdecoAssetsLabel")} value={money(inputs.ideco.currentValue)} sub={t("statIdecoAssetsSub")} />
              </>
            )}
          </div>
          {country === "US" && (
            <div className="note" style={{ marginBottom: 14, marginTop: -6 }}>
              <Info size={13} />
              <span>{t("usEarlyWithdrawalWarning")}</span>
            </div>
          )}
          <div className="stat-grid" style={{ marginBottom: 14 }}>
            <StatCard
              label={t("statSpendableAssetsLabel")}
              value={money((netWorthYearly[0]?.spendableNetWorth) ?? (netWorthFinal - idecoSim.finalValue))}
              sub={t("statSpendableAssetsSub")}
              tone="good"
            />
            <StatCard
              label={t("statRetirementOnlyAssetsLabel")}
              value={money((netWorthYearly[0]?.idecoLockedValue) ?? idecoSim.finalValue)}
              sub={t("statRetirementLockedSub")}
            />
          </div>
          {country === "JP" ? (
            <>
              <div className="stat-grid" style={{ marginBottom: 10 }}>
                <StatCard
                  label={t("statTsumitateRemainingLabel")}
                  value={money(remainingTsumitate)}
                  sub={t("statTsumitateRemainingSub")}
                  tone={remainingTsumitate <= 0 ? "danger" : "good"}
                />
                <StatCard
                  label={t("statGrowthRemainingLabel")}
                  value={money(remainingGrowth)}
                  sub={t("statGrowthRemainingSub", { used: money(computedGrowthUsed) })}
                  tone={remainingGrowth <= 0 ? "danger" : "good"}
                />
                <StatCard
                  label={t("statTotalRemainingLabel")}
                  value={money(remainingTotal)}
                  sub={t("statTotalRemainingSub", { used: money(computedTsumitateUsed + computedGrowthUsed) })}
                  tone={remainingTotal <= 0 ? "danger" : "good"}
                />
              </div>
              <div className="stat-grid" style={{ marginBottom: 14 }}>
                <StatCard
                  label={t("statTsumitateOverageLabel")}
                  value={money(tsumitateOverage)}
                  sub={tsumitateOverage > 0 ? t("statOverageOverSub") : t("statOverageWithinSub")}
                  tone={tsumitateOverage > 0 ? "danger" : "good"}
                />
                <StatCard
                  label={t("statGrowthOverageLabel")}
                  value={money(growthOverage)}
                  sub={growthOverage > 0 ? t("statOverageOverSub") : t("statOverageWithinSub")}
                  tone={growthOverage > 0 ? "danger" : "good"}
                />
                <StatCard
                  label={t("statTotalOverageLabel")}
                  value={money(totalOverage)}
                  sub={totalOverage > 0 ? t("statOverageOverSub") : t("statOverageWithinSub")}
                  tone={totalOverage > 0 ? "danger" : "good"}
                />
              </div>
              {(growthOverage > 0 || totalOverage > 0) && (
                <div className="note" style={{ borderLeftColor: "#C2694F", marginBottom: 22 }}>
                  <Info size={13} style={{ color: "#C2694F" }} />
                  <span>
                    {t("overageWarningIntro")}
                    {growthOverage > 0 && ` ${t("growthOverageDetail", { amount: money(growthOverage) })}`}
                    {totalOverage > 0 && ` ${t("totalOverageDetail", { amount: money(totalOverage) })}`}
                    {t("overageWarningOutro")}
                  </span>
                </div>
              )}

              <div className="chart-frame" style={{ marginBottom: 22 }}>
                <div className="chart-label">{t("nisaBreakdownChartTitle")}</div>
                <AllocationCharts items={nisaFrameAllocationItems} height={160} />
              </div>

              <div className="stat-grid" style={{ marginBottom: 14 }}>
                <StatCard
                  label={t("statTsumitateAnnualRemainingLabel")}
                  value={money(tsumitateAnnualRemaining)}
                  sub={
                    tsumitateAnnualOverage > 0
                      ? t("annualOverPaceNote", { amount: money(tsumitateAnnualOverage) })
                      : t("monthlyPaceNote", { monthly: money(currentTsumitateMonthly), annual: money(tsumitateAnnualPace) })
                  }
                  tone={tsumitateAnnualOverage > 0 ? "danger" : "good"}
                />
                <StatCard
                  label={t("statGrowthAnnualRemainingLabel")}
                  value={money(growthAnnualRemaining)}
                  sub={
                    growthAnnualOverage > 0
                      ? t("annualOverPaceNoteGrowth", { amount: money(growthAnnualOverage) })
                      : t("monthlyPaceNote", { monthly: money(currentGrowthMonthly), annual: money(growthAnnualPace) })
                  }
                  tone={growthAnnualOverage > 0 ? "danger" : "good"}
                />
              </div>
            </>
          ) : country === "US" && rules.investment.implemented ? (
            <div className="stat-grid" style={{ marginBottom: 22 }}>
              <StatCard
                label={t("us401kLabel")}
                value={money(rules.investment.get401kEmployeeLimit(effectiveCurrentAge) - (Number(inputs.usInvestment.k401.annualContribution) || 0))}
                sub={t("usRemainingOfLimitSub")}
              />
              <StatCard
                label={`${t("usTraditionalIraLabel")} + ${t("usRothIraLabel")}`}
                value={money(Math.max(0, rules.investment.getIraContributionLimit(effectiveCurrentAge) - ((Number(inputs.usInvestment.traditionalIra.annualContribution) || 0) + (Number(inputs.usInvestment.rothIra.annualContribution) || 0))))}
                sub={t("usIraSharedRemainingSub")}
              />
              <StatCard
                label={t("usBrokerageLabel")}
                value={money(Number(inputs.usInvestment.brokerage.currentValue) || 0)}
                sub={t("usBrokerageNoLimitNote")}
              />
            </div>
          ) : country === "GB" && rules.investment.implemented ? (
            <div className="stat-grid" style={{ marginBottom: 22 }}>
              <StatCard
                label={t("gbIsaRemainingLabel")}
                value={money(Math.max(0, rules.investment.getIsaRemaining(inputs.gbInvestment)))}
                sub={t("gbIsaRemainingSub", { amount: money(rules.investment.getIsaAnnualAllowance()) })}
                tone={rules.investment.getIsaRemaining(inputs.gbInvestment) < 0 ? "danger" : "good"}
              />
              <StatCard
                label={t("gbPensionRemainingLabel")}
                value={money(Math.max(0, gbPensionAnnualAllowance - gbPensionContribution))}
                sub={t("gbPensionRemainingSub", { amount: money(gbPensionAnnualAllowance) })}
                tone={(gbPensionAnnualAllowance - gbPensionContribution) < 0 ? "danger" : "good"}
              />
              <StatCard
                label={t("gbTotalTaxLabel")}
                value={money(gbTotalTax)}
                sub={t("gbTotalTaxSub")}
                tone="danger"
              />
            </div>
          ) : country === "CA" && rules.investment.implemented ? (
            <div className="stat-grid" style={{ marginBottom: 22 }}>
              <StatCard
                label={t("caTfsaRemainingLabel")}
                value={money(Math.max(0, rules.investment.getTfsaRemaining(inputs.caInvestment)))}
                sub={t("caTfsaRemainingSub", { amount: money(rules.investment.getTfsaAnnualLimit()) })}
                tone={rules.investment.getTfsaRemaining(inputs.caInvestment) < 0 ? "danger" : "good"}
              />
              <StatCard
                label={t("caRrspRemainingLabel")}
                value={money(Math.max(0, caRrspRoom - (Number(inputs.caInvestment.rrsp.annualContribution) || 0)))}
                sub={t("caRrspRoomSub", {
                  pct: Number((rules.investment.limits.rrspIncomePercent * 100).toFixed(2)),
                  cap: money(rules.investment.limits.rrspAnnualDollarLimit),
                })}
                tone={(caRrspRoom - (Number(inputs.caInvestment.rrsp.annualContribution) || 0)) < 0 ? "danger" : "good"}
              />
              <StatCard label={t("caTotalTaxLabel")} value={money(caTotalTax)} sub={t("caTotalTaxSub")} tone="danger" />
            </div>
          ) : country === "AU" && rules.investment.implemented ? (
            <div className="stat-grid" style={{ marginBottom: 22 }}>
              <StatCard
                label={t("auConcessionalRemainingLabel")}
                value={money(Math.max(0, auConcessionalRemaining))}
                sub={t("auConcessionalCapSub", { amount: money(rules.investment.getConcessionalCap()) })}
                tone={auConcessionalRemaining < 0 ? "danger" : "good"}
              />
              <StatCard
                label={t("auAgePensionAnnualLabel")}
                value={money(auAgePensionAnnual)}
                sub={t("auAgePensionAnnualSub")}
              />
              <StatCard label={t("auTotalTaxLabel")} value={money(auTotalTax)} sub={t("auTotalTaxSub")} tone="danger" />
            </div>
          ) : (
            <div className="note" style={{ borderLeftColor: "#D9A54F", marginBottom: 22 }}>
              <Info size={13} style={{ color: "#D9A54F" }} />
              <span>{t(rules.labels.investmentNote, { country: countryDisplayName })}</span>
            </div>
          )}

          <div className="stat-grid">
            <StatCard label={t("statAssetsAtRetireLabel", { age: t("ageYears", { age: inputs.retireAge }) })} value={money(sim.assetsAtRetire)} sub={t("statAssetsAtRetireSub")} />
            <StatCard
              label={t("statNetWorthFinalLabel", { age: t("ageYears", { age: inputs.deathAge }) })}
              value={money(netWorthFinal)}
              sub={netInheritanceGap >= 0 ? t("statInheritanceGapPositive", { amount: money(netInheritanceGap) }) : t("statInheritanceGapNegative", { amount: money(netInheritanceGap) })}
              tone={netInheritanceGap >= 0 ? "good" : "danger"}
            />
            <StatCard
              label={t("statMonthlyGapLabel")}
              value={`${netMonthlyGap >= 0 ? "" : "+"}${money(-netMonthlyGap)}`}
              sub={netMonthlyGap >= 0 ? t("statMonthlyGapShortfallSub") : t("statMonthlyGapCoveredSub")}
              tone={netMonthlyGap > 0 ? "danger" : "good"}
            />
            <StatCard
              label={t("statSustainabilityLabel")}
              value={integrated.depletionAge ? t("statDepletionAtAge", { age: Math.round(integrated.depletionAge) }) : t("statNeverDepletes")}
              sub={integrated.depletionAge ? t("statDepletionSub") : t("statSustainableSub")}
              tone={integrated.depletionAge ? "danger" : "good"}
            />
          </div>

          {country === "JP" && (
            <div className="stat-grid" style={{ marginBottom: 22 }}>
              <StatCard
                label={t("statTsumitateLifetimeUsageLabel")}
                value={money(sim.tsumitateCum)}
                sub={t("statOfLifetimeLimit", { amount: money(NISA_LIMITS.totalLifetime) })}
              />
              <StatCard
                label={t("statGrowthLifetimeUsageLabel")}
                value={`${money(sim.growthCum)} / ${money(NISA_LIMITS.growthLifetime)}`}
                sub={sim.growthMaxedAge ? t("statMaxedAtAge", { age: Math.round(sim.growthMaxedAge) }) : t("statNotYetMaxed")}
                tone={sim.growthMaxedAge ? "danger" : "good"}
              />
              <StatCard
                label={t("statTotalLifetimeUsageLabel")}
                value={`${money(sim.tsumitateCum + sim.growthCum)} / ${money(NISA_LIMITS.totalLifetime)}`}
                sub={sim.totalMaxedAge ? t("statUsedUpAtAge", { age: Math.round(sim.totalMaxedAge) }) : t("statLifetimeRoomSub")}
                tone={sim.totalMaxedAge ? "danger" : "good"}
              />
            </div>
          )}

          <div className="stat-grid" style={{ marginBottom: 22 }}>
            <StatCard
              label={t("statGoldAtTargetLabel", { age: formatAge(inputs.gold.accumulateUntilAge) })}
              value={money(goldSim.valueAtTarget)}
              sub={t("statGoldGramsEstimateSub", { grams: goldSim.yearly.find((y) => y.age >= inputs.gold.accumulateUntilAge)?.grams.toFixed(1) ?? goldSim.finalGrams.toFixed(1) })}
            />
            <StatCard
              label={t("statBankTotalNowLabel")}
              value={money(bankSim.totalNow)}
              sub={inputs.banks.length ? t("statBankCountSub", { count: inputs.banks.length }) : t("statNoBankAccountsSub")}
            />
            <StatCard
              label={t("statBankAtRetireLabel", { age: t("ageYears", { age: inputs.retireAge }) })}
              value={money(bankSim.totalAtRetire)}
              sub={t("statBankAtRetireSub")}
            />
            <StatCard
              label={t("statStockValueNowLabel")}
              value={money(stockTotalNow)}
              sub={t("statStockHoldingsCountSub", { count: watchlist.filter((w) => w.value > 0).length })}
            />
            <StatCard
              label={t("statLoanBalanceNowLabel")}
              value={money(loanSim.totalNow)}
              sub={inputs.loans.length ? t("statLoanCountSub", { count: inputs.loans.length }) : t("statNoLoansSub")}
              tone={loanSim.totalNow > 0 ? "danger" : "good"}
            />
            <StatCard
              label={t("statInsurancePaidLabel")}
              value={money(insuranceSim.totalFinal)}
              sub={inputs.insurancePolicies.length ? t("statInsuranceCountSub", { count: inputs.insurancePolicies.length }) : t("statNoInsuranceSub")}
              tone={insuranceSim.totalFinal > 0 ? "danger" : "good"}
            />
            <StatCard
              label={t("statPrivatePensionFinalLabel")}
              value={money(pensionSim.totalFinal)}
              sub={inputs.privatePensionPlans.length ? t("statPensionPlanCountSub", { count: inputs.privatePensionPlans.length }) : t("statNotRegisteredSub")}
              tone="good"
            />
          </div>

          {/* 診断コメント：グラフを見る前に、いまの状況が良いのか悪いのかが一目で分かるようにする。
              色だけに頼らず、アイコン（🟢🟡🔴✅⚠️💰💡）と文章の両方で伝える。 */}
          <div className="section-block" id="section-advice" style={{ borderColor: adviceBorderColor }}>
            <div className="field-label-row">
              <span className="field-label">{t("adviceCardTitle")}</span>
            </div>
            {!adviceReady ? (
              <div className="guide-text" style={{ margin: "8px 0" }}>{t("adviceNotReady")}</div>
            ) : advice.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  margin: a.id === "overall" ? "6px 0 12px" : "8px 0",
                  flexWrap: "wrap",
                }}
              >
                <span aria-hidden="true" style={{ fontSize: 16, lineHeight: "20px" }}>{a.icon}</span>
                {/* minWidth:0 と flexWrap で、スマホの狭い幅でも横にはみ出さず折り返す */}
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <div className="field-label" style={{ fontWeight: a.id === "overall" ? 700 : 600 }}>
                    {t(a.titleKey)}
                    {a.id === "overall" && `：${t(a.valueKey)}`}
                  </div>
                  <div className="guide-text" style={{ marginTop: 2 }}>
                    {t(a.messageKey, a.vars)}
                  </div>
                </div>
              </div>
            ))}
            {adviceReady && <div className="guide-text" style={{ marginTop: 4 }}>{t("adviceNote")}</div>}
            {/* 【名目値の注記】すべての金額は現在の物価のままで計算している（インフレ非考慮）。
                計算は一切変えず、誤解を避けるための表示のみ。 */}
            <div className="note" style={{ marginTop: 8 }}>
              <Info size={13} />
              <span>{t("nominalValueNote")}</span>
            </div>
          </div>

          {/* シナリオ比較カード（総資産推移グラフの上）。比較中だけ結果が表示される。 */}
          <div id="section-comparison">
          <ScenarioComparisonCard
            active={!!comparisonDraft}
            draft={comparisonDraft}
            result={comparison}
            multipliers={CONTRIBUTION_MULTIPLIERS}
            onStart={startComparison}
            onEnd={endComparison}
            onChange={setComparisonDraft}
          />
          </div>

          <SectionGuide guide={t("netWorthChartGuide")} />
          {/* 【名目値の注記】グラフの数字を「将来のその金額の価値」と誤解されないようにする。 */}
          <div className="note" style={{ marginBottom: 8 }}>
            <Info size={13} />
            <span>{t("nominalValueNote")}</span>
          </div>
          <div className="chart-frame" id="section-networth-chart">
            {/* 【修正】年齢に端数があると「57.66478859472867歳」と表示されていたため、整数に丸める。 */}
            <div className="chart-label">{t("netWorthChartTitle", { currentAge: t("ageYears", { age: Math.round(effectiveCurrentAge) }), deathAge: t("ageYears", { age: Math.round(inputs.deathAge) }) })}</div>
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={netWorthChartData} margin={{ top: 10, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#2A363C" strokeDasharray="3 3" />
                <XAxis dataKey="age" stroke="#7C8A90" fontSize={11} tickFormatter={(a) => `${a}`} />
                <YAxis stroke="#7C8A90" fontSize={11} tickFormatter={(v) => money(v)} width={64} />
                <Tooltip
                  // 背景を完全に透明にし、色つきの文字だけをグラフの上に浮かせる。
                  // 文字が背景の帯に埋もれないよう、黒い縁取り（textShadow）で可読性を確保する。
                  contentStyle={{ background: "transparent", border: "none", boxShadow: "none", fontSize: 12 }}
                  wrapperStyle={{ zIndex: 20 }}
                  itemStyle={{ textShadow: "0 0 3px #000, 0 0 3px #000, 0 0 2px #000" }}
                  labelStyle={{ textShadow: "0 0 3px #000, 0 0 3px #000, 0 0 2px #000" }}
                  labelFormatter={(a) => t("ageYears", { age: a })}
                  formatter={(v, n) => [money(v), n]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine x={inputs.retireAge} stroke="#D9A54F" strokeDasharray="4 4" label={{ value: t("retirementMarkerLabel"), position: "top", fill: "#D9A54F", fontSize: 11 }} />
                {inputs.lumpSums.map((entry, i) => (
                  <ReferenceLine key={i} x={entry.age} stroke="#8FBF7F" strokeDasharray="2 3" label={{ value: t("lumpSumMarkerLabel"), position: "insideTop", fill: "#8FBF7F", fontSize: 10 }} />
                ))}
                {integrated.depletionAge && (
                  <ReferenceLine x={Math.round(integrated.depletionAge)} stroke="#C2694F" strokeDasharray="4 4" label={{ value: t("depletionMarkerLabel"), position: "top", fill: "#C2694F", fontSize: 11 }} />
                )}
                {/* 【全面改修】帯（Area）はすべて統合エンジンの出力キーを使う。
                    投資口座は国ごとに名称だけ変わり、値は investmentValue に統一されているため、
                    「帯の最上部 − 借入残高 ＝ 純資産線」が常に数学的に成立する。 */}
                <Area type="monotone" dataKey="investmentValue" name={t(investmentLegendKey)} stackId="net" stroke="#4FA8D8" fill="rgba(79,168,216,0.35)" strokeWidth={1.5} legendType="rect" />
                <Area type="monotone" dataKey="goldValue" name={t("legendGoldAssets")} stackId="net" stroke="#D9A54F" fill="rgba(217,165,79,0.35)" strokeWidth={1.5} legendType="rect" />
                <Area type="monotone" dataKey="bankValue" name={t("legendBankDeposits")} stackId="net" stroke="#8FBF7F" fill="rgba(143,191,127,0.35)" strokeWidth={1.5} legendType="rect" />
                <Area type="monotone" dataKey="stockValue" name={t("legendStocks")} stackId="net" stroke="#B08FD6" fill="rgba(176,143,214,0.35)" strokeWidth={1.5} legendType="rect" />
                <Area type="monotone" dataKey="pensionValue" name={t("legendPrivatePension")} stackId="net" stroke="#6FA88A" fill="rgba(111,168,138,0.35)" strokeWidth={1.5} legendType="rect" />
                {country === "JP" && (
                  <Area type="monotone" dataKey="idecoLockedValue" name={t("legendIdecoAssets")} stackId="net" stroke="#D68FB0" fill="rgba(214,143,176,0.35)" strokeWidth={1.5} legendType="rect" />
                )}
                <Line type="monotone" dataKey="netWorth" name={t("legendNetWorth")} stroke="#F2F5F6" strokeWidth={2} dot={false} />
                {/* 比較プランの純資産線（比較中のみ）。既存の線・面グラフには手を加えない。 */}
                {comparison && (
                  <Line
                    type="monotone" dataKey="comparisonNetWorth" name={t("legendComparisonNetWorth")}
                    stroke="#4FA8D8" strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls
                  />
                )}
                {comparison && comparisonDraft && comparisonDraft.retireAge !== inputs.retireAge && (
                  <ReferenceLine
                    x={Math.round(comparisonDraft.retireAge)} stroke="#4FA8D8" strokeDasharray="4 4"
                    label={{ value: t("scenarioCompareRetireMarker"), position: "insideTop", fill: "#4FA8D8", fontSize: 10 }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="note" style={{ marginBottom: 22 }}>
            <Info size={13} />
            <span>{t("netWorthChartNote")}</span>
          </div>

          {/* 取り崩し順序（実装と必ず一致）と、海外口座の引出時課税 */}
          <DrawdownOrderPanel order={drawdownOrder} accountsByCategory={drawdownAccountsByCategory} />
          <WithdrawalTaxPanel accounts={withdrawalTaxAccounts} onUpdateAccount={updateWithdrawalTaxAccount} />

          {sim.lumpTruncations.length > 0 && (
            <div className="note" style={{ borderLeftColor: "#C2694F", marginBottom: 22 }}>
              <Info size={13} style={{ color: "#C2694F" }} />
              <span>
                {t("lumpTruncationIntro")}
                {sim.lumpTruncations.map((trunc, i) => (
                  <span key={i}>{i > 0 && t("listSeparator")}{t("ageYears", { age: trunc.age })}{t("lumpTruncationAt", { amount: money(trunc.shortfall) })}</span>
                ))}
                {t("lumpTruncationOutro")}
              </span>
            </div>
          )}

          <div className="two-col">
            <div className="chart-frame">
              <div className="chart-label">
                {country === "US"
                  ? t("usAccountBreakdownChartTitle", { age: t("ageYears", { age: inputs.retireAge }) })
                  : country === "GB"
                    ? t("gbAccountBreakdownChartTitle", { age: t("ageYears", { age: inputs.retireAge }) })
                    : country === "CA"
                      ? t("caAccountBreakdownChartTitle", { age: t("ageYears", { age: inputs.retireAge }) })
                      : country === "AU"
                        ? t("auAccountBreakdownChartTitle", { age: t("ageYears", { age: inputs.retireAge }) })
                        : t("fundBreakdownChartTitle", { age: t("ageYears", { age: inputs.retireAge }) })}
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={country === "US" ? usAccountBreakdownAtRetire : country === "GB" ? gbAccountBreakdownAtRetire : country === "CA" ? caAccountBreakdownAtRetire : country === "AU" ? auAccountBreakdownAtRetire : fundBreakdownAtRetire} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke="#2A363C" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" stroke="#7C8A90" fontSize={11} tickFormatter={(v) => money(v)} />
                  <YAxis type="category" dataKey="name" stroke="#7C8A90" fontSize={11} width={90} />
                  <Tooltip contentStyle={{ background: "transparent", border: "none", boxShadow: "none", fontSize: 12 }} itemStyle={{ textShadow: "0 0 3px #000, 0 0 3px #000, 0 0 2px #000" }} labelStyle={{ textShadow: "0 0 3px #000, 0 0 3px #000, 0 0 2px #000" }} formatter={(v) => money(v)} />
                  <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                    {(country === "US" ? usAccountBreakdownAtRetire : country === "GB" ? gbAccountBreakdownAtRetire : country === "CA" ? caAccountBreakdownAtRetire : country === "AU" ? auAccountBreakdownAtRetire : fundBreakdownAtRetire).map((f, i) => (
                      <Cell key={i} fill={f.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {country === "US" && (
                <div className="note" style={{ marginTop: 8 }}>
                  <Info size={13} />
                  <span>{t("usAccountBreakdownNote")}</span>
                </div>
              )}
              {country === "GB" && (
                <div className="note" style={{ marginTop: 8 }}>
                  <Info size={13} />
                  <span>{t("gbAccountBreakdownNote")}</span>
                </div>
              )}
              {country === "CA" && (
                <div className="note" style={{ marginTop: 8 }}>
                  <Info size={13} />
                  <span>{t("caAccountBreakdownNote")}</span>
                </div>
              )}
              {country === "AU" && (
                <div className="note" style={{ marginTop: 8 }}>
                  <Info size={13} />
                  <span>{t("auAccountBreakdownNote")}</span>
                </div>
              )}
            </div>

            <div className="chart-frame" id="section-stock" style={{ padding: "16px 16px 18px" }}>
              <div className="chart-label" style={{ padding: 0, marginBottom: 10 }}>{t("stockWatchlistTitle")}</div>
              <table className="watchlist">
                <thead>
                  <tr><th>{t("colName")}</th><th>{t("sectorCol")}</th><th>{t("sharesCol")}</th><th>{t("holdingValueCol")}</th><th></th></tr>
                </thead>
                <tbody>
                  {watchlist.map((s, i) => (
                    <tr key={i}>
                      <td>{s.name}</td>
                      <td style={{ color: "#7C8A90" }}>{s.sector}</td>
                      <td style={{ width: 64 }}>
                        <input
                          type="number" value={s.shares} className="mono inline-num"
                          onChange={(e) => updateStockField(i, "shares", Number(e.target.value))}
                        />
                      </td>
                      <td style={{ width: 96 }}>
                        <MoneyInput
                          value={s.value} className="mono inline-num"
                          onChange={(v) => updateStockField(i, "value", v === "" ? 0 : v)}
                        />
                      </td>
                      <td style={{ width: 24 }}>
                        <button className="del-btn" onClick={() => removeStock(i)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="add-row">
                <input placeholder={t("holdingNamePlaceholder")} value={newStock.name} onChange={(e) => setNewStock((p) => ({ ...p, name: e.target.value }))} />
                <input placeholder={t("sectorCol")} value={newStock.sector} onChange={(e) => setNewStock((p) => ({ ...p, sector: e.target.value }))} />
                <button className="add-btn" onClick={addStock}><Plus size={15} /></button>
              </div>
              <div className="stat-sub" style={{ marginTop: 10 }}>{t("stockCurrentTotalLabel")}：<span className="mono">{money(stockTotalNow)}</span></div>
              <Field
                label={`${t("stockReturnLabel", { age: t("ageYears", { age: inputs.deathAge }) })}${inputs.stockReturnPctAuto ? t("autoGuessedFromHoldingsSuffix") : ""}`} unit="%" step={0.5}
                value={effectiveStockReturnPct} onChange={(v) => update({ stockReturnPct: v, stockReturnPctAuto: false })}
              />
              {!inputs.stockReturnPctAuto && (
                <div className="note" style={{ marginTop: -8 }}>
                  <Info size={13} />
                  <span>
                    {t("manualOverrideNote")}
                    <span
                      style={{ color: "#4FA8D8", textDecoration: "underline", cursor: "pointer", marginLeft: 4 }}
                      onClick={() => update({ stockReturnPctAuto: true })}
                    >
                      {t("revertToAutoLink")}
                    </span>
                  </span>
                </div>
              )}
              {stockAllocationItems.length > 0 && (
                <>
                  <div className="chart-label" style={{ padding: 0, margin: "12px 0 4px" }}>{t("stockAllocationChartLabel")}</div>
                  <AllocationCharts items={stockAllocationItems} height={160} />
                </>
              )}
            </div>
          </div>

          {inputs.loans.length > 0 && (
            <div className="chart-frame" style={{ marginTop: 16 }}>
              <div className="chart-label">{t("loanBreakdownChartTitle", { retireAge: t("ageYears", { age: inputs.retireAge }), deathAge: t("ageYears", { age: inputs.deathAge }) })}</div>
              <ResponsiveContainer width="100%" height={Math.max(180, inputs.loans.length * 46)}>
                <BarChart data={loanBreakdownByAge} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke="#2A363C" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" stroke="#7C8A90" fontSize={11} tickFormatter={(v) => money(v)} />
                  <YAxis type="category" dataKey="name" stroke="#7C8A90" fontSize={11} width={90} />
                  <Tooltip contentStyle={{ background: "transparent", border: "none", boxShadow: "none", fontSize: 12 }} itemStyle={{ textShadow: "0 0 3px #000, 0 0 3px #000, 0 0 2px #000" }} labelStyle={{ textShadow: "0 0 3px #000, 0 0 3px #000, 0 0 2px #000" }} formatter={(v) => money(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey={t("currentLabelShort")} fill="#C2694F" radius={[0, 2, 2, 0]} />
                  <Bar dataKey={t("ageYears", { age: inputs.retireAge })} fill="#D9877A" radius={[0, 2, 2, 0]} />
                  <Bar dataKey={t("ageYears", { age: inputs.deathAge })} fill="#E6B0A6" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {inputs.banks.length > 0 && (
            <div className="chart-frame" style={{ marginTop: 16 }}>
              <div className="chart-label">{t("bankBreakdownChartTitle", { retireAge: t("ageYears", { age: inputs.retireAge }), deathAge: t("ageYears", { age: inputs.deathAge }) })}</div>
              <ResponsiveContainer width="100%" height={Math.max(180, inputs.banks.length * 46)}>
                <BarChart data={bankBreakdownByAge} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke="#2A363C" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" stroke="#7C8A90" fontSize={11} tickFormatter={(v) => money(v)} />
                  <YAxis type="category" dataKey="name" stroke="#7C8A90" fontSize={11} width={90} />
                  <Tooltip contentStyle={{ background: "transparent", border: "none", boxShadow: "none", fontSize: 12 }} itemStyle={{ textShadow: "0 0 3px #000, 0 0 3px #000, 0 0 2px #000" }} labelStyle={{ textShadow: "0 0 3px #000, 0 0 3px #000, 0 0 2px #000" }} formatter={(v) => money(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey={t("currentLabelShort")} fill="#4FA8D8" radius={[0, 2, 2, 0]} />
                  <Bar dataKey={t("ageYears", { age: inputs.retireAge })} fill="#D9A54F" radius={[0, 2, 2, 0]} />
                  <Bar dataKey={t("ageYears", { age: inputs.deathAge })} fill="#8FBF7F" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="footer-note">
        {t("footerDisclaimer")}
      </div>

      {/* 画面の一番下のクレジット表記（4行）。
          文字列は {"..."} で囲む。囲まないと importIntegrity.test.js が JSX の地の文中の
          Kunihiko / Developed / Version を「未定義の識別子」と誤検出して落ちるため。 */}
      <div className="footer-credit">
        <div>{"© 2026 Kunihiko Hioki"}</div>
        <div>{"Developed by Kunihiko Hioki"}</div>
        <div>{"Version 1.0.2"}</div>
        <div>
          <a className="footer-mail" href="mailto:pdr.gifu@gmail.com">{"✉️ pdr.gifu@gmail.com"}</a>
        </div>
      </div>
    </div>

    {/* 画面右下に常駐する「トップへ戻る」ボタン。
        着地先はアプリ紹介ではなく入力フォームの先頭（#simulator）。

        【なぜ Portal で body 直下に描くか】
        .app には overflow-x: hidden があり、祖先に overflow や transform が
        あると、その内側の position: fixed は「画面」ではなく祖先の枠を基準にして
        しまい、固定されずに一緒にスクロールして流れる。
        createPortal で document.body の直下に出すことで、いかなる祖先の
        overflow / transform の影響も受けず、確実に画面へ固定する。 */}
    {typeof document !== "undefined" && createPortal(
      <div className="quicknav-wrap no-print">
        {/* 各入力項目・個別株・総資産グラフへ飛ぶ小さなボタン群。
            背景は透明、文字はアクセント色。指で押せる最小サイズを確保しつつ、
            画面になるべく被らないよう右端に縦並びで置く。 */}
        <nav className="quicknav" aria-label={t("quickNavLabel")}>
          {quickNavItems.map(({ anchor, short }) => (
            <button
              key={anchor}
              type="button"
              className="quicknav-btn"
              onClick={() => {
                const el = document.getElementById(anchor);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {short}
            </button>
          ))}
        </nav>
      </div>,
      document.body
    )}
    </LocaleContext.Provider>
  );
}
