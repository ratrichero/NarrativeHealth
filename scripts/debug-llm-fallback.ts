// One-off diagnostic (do not commit): call the real LLM provider chain and
// show exactly which tier answers, fails, or gets skipped. Never prints keys.
import "dotenv/config";
import { generateContent } from "../src/lib/square/content-generator";
import type { SquareContentBrief } from "../src/lib/square/opportunity-engine";

function mask(v?: string): string {
  if (!v) return "(missing)";
  return `${v.slice(0, 6)}…${v.slice(-4)} (len ${v.length})`;
}

console.log("=== Provider chain env check (values masked) ===");
console.log("OPENAI_API_KEY           :", mask(process.env.OPENAI_API_KEY));
console.log("OPENAI_BASE_URL          :", process.env.OPENAI_BASE_URL ?? "(default api.openai.com)");
console.log("MODEL_NAME               :", process.env.MODEL_NAME ?? "(default gpt-4o-mini)");
console.log("FALLBACK_OPENAI_API_KEY  :", mask(process.env.FALLBACK_OPENAI_API_KEY));
console.log("FALLBACK_OPENAI_BASE_URL :", process.env.FALLBACK_OPENAI_BASE_URL ?? "(default api.openai.com)");
console.log("FALLBACK_MODEL_NAME      :", process.env.FALLBACK_MODEL_NAME ?? "(missing → tier skipped)");
console.log("FALLBACK2_OPENAI_API_KEY :", mask(process.env.FALLBACK2_OPENAI_API_KEY));
console.log("FALLBACK2_OPENAI_BASE_URL:", process.env.FALLBACK2_OPENAI_BASE_URL ?? "(default api.openai.com)");
console.log("FALLBACK2_MODEL_NAME     :", process.env.FALLBACK2_MODEL_NAME ?? "(missing → tier skipped)");
console.log("SQUARE_LLM_ENABLED       :", process.env.SQUARE_LLM_ENABLED ?? "(unset)");
console.log("GOOGLE_AI_API_KEY        :", mask(process.env.GOOGLE_AI_API_KEY));
console.log("");

const brief: SquareContentBrief = {
  opportunityId: 0,
  contentType: "text",
  text: "probe",
  cashtags: ["$BTC"],
  leadingCoinSymbols: ["BTC"],
  dataAsOf: "2026-09-29",
  direction: "LONG",
  whyNowFacts: ["Probe run from scripts/debug-llm-fallback.ts"],
  invalidation: "Probe invalidation line.",
  metrics: {
    currentPrice: 65000,
    marketCap: 1.28e12,
    volume24h: 2.8e10,
    priceVsEma20Pct: 1.4,
    priceVsEma50Pct: 4.2,
    rsi14: 56.2,
    fundingRate: 0.00008,
    openInterest: 8.4e9,
    trendScore: 62,
    derivativeScore: 55,
    volumeScore: 58,
    momentumScore: 60,
    coinsUp: 5,
    coinsTotal: 8,
    riskRewardRatio: 2.1,
    tp1GainPct: 9,
    slRiskPct: 6,
  },
  entry: { low: 63500, high: 65800 },
  takeProfits: [
    { level: 70850, label: "TP1" },
    { level: 76700, label: "TP2" },
  ],
  stopLoss: { level: 61100, label: "SL" },
};

// SQ-LLM-GOOGLE sim: neutralize the 3 OpenAI-compatible tiers to prove the
// new google tier rescues the post instead of dropping to template.
const sim = process.argv.includes("--simulate-primary-outage");
if (sim) {
  process.env.OPENAI_API_KEY = "invalid-by-sim";
  process.env.FALLBACK_OPENAI_API_KEY = "invalid-by-sim";
  process.env.FALLBACK2_OPENAI_API_KEY = "invalid-by-sim";
  console.log("\n[sim] primary + fallback1 + fallback2 keys invalidated → only google tier remains\n");
}

console.log("Calling generateContent against the real provider chain…");
const started = Date.now();
const result = await generateContent(brief);
console.log(`Done in ${Date.now() - started}ms`);
console.log("");
console.log("llmUsed    :", result.llmUsed);
console.log("llmProvider:", result.llmProvider ?? "(none — TEMPLATE)");
console.log("text length:", result.text.length);
console.log("--- first 400 chars ---");
console.log(result.text.slice(0, 400));
