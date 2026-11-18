import { NextRequest, NextResponse } from "next/server";
import { BriefQuotaExceededError, BriefUnavailableError, getMoverBrief } from "@/lib/market/brief";
import { briefIpLimiter, clientIpFromHeaders, rateLimitHeaders } from "@/lib/market/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/market/movers/[symbol]/brief — LLM brief opt-in (user bấm nút).
// 3 lớp chặn: cross-site, per-IP/giờ, quota toàn hệ thống/ngày.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json(
      { success: false, error: "Cross-site request bị từ chối." },
      { status: 403 }
    );
  }

  const ipRate = briefIpLimiter.check(clientIpFromHeaders(request.headers));
  if (!ipRate.allowed) {
    return NextResponse.json(
      { success: false, error: `Bạn đã tạo quá nhiều brief. Thử lại sau ${ipRate.retryAfterSec}s.` },
      { status: 429, headers: rateLimitHeaders(ipRate) }
    );
  }

  const { symbol } = await params;
  try {
    const brief = await getMoverBrief(symbol);
    if (!brief) {
      return NextResponse.json(
        { success: false, error: `Không tìm thấy ${symbol.toUpperCase()} trên Binance Futures.` },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: brief }, { headers: rateLimitHeaders(ipRate) });
  } catch (error) {
    if (error instanceof BriefQuotaExceededError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 429, headers: rateLimitHeaders(ipRate) }
      );
    }
    if (error instanceof BriefUnavailableError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Không tạo được brief";
    console.error("[RADAR] Brief failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 503 });
  }
}
