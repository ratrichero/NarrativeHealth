// One-off check (not committed): render the upgraded viral template with
// representative metrics to verify the rich 3-sentence hook output.
import { generateContent, DEFAULT_CONTENT_CONFIG } from "../src/lib/square/content-generator";
import type { SquareContentBrief } from "../src/lib/square/opportunity-engine";

const brief: SquareContentBrief = {
  opportunityId: 0,
  contentType: "text",
  text: "",
  cashtags: ["$FET"],
  leadingCoinSymbols: ["FET"],
  dataAsOf: "2026-09-27",
  entry: { low: 0.72, high: 0.78 },
  takeProfits: [{ level: 0.9, label: "TP1" }, { level: 1.02, label: "TP2" }],
  stopLoss: { level: 0.66, label: "SL" },
  invalidation: "Setup invalidates if price breaks above 0.8020 with sustained strength.",
  whyNowFacts: ["Health declined in the latest refresh — trend and volume softening together."],
  direction: "SHORT",
  hookLine: "$FET strength is fading — trend and momentum are losing ground, signaling a bearish shift.",
  chartCta: "📈 Chart: tap `$FET` above or open binance.com/en/trade/FET_USDT",
  metrics: {
    currentPrice: 0.7512,
    tp1GainPct: 20,
    slRiskPct: 12,
    riskRewardRatio: 1.7,
    trendScore: 38,
    volumeScore: 44,
    momentumScore: 41,
    rsi14: 74.2,
    fundingRate: 0.0061,
    priceVsEma20Pct: 2.3,
    volume24h: 431_600_000,
    coinsUp: 1,
    coinsTotal: 8,
  },
  priceMap: "SL 0.660000  ━  ▓ SHORT 0.720000–0.780000 ▓  ━  → TP1 0.900000  ━  → TP2 1.020000",
};

async function main() {
  const out = await generateContent(brief, { ...DEFAULT_CONTENT_CONFIG, useLLM: false });
  console.log("llmUsed:", out.llmUsed, "| templateVersion:", out.templateVersion);
  console.log("chars:", out.text.length);
  const sentences = out.text
    .slice(0, out.text.indexOf("Direction:"))
    .split(/[.!?]\s/)
    .filter((s) => s.trim().length > 0).length;
  console.log("hook sentences (before Direction:):", sentences);
  console.log("---");
  console.log(out.text);
}
main();
