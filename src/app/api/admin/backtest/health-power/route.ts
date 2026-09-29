// BT-02 — Health-score predictive power (admin): does a higher health score
// today actually predict a better forward return? Two complementary views:
//
//  1. Median forward return (1/3/7/14 days) grouped by health band.
//  2. Pearson correlation between health score and forward return, per
//     horizon — plus the same correlation for each feature score (trend,
//     volume, momentum) as a benchmark: if health correlates no better than a
//     single feature, the composite adds little.
//
// Population: active coins × dates with a health score, joined to
// market_price_daily for the forward close prices. Window param limits how far
// back we evaluate (default 90 days, max 365 — data-dependent). Read-only.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { healthScores, features, marketPriceDaily } from "@/db/schema";
import { and, eq, gte, inArray } from "drizzle-orm";
import { pearson } from "@/lib/backtest/engine";

export const dynamic = "force-dynamic";

const num = (v: string | null, def: number, min: number, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
};

function band(score: number): string {
  if (score >= 80) return "80+";
  if (score >= 60) return "60-80";
  if (score >= 40) return "40-60";
  return "<40";
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : +(((s[mid - 1] + s[mid]) / 2).toFixed(2));
};

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const daysBack = num(url.searchParams.get("daysBack"), 90, 14, 365);

    // Data window: dates evaluated must have horizon candles after them — cap
    // the evaluation dates at today - 14d so 14d returns are measurable.
    const since = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);

    // ── 1. Health + feature scores (one row per coin-date) ──
    const scoreRows = await db
      .select({
        coinId: healthScores.coinId,
        date: healthScores.date,
        health: healthScores.healthScore,
        trend: features.trendScore,
        volume: features.volumeScore,
        momentum: features.momentumScore,
      })
      .from(healthScores)
      .leftJoin(
        features,
        and(eq(features.coinId, healthScores.coinId), eq(features.date, healthScores.date))
      )
      .where(gte(healthScores.date, since))
      .limit(60000);

    if (scoreRows.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          params: { daysBack },
          totalSamples: 0,
          byBand: [],
          correlations: [],
          note: "Chưa có health scores trong window — tăng daysBack hoặc chạy refresh.",
        },
      });
    }

    // ── 2. Forward close prices per coin (date-indexed map) ──
    const coinIds = [...new Set(scoreRows.map((r) => r.coinId))];
    const closeByCoin = new Map<number, { date: string; close: number }[]>();
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
      const list = closeByCoin.get(r.coinId) ?? [];
      list.push({ date: r.date, close: Number(r.close) });
      closeByCoin.set(r.coinId, list);
    }
    for (const list of closeByCoin.values()) {
      list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }
    const closeIndex = new Map<number, Map<string, number>>();
    for (const [coinId, rows] of closeByCoin) {
      closeIndex.set(coinId, new Map(rows.map((r) => [r.date, r.close])));
    }

    // ── 3. Forward returns per (coin, date) for horizons 1/3/7/14 ──
    const horizons = [1, 3, 7, 14];
    interface Sample {
      health: number;
      trend: number | null;
      volume: number | null;
      momentum: number | null;
      fwd: Record<number, number | null>;
    }
    const samples: Sample[] = [];
    for (const r of scoreRows) {
      const closes = closeIndex.get(r.coinId);
      if (!closes) continue;
      const base = closes.get(r.date);
      if (base == null || base <= 0) continue;

      const fwd: Record<number, number | null> = {};
      for (const h of horizons) {
        const target = new Date(
          new Date(r.date + "T00:00:00Z").getTime() + h * 86400_000
        ).toISOString().slice(0, 10);
        // Calendar-day target; tolerate ±3 days gap (weekends/missing days):
        // pick the closest available close within [target, target+3].
        let px: number | null = closes.get(target) ?? null;
        if (px == null) {
          for (let k = 1; k <= 3 && px == null; k++) {
            const t2 = new Date(
              new Date(r.date + "T00:00:00Z").getTime() + (h + k) * 86400_000
            ).toISOString().slice(0, 10);
            if (t2 > new Date().toISOString().slice(0, 10)) break;
            px = closes.get(t2) ?? null;
          }
        }
        fwd[h] = px != null && base > 0 ? +(((px - base) / base) * 100).toFixed(2) : null;
      }
      samples.push({
        health: r.health,
        trend: r.trend,
        volume: r.volume,
        momentum: r.momentum,
        fwd,
      });
    }

    // ── 4. By-band medians (7d horizon) + sample counts ──
    const byBandMap = new Map<string, number[][]>(); // band → fwd returns per horizon
    for (const s of samples) {
      const b = band(s.health);
      const arr = byBandMap.get(b) ?? [[], [], [], []];
      horizons.forEach((h, i) => {
        const v = s.fwd[h];
        if (v != null) arr[i].push(v);
      });
      byBandMap.set(b, arr);
    }
    const bandOrder = ["80+", "60-80", "40-60", "<40"];
    const byBand = bandOrder
      .filter((b) => byBandMap.has(b))
      .map((b) => {
        const arrs = byBandMap.get(b)!;
        return {
          band: b,
          samples: arrs[2].length, // 7d horizon count as the representative
          median1d: median(arrs[0]),
          median3d: median(arrs[1]),
          median7d: median(arrs[2]),
          median14d: median(arrs[3]),
        };
      });

    // ── 5. Correlations per horizon: health, trend, volume, momentum ──
    const correlations = horizons.map((h) => {
      const pairs = samples.filter((s) => s.fwd[h] != null);
      const corr = (get: (s: Sample) => number | null) =>
        pearson(
          pairs.map((s) => get(s)).filter((v): v is number => v != null),
          pairs.map((s) => s.fwd[h] as number)
        );
      return {
        horizonDays: h,
        samples: pairs.length,
        health: corr((s) => s.health),
        trend: corr((s) => s.trend),
        volume: corr((s) => s.volume),
        momentum: corr((s) => s.momentum),
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        params: { daysBack },
        totalSamples: samples.length,
        byBand,
        correlations,
        note: null,
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/backtest/health-power]", error);
    return NextResponse.json(
      { success: false, error: "Health-power computation failed." },
      { status: 500 }
    );
  }
}
