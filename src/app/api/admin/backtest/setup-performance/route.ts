// BT-02 — Admin backtest endpoint: persist picks (BT-01) joined with
// market_price_daily → per-pick outcome (TP1/TP2/SL, MFE/MAE, entry fill) +
// aggregates by direction / signal / health band / slot.
//
// Query params:
//   horizon — forward candles per pick (default 14, max 60)
//   all     — "1" includes FILL_* picks and no-setup picks (default: GENUINE
//             with full setup only — the statistically meaningful population)
//   from    — ISO date lower bound (default 2026-01-01; BT-01 accumulates from
//             deploy day, so older bounds simply return fewer picks)
//
// Read-only; admin middleware guards the route. Aggregation happens in JS (the
// population is ≤ 6 picks/day — trivially small).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { topRecommendationPicks, marketPriceDaily } from "@/db/schema";
import { gte, inArray } from "drizzle-orm";
import {
  computePickOutcome,
  aggregateOutcomes,
  type PickOutcome,
  type BacktestPriceRow,
} from "@/lib/backtest/engine";

export const dynamic = "force-dynamic";

const num = (v: string | null, def: number, min: number, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
};

function healthBand(score: number | null): string {
  if (score == null) return "unknown";
  if (score >= 80) return "80+";
  if (score >= 60) return "60-80";
  if (score >= 40) return "40-60";
  return "<40";
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const horizon = num(url.searchParams.get("horizon"), 14, 1, 60);
    const includeAll = url.searchParams.get("all") === "1";
    const cutoff = url.searchParams.get("from") ?? "2026-01-01";

    const pickRows = await db
      .select({
        pickId: topRecommendationPicks.id,
        dataDate: topRecommendationPicks.dataDate,
        coinId: topRecommendationPicks.coinId,
        symbol: topRecommendationPicks.symbol,
        direction: topRecommendationPicks.direction,
        signal: topRecommendationPicks.signal,
        healthScore: topRecommendationPicks.healthScore,
        pickKind: topRecommendationPicks.pickKind,
        hasSetup: topRecommendationPicks.hasSetup,
        entryLow: topRecommendationPicks.entryLow,
        entryHigh: topRecommendationPicks.entryHigh,
        entryMid: topRecommendationPicks.entryMid,
        tp1: topRecommendationPicks.tp1,
        tp2: topRecommendationPicks.tp2,
        stopLoss: topRecommendationPicks.stopLoss,
        riskRewardRatio: topRecommendationPicks.riskRewardRatio,
      })
      .from(topRecommendationPicks)
      .where(gte(topRecommendationPicks.dataDate, cutoff))
      .limit(4000);

    // Default population: GENUINE picks with a full setup.
    const eligible = pickRows.filter((p) => {
      const hasLevels =
        p.entryMid != null && p.tp1 != null && p.stopLoss != null &&
        Number(p.entryMid) > 0 && Number(p.tp1) > 0 && Number(p.stopLoss) > 0;
      if (!includeAll) return p.pickKind === "GENUINE" && p.hasSetup && hasLevels;
      return hasLevels;
    });

    const coinIds = [...new Set(eligible.map((p) => p.coinId))];

    // Load daily candles for the involved coins (date >= min pick date).
    const minDate = eligible.length > 0
      ? eligible.reduce((m, p) => (p.dataDate < m ? p.dataDate : m), eligible[0].dataDate)
      : cutoff;

    const priceByCoin = new Map<number, BacktestPriceRow[]>();
    if (coinIds.length > 0) {
      const priceRows = await db
        .select({
          coinId: marketPriceDaily.coinId,
          date: marketPriceDaily.date,
          high: marketPriceDaily.high,
          low: marketPriceDaily.low,
        })
        .from(marketPriceDaily)
        .where(inArray(marketPriceDaily.coinId, coinIds))
        .limit(200000);
      for (const r of priceRows) {
        if (r.date < minDate) continue;
        const list = priceByCoin.get(r.coinId) ?? [];
        list.push({ date: r.date, high: Number(r.high), low: Number(r.low) });
        priceByCoin.set(r.coinId, list);
      }
      for (const list of priceByCoin.values()) {
        list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      }
    }

    const outcomes: PickOutcome[] = eligible.map((p) =>
      computePickOutcome(
        {
          pickId: p.pickId,
          dataDate: p.dataDate,
          coinId: p.coinId,
          symbol: p.symbol,
          direction: p.direction,
          signal: p.signal,
          healthScore: p.healthScore,
          entryLow: p.entryLow != null ? Number(p.entryLow) : null,
          entryHigh: p.entryHigh != null ? Number(p.entryHigh) : null,
          entryMid: p.entryMid != null ? Number(p.entryMid) : null,
          tp1: p.tp1 != null ? Number(p.tp1) : null,
          tp2: p.tp2 != null ? Number(p.tp2) : null,
          stopLoss: p.stopLoss != null ? Number(p.stopLoss) : null,
          riskRewardRatio: p.riskRewardRatio,
          pickKind: p.pickKind,
        },
        priceByCoin.get(p.coinId) ?? [],
        horizon
      )
    );

    // ── Aggregations ──
    const byDirection = new Map<string, PickOutcome[]>();
    const bySignal = new Map<string, PickOutcome[]>();
    const byBand = new Map<string, PickOutcome[]>();
    const bySlot = new Map<string, PickOutcome[]>();
    for (const o of outcomes) {
      const dirs = byDirection.get(o.direction) ?? [];
      dirs.push(o);
      byDirection.set(o.direction, dirs);

      const sigs = bySignal.get(o.signal) ?? [];
      sigs.push(o);
      bySignal.set(o.signal, sigs);

      const band = healthBand(o.healthScore);
      const bands = byBand.get(band) ?? [];
      bands.push(o);
      byBand.set(band, bands);

      const slotGroup = o.pickKind === "GENUINE" ? "genuine" : o.pickKind;
      const slots = bySlot.get(slotGroup) ?? [];
      slots.push(o);
      bySlot.set(slotGroup, slots);
    }

    const group = (m: Map<string, PickOutcome[]>) =>
      [...m.entries()].map(([g, os]) => aggregateOutcomes(g, os));

    return NextResponse.json({
      success: true,
      data: {
        params: { horizon, includeAll, cutoff },
        totalPicks: outcomes.length,
        byDirection: group(byDirection),
        bySignal: group(bySignal),
        byHealthBand: group(byBand),
        byPickKind: group(bySlot),
        picks: outcomes,
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/backtest/setup-performance]", error);
    return NextResponse.json(
      { success: false, error: "Backtest computation failed." },
      { status: 500 }
    );
  }
}
