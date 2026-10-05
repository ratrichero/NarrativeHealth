// TRACK-01 — Public track record (read-only, no auth).
//
// The admin Backtest tab already measures the picks, but a claim of performance
// is only worth anything if it is verifiable. This endpoint exposes the SAME
// stored results publicly: settled picks (GENUINE setups only), NET R after
// fees/slippage, win rate with a Wilson confidence interval, max drawdown,
// profit factor and a BTC buy-and-hold benchmark over the same window.
//
// It never recomputes outcomes — it reads what was settled once and aggregates
// it, so the public numbers cannot drift from the admin ones. Empty data is
// reported honestly instead of hidden.

import { NextResponse } from "next/server";
import { db } from "@/db";
import { topRecommendationPicks, coins, marketPriceDaily } from "@/db/schema";
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { addDaysIso } from "@/lib/backtest/engine";
import { readFeeConfig, computeCostR, computeNetR } from "@/lib/backtest/metrics";
import { buildTrackRecord, type TrackRecordPickRow } from "@/lib/backtest/track-record";

export const dynamic = "force-dynamic";

const MAX_ROWS = 4000;
const RECENT_LIMIT = 25;

interface Benchmark {
  from: string;
  to: string;
  startClose: number;
  endClose: number;
  returnPct: number;
}

/** BTC buy-and-hold over the window the settled trades spanned. */
async function btcBenchmark(from: string, to: string): Promise<Benchmark | null> {
  try {
    const [btc] = await db
      .select({ id: coins.id })
      .from(coins)
      .where(eq(coins.symbol, "BTC"))
      .limit(1);
    if (!btc) return null;

    const closes = await db
      .select({ date: marketPriceDaily.date, close: marketPriceDaily.close })
      .from(marketPriceDaily)
      .where(
        and(
          eq(marketPriceDaily.coinId, btc.id),
          gte(marketPriceDaily.date, from),
          lte(marketPriceDaily.date, to)
        )
      )
      .orderBy(asc(marketPriceDaily.date))
      .limit(500);

    if (closes.length < 2) return null;
    const start = Number(closes[0].close);
    const end = Number(closes[closes.length - 1].close);
    if (!(start > 0) || !(end > 0)) return null;
    return {
      from: closes[0].date,
      to: closes[closes.length - 1].date,
      startClose: +start.toFixed(2),
      endClose: +end.toFixed(2),
      returnPct: +(((end - start) / start) * 100).toFixed(2),
    };
  } catch (error) {
    console.error("[TRACK-01] BTC benchmark failed (non-blocking):", error);
    return null;
  }
}

export async function GET() {
  try {
    const fee = readFeeConfig();

    // Public record = real setups only (GENUINE + hasSetup). Fill-in picks
    // (FILL_LONG/FILL_SHORT) exist to keep the daily list at 3/3 and were never
    // meant to be traded, so they must not inflate a public win rate.
    const rows = await db
      .select({
        dataDate: topRecommendationPicks.dataDate,
        symbol: topRecommendationPicks.symbol,
        direction: topRecommendationPicks.direction,
        entryMid: topRecommendationPicks.entryMid,
        stopLoss: topRecommendationPicks.stopLoss,
        backtestStatus: topRecommendationPicks.backtestStatus,
        backtestOutcome: topRecommendationPicks.backtestOutcome,
        backtestExitR: topRecommendationPicks.backtestExitR,
        backtestHorizonDays: topRecommendationPicks.backtestHorizonDays,
        backtestEvaluatedAt: topRecommendationPicks.backtestEvaluatedAt,
      })
      .from(topRecommendationPicks)
      .where(
        and(
          eq(topRecommendationPicks.pickKind, "GENUINE"),
          eq(topRecommendationPicks.hasSetup, true),
          ne(topRecommendationPicks.backtestStatus, "PENDING")
        )
      )
      .limit(MAX_ROWS);

    const picks: TrackRecordPickRow[] = rows.map((r) => {
      const costR = computeCostR(r.entryMid, r.stopLoss, fee.roundTripBps);
      return {
        dataDate: r.dataDate,
        symbol: r.symbol,
        direction: r.direction,
        outcome: r.backtestOutcome,
        status: r.backtestStatus,
        exitRGross: r.backtestExitR,
        exitRNet: computeNetR(r.backtestExitR, costR),
        evaluatedAt: r.backtestEvaluatedAt ? r.backtestEvaluatedAt.toISOString() : null,
      };
    });

    const summary = buildTrackRecord(picks);

    // Benchmark window = first pick date → last pick's horizon close.
    let benchmark: Benchmark | null = null;
    const traded = rows.filter((r) => r.backtestStatus !== "SKIPPED");
    if (traded.length > 0) {
      const from = traded.reduce((m, r) => (r.dataDate < m ? r.dataDate : m), traded[0].dataDate);
      const to = traded.reduce(
        (m, r) => {
          const end = addDaysIso(r.dataDate, r.backtestHorizonDays ?? 0);
          return end > m ? end : m;
        },
        "0000-01-01"
      );
      benchmark = await btcBenchmark(from, to);
    }

    const recent = [...picks]
      .filter((p) => p.outcome === "TP1_WIN" || p.outcome === "TP2_WIN" || p.outcome === "SL_LOSS")
      .sort((a, b) => {
        const da = (a.evaluatedAt ?? a.dataDate).slice(0, 10);
        const dbTs = (b.evaluatedAt ?? b.dataDate).slice(0, 10);
        return da < dbTs ? 1 : da > dbTs ? -1 : 0;
      })
      .slice(0, RECENT_LIMIT)
      .map((p) => ({
        dataDate: p.dataDate,
        symbol: p.symbol,
        direction: p.direction,
        outcome: p.outcome,
        exitRNet: p.exitRNet,
      }));

    return NextResponse.json({
      success: true,
      data: {
        params: {
          feeBps: fee.feeBps,
          slippageBps: fee.slippageBps,
          roundTripBps: fee.roundTripBps,
        },
        summary,
        benchmark,
        recent,
      },
    });
  } catch (error) {
    console.error("[GET /api/track-record]", error);
    return NextResponse.json(
      { success: false, error: "Track record read failed." },
      { status: 500 }
    );
  }
}
