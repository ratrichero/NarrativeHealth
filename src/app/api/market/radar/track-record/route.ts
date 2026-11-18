import { NextRequest, NextResponse } from "next/server";
import { evaluateRadarSignals } from "@/lib/market/track-record";
import { buildDemoTrackRecord } from "@/lib/market/demo";
import { clientIpFromHeaders, rateLimitHeaders, trackRecordLimiter } from "@/lib/market/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/market/radar/track-record — forward return 1h/4h/24h/3d/7d, MFE/MAE, TP/SL, so BTC.
export async function GET(request: NextRequest) {
  const rate = trackRecordLimiter.check(clientIpFromHeaders(request.headers));
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: `Quá nhiều request. Thử lại sau ${rate.retryAfterSec}s.` },
      { status: 429, headers: rateLimitHeaders(rate) }
    );
  }

  try {
    if (process.env.RADAR_DEMO === "1") {
      return NextResponse.json({ success: true, data: buildDemoTrackRecord() }, { headers: rateLimitHeaders(rate) });
    }
    const data = await evaluateRadarSignals();
    return NextResponse.json({ success: true, data }, { headers: rateLimitHeaders(rate) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không đọc được track record";
    console.error("[RADAR] Track record failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
