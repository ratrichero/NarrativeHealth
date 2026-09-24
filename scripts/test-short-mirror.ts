/**
 * SQ-DIR verify: reproduce the PENDLE contradiction case end-to-end AFTER the
 * direction-aware mirroring fix.
 *
 * Real-world inputs (from the flawed post): price 2.4955, scoreChange -4.1,
 * ATR ≈ 0.2218 (the old LONG-shaped post had entry 2.3846–2.6064 = price
 * ± 0.5·ATR). The engine now mirrors the geometry for SHORT:
 *   entry 2.3846–2.6064 (same band, ABOVE-price fade zone)
 *   TP1 = entryLow − 1.5·ATR ≈ 2.0519, TP2 = entryLow − 3·ATR ≈ 1.7192
 *   SL  = entryHigh + 1·ATR ≈ 2.8282
 * Run: npx tsx scripts/test-short-mirror.ts
 */
import "dotenv/config";

const PRICE = 2.4955;
const ATR = 0.2218;
const round = (n: number) => Math.round(n * 10000) / 10000;

const entryLow = round(PRICE - ATR * 0.5);
const entryHigh = round(PRICE + ATR * 0.5);
const tp1 = round(entryLow - ATR * 1.5);
const tp2 = round(entryLow - ATR * 3);
const sl = round(entryHigh + ATR * 1);

const entryMid = (entryLow + entryHigh) / 2;
const reward = entryMid - tp1;
const risk = sl - entryMid;
const rr = Math.round((reward / risk) * 10) / 10;
const tp1GainPct = Math.round((reward / entryMid) * 1000) / 10;
const slRiskPct = Math.round((risk / entryMid) * 1000) / 10;

console.log("═══ Expected mirrored SHORT geometry ═══");
console.log(`entry ${entryLow}–${entryHigh}  TP1 ${tp1}  TP2 ${tp2}  SL ${sl}`);
console.log(`R:R ${rr}:1  TP1 move -${tp1GainPct}%  stop move +${slRiskPct}%\n`);

// Opportunity exactly as extractNarrativeOpportunities now emits it.
const opp = {
  id: 7,
  type: "NARRATIVE_SETUP" as const,
  subjectId: 42,
  narrativeId: 5,
  coinSymbol: "PENDLE",
  score: 61,
  dataAsOf: "2026-09-24",
  dataQuality: "MEDIUM" as const,
  rationale: [
    "Narrative health declining (-4.1)",
    "Leader: $PENDLE",
    "8 coins in narrative",
  ],
  leadingCoinSymbols: ["PENDLE"],
  leadingCoinRationales: ["declining relative strength (-4.1)"],
  narrativeInvalidation: null,
  leaderCoinEntry: { low: entryLow, high: entryHigh },
  leaderCoinTakeProfits: [
    { level: tp1, label: "TP1 (1.5 ATR)" },
    { level: tp2, label: "TP2 (3 ATR)" },
  ],
  leaderCoinStopLoss: { level: sl, label: "SL (1 ATR)" },
  setupDirection: "SHORT" as const,
  metrics: {
    currentPrice: PRICE,
    marketCap: 4.1e8,
    volume24h: 0,
    priceVsEma20Pct: 2.1,
    priceVsEma50Pct: 6.4,
    rsi14: 57.1,
    fundingRate: -0.00012,
    openInterest: 3.2e7,
    trendScore: 100,
    derivativeScore: 58,
    volumeScore: 12,
    momentumScore: 46,
    coinsUp: 2,
    coinsTotal: 8,
    riskRewardRatio: rr,
    tp1GainPct,
    slRiskPct,
  },
  status: "QUALIFIED" as const,
};

async function main() {
  const { buildContentBrief, deriveDirection } = await import(
    "../src/lib/square/opportunity-engine"
  );
  const { generateContent } = await import("../src/lib/square/content-generator");

  const brief = buildContentBrief(opp as never);
  console.log("═══ Brief ═══");
  console.log(`direction: ${brief.direction} (deriveDirection: ${deriveDirection(opp as never)})`);
  console.log(`priceMap: ${brief.priceMap}`);
  console.log(`invalidation: ${brief.invalidation}\n`);

  console.log("═══ TEMPLATE PREVIEW (useLLM: false) ═══");
  const tpl = await generateContent(brief as never, {
    maxTextLength: 1200,
    includeDisclaimer: true,
    useLLM: false,
  });
  console.log(tpl.text);

  console.log("\n═══ LLM POST (real providers) ═══");
  const llm = await generateContent(brief as never, {
    maxTextLength: 1200,
    includeDisclaimer: true,
    useLLM: true,
  });
  console.log(`llmUsed: ${llm.llmUsed}  provider: ${llm.llmProvider ?? "—"}  len: ${llm.text.length}`);
  console.log(llm.text);

  // Consistency checks on whichever text won.
  const text = llm.text;
  const checks: [string, boolean][] = [
    ["Direction line present", /Direction:\s*SHORT/i.test(text)],
    ["No 'structural uptrend intact' under SHORT", !text.includes("structural uptrend intact")],
    ["Targets below price (no +18% upside framing)", !/Targets:.*\(\+1[0-9]%\)/.test(text)],
    ["No 'contrarian long signal' under SHORT", !text.includes("contrarian long signal")],
    ["Chart CTA present", text.includes("binance.com/en/trade/PENDLE")],
  ];
  console.log("\n═══ CONSISTENCY CHECKS ═══");
  let allPass = true;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "✅" : "❌"} ${name}`);
    if (!ok) allPass = false;
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
