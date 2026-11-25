import { NextResponse } from "next/server";
import { readRadarAlertStats } from "@/lib/market/alert-stats";

export const dynamic = "force-dynamic";

// RADAR-ALERT-METRICS — GET /api/admin/radar/alert-stats
//
// Middleware AUTH-01 chặn /api/admin/* bằng admin session (fail-closed).
// Trả thống kê 7 ngày: sent/failed/suppressed/pending theo tier (URGENT/
// ACTIONABLE/WATCH) và p95 detection→delivery, đọc từ outbox + bias log sẵn có.
export async function GET() {
  try {
    const data = await readRadarAlertStats(7);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[RADAR-ALERT-METRICS] GET /api/admin/radar/alert-stats", error);
    return NextResponse.json(
      { success: false, error: "Không đọc được thống kê alert radar." },
      { status: 500 }
    );
  }
}
