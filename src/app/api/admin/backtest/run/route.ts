// BT-03 — Admin backtest RUN endpoint. Evaluates PENDING picks exactly once:
//
//   GENUINE + setup + TP/SL hit within horizon → EVALUATED (TP1_WIN/TP2_WIN/SL_LOSS)
//   GENUINE + setup + horizon elapsed, no hit  → EXPIRED  (NO_HIT)
//   pick without usable setup                  → SKIPPED  (NO_SETUP)
//   still inside its horizon window            → stays PENDING (OPEN), re-run later
//
// Once a pick leaves PENDING its stored result is immutable — later runs never
// recompute it ("lần backtest sau sẽ không chạy lại"). GET
// /api/admin/backtest/setup-performance reads the stored columns instead of
// recomputing, so results are stable and reviewable.
//
// Request body (JSON, all optional): { horizon?: 7|14|30|60, dryRun?: boolean }
// dryRun=true reports what WOULD be evaluated without writing.
//
// Admin middleware guards the route.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { topRecommendationPicks, marketPriceDaily } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  computePickOutcome,
  isHorizonClosed,
  type BacktestPickInput,
  type BacktestPriceRow,
} from "@/lib/backtest/engine";
import { getBusinessDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const HORIZONS = [7, 14, 30, 60];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      horizon?: number;
      dryRun?: boolean;
    };
    const horizon = HORIZONS.includes(Number(body.horizon))
      ? Number(body.horizon)
      : 14;
    const dryRun = body.dryRun === true;
    const today = getBusinessDate();
    const runId = `bt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    // ── 1. PENDING picks only — evaluated/expired/skipped are immutable ──
    const pendingRows = await db
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
      })
      .from(topRecommendationPicks)
      .where(eq(topRecommendationPicks.backtestStatus, "PENDING"))
      .limit(5000);

    // Population split: no-setup picks are SKIPPed immediately; the rest are
    // candidates for evaluation.
    const hasLevels = (p: (typeof pendingRows)[number]) =>
      p.entryMid != null && p.tp1 != null && p.stopLoss != null &&
      Number(p.entryMid) > 0 && Number(p.tp1) > 0 && Number(p.stopLoss) > 0;

    const skippable = pendingRows.filter((p) => !p.hasSetup || !hasLevels(p));
    const candidates = pendingRows.filter((p) => p.hasSetup && hasLevels(p));

    // Window closed = dataDate + horizon calendar days <= today.
    const closed = candidates.filter((p) => isHorizonClosed(p.dataDate, horizon, today));
    const stillOpen = candidates.length - closed.length;

    if (dryRun) {
      return NextResponse.json({
        success: true,
        data: {
          dryRun: true,
          horizon,
          pending: pendingRows.length,
          willSkip: skippable.length,
          willEvaluate: closed.length,
          stillOpen,
          note:
            "Dry run — không ghi gì. Picks đã EVALUATED/EXPIRED/SKIPPED không bao giờ chạy lại.",
        },
      });
    }

    // ── 2. Load candles only for the coins being evaluated now ──
    const coinIds = [...new Set(closed.map((p) => p.coinId))];
    const priceByCoin = new Map<number, BacktestPriceRow[]>();
    if (coinIds.length > 0) {
      const minDate = closed.reduce(
        (m, p) => (p.dataDate < m ? p.dataDate : m),
        closed[0].dataDate
      );
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

    // ── 3. Evaluate + persist (update each pick once) ──
    let evaluated = 0;
    let expired = 0;
    let skipped = 0;
    let errors = 0;
    const outcomes: { pickId: number; symbol: string; dataDate: string; outcome: string; exitR: number | null; hitDay: number | null }[] = [];

    const stamp = {
      horizonDays: horizon,
      runId,
      evaluatedAt: new Date(),
    };

    // SKIPPED — no usable setup, mark once, never touched again.
    for (const p of skippable) {
      try {
        await db
          .update(topRecommendationPicks)
          .set({
            backtestStatus: "SKIPPED",
            backtestOutcome: "NO_SETUP",
            ...stamp,
          })
          .where(eq(topRecommendationPicks.id, p.pickId));
        skipped++;
      } catch (e) {
        errors++;
        console.error(`[BT-03] skip ${p.pickId} failed:`, e);
      }
    }

    // EVALUATED / EXPIRED — outcome stored on the pick row itself.
    for (const p of closed) {
      const input: BacktestPickInput = {
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
        riskRewardRatio: null,
        pickKind: p.pickKind,
      };
      try {
        const o = computePickOutcome(input, priceByCoin.get(p.coinId) ?? [], horizon, {
          horizonClosed: true,
        });

        if (o.outcome === "OPEN" || o.outcome === "INVALID") {
          // Defensive: should not happen for closed windows — leave PENDING.
          continue;
        }

        await db
          .update(topRecommendationPicks)
          .set({
            backtestStatus: o.outcome === "NO_HIT" ? "EXPIRED" : "EVALUATED",
            backtestOutcome: o.outcome,
            backtestExitR: o.exitR,
            backtestHitDay: o.hitDay,
            backtestMfePct: o.mfePct,
            backtestMaePct: o.maePct,
            backtestEntryFilled: o.entryFilled,
            ...stamp,
          })
          .where(eq(topRecommendationPicks.id, p.pickId));

        if (o.outcome === "NO_HIT") {
          expired++;
        } else {
          evaluated++;
        }
        outcomes.push({
          pickId: p.pickId,
          symbol: p.symbol,
          dataDate: p.dataDate,
          outcome: o.outcome,
          exitR: o.exitR,
          hitDay: o.hitDay,
        });
      } catch (e) {
        errors++;
        console.error(`[BT-03] evaluate ${p.pickId} failed:`, e);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        runId,
        horizon,
        pendingBefore: pendingRows.length,
        evaluated,
        expired,
        skipped,
        stillOpen,
        errors,
        outcomes,
      },
    });
  } catch (error) {
    console.error("[POST /api/admin/backtest/run]", error);
    return NextResponse.json(
      { success: false, error: "Backtest run failed." },
      { status: 500 }
    );
  }
}
