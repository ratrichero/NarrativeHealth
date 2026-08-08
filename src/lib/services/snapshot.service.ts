import { db } from "@/db";
import {
  morningSnapshotHeaders,
  morningSnapshotCoins,
  morningSnapshotNarratives,
  healthScores,
  coins as coinsTable,
  narratives,
} from "@/db/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import type {
  MorningSnapshotHeader,
  MorningSnapshotCoin,
  MorningSnapshotNarrative,
  FullSnapshot,
  SnapshotSummary,
  CoinSnapshotPoint,
  NarrativeSnapshotPoint,
} from "@/lib/types/morning-snapshot";

function parseNum(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const parsed = parseFloat(val);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(val: string | Date): string {
  return val instanceof Date ? val.toISOString().split('T')[0] : String(val);
}

export class SnapshotService {
  async createDailySnapshot(
    date: string,
    coinScores: Array<{ coinId: number; healthScore: number | null; scoreChange: number | null; signal: string | null; confidence: number | null }>,
    narrativeScores: Array<{
      narrativeId: number;
      healthScore: number | null;
      scoreChange: number | null;
      coinCount: number | null;
      topCoinId: number | null;
      weakestCoinId: number | null;
      weightingMethod: string | null;
    }>,
    ruleVersionId: number
  ): Promise<number> {
    const [existing] = await db
      .select()
      .from(morningSnapshotHeaders)
      .where(eq(morningSnapshotHeaders.date, date))
      .limit(1);

    if (existing) {
      return existing.id;
    }

    const totalCoins = coinScores.length;
    const avgHealthScore = totalCoins > 0
      ? coinScores.reduce((sum, c) => sum + (c.healthScore ?? 0), 0) / totalCoins
      : 0;
    const topNarrative = narrativeScores.length > 0 ? narrativeScores[0] : null;

    const alertCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(healthScores)
      .where(and(eq(healthScores.date, date), sql`${healthScores.healthScore} < 65`));

    const [header] = await db
      .insert(morningSnapshotHeaders)
      .values({
        date,
        totalCoins,
        avgHealthScore: Math.round(avgHealthScore * 100) / 100,
        topNarrativeId: topNarrative?.narrativeId ?? null,
        alertCount: alertCountResult[0]?.count ?? 0,
        ruleVersionId,
        timezone: 'Asia/Ho_Chi_Minh',
      } as any)
      .returning();

    if (!header) throw new Error('Failed to create snapshot header');

    await db.insert(morningSnapshotCoins).values(
      coinScores.map(c => ({
        snapshotId: header.id,
        coinId: c.coinId,
        healthScore: c.healthScore ?? null,
        scoreChange: c.scoreChange ?? null,
        signal: c.signal ?? null,
        confidence: c.confidence ?? null,
      })) as any[]
    );

    await db.insert(morningSnapshotNarratives).values(
      narrativeScores.map(n => ({
        snapshotId: header.id,
        narrativeId: n.narrativeId,
        healthScore: n.healthScore ?? null,
        scoreChange: n.scoreChange ?? null,
        coinCount: n.coinCount ?? null,
        topCoinId: n.topCoinId ?? null,
        weakestCoinId: n.weakestCoinId ?? null,
        weightingMethod: n.weightingMethod ?? null,
      })) as any[]
    );

    return header.id;
  }

  async getSnapshotByDate(date: string): Promise<FullSnapshot | null> {
    const [header] = await db
      .select()
      .from(morningSnapshotHeaders)
      .where(eq(morningSnapshotHeaders.date, date))
      .limit(1);

    if (!header) return null;

    const coins = await db
      .select()
      .from(morningSnapshotCoins)
      .where(eq(morningSnapshotCoins.snapshotId, header.id));

    const narratives = await db
      .select()
      .from(morningSnapshotNarratives)
      .where(eq(morningSnapshotNarratives.snapshotId, header.id));

    return {
      header: header as MorningSnapshotHeader,
      coins: coins as MorningSnapshotCoin[],
      narratives: narratives as MorningSnapshotNarrative[],
    };
  }

  async getSnapshotHistory(days: number): Promise<SnapshotSummary[]> {
    const result = await db
      .select({
        id: morningSnapshotHeaders.id,
        date: morningSnapshotHeaders.date,
        totalCoins: morningSnapshotHeaders.totalCoins,
        avgHealthScore: morningSnapshotHeaders.avgHealthScore,
        topNarrativeId: morningSnapshotHeaders.topNarrativeId,
        alertCount: morningSnapshotHeaders.alertCount,
        ruleVersionId: morningSnapshotHeaders.ruleVersionId,
        timezone: morningSnapshotHeaders.timezone,
        createdAt: morningSnapshotHeaders.createdAt,
        topNarrativeName: narratives.name,
      })
      .from(morningSnapshotHeaders)
      .leftJoin(narratives, eq(narratives.id, morningSnapshotHeaders.topNarrativeId))
      .orderBy(desc(morningSnapshotHeaders.date))
      .limit(days);

    return result.map(r => ({
      id: r.id,
      date: formatDate(r.date),
      totalCoins: r.totalCoins ?? 0,
      avgHealthScore: parseNum(r.avgHealthScore),
      topNarrativeId: r.topNarrativeId ?? null,
      alertCount: r.alertCount ?? 0,
      ruleVersionId: r.ruleVersionId ?? null,
      timezone: r.timezone ?? 'Asia/Ho_Chi_Minh',
      createdAt: r.createdAt ?? new Date(),
      topNarrativeName: r.topNarrativeName ?? null,
    }));
  }

  async getNarrativeHistory(
    narrativeId: number,
    days: number
  ): Promise<Array<{ date: string; healthScore: number | null; scoreChange: number | null }>> {
    const result = await db
      .select({
        date: morningSnapshotHeaders.date,
        healthScore: morningSnapshotNarratives.healthScore,
        scoreChange: morningSnapshotNarratives.scoreChange,
      })
      .from(morningSnapshotNarratives)
      .innerJoin(morningSnapshotHeaders, eq(morningSnapshotHeaders.id, morningSnapshotNarratives.snapshotId))
      .where(eq(morningSnapshotNarratives.narrativeId, narrativeId))
      .orderBy(asc(morningSnapshotHeaders.date))
      .limit(days);

    return result.map(r => ({
      date: formatDate(r.date),
      healthScore: parseNum(r.healthScore),
      scoreChange: parseNum(r.scoreChange),
    }));
  }

  async getCoinHistory(
    coinId: number,
    days: number
  ): Promise<CoinSnapshotPoint[]> {
    const result = await db
      .select({
        coinId: morningSnapshotCoins.coinId,
        symbol: coinsTable.symbol,
        healthScore: morningSnapshotCoins.healthScore,
        scoreChange: morningSnapshotCoins.scoreChange,
        signal: morningSnapshotCoins.signal,
        confidence: morningSnapshotCoins.confidence,
      })
      .from(morningSnapshotCoins)
      .innerJoin(morningSnapshotHeaders, eq(morningSnapshotHeaders.id, morningSnapshotCoins.snapshotId))
      .innerJoin(coinsTable, eq(coinsTable.id, morningSnapshotCoins.coinId))
      .where(eq(morningSnapshotCoins.coinId, coinId))
      .orderBy(asc(morningSnapshotHeaders.date))
      .limit(days);

    return result.map(r => ({
      coinId: r.coinId,
      symbol: r.symbol,
      healthScore: parseNum(r.healthScore),
      scoreChange: parseNum(r.scoreChange),
      signal: r.signal ?? null,
      confidence: parseNum(r.confidence),
    }));
  }
}

export const snapshotService = new SnapshotService();
