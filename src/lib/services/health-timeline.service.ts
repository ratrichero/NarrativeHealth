import { db } from "@/db";
import { healthScores, coins } from "@/db/schema";
import { eq, and, gte, asc } from "drizzle-orm";
import type {
  HealthTimeline,
  HealthTimelinePoint,
  HealthTrend,
} from "@/lib/types/health-timeline";

/**
 * HealthTimelineService - Retrieves and analyzes coin health history (P0C)
 *
 * Responsibilities:
 * - Fetch health score timeline for a coin over N days
 * - Calculate trend (improving/declining/stable) via linear regression
 * - Compute 7-day and 30-day changes
 */
export class HealthTimelineService {
  /**
   * Get the health timeline for a specific coin.
   *
   * @param coinId - The coin ID
   * @param days - Number of days to look back (default 30)
   * @returns HealthTimeline with points and trend
   */
  async getCoinTimeline(coinId: number, days = 30): Promise<HealthTimeline> {
    // Calculate sinceDate = today - days days (YYYY-MM-DD format)
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    const sinceDateStr = sinceDate.toISOString().split("T")[0];

    // Query health scores
    const scoreRows = await db
      .select({
        date: healthScores.date,
        healthScore: healthScores.healthScore,
        status: healthScores.status,
        scoreChange: healthScores.scoreChange,
      })
      .from(healthScores)
      .where(and(eq(healthScores.coinId, coinId), gte(healthScores.date, sinceDateStr)))
      .orderBy(asc(healthScores.date));

    // Query coin symbol
    const [coinRow] = await db
      .select({ symbol: coins.symbol })
      .from(coins)
      .where(eq(coins.id, coinId))
      .limit(1);

    const symbol = coinRow?.symbol ?? "UNKNOWN";

    // Map to HealthTimelinePoint[]
    const points: HealthTimelinePoint[] = scoreRows.map((row) => ({
      date: row.date,
      healthScore: row.healthScore,
      status: row.status as HealthTimelinePoint["status"],
      change: row.scoreChange !== null ? Number(row.scoreChange) : null,
    }));

    // Calculate trend
    const trend = this.calculateTrend(points);

    return {
      coinId,
      symbol,
      points,
      trend,
    };
  }

  /**
   * Calculate trend from a series of health timeline points.
   *
   * Uses linear regression on the last 7 points (or all if < 7) to determine slope.
   * Direction: improving (slope > 0.5), declining (slope < -0.5), stable otherwise.
   *
   * @param points - Array of HealthTimelinePoint (ordered by date ASC)
   * @returns HealthTrend with direction, slope, and 7d/30d changes
   */
  private calculateTrend(points: HealthTimelinePoint[]): HealthTrend {
    if (points.length < 2) {
      return {
        direction: "stable",
        slope: 0,
        change7d: 0,
        change30d: 0,
      };
    }

    const latest = points[points.length - 1].healthScore;
    const oldest = points[0].healthScore;

    // 7-day change
    const idx7d = Math.max(0, points.length - 7);
    const change7d = latest - points[idx7d].healthScore;

    // 30-day change
    const change30d = latest - oldest;

    // Linear slope on last 7 points (or all if < 7)
    const recentPoints = points.slice(-7);
    const slope = this.linearSlope(
      recentPoints.map((p, i) => [i, p.healthScore])
    );

    // Determine direction
    let direction: HealthTrend["direction"];
    if (slope > 0.5) {
      direction = "improving";
    } else if (slope < -0.5) {
      direction = "declining";
    } else {
      direction = "stable";
    }

    return {
      direction,
      slope: Math.round(slope * 100) / 100,
      change7d: Math.round(change7d * 100) / 100,
      change30d: Math.round(change30d * 100) / 100,
    };
  }

  /**
   * Calculate the slope of a linear regression line through the given points.
   * Uses least squares method.
   *
   * @param points - Array of [x, y] pairs
   * @returns The slope of the best-fit line, or 0 if undefined
   */
  private linearSlope(points: [number, number][]): number {
    const n = points.length;
    if (n < 2) return 0;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (const [x, y] of points) {
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return 0;

    return (n * sumXY - sumX * sumY) / denom;
  }
}

// Export singleton instance
export const healthTimelineService = new HealthTimelineService();