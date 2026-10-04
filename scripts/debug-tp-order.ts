// One-off verification for SQ-TP-ORDER (not committed): SHORT legacy/new +
// LONG with EMA targets — labels and display order must be near→far always.
import { buildContentBrief } from "../src/lib/square/opportunity-engine";

const base = {
  id: 905,
  type: "COIN_SETUP" as const,
  subjectId: 1,
  coinSymbol: "TEST",
  score: 80,
  dataAsOf: "2026-09-27",
  dataQuality: { priceData: true, indicatorData: true, futuresData: true, score: 100 },
  rationale: ["Health declining significantly (-8.0)"],
  entry: { low: 0.0086, high: 0.0096 },
  stopLoss: { level: 0.0107, label: "SL (1 ATR)" },
  expiresAt: "2026-09-28T00:00:00Z",
  status: "CANDIDATE" as const,
  setupDirection: "SHORT" as const,
};

const legacyShort = { ...base, takeProfits: [
  { level: 0.0054, label: "TP1 (1.5 ATR)" },
  { level: 0.007, label: "TP2 (3 ATR)" },
] };
const newShort = { ...base, id: 906, takeProfits: [
  { level: 0.007, label: "TP1 (1.5 ATR)" },
  { level: 0.0054, label: "TP2 (3 ATR)" },
] };
const longOpp = {
  ...base,
  id: 907,
  rationale: ["Health improving significantly (+8.0)"],
  setupDirection: "LONG" as const,
  entry: { low: 0.41, high: 0.43 },
  stopLoss: { level: 0.39, label: "SL (1 ATR)" },
  // LONG path: [tp1, tp2, ...ema].sort(by level) — EMA20 (0.44) sits between
  // TP1 (0.45) and entry; TP2 (0.48) far. Nearest-first must hold, and both
  // labeled TPs must survive any slicing.
  takeProfits: [
    { level: 0.45, label: "TP1 (1.5 ATR)" },
    { level: 0.48, label: "TP2 (3 ATR)" },
    { level: 0.44, label: "EMA20" },
    { level: 0.5, label: "EMA50" },
  ].sort((a, b) => a.level - b.level),
};

for (const opp of [legacyShort, newShort, longOpp]) {
  const brief = buildContentBrief(opp as unknown as Parameters<typeof buildContentBrief>[0]);
  console.log(`--- ${opp.id} (${opp.setupDirection}) ---`);
  console.log("direction:", brief.direction);
  console.log("priceMap:", brief.priceMap);
}
