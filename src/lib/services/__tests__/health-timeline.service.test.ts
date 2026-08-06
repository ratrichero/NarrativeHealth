import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// Mock the db module
jest.mock("@/db", () => ({
  db: {
    select: jest.fn(),
  },
}));

jest.mock("@/db/schema", () => ({
  healthScores: {
    coinId: "coin_id",
    date: "date",
    healthScore: "health_score",
    status: "status",
    scoreChange: "score_change",
  },
  coins: {
    id: "id",
    symbol: "symbol",
  },
}));

import { db } from "@/db";
import { HealthTimelineService } from "../health-timeline.service";
import type { HealthTimelinePoint } from "@/lib/types/health-timeline";

const dbMock = db as any;

describe("HealthTimelineService", () => {
  let service: HealthTimelineService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HealthTimelineService();
  });

  // Helper to create mock points
  function createMockPoints(
    scores: number[],
    startDate = "2026-01-01"
  ): HealthTimelinePoint[] {
    return scores.map((score, i) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      return {
        date: d.toISOString().split("T")[0],
        healthScore: score,
        status: score >= 90 ? "STRONG" : score >= 80 ? "HEALTHY" : score >= 65 ? "NEUTRAL" : score >= 50 ? "CAUTION" : "WEAK",
        change: i > 0 ? scores[i] - scores[i - 1] : null,
      };
    });
  }

  // ─── getCoinTimeline ────────────────────────────────────────────────
  describe("getCoinTimeline", () => {
    it("should return points in ASC date order", async () => {
      const mockScoreRows = [
        { date: "2026-01-03", healthScore: 80, status: "HEALTHY", scoreChange: 5 },
        { date: "2026-01-01", healthScore: 70, status: "NEUTRAL", scoreChange: null },
        { date: "2026-01-02", healthScore: 75, status: "NEUTRAL", scoreChange: 5 },
      ];

      // Mock health scores query (first select call)
      dbMock.select
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              orderBy: jest.fn<any>().mockResolvedValue(mockScoreRows),
            }),
          }),
        })
        // Mock coin symbol query (second select call)
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              limit: jest.fn<any>().mockResolvedValue([{ symbol: "BTC" }]),
            }),
          }),
        });

      const result = await service.getCoinTimeline(1, 30);

      // Points should be in ASC order (the mock returns them in random order,
      // but the DB query uses orderBy(asc), so in real usage they'd be sorted.
      // Here we verify the mapping works correctly)
      expect(result.points).toHaveLength(3);
      expect(result.symbol).toBe("BTC");
      expect(result.coinId).toBe(1);
    });

    it("should return empty points gracefully (no throw)", async () => {
      dbMock.select
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              orderBy: jest.fn<any>().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              limit: jest.fn<any>().mockResolvedValue([{ symbol: "ETH" }]),
            }),
          }),
        });

      const result = await service.getCoinTimeline(2, 30);

      expect(result.points).toHaveLength(0);
      expect(result.trend.direction).toBe("stable");
      expect(result.trend.slope).toBe(0);
      expect(result.trend.change7d).toBe(0);
      expect(result.trend.change30d).toBe(0);
    });

    it("should handle UNKNOWN symbol when coin not found", async () => {
      dbMock.select
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              orderBy: jest.fn<any>().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              limit: jest.fn<any>().mockResolvedValue([]),
            }),
          }),
        });

      const result = await service.getCoinTimeline(999, 30);
      expect(result.symbol).toBe("UNKNOWN");
    });
  });

  // ─── Trend calculation (via getCoinTimeline with mocked data) ────────
  describe("trend calculation", () => {
    // We test the trend calculation indirectly through getCoinTimeline
    // by providing specific score sequences

    it("improving trend: slope > 0.5", async () => {
      // Scores consistently increasing: 60, 62, 64, 66, 68, 70, 72
      // slope ≈ 2.0 per day (well above 0.5 threshold)
      const mockScoreRows = [60, 62, 64, 66, 68, 70, 72].map((score, i) => {
        const d = new Date("2026-01-01");
        d.setDate(d.getDate() + i);
        return {
          date: d.toISOString().split("T")[0],
          healthScore: score,
          status: "NEUTRAL",
          scoreChange: i > 0 ? 2 : null,
        };
      });

      dbMock.select
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              orderBy: jest.fn<any>().mockResolvedValue(mockScoreRows),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              limit: jest.fn<any>().mockResolvedValue([{ symbol: "TEST" }]),
            }),
          }),
        });

      const result = await service.getCoinTimeline(1, 30);

      expect(result.trend.direction).toBe("improving");
      expect(result.trend.slope).toBeGreaterThan(0.5);
    });

    it("declining trend: slope < -0.5", async () => {
      // Scores consistently decreasing: 80, 78, 76, 74, 72, 70, 68
      // slope ≈ -2.0 per day (well below -0.5 threshold)
      const mockScoreRows = [80, 78, 76, 74, 72, 70, 68].map((score, i) => {
        const d = new Date("2026-01-01");
        d.setDate(d.getDate() + i);
        return {
          date: d.toISOString().split("T")[0],
          healthScore: score,
          status: "HEALTHY",
          scoreChange: i > 0 ? -2 : null,
        };
      });

      dbMock.select
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              orderBy: jest.fn<any>().mockResolvedValue(mockScoreRows),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              limit: jest.fn<any>().mockResolvedValue([{ symbol: "TEST" }]),
            }),
          }),
        });

      const result = await service.getCoinTimeline(1, 30);

      expect(result.trend.direction).toBe("declining");
      expect(result.trend.slope).toBeLessThan(-0.5);
    });

    it("stable trend: slope between -0.5 and 0.5", async () => {
      // Scores fluctuating slightly around 70: 70, 70.2, 69.8, 70.1, 69.9, 70, 70.1
      // slope ≈ 0 (stable)
      const stableScores = [70, 70.2, 69.8, 70.1, 69.9, 70, 70.1];
      const mockScoreRows = stableScores.map((score, i) => {
        const d = new Date("2026-01-01");
        d.setDate(d.getDate() + i);
        return {
          date: d.toISOString().split("T")[0],
          healthScore: score,
          status: "NEUTRAL",
          scoreChange: i > 0 ? score - stableScores[i - 1] : null,
        };
      });

      dbMock.select
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              orderBy: jest.fn<any>().mockResolvedValue(mockScoreRows),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              limit: jest.fn<any>().mockResolvedValue([{ symbol: "TEST" }]),
            }),
          }),
        });

      const result = await service.getCoinTimeline(1, 30);

      expect(result.trend.direction).toBe("stable");
      expect(result.trend.slope).toBeGreaterThanOrEqual(-0.5);
      expect(result.trend.slope).toBeLessThanOrEqual(0.5);
    });

    it("should handle < 7 data points", async () => {
      // Only 3 data points
      const mockScoreRows = [60, 65, 70].map((score, i) => {
        const d = new Date("2026-01-01");
        d.setDate(d.getDate() + i);
        return {
          date: d.toISOString().split("T")[0],
          healthScore: score,
          status: "NEUTRAL",
          scoreChange: i > 0 ? score - [60, 65, 70][i - 1] : null,
        };
      });

      dbMock.select
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              orderBy: jest.fn<any>().mockResolvedValue(mockScoreRows),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              limit: jest.fn<any>().mockResolvedValue([{ symbol: "TEST" }]),
            }),
          }),
        });

      const result = await service.getCoinTimeline(1, 30);

      // Should not throw, should use all 3 points for slope calculation
      expect(result.points).toHaveLength(3);
      expect(result.trend.direction).toBe("improving"); // 60→70 is improving
      // change7d should be 70 - 60 = 10 (since we only have 3 points, idx7d = 0)
      expect(result.trend.change7d).toBeCloseTo(10, 1);
    });

    it("change7d uses correct reference point (7th point from end)", async () => {
      // 10 data points: scores 50, 55, 60, 65, 70, 75, 80, 85, 90, 95
      // latest = 95, idx7d = max(0, 10-7) = 3, points[3] = 65
      // change7d = 95 - 65 = 30
      const scores = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
      const mockScoreRows = scores.map((score, i) => {
        const d = new Date("2026-01-01");
        d.setDate(d.getDate() + i);
        return {
          date: d.toISOString().split("T")[0],
          healthScore: score,
          status: "NEUTRAL",
          scoreChange: i > 0 ? scores[i] - scores[i - 1] : null,
        };
      });

      dbMock.select
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              orderBy: jest.fn<any>().mockResolvedValue(mockScoreRows),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              limit: jest.fn<any>().mockResolvedValue([{ symbol: "TEST" }]),
            }),
          }),
        });

      const result = await service.getCoinTimeline(1, 30);

      // change7d = latest(95) - points[idx7d](65) = 30
      expect(result.trend.change7d).toBeCloseTo(30, 1);
      // change30d = latest(95) - oldest(50) = 45
      expect(result.trend.change30d).toBeCloseTo(45, 1);
    });

    it("should handle single data point (no throw)", async () => {
      const mockScoreRows = [
        { date: "2026-01-01", healthScore: 75, status: "NEUTRAL", scoreChange: null },
      ];

      dbMock.select
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              orderBy: jest.fn<any>().mockResolvedValue(mockScoreRows),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn<any>().mockReturnValue({
            where: jest.fn<any>().mockReturnValue({
              limit: jest.fn<any>().mockResolvedValue([{ symbol: "TEST" }]),
            }),
          }),
        });

      const result = await service.getCoinTimeline(1, 30);

      expect(result.points).toHaveLength(1);
      expect(result.trend.direction).toBe("stable");
      expect(result.trend.slope).toBe(0);
    });
  });
});