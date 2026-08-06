import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// Mock the db module before importing the service
jest.mock("@/db", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    transaction: jest.fn(),
  },
}));

jest.mock("@/db/schema", () => ({
  ruleVersions: {
    id: "id",
    version: "version",
    isActive: "is_active",
    healthWeights: "health_weights",
    confidenceWeights: "confidence_weights",
    recommendationThresholds: "recommendation_thresholds",
  },
}));

// Import after mocks are set up
import { db } from "@/db";
import { RuleVersionService } from "../rule-version.service";
import type {
  HealthWeights,
  ConfidenceWeights,
  RecommendationThresholds,
  CreateRuleVersionInput,
} from "@/lib/types/rule-version";

// Cast db to any for testing to avoid strict type issues with mocks
const dbMock = db as any;

describe("RuleVersionService", () => {
  let service: RuleVersionService;

  const validHealthWeights: HealthWeights = {
    trend: 0.35,
    derivative: 0.35,
    volume: 0.2,
    momentum: 0.1,
  };

  const validConfidenceWeights: ConfidenceWeights = {
    binance_spot: 0.4,
    binance_futures: 0.4,
    coingecko: 0.2,
  };

  const validThresholds: RecommendationThresholds = {
    strong_watch: 90,
    watch: 80,
    observe: 65,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RuleVersionService();
  });

  // Helper to create a mock limit chain that resolves to a value
  function mockLimitChain(resolveValue: any) {
    return jest.fn<any>().mockReturnValue({
      from: jest.fn<any>().mockReturnValue({
        where: jest.fn<any>().mockReturnValue({
          limit: jest.fn<any>().mockResolvedValue(resolveValue),
        }),
      }),
    });
  }

  // ─── getActiveVersion ───────────────────────────────────────────────
  describe("getActiveVersion", () => {
    it("should throw when no active version found", async () => {
      dbMock.select.mockReturnValue({
        from: jest.fn<any>().mockReturnValue({
          where: jest.fn<any>().mockReturnValue({
            limit: jest.fn<any>().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.getActiveVersion()).rejects.toThrow(
        "No active rule version found."
      );
    });

    it("should return mapped RuleVersion when active version exists", async () => {
      const mockRow = {
        id: 1,
        version: 1,
        description: "Initial",
        healthWeights: validHealthWeights,
        confidenceWeights: validConfidenceWeights,
        recommendationThresholds: validThresholds,
        isActive: true,
        createdAt: new Date("2026-01-01"),
        activatedAt: new Date("2026-01-01"),
      };

      dbMock.select.mockReturnValue({
        from: jest.fn<any>().mockReturnValue({
          where: jest.fn<any>().mockReturnValue({
            limit: jest.fn<any>().mockResolvedValue([mockRow]),
          }),
        }),
      });

      const result = await service.getActiveVersion();
      expect(result.id).toBe(1);
      expect(result.isActive).toBe(true);
      expect(result.healthWeights.trend).toBe(0.35);
    });
  });

  // ─── createVersion ──────────────────────────────────────────────────
  describe("createVersion", () => {
    it("should increment version number correctly", async () => {
      const input: CreateRuleVersionInput = {
        healthWeights: validHealthWeights,
        confidenceWeights: validConfidenceWeights,
        recommendationThresholds: validThresholds,
      };

      // Mock max version query (returns 5, so next should be 6)
      dbMock.select.mockReturnValueOnce({
        from: jest.fn<any>().mockResolvedValue([{ maxVersion: 5 }]),
      });

      // Mock insert
      const mockNewRow = {
        id: 10,
        version: 6,
        description: null,
        healthWeights: validHealthWeights,
        confidenceWeights: validConfidenceWeights,
        recommendationThresholds: validThresholds,
        isActive: false,
        createdAt: new Date(),
        activatedAt: null,
      };

      dbMock.insert.mockReturnValue({
        values: jest.fn<any>().mockReturnValue({
          returning: jest.fn<any>().mockResolvedValue([mockNewRow]),
        }),
      });

      const result = await service.createVersion(input, false);
      expect(result.version).toBe(6);
    });

    it("should validate weights and reject sum != 1.0", async () => {
      const invalidWeights: HealthWeights = {
        trend: 0.5,
        derivative: 0.3,
        volume: 0.1,
        momentum: 0.2, // sum = 1.1, not 1.0
      };

      const input: CreateRuleVersionInput = {
        healthWeights: invalidWeights,
        confidenceWeights: validConfidenceWeights,
        recommendationThresholds: validThresholds,
      };

      await expect(service.createVersion(input, false)).rejects.toThrow(
        /must sum to 1.0/
      );
    });

    it("should accept weights summing to 1.0 ± 0.001 tolerance", async () => {
      // Sum = 1.0005, within tolerance
      const toleranceWeights: HealthWeights = {
        trend: 0.3502,
        derivative: 0.3502,
        volume: 0.1998,
        momentum: 0.0998, // sum ≈ 1.0
      };

      const input: CreateRuleVersionInput = {
        healthWeights: toleranceWeights,
        confidenceWeights: validConfidenceWeights,
        recommendationThresholds: validThresholds,
      };

      // Mock max version query
      dbMock.select.mockReturnValueOnce({
        from: jest.fn<any>().mockResolvedValue([{ maxVersion: 0 }]),
      });

      const mockNewRow = {
        id: 1,
        version: 1,
        description: null,
        healthWeights: toleranceWeights,
        confidenceWeights: validConfidenceWeights,
        recommendationThresholds: validThresholds,
        isActive: false,
        createdAt: new Date(),
        activatedAt: null,
      };

      dbMock.insert.mockReturnValue({
        values: jest.fn<any>().mockReturnValue({
          returning: jest.fn<any>().mockResolvedValue([mockNewRow]),
        }),
      });

      const result = await service.createVersion(input, false);
      expect(result).toBeDefined();
    });

    it("should validate thresholds and reject strong_watch <= watch", async () => {
      const invalidThresholds: RecommendationThresholds = {
        strong_watch: 80,
        watch: 80,
        observe: 65,
      };

      const input: CreateRuleVersionInput = {
        healthWeights: validHealthWeights,
        confidenceWeights: validConfidenceWeights,
        recommendationThresholds: invalidThresholds,
      };

      await expect(service.createVersion(input, false)).rejects.toThrow(
        /strong_watch.*must be greater than watch/
      );
    });

    it("should reject watch <= observe", async () => {
      const invalidThresholds: RecommendationThresholds = {
        strong_watch: 90,
        watch: 65,
        observe: 65,
      };

      const input: CreateRuleVersionInput = {
        healthWeights: validHealthWeights,
        confidenceWeights: validConfidenceWeights,
        recommendationThresholds: invalidThresholds,
      };

      await expect(service.createVersion(input, false)).rejects.toThrow(
        /watch.*must be greater than observe/
      );
    });
  });

  // ─── activate ───────────────────────────────────────────────────────
  describe("activate", () => {
    it("should throw when version not found", async () => {
      // Mock getVersionById to return null
      dbMock.select.mockReturnValue({
        from: jest.fn<any>().mockReturnValue({
          where: jest.fn<any>().mockReturnValue({
            limit: jest.fn<any>().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.activate(999)).rejects.toThrow(
        /not found/
      );
    });

    it("should use transaction to deactivate others and activate target", async () => {
      const mockRow = {
        id: 2,
        version: 2,
        description: "v2",
        healthWeights: validHealthWeights,
        confidenceWeights: validConfidenceWeights,
        recommendationThresholds: validThresholds,
        isActive: false,
        createdAt: new Date(),
        activatedAt: null,
      };

      // Mock getVersionById
      dbMock.select.mockReturnValue({
        from: jest.fn<any>().mockReturnValue({
          where: jest.fn<any>().mockReturnValue({
            limit: jest.fn<any>().mockResolvedValue([mockRow]),
          }),
        }),
      });

      // Mock transaction
      const txUpdateMock = jest.fn<any>().mockReturnValue({
        set: jest.fn<any>().mockReturnValue({
          where: jest.fn<any>().mockResolvedValue(undefined),
        }),
      });

      dbMock.transaction.mockImplementation(async (callback: any) => {
        await callback({
          update: txUpdateMock,
        });
      });

      await service.activate(2);

      expect(dbMock.transaction).toHaveBeenCalled();
      // First call: deactivate all (no where clause)
      // Second call: activate target (with where clause)
      expect(txUpdateMock).toHaveBeenCalledTimes(2);
    });
  });
});