import { NextResponse } from "next/server";
import { snapshotBuildStats } from "@/lib/market/binance-metrics";

export const dynamic = "force-dynamic";

// RADAR-METRIC — số liệu tải radar của process hiện tại (admin session do proxy
// AUTH-01 chặn). Nhiều instance thì gọi từng instance hoặc xem log
// `[RADAR-METRIC] snapshot ...` để biết build nào chậm/tốn request.
export async function GET() {
  return NextResponse.json({ success: true, data: snapshotBuildStats() });
}
