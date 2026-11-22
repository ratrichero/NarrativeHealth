// TRACK-01 — Public track record (read-only, no auth).
//
// The admin Backtest tab already measures the picks, but a claim of performance
// is only worth anything if it is verifiable. This endpoint exposes the SAME
// stored results publicly: settled picks (GENUINE setups only), NET R after
// fees/slippage, win rate with a Wilson confidence interval, max drawdown,
// profit factor and an equal-weight basket benchmark of the crypto universe
// over the same window (BTC buy-and-hold is returned separately as a reference).
//
// It never recomputes outcomes — it reads what was settled once and aggregates
// it, so the public numbers cannot drift from the admin ones. Empty data is
// reported honestly instead of hidden.
//
// Phần đọc/aggregate nằm ở `track-record-read.ts` để bản export CSV/JSON dùng
// đúng cùng nguồn (không có hai bộ số khác nhau trên cùng một trang).

import { NextResponse } from "next/server";
import { readTrackRecord } from "@/lib/backtest/track-record-read";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { payload } = await readTrackRecord();
    return NextResponse.json({ success: true, data: payload });
  } catch (error) {
    console.error("[GET /api/track-record]", error);
    return NextResponse.json(
      { success: false, error: "Track record read failed." },
      { status: 500 }
    );
  }
}
