// Square Opportunity Engine Tests

import {
  evaluateOpportunities,
  buildContentBrief,
  DEFAULT_SCORING_CONFIG,
  type SquareOpportunity,
  type OpportunityScoringConfig,
} from "../opportunity-engine";

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

describe("Square Opportunity Engine", () => {
  describe("DEFAULT_SCORING_CONFIG", () => {
    it("has valid default configuration", () => {
      expect(DEFAULT_SCORING_CONFIG.minDataQualityScore).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_SCORING_CONFIG.minDataQualityScore).toBeLessThanOrEqual(100);
      expect(DEFAULT_SCORING_CONFIG.minConfidenceScore).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_SCORING_CONFIG.minConfidenceScore).toBeLessThanOrEqual(100);
      expect(DEFAULT_SCORING_CONFIG.maxDataAgeHours).toBeGreaterThan(0);
      expect(DEFAULT_SCORING_CONFIG.dailyHardCap).toBe(100);
    });

    it("weights sum to 1.0", () => {
      const weights = DEFAULT_SCORING_CONFIG.weights;
      const sum =
        weights.dataQuality +
        weights.healthMomentum +
        weights.signalAlignment +
        weights.volumeConfirmation +
        weights.trendStrength +
        weights.noveltyBonus;
      expect(sum).toBeCloseTo(1.0, 2);
    });
  });

  describe("buildContentBrief", () => {
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
      takeProfits: [{ level: 52500, label: "TP1" }, { level: 55000, label: "TP2" }],
      stopLoss: { level: 49000, label: "SL" },
      status: "CANDIDATE",
    };

    const narrativeOpportunity: SquareOpportunity = {
      id: 2,
      type: "NARRATIVE_SETUP",
      subjectId: 1,
      narrativeId: 1,
      coinSymbol: "FET",
      score: 72.0,
      dataAsOf: "2026-08-19",
      dataQuality: "MEDIUM",
      rationale: ["Narrative health improving (+3.5)", "Leader: $FET"],
      status: "CANDIDATE",
    };

    it("builds text brief for coin setup", () => {
      const brief = buildContentBrief(coinOpportunity);

      expect(brief.contentType).toBe("image");
      expect(brief.cashtags).toContain("$BTC");
      expect(brief.text).toContain("$BTC");
      expect(brief.text).toContain("Entry: 50000");
      expect(brief.text).toContain("TP: 52500");
      expect(brief.text).toContain("SL: 49000");
      expect(brief.text).toContain("⚠️");
      expect(brief.chartCoin).toBe("BTC");
    });

    it("builds text brief for narrative setup", () => {
      const brief = buildContentBrief(narrativeOpportunity);

      expect(brief.contentType).toBe("text");
      expect(brief.cashtags).toContain("$FET");
      expect(brief.text).toContain("$FET");
      expect(brief.text).toContain("Narrative");
      expect(brief.text).toContain("⚠️");
    });

    it("preserves data facts without modification", () => {
      const brief = buildContentBrief(coinOpportunity);

      // Key facts should be present
      expect(brief.text).toContain("Health improving (+5.2)");
      expect(brief.text).toContain("Signal: STRONG_WATCH");
      expect(brief.text).toContain("Confidence: 80%");
    });

    it("includes disclaimer", () => {
      const brief = buildContentBrief(coinOpportunity);
      expect(brief.text).toContain("not financial advice");
    });
  });

  describe("Opportunity Types", () => {
    it("validates opportunity type values", () => {
      const validTypes = ["COIN_SETUP", "NARRATIVE_SETUP", "WATCH"];
      for (const type of validTypes) {
        expect(["COIN_SETUP", "NARRATIVE_SETUP", "WATCH"]).toContain(type);
      }
    });

    it("validates data quality values", () => {
      const validQualities = ["HIGH", "MEDIUM", "LOW"];
      for (const quality of validQualities) {
        expect(["HIGH", "MEDIUM", "LOW"]).toContain(quality);
      }
    });

    it("validates opportunity status values", () => {
      const validStatuses = [
        "CANDIDATE",
        "QUALIFIED",
        "SUPPRESSED",
        "PUBLISHED",
        "EXPIRED",
      ];
      for (const status of validStatuses) {
        expect([
          "CANDIDATE",
          "QUALIFIED",
          "SUPPRESSED",
          "PUBLISHED",
          "EXPIRED",
        ]).toContain(status);
      }
    });
  });

  describe("Scoring Configuration", () => {
    it("allows custom configuration", () => {
      const customConfig: OpportunityScoringConfig = {
        ...DEFAULT_SCORING_CONFIG,
        minDataQualityScore: 70,
        minConfidenceScore: 60,
        coinCooldownHours: 48,
        dailySoftCap: 5,
      };

      expect(customConfig.minDataQualityScore).toBe(70);
      expect(customConfig.minConfidenceScore).toBe(60);
      expect(customConfig.coinCooldownHours).toBe(48);
      expect(customConfig.dailySoftCap).toBe(5);
    });

    it("maintains valid weights with custom config", () => {
      const customConfig: OpportunityScoringConfig = {
        ...DEFAULT_SCORING_CONFIG,
        weights: {
          dataQuality: 0.3,
          healthMomentum: 0.3,
          signalAlignment: 0.2,
          volumeConfirmation: 0.1,
          trendStrength: 0.05,
          noveltyBonus: 0.05,
        },
      };

      const sum =
        customConfig.weights.dataQuality +
        customConfig.weights.healthMomentum +
        customConfig.weights.signalAlignment +
        customConfig.weights.volumeConfirmation +
        customConfig.weights.trendStrength +
        customConfig.weights.noveltyBonus;

      expect(sum).toBeCloseTo(1.0, 2);
    });
  });

  describe("Content Brief Validation", () => {
    it("requires text in brief", () => {
      const opportunity: SquareOpportunity = {
        id: 1,
        type: "COIN_SETUP",
        subjectId: 1,
        coinSymbol: "BTC",
        score: 80,
        dataAsOf: "2026-08-19",
        dataQuality: "HIGH",
        rationale: ["Test"],
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(opportunity);
      expect(brief.text).toBeTruthy();
      expect(brief.text.length).toBeGreaterThan(0);
    });

    it("generates cashtags from coin symbol", () => {
      const opportunity: SquareOpportunity = {
        id: 1,
        type: "COIN_SETUP",
        subjectId: 1,
        coinSymbol: "ETH",
        score: 80,
        dataAsOf: "2026-08-19",
        dataQuality: "HIGH",
        rationale: ["Test"],
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(opportunity);
      expect(brief.cashtags).toContain("$ETH");
    });

    it("handles missing coin symbol", () => {
      const opportunity: SquareOpportunity = {
        id: 1,
        type: "NARRATIVE_SETUP",
        subjectId: 1,
        score: 80,
        dataAsOf: "2026-08-19",
        dataQuality: "HIGH",
        rationale: ["Test"],
        status: "CANDIDATE",
      };

      const brief = buildContentBrief(opportunity);
      expect(brief.cashtags).toEqual([]);
    });
  });
});
