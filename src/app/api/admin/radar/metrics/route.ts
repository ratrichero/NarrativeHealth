import { NextResponse } from "next/server";
import { snapshotBuildStats } from "@/lib/market/binance-metrics";

export const dynamic = "force-dynamic";

// RADAR-METRIC — số liệu tải radar của process hiện tại (admin session do proxy
// AUTH-01 chặn): average/max duration và request Binance của từng build theo side
// + cache hit rate. Số liệu nằm trong RAM, reset khi restart; nhiều instance thì
// mỗi instance một bộ, và timeline từng build đọc ở log `[RADAR-METRIC]`.
export async function GET() {
  return NextResponse.json({ success: true, data: snapshotBuildStats() });
}
