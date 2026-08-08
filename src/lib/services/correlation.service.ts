import { db } from "@/db";
import { coinCorrelations, coins as coinsTable, healthScores, coinNarratives, narratives } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type { CorrelationMatrix, CoinCorrelation } from "@/lib/types/correlation";

export class CorrelationService {
  async calculatePearsonCorrelation(
    series1: number[],
    series2: number[]
  ): Promise<number> {
    const n = Math.min(series1.length, series2.length);
    if (n < 5) return 0;

    const mean1 = series1.slice(-n).reduce((a, b) => a + b, 0) / n;
    const mean2 = series2.slice(-n).reduce((a, b) => a + b, 0) / n;

    let num = 0;
    let den1 = 0;
    let den2 = 0;

    for (let i = 0; i < n; i++) {
      const d1 = series1[i] - mean1;
      const d2 = series2[i] - mean2;
      num += d1 * d2;
      den1 += d1 * d1;
      den2 += d2 * d2;
    }

    const denom = Math.sqrt(den1 * den2);
    return denom === 0 ? 0 : num / denom;
  }

  async getCorrelationMatrix(narrativeId: number, days: number = 30): Promise<CorrelationMatrix> {
    const narrativeResult = await db
      .select({ id: narratives.id, name: narratives.name })
      .from(narratives)
      .where(eq(narratives.id, narrativeId))
      .limit(1);

    const narrative = narrativeResult[0];
    const narrativeName = narrative?.name ?? "";

    const coinsInNarrative = await db
      .select({
        coinId: coinsTable.id,
        symbol: coinsTable.symbol,
      })
      .from(coinsTable)
      .innerJoin(
        coinNarratives,
        and(
          eq(coinNarratives.coinId, coinsTable.id),
          eq(coinNarratives.narrativeId, narrativeId)
        )
      )
      .where(eq(coinsTable.isActive, true))
      .orderBy(coinsTable.symbol);

    const coins = coinsInNarrative.map(r => ({ coinId: r.coinId, symbol: r.symbol }));

    const historyPromises = coins.map(c => this.getHealthScoreHistory(c.coinId, days));
    const histories = await Promise.all(historyPromises);

    const matrix: number[][] = [];
    const correlations: number[] = [];

    for (let i = 0; i < coins.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < coins.length; j++) {
        if (i === j) {
          matrix[i][j] = 1.0;
        } else {
          const correlation = await this.calculatePearsonCorrelation(histories[i], histories[j]);
          matrix[i][j] = Math.round(correlation * 1000) / 1000;
          if (i < j) {
            correlations.push(correlation);
          }
        }
      }
    }

    const avgCorrelation = correlations.length > 0
      ? correlations.reduce((a, b) => a + b, 0) / correlations.length
      : 0;

    return {
      narrativeId,
      narrativeName,
      coins,
      matrix,
      avgCorrelation: Math.round(avgCorrelation * 1000) / 1000,
    };
  }

  async saveDailyCorrelations(date: string, periodDays: number = 30): Promise<void> {
    const activeCoins = await db
      .select({ id: coinsTable.id })
      .from(coinsTable)
      .where(eq(coinsTable.isActive, true));

    const coinIds = activeCoins.map(c => c.id);
    const historyPromises = coinIds.map(id => this.getHealthScoreHistory(id, periodDays));
    const allHistories = await Promise.all(historyPromises);

    for (let i = 0; i < coinIds.length; i++) {
      for (let j = i + 1; j < coinIds.length; j++) {
        const correlation = await this.calculatePearsonCorrelation(allHistories[i], allHistories[j]);

        await db
          .insert(coinCorrelations)
          .values({
            date,
            coinIdA: coinIds[i],
            coinIdB: coinIds[j],
            correlation: String(Math.round(correlation * 1000) / 1000),
            periodDays,
          } as any)
          .onConflictDoUpdate({
            target: [coinCorrelations.date, coinCorrelations.coinIdA, coinCorrelations.coinIdB, coinCorrelations.periodDays],
            set: { correlation: String(Math.round(correlation * 1000) / 1000) } as any,
          });
      }
    }
  }

  private async getHealthScoreHistory(coinId: number, days: number): Promise<number[]> {
    const result = await db
      .select({ healthScore: healthScores.healthScore })
      .from(healthScores)
      .where(eq(healthScores.coinId, coinId))
      .orderBy(desc(healthScores.date))
      .limit(days);

    return result
      .map(r => typeof r.healthScore === 'number' ? r.healthScore : parseFloat(r.healthScore as any))
      .reverse();
  }
}

export const correlationService = new CorrelationService();
