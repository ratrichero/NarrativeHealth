import { NextResponse } from "next/server";
import { evaluateRadarSignals } from "@/lib/market/track-record";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/market/radar/track-record — hit rate/forward return của tín hiệu đã lưu.
export async function GET() {
  try {
    const data = await evaluateRadarSignals();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không đọc được track record";
    console.error("[RADAR] Track record failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
