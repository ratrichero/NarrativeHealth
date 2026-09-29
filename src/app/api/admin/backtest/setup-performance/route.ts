// BT-03 — Admin backtest results endpoint (read-only).
//
// Since BT-03, outcomes are COMPUTED ONCE by POST /api/admin/backtest/run and
// stored on the pick rows (backtest_status/backtest_outcome/backtest_*). This
// endpoint only reads the stored results and aggregates them — it never
// recomputes, so numbers never shift after a pick is evaluated ("lần backtest
// sau không chạy lại").
//
// Query params:
//   all  — "1" includes FILL_* picks (default: GENUINE with a setup only)
//   from — ISO date lower bound (default 2026-01-01)
//
// Admin middleware guards the route.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { topRecommendationPicks } from "@/db/schema";
import { gte } from "drizzle-orm";
import { aggregateOutcomes, type PickOutcome } from "@/lib/backtest/engine";

export const dynamic = "force-dynamic";

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
    const includeAll = url.searchParams.get("all") === "1";
    const cutoff = url.searchParams.get("from") ?? "2026-01-01";

    const rows = await db
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
        backtestStatus: topRecommendationPicks.backtestStatus,
        backtestOutcome: topRecommendationPicks.backtestOutcome,
        backtestExitR: topRecommendationPicks.backtestExitR,
        backtestHitDay: topRecommendationPicks.backtestHitDay,
        backtestMfePct: topRecommendationPicks.backtestMfePct,
        backtestMaePct: topRecommendationPicks.backtestMaePct,
        backtestEntryFilled: topRecommendationPicks.backtestEntryFilled,
        backtestHorizonDays: topRecommendationPicks.backtestHorizonDays,
        backtestEvaluatedAt: topRecommendationPicks.backtestEvaluatedAt,
      })
      .from(topRecommendationPicks)
      .where(gte(topRecommendationPicks.dataDate, cutoff))
      .limit(4000);

    const eligible = rows.filter((p) =>
      includeAll ? true : p.pickKind === "GENUINE" && p.hasSetup
    );

    const finalized = eligible.filter((p) => p.backtestStatus !== "PENDING");
    const pendingCount = eligible.filter((p) => p.backtestStatus === "PENDING").length;

    // Map stored columns back into the shared PickOutcome shape so grouping
    // reuses the BT-02 aggregations unchanged.
    const outcomes: PickOutcome[] = finalized.map((p) => ({
      pickId: p.pickId,
      dataDate: p.dataDate,
      coinId: p.coinId,
      symbol: p.symbol,
      direction: p.direction,
      signal: p.signal,
      healthScore: p.healthScore,
      pickKind: p.pickKind,
      entryMid: null,
      outcome:
        (p.backtestOutcome as PickOutcome["outcome"]) ?? "INVALID",
      exitR: p.backtestExitR,
      hitDay: p.backtestHitDay,
      mfePct: p.backtestMfePct,
      maePct: p.backtestMaePct,
      entryFilled: p.backtestEntryFilled,
    }));

    // ── Grouping (same as BT-02) ──
    const byDirection = new Map<string, PickOutcome[]>();
    const bySignal = new Map<string, PickOutcome[]>();
    const byBand = new Map<string, PickOutcome[]>();
    const byPickKind = new Map<string, PickOutcome[]>();
    const push = (m: Map<string, PickOutcome[]>, key: string, o: PickOutcome) => {
      const arr = m.get(key);
      if (arr) arr.push(o);
      else m.set(key, [o]);
    };
    for (const o of outcomes) {
      push(byDirection, o.direction, o);
      push(bySignal, o.signal, o);
      push(byBand, healthBand(o.healthScore), o);
      push(byPickKind, o.pickKind, o);
    }

    const group = (m: Map<string, PickOutcome[]>) =>
      [...m.entries()].map(([g, os]) => aggregateOutcomes(g, os));

    return NextResponse.json({
      success: true,
      data: {
        params: { includeAll, cutoff },
        totalPicks: eligible.length,
        evaluatedCount: finalized.length,
        pendingCount,
        statusCounts: {
          PENDING: pendingCount,
          EVALUATED: eligible.filter((p) => p.backtestStatus === "EVALUATED").length,
          EXPIRED: eligible.filter((p) => p.backtestStatus === "EXPIRED").length,
          SKIPPED: eligible.filter((p) => p.backtestStatus === "SKIPPED").length,
        },
        byDirection: group(byDirection),
        bySignal: group(bySignal),
        byHealthBand: group(byBand),
        byPickKind: group(byPickKind),
        picks: finalized.map((p) => ({
          pickId: p.pickId,
          dataDate: p.dataDate,
          symbol: p.symbol,
          direction: p.direction,
          signal: p.signal,
          healthScore: p.healthScore,
          pickKind: p.pickKind,
          status: p.backtestStatus,
          outcome: p.backtestOutcome,
          exitR: p.backtestExitR,
          hitDay: p.backtestHitDay,
          mfePct: p.backtestMfePct,
          maePct: p.backtestMaePct,
          entryFilled: p.backtestEntryFilled,
          horizonDays: p.backtestHorizonDays,
          evaluatedAt: p.backtestEvaluatedAt,
        })),
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/backtest/setup-performance]", error);
    return NextResponse.json(
      { success: false, error: "Backtest read failed." },
      { status: 500 }
    );
  }
}
