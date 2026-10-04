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
// BT-06 — evaluator sống trong src/lib/backtest/settlement.ts, dùng chung với
// auto-settle hook của POST /api/refresh:
//   POST { horizon?: 7|14|30|60, dryRun?: boolean } — chạy/chạy thử (như cũ).
//   GET  — status: readyByHorizon (pick đã đóng window, sẵn sàng chốt),
//          stillOpenByHorizon, skippable, lastEvaluatedAt → chip auto-settle.
//
// Admin middleware guards both methods.

import { NextRequest, NextResponse } from "next/server";
import { runBacktestSettlement, getBacktestStatus } from "@/lib/backtest/settlement";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      horizon?: number;
      dryRun?: boolean;
    };
    const result = await runBacktestSettlement({
      horizon: body.horizon,
      dryRun: body.dryRun === true,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("[POST /api/admin/backtest/run]", error);
    return NextResponse.json(
      { success: false, error: "Backtest run failed." },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const status = await getBacktestStatus();
    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    console.error("[GET /api/admin/backtest/run]", error);
    return NextResponse.json(
      { success: false, error: "Backtest status failed." },
      { status: 500 }
    );
  }
}
