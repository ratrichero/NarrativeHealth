// Top Recommendations API — 3 best-trend coins for the dashboard
// SQ-TOP-REC: returns the top 3 coins by composite trend strength with
// actionable setup levels (Entry/TP/SL derived from ATR, same formula as
// the Binance Square opportunity engine) and recommendation reason.

import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  coins,
  healthScores,
  recommendations,
  features,
  marketPriceDaily,
  indicators,
  coinNarratives,
  narratives,
} from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getBusinessDate, getHealthStatus } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface TopRecommendation {
  coinId: number;
  symbol: string;
  name: string;
  narrativeName: string | null;
  healthScore: number;
  scoreChange: number | null;
  status: string;
  signal: string;
  reason: string;
  currentPrice: number;
  setup: {
    entryLow: number;
    entryHigh: number;
    takeProfits: { level: number; label: string | null }[];
    stopLoss: number;
    riskRewardRatio: number | null;
    tp1GainPct: number | null;
    slRiskPct: number | null;
  } | null;
  metrics: {
    trendScore: number | null;
    volumeScore: number | null;
    rsi14: number | null;
    fundingRate: number | null;
    priceVsEma20Pct: number | null;
  };
}

// Same ATR-derived setup formula as the Square opportunity engine
function computeSetup(
  price: number,
  atr14: number | null,
  ema20: number | null,
  ema50: number | null
): TopRecommendation["setup"] {
  if (price <= 0 || atr14 === null || atr14 <= 0) return null;

  const entryLow = +(price - atr14 * 0.5).toFixed(6);
  const entryHigh = +(price + atr14 * 0.5).toFixed(6);
  const tp1 = +(entryHigh + atr14 * 1.5).toFixed(6);
  const tp2 = +(entryHigh + atr14 * 3).toFixed(6);
  const sl = +(entryLow - atr14 * 1).toFixed(6);

  const targets = [
    { level: tp1, label: "TP1 (1.5 ATR)" },
    { level: tp2, label: "TP2 (3 ATR)" },
  ];
  if (ema20 !== null && ema20 > price) targets.push({ level: +ema20.toFixed(6), label: "EMA20" });
  if (ema50 !== null && ema50 > price) targets.push({ level: +ema50.toFixed(6), label: "EMA50" });
  targets.sort((a, b) => a.level - b.level);

  const entryMid = (entryLow + entryHigh) / 2;
  let riskRewardRatio: number | null = null;
  let tp1GainPct: number | null = null;
  let slRiskPct: number | null = null;
  if (entryMid > sl && sl > 0) {
    const reward = tp1 - entryMid;
    const risk = entryMid - sl;
    if (risk > 0) {
      riskRewardRatio = +(reward / risk).toFixed(1);
      tp1GainPct = +((reward / entryMid) * 100).toFixed(0);
      slRiskPct = +((risk / entryMid) * 100).toFixed(0);
    }
  }

  return {
    entryLow,
    entryHigh,
    takeProfits: targets.slice(0, 3),
    stopLoss: sl,
    riskRewardRatio,
    tp1GainPct,
    slRiskPct,
  };
}

export async function GET() {
  try {
    const today = getBusinessDate();

    // Latest health + signal + features + price for each active coin,
    // restricted to the freshest date that actually has data (same
    // "freshest wins" approach as the dashboard route).
    const [latest] = await db
      .select({ date: healthScores.date })
      .from(healthScores)
      .orderBy(desc(healthScores.date))
      .limit(1);
    const dataDate = latest?.date ?? today;

    const rows = await db
      .select({
        coinId: coins.id,
        symbol: coins.symbol,
        name: coins.name,
        healthScore: healthScores.healthScore,
        scoreChange: healthScores.scoreChange,
        signal: recommendations.signal,
        reason: recommendations.reason,
        trendScore: features.trendScore,
        volumeScore: features.volumeScore,
        momentumScore: features.momentumScore,
        narrativeName: sql<string | null>`(
          SELECT n.name FROM narratives n
          JOIN coin_narratives cn ON cn.narrative_id = n.id
          WHERE cn.coin_id = ${coins.id} AND n.is_active = true
          ORDER BY cn.is_primary DESC LIMIT 1
        )`,
        closePrice: sql<string | null>`(
          SELECT p.close FROM market_price_daily p
          WHERE p.coin_id = ${coins.id} AND p.date = ${dataDate}
          LIMIT 1
        )`,
        atr14: sql<string | null>`(
          SELECT i.indicator_value FROM indicators i
          WHERE i.coin_id = ${coins.id} AND i.date = ${dataDate}
            AND i.timeframe = '1d' AND i.indicator_type = 'ATR_14'
          LIMIT 1
        )`,
        ema20: sql<string | null>`(
          SELECT i.indicator_value FROM indicators i
          WHERE i.coin_id = ${coins.id} AND i.date = ${dataDate}
            AND i.timeframe = '1d' AND i.indicator_type = 'EMA_20'
          LIMIT 1
        )`,
        ema50: sql<string | null>`(
          SELECT i.indicator_value FROM indicators i
          WHERE i.coin_id = ${coins.id} AND i.date = ${dataDate}
            AND i.timeframe = '1d' AND i.indicator_type = 'EMA_50'
          LIMIT 1
        )`,
        rsi14: sql<string | null>`(
          SELECT i.indicator_value FROM indicators i
          WHERE i.coin_id = ${coins.id} AND i.date = ${dataDate}
            AND i.timeframe = '1d' AND i.indicator_type = 'RSI_14'
          LIMIT 1
        )`,
        fundingRate: sql<string | null>`(
          SELECT cm.funding_rate FROM coin_metrics cm
          WHERE cm.coin_id = ${coins.id} AND cm.date = ${dataDate}
          LIMIT 1
        )`,
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

    // Composite ranking: health + trend + momentum + positive change
    const scored = rows
      .map((r) => {
        const trend = r.trendScore ?? 50;
        const momentum = r.momentumScore ?? 50;
        const change = r.scoreChange ?? 0;
        const composite =
          (r.healthScore ?? 0) * 0.4 + trend * 0.35 + momentum * 0.15 + Math.max(0, Math.min(20, change + 10)) * 0.5;
        return { ...r, composite };
      })
      .sort((a, b) => b.composite - a.composite);

    const top: TopRecommendation[] = scored.slice(0, 3).map((r) => {
      const price = r.closePrice ? parseFloat(r.closePrice) : 0;
      const atr = r.atr14 ? parseFloat(r.atr14) : null;
      const ema20 = r.ema20 ? parseFloat(r.ema20) : null;
      const ema50 = r.ema50 ? parseFloat(r.ema50) : null;
      const rsi = r.rsi14 ? parseFloat(r.rsi14) : null;
      const funding = r.fundingRate ? parseFloat(r.fundingRate) : null;
      const ema20Pct =
        ema20 && ema20 > 0 && price > 0 ? +(((price - ema20) / ema20) * 100).toFixed(1) : null;

      return {
        coinId: r.coinId,
        symbol: r.symbol,
        name: r.name,
        narrativeName: r.narrativeName,
        healthScore: r.healthScore,
        scoreChange: r.scoreChange,
        status: getHealthStatus(r.healthScore),
        signal: r.signal ?? "OBSERVE",
        reason: r.reason ?? "No recommendation text available.",
        currentPrice: price,
        setup: computeSetup(price, atr, ema20, ema50),
        metrics: {
          trendScore: r.trendScore != null ? Math.round(r.trendScore) : null,
          volumeScore: r.volumeScore != null ? Math.round(r.volumeScore) : null,
          rsi14: rsi,
          fundingRate: funding,
          priceVsEma20Pct: ema20Pct,
        },
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        date: dataDate,
        recommendations: top,
      },
    });
  } catch (error) {
    console.error("[GET /api/dashboard/top-recommendations] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch top recommendations" },
      { status: 500 }
    );
  }
}
