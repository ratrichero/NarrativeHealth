import { db } from "@/db";
import { indicators, coins } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { calculateIndicators } from "@/lib/indicators/engine";
import { KlineData } from "@/lib/technical-analysis/types";

export class IndicatorService {
  async calculateAndSave(
    data: KlineData[],
    coinId: number,
    date: string,
    timeframe: string,
    source: string
  ): Promise<void> {
    const calculated = calculateIndicators(data, timeframe);
    const [coin] = await db.select().from(coins).where(eq(coins.id, coinId)).limit(1);
    if (!coin) return;

    for (const ind of calculated) {
      const valueStr = ind.value != null ? String(ind.value) : null;
      await db
        .insert(indicators)
        .values({
          coinId: coinId as any,
          date: date as any,
          timeframe: timeframe as any,
          indicatorType: ind.type as any,
          indicatorValue: valueStr as any,
          indicatorMeta: ind.meta ?? null,
          source: source as any,
        } as any)
        .onConflictDoUpdate({
          target: [indicators.coinId, indicators.date, indicators.timeframe, indicators.indicatorType],
          set: {
            indicatorValue: valueStr as any,
            indicatorMeta: ind.meta ?? null,
            source: source as any,
            calculatedAt: sql`NOW()`,
          } as any,
        } as any);
    }
  }

  async getIndicators(
    coinId: number,
    date: string,
    timeframe?: string
  ): Promise<any[]> {
    const conditions = [eq(indicators.coinId, coinId), eq(indicators.date, date)];
    if (timeframe) {
      conditions.push(eq(indicators.timeframe, timeframe));
    }

    return db.select().from(indicators).where(and(...conditions));
  }

  async getIndicatorHistory(
    coinId: number,
    indicatorType: string,
    days: number
  ): Promise<Array<{ date: string; value: number | null }>> {
    const result = await db
      .select({
        date: indicators.date,
        value: indicators.indicatorValue,
      })
      .from(indicators)
      .where(
        and(
          eq(indicators.coinId, coinId),
          eq(indicators.indicatorType, indicatorType)
        )
      )
      .orderBy(desc(indicators.date))
      .limit(days);

    return result.map(r => ({
      date: typeof r.date === 'string' ? r.date : String(r.date),
      value: r.value ? parseFloat(r.value) : null,
    }));
  }
}

export const indicatorService = new IndicatorService();
