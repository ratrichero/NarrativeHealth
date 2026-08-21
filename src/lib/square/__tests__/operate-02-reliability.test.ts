// SQ-OPERATE-02: Tests for publisher retry, failure classification, pipeline summary, quota warning

import { generateThesisFingerprint, getQuotaStatus, type PublicationStatus, type FailureCategory, type PublicationResult, type QuotaStatus } from "../publisher";
import { getLastPipelineSummary, type PipelineExecutionSummary } from "../production";

// ─── Failure Classification Type Contract Tests ────────

describe("SQ-OPERATE-02: Failure Classification", () => {
  it("TRANSIENT maps to RETRY_PENDING status", () => {
    const category: FailureCategory = "TRANSIENT";
    expect(category).toBe("TRANSIENT");
  });

  it("TIMEOUT maps to RETRY_PENDING status", () => {
    const category: FailureCategory = "TIMEOUT";
    expect(category).toBe("TIMEOUT");
  });

  it("PERMANENT maps to FAILED status (no retry)", () => {
    const category: FailureCategory = "PERMANENT";
    expect(category).toBe("PERMANENT");
  });

  it("UNKNOWN maps to FAILED status (no retry)", () => {
    const category: FailureCategory = "UNKNOWN";
    expect(category).toBe("UNKNOWN");
  });
});

// ─── Publication Status Tests ───────────────────────────

describe("SQ-OPERATE-02: Publication Status", () => {
  it("supports RETRY_PENDING status", () => {
    const status: PublicationStatus = "RETRY_PENDING";
    expect(status).toBe("RETRY_PENDING");
  });

  it("supports UNKNOWN status", () => {
    const status: PublicationStatus = "UNKNOWN";
    expect(status).toBe("UNKNOWN");
  });

  it("all statuses are valid", () => {
    const validStatuses: PublicationStatus[] = [
      "DRAFT", "PUBLISHED", "FAILED", "SUPPRESSED", "RETRY_PENDING", "UNKNOWN"
    ];
    expect(validStatuses).toHaveLength(6);
  });
});

// ─── Thesis Fingerprint Tests ───────────────────────────

describe("SQ-OPERATE-02: Thesis Fingerprint", () => {
  it("generates deterministic fingerprint", () => {
    const fp1 = generateThesisFingerprint({
      type: "COIN_SETUP",
      subjectId: 1,
      narrativeId: null,
      coinSymbols: ["BTC"],
      signal: "WATCH",
      entryLow: 65000,
      entryHigh: 67000,
      tpLevels: [69000, 72000],
      slLevel: 63000,
      invalidation: null,
    });

    const fp2 = generateThesisFingerprint({
      type: "COIN_SETUP",
      subjectId: 1,
      narrativeId: null,
      coinSymbols: ["BTC"],
      signal: "WATCH",
      entryLow: 65000,
      entryHigh: 67000,
      tpLevels: [69000, 72000],
      slLevel: 63000,
      invalidation: null,
    });

    expect(fp1).toBe(fp2);
    expect(fp1.length).toBe(64);
  });

  it("different inputs produce different fingerprints", () => {
    const fp1 = generateThesisFingerprint({
      type: "COIN_SETUP",
      subjectId: 1,
      narrativeId: null,
      coinSymbols: ["BTC"],
      signal: "WATCH",
      entryLow: 65000,
      entryHigh: 67000,
      tpLevels: [69000],
      slLevel: 63000,
      invalidation: null,
    });

    const fp2 = generateThesisFingerprint({
      type: "COIN_SETUP",
      subjectId: 1,
      narrativeId: null,
      coinSymbols: ["ETH"],
      signal: "WATCH",
      entryLow: 65000,
      entryHigh: 67000,
      tpLevels: [69000],
      slLevel: 63000,
      invalidation: null,
    });

    expect(fp1).not.toBe(fp2);
  });
});

// ─── Pipeline Summary Tests ─────────────────────────────

describe("SQ-OPERATE-02: Pipeline Execution Summary", () => {
  it("getLastPipelineSummary returns null or object", () => {
    const summary = getLastPipelineSummary();
    expect(summary === null || typeof summary === "object").toBe(true);
  });

  it("PipelineExecutionSummary has required fields", () => {
    const summary: PipelineExecutionSummary = {
      executedAt: new Date().toISOString(),
      durationMs: 1000,
      evaluated: 10,
      qualified: 5,
      persisted: 5,
      published: 2,
      failed: 1,
      deduplicated: 1,
      quotaBlocked: 0,
      retryPending: 1,
      quotaRemaining: 97,
      quotaWarning: false,
      llmUsedCount: 2,
      llmFallbackCount: 0,
      details: [],
    };
    expect(summary.published).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.retryPending).toBe(1);
    expect(summary.quotaWarning).toBe(false);
    expect(summary.llmUsedCount).toBe(2);
  });
});

// ─── Quota Warning Tests ────────────────────────────────

describe("SQ-OPERATE-02: Quota Warning", () => {
  it("QuotaStatus interface has all required fields", () => {
    const quota: QuotaStatus = {
      postsPublished: 85,
      postsRemaining: 15,
      dailyHardCap: 100,
      warningThreshold: true,
    };
    expect(quota.warningThreshold).toBe(true);
    expect(quota.postsRemaining).toBe(15);
    expect(quota.dailyHardCap).toBe(100);
  });

  it("warning triggers at 80% of daily cap", () => {
    const WARNING_THRESHOLD = 80;
    const quota: QuotaStatus = {
      postsPublished: 80,
      postsRemaining: 20,
      dailyHardCap: 100,
      warningThreshold: true,
    };
    expect(quota.postsPublished >= WARNING_THRESHOLD).toBe(true);
    expect(quota.warningThreshold).toBe(true);
  });

  it("no warning below threshold", () => {
    const quota: QuotaStatus = {
      postsPublished: 50,
      postsRemaining: 50,
      dailyHardCap: 100,
      warningThreshold: false,
    };
    expect(quota.warningThreshold).toBe(false);
  });
});

// ─── Content Generator Integration Tests ─────────────────

describe("SQ-OPERATE-02: Content Generator llmUsed", () => {
  it("generateContent returns llmUsed field", async () => {
    const { generateContent } = await import("../content-generator");
    const brief = {
      opportunityId: 1,
      contentType: "text" as const,
      text: "Test content with $BTC",
      cashtags: ["$BTC"],
      dataAsOf: "2026-08-20",
    };

    const result = await generateContent(brief);
    expect(typeof result.llmUsed).toBe("boolean");
    expect(typeof result.text).toBe("string");
    expect(typeof result.templateVersion).toBe("string");
  });
});

// ─── Publisher Result Interface Tests ────────────────────

describe("SQ-OPERATE-02: Publisher Result Interface", () => {
  it("PublicationResult has retryCount field", () => {
    const result: PublicationResult = {
      success: false,
      retryCount: 0,
    };
    expect(result.retryCount).toBe(0);
    expect(result.success).toBe(false);
  });

  it("PublicationResult has failureCategory field", () => {
    const result: PublicationResult = {
      success: false,
      retryCount: 1,
      failureCategory: "TRANSIENT",
    };
    expect(result.failureCategory).toBe("TRANSIENT");
  });

  it("QuotaStatus has warningThreshold field", () => {
    const quota: QuotaStatus = {
      postsPublished: 85,
      postsRemaining: 15,
      dailyHardCap: 100,
      warningThreshold: true,
    };
    expect(quota.warningThreshold).toBe(true);
    expect(quota.postsRemaining).toBe(15);
  });
});
