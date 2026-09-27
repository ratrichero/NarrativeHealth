import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  narratives,
  coins,
  coinNarratives,
  narrativeHealth,
  healthScores,
  recommendations,
  sourceStatus,
  features,
} from "@/db/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { getHealthStatus, getBusinessDate, getYesterdayBusinessDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const today = getBusinessDate();
    const yesterday = getYesterdayBusinessDate();

    // Fetch active narratives with their health scores
    const activeNarratives = await db
      .select({
        id: narratives.id,
        name: narratives.name,
        description: narratives.description,
      })
      .from(narratives)
      .where(eq(narratives.isActive, true));

    // SQ-FIX: Always serve the freshest available data, never a blank report.
    // The business date (Asia/Ho_Chi_Minh) rolls over at midnight VN. If the
    // daily refresh has not run yet, there is no row for `today` and the old
    // code rendered placeholder score 50 for every narrative until the user
    // hit Refresh Data manually. Instead: detect the latest date that actually
    // has narrative_health rows and query against that date, so both manual
    // refresh and scheduler refresh show up immediately, first visit included.
    const [latestHealthRow] = await db
      .select({ date: narrativeHealth.date })
      .from(narrativeHealth)
      .where(
        sql`${narrativeHealth.narrativeId} IN (${sql.join(
          activeNarratives.map((n) => sql`${n.id}`),
          sql`, `
        )})`
      )
      .orderBy(desc(narrativeHealth.date))
      .limit(1);

    const latestDataDate: string | null = latestHealthRow?.date ?? null;
    // Primary date = freshest date with data (falls back from today),
    // secondary = the day before it (for score-change comparison).
    const dataDate = latestDataDate ?? today;
    const prevDate = latestDataDate
      ? getBusinessDate(
          new Date(new Date(latestDataDate + "T00:00:00+07:00").getTime() - 24 * 60 * 60 * 1000)
        )
      : yesterday;
    const dataIsStale = latestDataDate !== null && latestDataDate !== today;
    // Fetch narrative health data for the resolved data dates
    const narrativeHealthData = await db
      .select()
      .from(narrativeHealth)
      .where(
        and(
          gte(narrativeHealth.date, prevDate),
          sql`${narrativeHealth.narrativeId} IN (${sql.join(
            activeNarratives.map((n) => sql`${n.id}`),
            sql`, `
          )})`
        )
      )
      .orderBy(desc(narrativeHealth.date));

    // Get coin counts per narrative
    const coinCountsResult = await db
      .select({
        narrativeId: coinNarratives.narrativeId,
        count: sql<number>`count(*)::int`,
      })
      .from(coinNarratives)
      .innerJoin(coins, eq(coins.id, coinNarratives.coinId))
      .where(eq(coins.isActive, true))
      .groupBy(coinNarratives.narrativeId);

    const coinCountMap = new Map(coinCountsResult.map((c) => [c.narrativeId, c.count]));

    // Build narrative summaries
    const narrativeSummaries = await Promise.all(
      activeNarratives.map(async (narrative) => {
        // SQ-FIX: look up health rows against the resolved data dates, and
        // never fabricate a score. If there is genuinely no data, status is
        // null so the UI shows "No Data" instead of a fake 50/CAUTION badge.
        const healthData = narrativeHealthData.find(
          (h) => h.narrativeId === narrative.id && h.date === dataDate
        );
        const prevHealthData = narrativeHealthData.find(
          (h) => h.narrativeId === narrative.id && h.date === prevDate
        );

        // Get top coin for this narrative
        let topCoin = null;
        let weakestCoin = null;

        if (healthData?.topCoinId) {
          const topCoinData = await db
            .select({ id: coins.id, symbol: coins.symbol, name: coins.name })
            .from(coins)
            .where(eq(coins.id, healthData.topCoinId))
            .limit(1);

          if (topCoinData.length > 0) {
            const topCoinHealth = await db
              .select({ healthScore: healthScores.healthScore })
              .from(healthScores)
              .where(and(eq(healthScores.coinId, healthData.topCoinId), eq(healthScores.date, today)))
              .limit(1);

            topCoin = {
              id: topCoinData[0].id,
              symbol: topCoinData[0].symbol,
              name: topCoinData[0].name,
              healthScore: topCoinHealth[0]?.healthScore || 0,
            };
          }
        }

        if (healthData?.weakestCoinId) {
          const weakestCoinData = await db
            .select({ id: coins.id, symbol: coins.symbol, name: coins.name })
            .from(coins)
            .where(eq(coins.id, healthData.weakestCoinId))
            .limit(1);

          if (weakestCoinData.length > 0) {
            const weakestCoinHealth = await db
              .select({ healthScore: healthScores.healthScore })
              .from(healthScores)
              .where(
                and(eq(healthScores.coinId, healthData.weakestCoinId), eq(healthScores.date, today))
              )
              .limit(1);

            weakestCoin = {
              id: weakestCoinData[0].id,
              symbol: weakestCoinData[0].symbol,
              name: weakestCoinData[0].name,
              healthScore: weakestCoinHealth[0]?.healthScore || 0,
            };
          }
        }

        const score = healthData?.healthScore ?? null;

        return {
          id: narrative.id,
          name: narrative.name,
          healthScore: score,
          previousScore: prevHealthData?.healthScore || null,
          scoreChange: healthData?.scoreChange ?? null,
          status: score !== null ? getHealthStatus(score) : null,
          coinCount: coinCountMap.get(narrative.id) || 0,
          topCoin,
          weakestCoin,
          avgConfidence: healthData?.avgConfidence || null,
          signal: null,
        };
      })
    );

    // Sort by health score (nulls last)
    narrativeSummaries.sort(
      (a, b) => (b.healthScore ?? -1) - (a.healthScore ?? -1)
    );

    // PA-A (MOVE-COMPOSITE): "Mạnh nhất" / "Weakest" must agree with the
    // scoring used by Đề xuất nổi bật (top-recommendations). Raw scoreChange
    // ranking put bearish-only markets under a green header, while weakest
    // ranked by health alone ignored trend/momentum. We replicate the same
    // classifyDirection + bull/bear composites here (small intentional copy —
    // see src/app/api/dashboard/top-recommendations/route.ts as source of
    // truth) so both views tell the same story on the same data date.
    const moverRows = await db
      .select({
        coinId: healthScores.coinId,
        healthScore: healthScores.healthScore,
        scoreChange: healthScores.scoreChange,
        signal: recommendations.signal,
        trendScore: features.trendScore,
        momentumScore: features.momentumScore,
        symbol: coins.symbol,
        name: coins.name,
      })
      .from(healthScores)
      .innerJoin(coins, eq(coins.id, healthScores.coinId))
      .leftJoin(
        recommendations,
        and(
          eq(recommendations.coinId, healthScores.coinId),
          eq(recommendations.date, dataDate)
        )
      )
      .leftJoin(
        features,
        and(
          eq(features.coinId, healthScores.coinId),
          eq(features.date, dataDate)
        )
      )
      .where(and(eq(healthScores.date, dataDate), eq(coins.isActive, true)));

    // Mirror of classifyDirection in top-recommendations/route.ts
    const moverDirection = (
      signal: string,
      health: number,
      change: number | null
    ): "BULLISH" | "BEARISH" => {
      if (signal === "WEAK" || signal === "CAUTION") return "BEARISH";
      if (change !== null && change <= -3) return "BEARISH";
      if (health < 50) return "BEARISH";
      return "BULLISH";
    };

    const moverScored = moverRows.map((r) => {
      const health = r.healthScore ?? 0;
      const trend = r.trendScore ?? 50;
      const momentum = r.momentumScore ?? 50;
      const change = r.scoreChange ?? 0;
      const direction = moverDirection(r.signal ?? "OBSERVE", health, r.scoreChange);
      // Bull strength composite (top-recommendations bullComposite)
      const bullComposite =
        health * 0.4 + trend * 0.35 + momentum * 0.15 + Math.max(0, Math.min(20, change + 10)) * 0.5;
      // Bear weakness composite (top-recommendations bearComposite)
      const bearComposite =
        (100 - health) * 0.45 + Math.max(0, -change) * 8 + (100 - trend) * 0.25 + (100 - momentum) * 0.15;
      return { ...r, direction, bullComposite, bearComposite };
    });

    type MoverEntry = { row: (typeof moverScored)[number]; watchOnly: boolean };

    // Strongest = top bullComposite among genuine BULLISH. Top-Rec-Fill
    // parity: when nothing classifies BULLISH, fill with the relatively
    // strongest coins (bullComposite across ALL coins, independent of their
    // classified direction) flagged watchOnly — relative strength, never a
    // presented-as-real directional signal.
    const topMoversData: MoverEntry[] = moverScored
      .filter((s) => s.direction === "BULLISH")
      .sort((a, b) => b.bullComposite - a.bullComposite)
      .slice(0, 5)
      .map((s) => ({ row: s, watchOnly: false }));
    if (topMoversData.length < 5) {
      const chosenIds = new Set(topMoversData.map((e) => e.row.coinId));
      const padPool = moverScored
        .filter((s) => !chosenIds.has(s.coinId))
        .sort((a, b) => b.bullComposite - a.bullComposite);
      for (const s of padPool) {
        if (topMoversData.length >= 5) break;
        topMoversData.push({ row: s, watchOnly: true });
      }
    }

    // Weakest = top bearComposite among genuine BEARISH; symmetric fill with
    // the relatively weakest coins (bearComposite across ALL coins) flagged
    // watchOnly when the day is broadly bullish.
    const weakestCoinsData: MoverEntry[] = moverScored
      .filter((s) => s.direction === "BEARISH")
      .sort((a, b) => b.bearComposite - a.bearComposite)
      .slice(0, 5)
      .map((s) => ({ row: s, watchOnly: false }));
    if (weakestCoinsData.length < 5) {
      const chosenIds = new Set([
        ...topMoversData.map((e) => e.row.coinId),
        ...weakestCoinsData.map((e) => e.row.coinId),
      ]);
      const padPool = moverScored
        .filter((s) => !chosenIds.has(s.coinId))
        .sort((a, b) => b.bearComposite - a.bearComposite);
      for (const s of padPool) {
        if (weakestCoinsData.length >= 5) break;
        weakestCoinsData.push({ row: s, watchOnly: true });
      }
    }

    // Get source status
    const sourceStatusData = await db
      .select()
      .from(sourceStatus)
      .where(sql`${sourceStatus.coinId} IS NULL`)
      .orderBy(desc(sourceStatus.lastAttempt));

    const sourceStatusMap: Record<
      string,
      { status: string; lastSuccess: string | null; recordsCollected: number }
    > = {
      binance_spot: { status: "OK", lastSuccess: null, recordsCollected: 0 },
      binance_futures: { status: "OK", lastSuccess: null, recordsCollected: 0 },
      coingecko: { status: "OK", lastSuccess: null, recordsCollected: 0 },
    };

    for (const status of sourceStatusData) {
      if (status.source in sourceStatusMap) {
        sourceStatusMap[status.source] = {
          status: status.status,
          lastSuccess: status.lastSuccess?.toISOString() || null,
          recordsCollected: status.recordsCollected || 0,
        };
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        date: today,
        // SQ-FIX: the business date of the rows actually being shown, so the
        // UI can label the report "data as of ..." when it is not today.
        dataAsOf: dataDate,
        dataIsStale,
        narratives: narrativeSummaries,
        sourceStatus: {
          binanceSpot: sourceStatusMap.binance_spot,
          binanceFutures: sourceStatusMap.binance_futures,
          coingecko: sourceStatusMap.coingecko,
          lastUpdate: new Date().toISOString(),
        },
        topMovers: topMoversData.map(({ row: c, watchOnly }) => ({
          id: c.coinId,
          symbol: c.symbol,
          name: c.name,
          healthScore: c.healthScore,
          scoreChange: c.scoreChange || 0,
          narrativeId: null,
          narrativeName: null,
          watchOnly,
        })),
        weakestCoins: weakestCoinsData.map(({ row: c, watchOnly }) => ({
          id: c.coinId,
          symbol: c.symbol,
          name: c.name,
          healthScore: c.healthScore,
          scoreChange: c.scoreChange || 0,
          narrativeId: null,
          narrativeName: null,
          watchOnly,
        })),
        alertCount: 0,
        lastUpdate: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}
