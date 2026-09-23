/**
 * SQ-LLM-DIAG 2: Reproduce the full generateContent() path with a realistic
 * brief, with [SQ-LLM] warnings visible, to see the exact rejection reason.
 */
import "dotenv/config";

// 1. Capture [SQ-LLM] console warnings so we can report the true reason
const sqLlmLogs: string[] = [];
const origWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const line = args.map(String).join(" ");
  if (line.includes("[SQ-LLM]")) sqLlmLogs.push(line);
  origWarn(...args);
};

// 2. Build a realistic NARRATIVE_SETUP brief (mirrors opportunity-engine output)
const brief = {
  opportunityId: 1,
  type: "NARRATIVE_SETUP" as const,
  title: "$ETH — Health Signal",
  hookLine: "$ETH dropped 3.1 points on our health engine — a weakening signal worth understanding, not ignoring.",
  cashtags: ["$ETH"],
  leadingCoinSymbols: ["ETH"],
  leadingCoinRationales: ["Weakening health with elevated volatility."],
  whyNowFacts: [
    "Narrative health declined by 3.1 points in the latest refresh.",
    "1 leading coins are participating in this move.",
  ],
  invalidation: "Setup invalidates if price loses 2605.18 with sustained weakness.",
  entry: { low: 2701.21, high: 2797.23 },
  takeProfits: [
    { label: "TP1", level: 2941.27 },
    { label: "TP2", level: 3085.31 },
  ],
  stopLoss: { label: "SL", level: 2605.18 },
  metrics: {
    currentPrice: 2749.22,
    marketCap: 3.3e11,
    volume24h: 1.2e10,
    priceVsEma20Pct: -1.2,
    rsi14: 42.5,
    fundingRate: 0.0001,
    openInterest: 8.1e8,
    trendScore: 48,
    derivativeScore: 44,
    volumeScore: 52,
    momentumScore: 41,
    coinsUp: 1,
    coinsTotal: 4,
    riskRewardRatio: 2.1,
    tp1GainPct: 7,
    slRiskPct: 5,
  },
  text: "fallback text",
  chartCoin: "ETH",
  direction: "SHORT" as const,
  chartCta: "📈 Chart: tap `$ETH` above or open binance.com/en/trade/ETH_USDT",
};

async function main() {
  const { generateContent } = await import("../src/lib/square/content-generator");

  const result = await generateContent(brief as never);
  const text: string = result.text;

  console.log("\n═══ RESULT ═══");
  console.log(`llmUsed: ${result.llmUsed}`);
  console.log(`llmProvider: ${result.llmProvider ?? "—"}`);
  console.log(`text length: ${text.length} chars`);
  console.log("\n═══ FULL POST TEXT ═══");
  console.log(text);
  console.log("═══ END POST TEXT ═══");
  console.log("\n═══ [SQ-LLM] DIAGNOSTIC LOGS ═══");
  if (sqLlmLogs.length === 0) console.log("(none)");
  for (const l of sqLlmLogs) console.log(" ", l);

  // 3. Validator rules applied to the final text (informational)
  console.log("\n═══ VALIDATOR RULES ═══");
  const forbidden = /\b(BUY|SELL|ORDER|EXECUTE)\b/i; // SQ-DIR: LONG/SHORT allowed
  console.log(`length ≤ 1200 chars: ${text.length <= 1200 ? "pass" : "FAIL"} (${text.length})`);
  console.log(`no banned words: ${!forbidden.test(text) ? "pass" : "FAIL"}`);
  console.log(`cashtags present: ${brief.cashtags.every((t) => text.includes(t)) ? "pass" : "FAIL"}`);
  console.log(`direction line: ${/Direction:\s*(LONG|SHORT)/i.test(text) ? "pass" : "FAIL"}`);
  console.log(`chart pointer: ${text.includes("Chart:") || text.includes("binance.com/en/trade") ? "pass" : "FAIL"}`);
}

main();
