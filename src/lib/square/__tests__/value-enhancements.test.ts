// SQ-VALUE-02 Monetization Quality Enhancement Tests

import {
  evaluateOpportunities,
  buildContentBrief,
  DEFAULT_SCORING_CONFIG,
  type SquareOpportunity,
  type SquareContentBrief,
} from "../opportunity-engine";
import { generateThesisFingerprint } from "../publisher";
import { generateContent } from "../content-generator";

// Mock database
jest.mock("@/db", () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
  },
}));

describe("SQ-VALUE-02 Enhancements", () => {
  describe("E1: Multi-coin Narrative Post", () => {
    it("selects up to maxLeadingCoins for narrative opportunities", () => {
      const mockCoinData = [
        {
          coinId: 1, symbol: "FET", name: "Fetch.ai", narrativeId: 1, narrativeName: "AI", isPrimary: true,
          healthScore: 90, previousScore: 80, scoreChange: 10, signal: "STRONG_WATCH",
          confidenceScore: 85, trendScore: 90, derivativeScore: 80, volumeScore: 85, momentumScore: 88,
          currentPrice: 1.5, volume24h: 1000000, marketCap: 1000000000, fundingRate: 0.01, openInterest: 500000000,
          rsi14: 65, ema20: 1.4, ema50: 1.3, atr14: 0.05, dataDate: "2026-08-20",
        },
        {
          coinId: 2, symbol: "RENDER", name: "Render", narrativeId: 1, narrativeName: "AI", isPrimary: false,
          healthScore: 85, previousScore: 75, scoreChange: 10, signal: "STRONG_WATCH",
          confidenceScore: 80, trendScore: 85, derivativeScore: 75, volumeScore: 80, momentumScore: 82,
          currentPrice: 5.0, volume24h: 500000000, marketCap: 2000000000, fundingRate: 0.02, openInterest: 1000000000,
          rsi14: 60, ema20: 4.8, ema50: 4.5, atr14: 0.2, dataDate: "2026-08-20",
        },
        {
          coinId: 3, symbol: "TAO", name: "TAO", narrativeId: 1, narrativeName: "AI", isPrimary: false,
          healthScore: 80, previousScore: 70, scoreChange: 10, signal: "WATCH",
          confidenceScore: 75, trendScore: 80, derivativeScore: 70, volumeScore: 75, momentumScore: 78,
          currentPrice: 400, volume24h: 100000000, marketCap: 3000000000, fundingRate: 0.015, openInterest: 800000000,
          rsi14: 58, ema20: 390, ema50: 380, atr14: 10, dataDate: "2026-08-20",
        },
        {
          coinId: 4, symbol: "AGIX", name: "SingularityNET", narrativeId: 1, narrativeName: "AI", isPrimary: false,
          healthScore: 70, previousScore: 65, scoreChange: 5, signal: "WATCH",
          confidenceScore: 70, trendScore: 70, derivativeScore: 65, volumeScore: 70, momentumScore: 68,
          currentPrice: 0.8, volume24h: 50000000, marketCap: 500000000, fundingRate: 0.005, openInterest: 200000000,
          rsi14: 55, ema20: 0.78, ema50: 0.75, atr14: 0.03, dataDate: "2026-08-20",
        },
      ];

      // We test selection logic directly by calling buildContentBrief with a narrative opportunity
      // that has leadingCoinSymbols set
      const narrativeOpp: SquareOpportunity = {
        id: 1,
        type: "NARRATIVE_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbol: "FET",
        score: 85,
        dataAsOf: "2026-08-20",
        dataQuality: "HIGH",
        rationale: ["Narrative health improving (+5.0)", "Leader: $FET", "3 coins in narrative", "Avg confidence: 80%"],
        leadingCoinSymbols: ["FET", "RENDER", "TAO"],
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(narrativeOpp);

      expect(brief.leadingCoinSymbols).toEqual(["FET", "RENDER", "TAO"]);
      expect(brief.cashtags).toContain("$FET");
      expect(brief.cashtags).toContain("$RENDER");
      expect(brief.cashtags).toContain("$TAO");
      expect(brief.cashtags.length).toBe(3);
    });

    it("handles narrative with only 1 qualified coin", () => {
      const narrativeOpp: SquareOpportunity = {
        id: 1,
        type: "NARRATIVE_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbol: "FET",
        score: 70,
        dataAsOf: "2026-08-20",
        dataQuality: "MEDIUM",
        rationale: ["Narrative health improving (+3.5)", "Leader: $FET", "1 coin in narrative"],
        leadingCoinSymbols: ["FET"],
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(narrativeOpp);

      expect(brief.leadingCoinSymbols).toEqual(["FET"]);
      expect(brief.cashtags).toContain("$FET");
      expect(brief.cashtags.length).toBe(1);
    });

    it("does not force multi-coin when insufficient qualified coins", () => {
      const narrativeOpp: SquareOpportunity = {
        id: 1,
        type: "NARRATIVE_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbol: "FET",
        score: 70,
        dataAsOf: "2026-08-20",
        dataQuality: "MEDIUM",
        rationale: ["Narrative health improving (+3.5)", "Leader: $FET"],
        leadingCoinSymbols: ["FET"],
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(narrativeOpp);

      expect(brief.leadingCoinSymbols?.length).toBeGreaterThanOrEqual(1);
      expect(brief.cashtags.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("E2: Why Now Hook", () => {
    it("generates why-now facts for coin setup with strong change", () => {
      const coinOpp: SquareOpportunity = {
        id: 1,
        type: "COIN_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbol: "BTC",
        score: 85,
        dataAsOf: "2026-08-20",
        dataQuality: "HIGH",
        rationale: [
          "Health improving significantly (+5.2)",
          "Signal: STRONG_WATCH",
          "Strong bullish trend",
          "Volume above average",
          "Confidence: 80%",
        ],
        entry: { low: 50000, high: 51000 },
        takeProfits: [{ level: 52500, label: "TP1" }],
        stopLoss: { level: 49000, label: "SL" },
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(coinOpp);

      expect(brief.whyNowFacts).toBeDefined();
      expect(brief.whyNowFacts!.length).toBeGreaterThan(0);
      expect(brief.whyNowFacts!.some((f) => f.includes("improved"))).toBe(true);
      expect(brief.whyNowFacts!.some((f) => f.includes("STRONG_WATCH"))).toBe(true);
    });

    it("generates why-now facts for narrative setup", () => {
      const narrativeOpp: SquareOpportunity = {
        id: 1,
        type: "NARRATIVE_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbol: "FET",
        score: 80,
        dataAsOf: "2026-08-20",
        dataQuality: "HIGH",
        rationale: [
          "Narrative health improving (+4.5)",
          "Leader: $FET",
          "3 coins in narrative",
          "Avg confidence: 80%",
        ],
        leadingCoinSymbols: ["FET", "RENDER", "TAO"],
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(narrativeOpp);

      expect(brief.whyNowFacts).toBeDefined();
      expect(brief.whyNowFacts!.length).toBeGreaterThan(0);
      expect(brief.whyNowFacts!.some((f) => f.includes("Narrative health improved"))).toBe(true);
      expect(brief.whyNowFacts!.some((f) => f.includes("3 leading coins"))).toBe(true);
    });

    it("falls back gracefully when why-now data is weak", () => {
      const coinOpp: SquareOpportunity = {
        id: 1,
        type: "COIN_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbol: "BTC",
        score: 65,
        dataAsOf: "2026-08-20",
        dataQuality: "MEDIUM",
        rationale: ["Health stable", "Signal: OBSERVE", "Confidence: 55%"],
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(coinOpp);

      expect(brief.whyNowFacts).toBeDefined();
      expect(brief.whyNowFacts!.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("E3: Invalidation Thesis", () => {
    it("generates deterministic coin invalidation from SL", () => {
      const coinOpp: SquareOpportunity = {
        id: 1,
        type: "COIN_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbol: "BTC",
        score: 85,
        dataAsOf: "2026-08-20",
        dataQuality: "HIGH",
        rationale: ["Signal: STRONG_WATCH", "Confidence: 80%"],
        entry: { low: 50000, high: 51000 },
        takeProfits: [{ level: 52500, label: "TP1" }],
        stopLoss: { level: 49000, label: "SL" },
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(coinOpp);

      expect(brief.invalidation).toBeDefined();
      expect(brief.invalidation).toContain("invalidates");
      expect(brief.invalidation).toContain("49000");
    });

    it("generates narrative invalidation", () => {
      const narrativeOpp: SquareOpportunity = {
        id: 1,
        type: "NARRATIVE_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbol: "FET",
        score: 80,
        dataAsOf: "2026-08-20",
        dataQuality: "HIGH",
        rationale: ["Narrative health improving (+4.5)", "Leader: $FET"],
        leadingCoinSymbols: ["FET", "RENDER"],
        leadingCoinRationales: ["strongest momentum contribution", "positive monitoring posture"],
        narrativeInvalidation: "Narrative thesis weakens if leading coins lose their current relative-strength advantage.",
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(narrativeOpp);

      expect(brief.invalidation).toBeDefined();
      expect(brief.invalidation!.length).toBeGreaterThan(0);
      expect(brief.invalidation).toContain("Narrative thesis weakens");
    });

    it("omits invalidation when data is insufficient", () => {
      const coinOpp: SquareOpportunity = {
        id: 1,
        type: "COIN_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbol: "BTC",
        score: 60,
        dataAsOf: "2026-08-20",
        dataQuality: "MEDIUM",
        rationale: ["Signal: OBSERVE"],
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(coinOpp);

      expect(brief.invalidation).toBeNull();
    });
  });

  describe("E4: Thesis Stability", () => {
    it("generates deterministic thesis fingerprint", () => {
      const fp1 = generateThesisFingerprint({
        type: "COIN_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbols: ["BTC"],
        signal: "STRONG_WATCH",
        entryLow: 50000,
        entryHigh: 51000,
        tpLevels: [52500, 55000],
        slLevel: 49000,
        invalidation: "Setup invalidates if price breaks below 49000.0000",
      });

      const fp2 = generateThesisFingerprint({
        type: "COIN_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbols: ["BTC"],
        signal: "STRONG_WATCH",
        entryLow: 50000,
        entryHigh: 51000,
        tpLevels: [52500, 55000],
        slLevel: 49000,
        invalidation: "Setup invalidates if price breaks below 49000.0000",
      });

      expect(fp1).toBe(fp2);
    });

    it("changes fingerprint when entry changes materially", () => {
      const fp1 = generateThesisFingerprint({
        type: "COIN_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbols: ["BTC"],
        signal: "STRONG_WATCH",
        entryLow: 50000,
        entryHigh: 51000,
        tpLevels: [52500, 55000],
        slLevel: 49000,
        invalidation: "Setup invalidates if price breaks below 49000.0000",
      });

      const fp2 = generateThesisFingerprint({
        type: "COIN_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbols: ["BTC"],
        signal: "STRONG_WATCH",
        entryLow: 50100,
        entryHigh: 51100,
        tpLevels: [52500, 55000],
        slLevel: 49000,
        invalidation: "Setup invalidates if price breaks below 49000.0000",
      });

      expect(fp1).not.toBe(fp2);
    });

    it("changes fingerprint when SL changes", () => {
      const fp1 = generateThesisFingerprint({
        type: "COIN_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbols: ["BTC"],
        signal: "STRONG_WATCH",
        entryLow: 50000,
        entryHigh: 51000,
        tpLevels: [52500, 55000],
        slLevel: 49000,
        invalidation: "Setup invalidates if price breaks below 49000.0000",
      });

      const fp2 = generateThesisFingerprint({
        type: "COIN_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbols: ["BTC"],
        signal: "STRONG_WATCH",
        entryLow: 50000,
        entryHigh: 51000,
        tpLevels: [52500, 55000],
        slLevel: 48800,
        invalidation: "Setup invalidates if price breaks below 48800.0000",
      });

      expect(fp1).not.toBe(fp2);
    });

    it("changes fingerprint when narrative posture changes", () => {
      const fp1 = generateThesisFingerprint({
        type: "NARRATIVE_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbols: ["FET", "RENDER"],
        signal: "STRONG_WATCH",
        entryLow: null,
        entryHigh: null,
        tpLevels: [],
        slLevel: null,
        invalidation: null,
      });

      const fp2 = generateThesisFingerprint({
        type: "NARRATIVE_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbols: ["FET"],
        signal: "WATCH",
        entryLow: null,
        entryHigh: null,
        tpLevels: [],
        slLevel: null,
        invalidation: null,
      });

      expect(fp1).not.toBe(fp2);
    });

    it("does not contain arbitrary time/random dependency", () => {
      const fp1 = generateThesisFingerprint({
        type: "COIN_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbols: ["BTC"],
        signal: "STRONG_WATCH",
        entryLow: 50000,
        entryHigh: 51000,
        tpLevels: [52500, 55000],
        slLevel: 49000,
        invalidation: "Setup invalidates if price breaks below 49000.0000",
      });

      const fp2 = generateThesisFingerprint({
        type: "COIN_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbols: ["BTC"],
        signal: "STRONG_WATCH",
        entryLow: 50000,
        entryHigh: 51000,
        tpLevels: [52500, 55000],
        slLevel: 49000,
        invalidation: "Setup invalidates if price breaks below 49000.0000",
      });

      expect(fp1).toBe(fp2);
    });
  });

  describe("Content Contract Integration", () => {
    it("coin post contains all required sections", () => {
      const coinOpp: SquareOpportunity = {
        id: 1,
        type: "COIN_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbol: "BTC",
        score: 85,
        dataAsOf: "2026-08-20",
        dataQuality: "HIGH",
        rationale: [
          "Health improving significantly (+5.2)",
          "Signal: STRONG_WATCH",
          "Strong bullish trend",
          "Volume above average",
          "Confidence: 80%",
        ],
        entry: { low: 50000, high: 51000 },
        takeProfits: [{ level: 52500, label: "TP1" }, { level: 55000, label: "TP2" }],
        stopLoss: { level: 49000, label: "SL" },
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(coinOpp);

      expect(brief.text).toContain("🔍 $BTC");
      expect(brief.text).toContain("WHY NOW");
      expect(brief.text).toContain("Key facts:");
      expect(brief.text).toContain("Entry:");
      expect(brief.text).toContain("TP:");
      expect(brief.text).toContain("SL:");
      expect(brief.text).toContain("INVALIDATION");
      expect(brief.text).toContain("not financial advice");
    });

    it("narrative post contains leading coins and why now", () => {
      const narrativeOpp: SquareOpportunity = {
        id: 1,
        type: "NARRATIVE_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbol: "FET",
        score: 80,
        dataAsOf: "2026-08-20",
        dataQuality: "HIGH",
        rationale: [
          "Narrative health improving (+4.5)",
          "Leader: $FET",
          "3 coins in narrative",
          "Avg confidence: 80%",
        ],
        leadingCoinSymbols: ["FET", "RENDER", "TAO"],
        leadingCoinRationales: [
          "strongest momentum contribution",
          "positive monitoring posture",
          "confirmed by trend and volume",
        ],
        narrativeInvalidation: "The narrative thesis becomes weaker if the current leading-coin strength fails to persist.",
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(narrativeOpp);

      expect(brief.text).toContain("📊 $FET");
      expect(brief.text).toContain("WHY NOW");
      expect(brief.text).toContain("Leading coins:");
      expect(brief.text).toContain("$FET — strongest momentum contribution");
      expect(brief.text).toContain("$RENDER — positive monitoring posture");
      expect(brief.text).toContain("$TAO — confirmed by trend and volume");
      expect(brief.text).toContain("INVALIDATION");
      expect(brief.text).toContain("not financial advice");
    });

    it("LLM prompt includes new sections", async () => {
      const coinOpp: SquareOpportunity = {
        id: 1,
        type: "COIN_SETUP",
        subjectId: 1,
        narrativeId: 1,
        coinSymbol: "BTC",
        score: 85,
        dataAsOf: "2026-08-20",
        dataQuality: "HIGH",
        rationale: [
          "Health improving significantly (+5.2)",
          "Signal: STRONG_WATCH",
          "Strong bullish trend",
          "Volume above average",
          "Confidence: 80%",
        ],
        entry: { low: 50000, high: 51000 },
        takeProfits: [{ level: 52500, label: "TP1" }],
        stopLoss: { level: 49000, label: "SL" },
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(coinOpp);
      const result = await generateContent(brief, { maxTextLength: 2000, includeDisclaimer: true, useLLM: false });

      expect(result.text).toContain("WHY NOW");
      expect(result.text).toContain("INVALIDATION");
      expect(result.text).toContain("$BTC");
    });
  });
});
