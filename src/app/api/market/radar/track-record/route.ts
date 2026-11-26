import { NextRequest, NextResponse } from "next/server";
import { evaluateRadarSignals } from "@/lib/market/track-record";
import { buildDemoTrackRecord } from "@/lib/market/demo";
import { readMeasuredBiasTtl, toTtlPayload } from "@/lib/market/bias-ttl-read";
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
    // TTL đo được dùng chung với bảng bias review, để badge trạng thái trên
    // radar không còn chạy bằng bảng viết tay. Đọc lỗi KHÔNG được làm mất track
    // record: thiếu số thì badge rơi về TTL tĩnh như trước.
    const ttl = await readMeasuredBiasTtl().catch((error: unknown) => {
      console.warn(
        "[RADAR] Measured bias TTL failed:",
        error instanceof Error ? error.message : error
      );
      return null;
    });
    // Gửi kèm nguồn (`measured`/`static`) + số run để badge nói rõ con số đó
    // là đo được hay viết tay, không để người đọc tự đoán.
    return NextResponse.json(
      { success: true, data: ttl ? { ...data, ttl: toTtlPayload(ttl) } : data },
      { headers: rateLimitHeaders(rate) }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không đọc được track record";
    console.error("[RADAR] Track record failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
