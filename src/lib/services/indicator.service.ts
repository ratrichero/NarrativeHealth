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
    if (data.length === 0) {
      console.warn(`[INDICATOR-SVC] coin=${coinId}: empty data array, skipping`);
      return;
    }

    const calculated = calculateIndicators(data, timeframe);
    console.log(`[INDICATOR-SVC] coin=${coinId} ${date} ${timeframe}: calculated=${calculated.length} indicators`);

    if (calculated.length === 0) {
      console.warn(`[INDICATOR-SVC] coin=${coinId} ${date} ${timeframe}: NO indicators calculated (data.length=${data.length})`);
    }

    const [coin] = await db.select().from(coins).where(eq(coins.id, coinId)).limit(1);
    if (!coin) {
      console.warn(`[INDICATOR-SVC] coin=${coinId}: NOT FOUND in coins table, skipping`);
      return;
    }

    let saved = 0;
    let failed = 0;
    for (const ind of calculated) {
      try {
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
        saved++;
      } catch (indErr) {
        failed++;
        const errMsg = indErr instanceof Error ? indErr.message : String(indErr);
        console.error(`[INDICATOR-SVC] coin=${coinId} ${date} ${timeframe} ${ind.type}: DB INSERT FAILED: ${errMsg}`);
      }
    }
    console.log(`[INDICATOR-SVC] coin=${coinId} ${date} ${timeframe}: saved=${saved} failed=${failed}`);
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
