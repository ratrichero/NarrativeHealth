import { db } from "@/db";
import { narrativeMomentum, narrativeHealth } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type { NarrativeMomentumResult, NarrativeMomentum } from "@/lib/types/narrative-momentum";

function linearSlope(points: Array<{ healthScore: number }>): number {
  if (points.length < 2) return 0;
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += points[i].healthScore;
    sumXY += i * points[i].healthScore;
    sumX2 += i * i;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

export class MomentumService {
  async calculateNarrativeMomentum(
    narrativeId: number,
    date: string,
    healthHistory: Array<{ date: string; healthScore: number }>
  ): Promise<NarrativeMomentumResult> {
    if (healthHistory.length < 3) {
      return { score: 0, type: 'stable', health7dAgo: null, healthNow: null };
    }

    const recent = healthHistory.slice(-7);
    const now = recent[recent.length - 1].healthScore;
    const ago7d = recent[0].healthScore;

    const change7d = now - ago7d;

    const midpoint = Math.floor(recent.length / 2);
    const firstHalfSlope = linearSlope(recent.slice(0, midpoint));
    const secondHalfSlope = linearSlope(recent.slice(midpoint));
    const acceleration = secondHalfSlope - firstHalfSlope;

    let type: 'accelerating' | 'decelerating' | 'stable';
    if (Math.abs(acceleration) < 0.5) type = 'stable';
    else if (acceleration > 0) type = 'accelerating';
    else type = 'decelerating';

    const momentumScore = Math.round(Math.max(-100, Math.min(100, change7d * 10)));

    return {
      score: momentumScore,
      type,
      health7dAgo: ago7d,
      healthNow: now,
    };
  }

  async saveMomentum(narrativeId: number, date: string): Promise<void> {
    const history = await db
      .select({
        date: narrativeHealth.date,
        healthScore: narrativeHealth.healthScore,
      })
      .from(narrativeHealth)
      .where(
        and(
          eq(narrativeHealth.narrativeId, narrativeId),
          sql`${narrativeHealth.date} <= ${date}`
        )
      )
      .orderBy(desc(narrativeHealth.date))
      .limit(7);

    const reversedHistory = history.map(h => ({
      date: typeof h.date === 'string' ? h.date : String(h.date),
      healthScore: typeof h.healthScore === 'number' ? h.healthScore : (h.healthScore ? parseFloat(h.healthScore as any) : 0),
    })).reverse();

    const result = await this.calculateNarrativeMomentum(narrativeId, date, reversedHistory);

    await db
      .insert(narrativeMomentum)
      .values({
        narrativeId,
        date,
        momentumScore: String(result.score),
        momentumType: result.type,
        health7dAgo: result.health7dAgo != null ? String(result.health7dAgo) : null,
        healthNow: result.healthNow != null ? String(result.healthNow) : null,
      } as any)
      .onConflictDoUpdate({
        target: [narrativeMomentum.narrativeId, narrativeMomentum.date],
        set: {
          momentumScore: String(result.score),
          momentumType: result.type,
          health7dAgo: result.health7dAgo != null ? String(result.health7dAgo) : null,
          healthNow: result.healthNow != null ? String(result.healthNow) : null,
        } as any,
      });
  }

  async getMomentumHistory(narrativeId: number, days: number): Promise<NarrativeMomentum[]> {
    const result = await db
      .select()
      .from(narrativeMomentum)
      .where(eq(narrativeMomentum.narrativeId, narrativeId))
      .orderBy(desc(narrativeMomentum.date))
      .limit(days);

    return result.map(r => ({
      ...r,
      momentumScore: r.momentumScore ? parseFloat(r.momentumScore) : null,
      health7dAgo: r.health7dAgo ? parseFloat(r.health7dAgo) : null,
      healthNow: r.healthNow ? parseFloat(r.healthNow) : null,
    })) as NarrativeMomentum[];
  }
}

export const momentumService = new MomentumService();
