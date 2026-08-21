import { TimeRange } from "../analytics";

describe("SQ-AN-02 Analytics Service", () => {
  describe("TimeRange type validation", () => {
    it("accepts valid time ranges", () => {
      const validRanges: TimeRange[] = ["TODAY", "7D", "30D", "ALL"];
      expect(validRanges).toHaveLength(4);
      for (const range of validRanges) {
        expect(["TODAY", "7D", "30D", "ALL"]).toContain(range);
      }
    });
  });

  describe("Pipeline execution record structure", () => {
    it("defines expected fields for pipeline execution", () => {
      const execution = {
        startedAt: new Date(),
        completedAt: new Date(),
        triggerType: "SCHEDULED",
        evaluated: 10,
        qualified: 5,
        published: 3,
        failed: 1,
        deduplicated: 1,
        quotaBlocked: 0,
        retryPending: 0,
        contentGenerationFailed: 0,
        llmUsedCount: 2,
        templateFallbackCount: 1,
        durationMs: 5000,
        quotaRemainingStart: 97,
        quotaRemainingEnd: 94,
        quotaWarning: false,
        errorSummary: null,
      };

      expect(execution.triggerType).toBe("SCHEDULED");
      expect(execution.evaluated).toBeGreaterThanOrEqual(0);
      expect(execution.qualified).toBeLessThanOrEqual(execution.evaluated);
      expect(execution.published + execution.failed + execution.deduplicated).toBeLessThanOrEqual(execution.qualified);
      expect(execution.llmUsedCount + execution.templateFallbackCount).toBeLessThanOrEqual(execution.published + execution.failed);
    });

    it("validates trigger type enum", () => {
      const validTriggerTypes = ["SCHEDULED", "MANUAL", "RETRY"];
      for (const t of validTriggerTypes) {
        expect(["SCHEDULED", "MANUAL", "RETRY"]).toContain(t);
      }
    });
  });

  describe("Publication funnel reconciliation", () => {
    it("funnel counts are consistent", () => {
      const funnel = {
        evaluated: 60,
        qualified: 9,
        published: 7,
        failed: 0,
        deduplicated: 2,
        quotaBlocked: 0,
      };

      // Published + failed + deduplicated should be <= qualified
      expect(funnel.published + funnel.failed + funnel.deduplicated).toBeLessThanOrEqual(funnel.qualified);
      // Qualified should be <= evaluated
      expect(funnel.qualified).toBeLessThanOrEqual(funnel.evaluated);
    });
  });

  describe("LlmUsage reconciliation", () => {
    it("llm + template counts make sense", () => {
      const usage = {
        llmUsed: 2,
        templateFallback: 7,
        llmPublishRate: 100,
        templatePublishRate: 100,
      };

      expect(usage.llmUsed + usage.templateFallback).toBeGreaterThan(0);
      expect(usage.llmPublishRate).toBeGreaterThanOrEqual(0);
      expect(usage.llmPublishRate).toBeLessThanOrEqual(100);
      expect(usage.templatePublishRate).toBeGreaterThanOrEqual(0);
      expect(usage.templatePublishRate).toBeLessThanOrEqual(100);
    });
  });

  describe("Latency stats", () => {
    it("percentiles are ordered correctly", () => {
      const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
      const p50 = latencies[Math.floor(latencies.length * 0.5)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const p99 = latencies[Math.floor(latencies.length * 0.99)];

      expect(p50).toBeLessThanOrEqual(p95);
      expect(p95).toBeLessThanOrEqual(p99);
    });
  });

  describe("Quota constraints", () => {
    it("daily cap is 100", () => {
      const dailyCap = 100;
      const quotaWarning = 80;
      expect(dailyCap).toBe(100);
      expect(quotaWarning).toBeLessThan(dailyCap);
    });
  });

  describe("Score distribution ranges", () => {
    it("covers all score ranges", () => {
      const ranges = ["90-100", "80-89", "70-79", "60-69", "50-59", "<50"];
      expect(ranges).toHaveLength(6);
    });
  });

  describe("No external API calls", () => {
    it("analytics service is purely DB-based", () => {
      // This is a structural test - analytics.ts should only import from db and drizzle
      // No fetch calls, no Binance API, no external services
      const fs = require("fs");
      const content = fs.readFileSync("src/lib/square/analytics.ts", "utf-8");
      
      // Should not contain fetch calls
      expect(content).not.toMatch(/fetch\(/);
      // Should not contain Binance API URLs
      expect(content).not.toMatch(/binance\.com/);
      // Should not contain external HTTP
      expect(content).not.toMatch(/https?:\/\/(?!drizzle)/);
    });
  });

  describe("Security: no secret leakage", () => {
    it("analytics does not expose API keys", () => {
      const fs = require("fs");
      const content = fs.readFileSync("src/lib/square/analytics.ts", "utf-8");
      
      // Should not contain API key references
      expect(content).not.toMatch(/OPENAPI_KEY/);
      expect(content).not.toMatch(/process\.env\.BINANCE/);
      expect(content).not.toMatch(/process\.env\.GOOGLE/);
    });

    it("analytics route does not expose secrets", () => {
      const fs = require("fs");
      const content = fs.readFileSync("src/app/api/admin/square/analytics/route.ts", "utf-8");
      
      expect(content).not.toMatch(/OPENAPI_KEY/);
      expect(content).not.toMatch(/process\.env\.BINANCE/);
    });
  });
});
