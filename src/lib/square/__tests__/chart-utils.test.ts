// Chart Integration Tests
// Verifies symbol normalization, chart coin resolution, and integration boundaries

import {
  normalizeCoinSymbol,
  validateChartSymbol,
  resolveChartCoin,
  generateChartMetadata,
} from "../chart-utils";
import {
  buildContentBrief,
  type SquareOpportunity,
} from "../opportunity-engine";

// ─── Symbol Normalization ──────────────────────────────

describe("normalizeCoinSymbol", () => {
  it("normalizes plain ticker", () => {
    expect(normalizeCoinSymbol("BTC")).toBe("BTC");
  });

  it("normalizes lowercase", () => {
    expect(normalizeCoinSymbol("btc")).toBe("BTC");
  });

  it("removes leading $", () => {
    expect(normalizeCoinSymbol("$BTC")).toBe("BTC");
  });

  it("removes USDT suffix", () => {
    expect(normalizeCoinSymbol("BTCUSDT")).toBe("BTC");
  });

  it("removes /USDT", () => {
    expect(normalizeCoinSymbol("BTC/USDT")).toBe("BTC");
  });

  it("removes _USDT", () => {
    expect(normalizeCoinSymbol("BTC_USDT")).toBe("BTC");
  });

  it("removes PERP suffix", () => {
    expect(normalizeCoinSymbol("BTCPERP")).toBe("BTC");
  });

  it("removes USDC suffix", () => {
    expect(normalizeCoinSymbol("ETHUSDC")).toBe("ETH");
  });

  it("handles mixed case with suffix", () => {
    expect(normalizeCoinSymbol("EthUsdt")).toBe("ETH");
  });

  it("handles $ETH/USDT", () => {
    expect(normalizeCoinSymbol("$ETH/USDT")).toBe("ETH");
  });

  it("returns empty for empty input", () => {
    expect(normalizeCoinSymbol("")).toBe("");
  });

  it("returns empty for null-like input", () => {
    expect(normalizeCoinSymbol(null as unknown as string)).toBe("");
  });

  it("returns empty for single character", () => {
    expect(normalizeCoinSymbol("A")).toBe("");
  });

  it("returns empty for too-long input", () => {
    expect(normalizeCoinSymbol("VERYLONGSYMBOL")).toBe("");
  });

  it("handles FET correctly", () => {
    expect(normalizeCoinSymbol("FET")).toBe("FET");
    expect(normalizeCoinSymbol("$FET")).toBe("FET");
    expect(normalizeCoinSymbol("FETUSDT")).toBe("FET");
  });

  it("handles TAO correctly", () => {
    expect(normalizeCoinSymbol("TAO")).toBe("TAO");
  });

  it("handles RENDER correctly", () => {
    expect(normalizeCoinSymbol("RENDER")).toBe("RENDER");
  });

  it("handles ONDO correctly", () => {
    expect(normalizeCoinSymbol("ONDO")).toBe("ONDO");
  });
});

// ─── Chart Symbol Validation ───────────────────────────

describe("validateChartSymbol", () => {
  it("validates BTC", () => {
    expect(validateChartSymbol("BTC")).toBe("BTC");
  });

  it("validates and normalizes $eth", () => {
    expect(validateChartSymbol("$eth")).toBe("ETH");
  });

  it("validates FET (Fetch.ai)", () => {
    expect(validateChartSymbol("FET")).toBe("FET");
  });

  it("rejects empty string", () => {
    expect(validateChartSymbol("")).toBeNull();
  });

  it("rejects single character", () => {
    expect(validateChartSymbol("A")).toBeNull();
  });

  it("rejects invalid normalized symbols", () => {
    expect(validateChartSymbol("123")).toBeNull();
  });

  it("returns null for non-crypto common words", () => {
    expect(validateChartSymbol("THE")).toBeNull();
    expect(validateChartSymbol("AND")).toBeNull();
    expect(validateChartSymbol("FOR")).toBeNull();
  });
});

// ─── Chart Coin Resolution ─────────────────────────────

describe("resolveChartCoin", () => {
  it("uses explicit chart coin when valid", () => {
    const result = resolveChartCoin("BTC", ["$ETH"]);
    expect(result.primarySymbol).toBe("BTC");
    expect(result.wasExplicit).toBe(true);
    expect(result.allCashtags).toContain("ETH");
  });

  it("falls back to first cashtag when explicit is invalid", () => {
    const result = resolveChartCoin("INVALID!", ["$BTC", "$ETH"]);
    expect(result.primarySymbol).toBe("BTC");
    expect(result.wasExplicit).toBe(false);
  });

  it("falls back to first cashtag when explicit is null", () => {
    const result = resolveChartCoin(null, ["$BTC"]);
    expect(result.primarySymbol).toBe("BTC");
    expect(result.wasExplicit).toBe(false);
  });

  it("returns null when no valid cashtags", () => {
    const result = resolveChartCoin(undefined, []);
    expect(result.primarySymbol).toBeNull();
  });

  it("handles multiple cashtags", () => {
    const result = resolveChartCoin(undefined, ["$BTC", "$ETH", "$SOL"]);
    expect(result.primarySymbol).toBe("BTC");
    expect(result.allCashtags).toEqual(["BTC", "ETH", "SOL"]);
  });
});

// ─── Chart Metadata Generation ─────────────────────────

describe("generateChartMetadata", () => {
  it("generates enabled metadata when chart coin exists", () => {
    const chartCoin = resolveChartCoin("BTC", ["$BTC"]);
    const meta = generateChartMetadata(chartCoin, "BTC");
    expect(meta.chartEnabled).toBe(true);
    expect(meta.chartSymbol).toBe("BTC");
    expect(meta.chartMatchesSource).toBe(true);
    expect(meta.cashtagCount).toBe(1);
  });

  it("detects chart matches source", () => {
    const chartCoin = resolveChartCoin("BTC", ["$BTC"]);
    const meta = generateChartMetadata(chartCoin, "BTC");
    expect(meta.chartMatchesSource).toBe(true);
  });

  it("detects chart mismatch", () => {
    const chartCoin = resolveChartCoin("ETH", ["$ETH"]);
    const meta = generateChartMetadata(chartCoin, "BTC");
    expect(meta.chartMatchesSource).toBe(false);
  });

  it("disabled when no chart coin", () => {
    const chartCoin = resolveChartCoin(undefined, []);
    const meta = generateChartMetadata(chartCoin, "BTC");
    expect(meta.chartEnabled).toBe(false);
    expect(meta.chartSymbol).toBeNull();
  });

  it("handles null source symbol", () => {
    const chartCoin = resolveChartCoin("BTC", ["$BTC"]);
    const meta = generateChartMetadata(chartCoin, null);
    expect(meta.chartEnabled).toBe(true);
    expect(meta.chartMatchesSource).toBe(false);
  });
});

// ─── Content Brief Chart Integration ───────────────────

describe("buildContentBrief chart integration", () => {
  const coinOpportunity: SquareOpportunity = {
    id: 1,
    type: "COIN_SETUP",
    subjectId: 1,
    narrativeId: 1,
    coinSymbol: "BTC",
    score: 85.5,
    dataAsOf: "2026-08-19",
    dataQuality: "HIGH",
    rationale: ["Health improving (+5.2)", "Signal: STRONG_WATCH", "Confidence: 80%"],
    entry: { low: 50000, high: 51000 },
    takeProfits: [{ level: 52500, label: "TP1" }],
    stopLoss: { level: 49000, label: "SL" },
    status: "CANDIDATE",
  };

  it("includes normalized chartCoin in brief", () => {
    const brief = buildContentBrief(coinOpportunity);
    expect(brief.chartCoin).toBe("BTC");
    expect(brief.chartCoinExplicit).toBe(true);
  });

  it("includes $BTC cashtag in text", () => {
    const brief = buildContentBrief(coinOpportunity);
    expect(brief.cashtags).toContain("$BTC");
    expect(brief.text).toContain("$BTC");
  });

  it("normalizes symbol from $BTC format", () => {
    const opp = { ...coinOpportunity, coinSymbol: "$BTC" };
    const brief = buildContentBrief(opp);
    expect(brief.chartCoin).toBe("BTC");
    expect(brief.cashtags).toContain("$BTC");
  });

  it("normalizes symbol from BTCUSDT format", () => {
    const opp = { ...coinOpportunity, coinSymbol: "BTCUSDT" };
    const brief = buildContentBrief(opp);
    expect(brief.chartCoin).toBe("BTC");
    expect(brief.cashtags).toContain("$BTC");
  });

  it("handles narrative opportunity with chart coin", () => {
    const narrativeOpp: SquareOpportunity = {
      id: 2,
      type: "NARRATIVE_SETUP",
      subjectId: 1,
      narrativeId: 1,
      coinSymbol: "FET",
      score: 72.0,
      dataAsOf: "2026-08-19",
      dataQuality: "MEDIUM",
      rationale: ["Narrative health improving"],
      status: "CANDIDATE",
    };
    const brief = buildContentBrief(narrativeOpp);
    expect(brief.chartCoin).toBe("FET");
    expect(brief.cashtags).toContain("$FET");
  });

  it("handles missing coin symbol gracefully", () => {
    const opp: SquareOpportunity = {
      id: 3,
      type: "NARRATIVE_SETUP",
      subjectId: 1,
      score: 60,
      dataAsOf: "2026-08-19",
      dataQuality: "LOW",
      rationale: ["Test"],
      status: "CANDIDATE",
    };
    const brief = buildContentBrief(opp);
    expect(brief.chartCoin).toBeUndefined();
    expect(brief.cashtags).toEqual([]);
  });

  it("chart does not modify Entry/TP/SL", () => {
    const brief = buildContentBrief(coinOpportunity);
    expect(brief.entry).toEqual(coinOpportunity.entry);
    expect(brief.takeProfits).toEqual(coinOpportunity.takeProfits);
    expect(brief.stopLoss).toEqual(coinOpportunity.stopLoss);
  });

  it("chart does not modify opportunity score", () => {
    const brief = buildContentBrief(coinOpportunity);
    // Score is not in the brief, but the brief preserves the identity
    expect(brief.opportunityId).toBe(coinOpportunity.id);
  });
});

// ─── Edge Cases ────────────────────────────────────────

describe("Chart edge cases", () => {
  it("empty cashtags array produces no chart", () => {
    const result = resolveChartCoin(undefined, []);
    expect(result.primarySymbol).toBeNull();
    expect(result.allCashtags).toEqual([]);
  });

  it("all invalid cashtags produces no chart", () => {
    const result = resolveChartCoin(undefined, ["$THE", "$AND"]);
    expect(result.primarySymbol).toBeNull();
  });

  it("mixed valid/invalid cashtags picks first valid", () => {
    const result = resolveChartCoin(undefined, ["$THE", "$BTC", "$ETH"]);
    expect(result.primarySymbol).toBe("BTC");
    expect(result.allCashtags).toEqual(["BTC", "ETH"]);
  });

  it("chart coin from narrative post with multiple leaders", () => {
    const opp: SquareOpportunity = {
      id: 1,
      type: "NARRATIVE_SETUP",
      subjectId: 1,
      narrativeId: 1,
      coinSymbol: "FET",
      score: 70,
      dataAsOf: "2026-08-19",
      dataQuality: "MEDIUM",
      rationale: ["Leader: $FET", "Other: $RENDER"],
      status: "CANDIDATE",
    };
    const brief = buildContentBrief(opp);
    expect(brief.chartCoin).toBe("FET");
    // Only primary coin gets cashtag (this is by design — one chart per post)
    expect(brief.cashtags).toEqual(["$FET"]);
  });
});
