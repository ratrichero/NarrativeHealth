// BT-04 — Signal quality (admin): are the rule-engine signals predictive?
//
// Population: every coin-date with a rule-engine signal (recommendations) +
// health score (health_scores), joined to market_price_daily forward closes —
// NOT just the 6 daily picks, so this measures the whole signal layer.
//
// Views:
//  1. bySignal — median forward return (1/3/7/14d) + share of positive 7d
//     outcomes per signal (STRONG_WATCH / WATCH / OBSERVE / WEAK / CAUTION).
//     A good engine: STRONG_WATCH medians > WATCH > OBSERVE, WEAK negative.
//  2. byScoreChange — median 7d return bucketed by score change
//     (≤-3, -3..-1, -1..1, 1..3, >3): does a falling score predict losses?
//
// Read-only; admin middleware guards the route.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { recommendations, healthScores, marketPriceDaily } from "@/db/schema";
import { and, eq, gte, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

const num = (v: string | null, def: number, min: number, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
};

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : +(((s[mid - 1] + s[mid]) / 2).toFixed(2));
};

const HORIZONS = [1, 3, 7, 14];

function changeBucket(change: number | null): string {
  if (change == null) return "unknown";
  if (change <= -3) return "≤-3";
  if (change <= -1) return "-3..-1";
  if (change < 1) return "-1..1";
  if (change < 3) return "1..3";
  return "≥3";
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const daysBack = num(url.searchParams.get("daysBack"), 120, 14, 365);
    const since = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);

    // ── 1. Signal + score per coin-date ──
    const rows = await db
      .select({
        coinId: recommendations.coinId,
        date: recommendations.date,
        signal: recommendations.signal,
        health: healthScores.healthScore,
        scoreChange: healthScores.scoreChange,
      })
      .from(recommendations)
      .innerJoin(
        healthScores,
        and(
          eq(healthScores.coinId, recommendations.coinId),
          eq(healthScores.date, recommendations.date)
        )
      )
      .where(gte(recommendations.date, since))
      .limit(60000);

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        data: { params: { daysBack }, totalSamples: 0, bySignal: [], byScoreChange: [] },
      });
    }

    const coinIds = [...new Set(rows.map((r) => r.coinId))];

    // ── 2. Forward closes ──
    const closeIndex = new Map<number, Map<string, number>>();
    const priceRows = await db
      .select({
        coinId: marketPriceDaily.coinId,
        date: marketPriceDaily.date,
        close: marketPriceDaily.close,
      })
      .from(marketPriceDaily)
      .where(inArray(marketPriceDaily.coinId, coinIds))
      .limit(300000);
    for (const r of priceRows) {
      let m = closeIndex.get(r.coinId);
      if (!m) {
        m = new Map();
        closeIndex.set(r.coinId, m);
      }
      m.set(r.date, Number(r.close));
    }

    // ── 3. Forward returns per sample ──
    const today = new Date().toISOString().slice(0, 10);
    const closeAt = (coinId: number, date: string, h: number): number | null => {
      const m = closeIndex.get(coinId);
      if (!m) return null;
      let px: number | null = m.get(date) ?? null;
      for (let k = 1; k <= 3 && px == null; k++) {
        const t2 = new Date(
          new Date(date + "T00:00:00Z").getTime() + (h + k) * 86400_000
        ).toISOString().slice(0, 10);
        if (t2 > today) break;
        px = m.get(t2) ?? null;
      }
      return px;
    };

    interface Sample {
      signal: string;
      change: number | null;
      fwd: Record<number, number | null>;
    }
    const samples: Sample[] = [];
    for (const r of rows) {
      const base = closeIndex.get(r.coinId)?.get(r.date);
      if (base == null || base <= 0) continue;
      const fwd: Record<number, number | null> = {};
      for (const h of HORIZONS) {
        const target = new Date(
          new Date(r.date + "T00:00:00Z").getTime() + h * 86400_000
        ).toISOString().slice(0, 10);
        if (target > today) {
          fwd[h] = null;
          continue;
        }
        const px = closeAt(r.coinId, target, h);
        fwd[h] = px != null ? +(((px - base) / base) * 100).toFixed(2) : null;
      }
      samples.push({ signal: r.signal ?? "OBSERVE", change: r.scoreChange, fwd });
    }

    // ── 4. bySignal ──
    const bySignalMap = new Map<string, number[][]>();
    for (const s of samples) {
      const arr = bySignalMap.get(s.signal) ?? [[], [], [], []];
      HORIZONS.forEach((h, i) => {
        if (s.fwd[h] != null) arr[i].push(s.fwd[h] as number);
      });
      bySignalMap.set(s.signal, arr);
    }
    const SIGNAL_ORDER = ["STRONG_WATCH", "WATCH", "OBSERVE", "CAUTION", "WEAK"];
    const bySignal = SIGNAL_ORDER.filter((s) => bySignalMap.has(s)).map((s) => {
      const arrs = bySignalMap.get(s)!;
      const r7 = arrs[2];
      const positive = r7.filter((v) => v > 0).length;
      return {
        signal: s,
        samples: arrs[0].length,
        median1d: median(arrs[0]),
        median3d: median(arrs[1]),
        median7d: median(arrs[2]),
        median14d: median(arrs[3]),
        positive7dRate: r7.length > 0 ? +((positive / r7.length) * 100).toFixed(1) : null,
      };
    });

    // ── 5. byScoreChange (7d horizon) ──
    const byChangeMap = new Map<string, number[]>();
    for (const s of samples) {
      const v = s.fwd[7];
      if (v == null) continue;
      const b = changeBucket(s.change);
      const arr = byChangeMap.get(b) ?? [];
      arr.push(v);
      byChangeMap.set(b, arr);
    }
    const CHANGE_ORDER = ["≤-3", "-3..-1", "-1..1", "1..3", "≥3"];
    const byScoreChange = CHANGE_ORDER.filter((b) => byChangeMap.has(b)).map((b) => {
      const arr = byChangeMap.get(b)!;
      const positive = arr.filter((v) => v > 0).length;
      return {
        bucket: b,
        samples: arr.length,
        median7d: median(arr),
        positive7dRate: +((positive / arr.length) * 100).toFixed(1),
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        params: { daysBack },
        totalSamples: samples.length,
        bySignal,
        byScoreChange,
        note: null,
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/backtest/signal-quality]", error);
    return NextResponse.json(
      { success: false, error: "Signal-quality computation failed." },
      { status: 500 }
    );
  }
}
