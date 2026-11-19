import { NextRequest, NextResponse } from "next/server";
import { getRadarSnapshot, type RadarSort } from "@/lib/market/radar";
import type { MoverSide } from "@/lib/market/scoring";
import { clientIpFromHeaders, listLimiter, rateLimitHeaders } from "@/lib/market/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SIDES: MoverSide[] = ["gainer", "loser", "unusual"];
const SORTS: RadarSort[] = ["composite", "change", "volume", "fresh"];

// GET /api/market/movers?side=gainer|loser|unusual&limit=15&sort=composite
// Cache trong module 60s; mọi enrichment đều null-safe.
export async function GET(request: NextRequest) {
  const rate = listLimiter.check(clientIpFromHeaders(request.headers));
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: `Quá nhiều request. Thử lại sau ${rate.retryAfterSec}s.` },
      { status: 429, headers: rateLimitHeaders(rate) }
    );
  }

  const params = request.nextUrl.searchParams;
  const sideParam = params.get("side") ?? "gainer";
  if (!SIDES.includes(sideParam as MoverSide)) {
    return NextResponse.json(
      { success: false, error: `side phải là một trong: ${SIDES.join(", ")}` },
      { status: 400 }
    );
  }
  const side = sideParam as MoverSide;

  const sortParam = params.get("sort") ?? "composite";
  const sort = SORTS.includes(sortParam as RadarSort) ? (sortParam as RadarSort) : "composite";

  const limitRaw = Number(params.get("limit"));
  const limit = Number.isFinite(limitRaw) ? limitRaw : 15;
  const minVolumeRaw = Number(params.get("minVolume"));
  const minVolume = Number.isFinite(minVolumeRaw) && minVolumeRaw > 0 ? minVolumeRaw : undefined;
  const excludeSystem = params.get("excludeSystem") === "1";
  // `?cluster=<id>`: giữ đúng cụm của permalink trong payload kể cả khi cụm
  // không nằm trong top 6 panel hiện tại.
  const clusterRaw = params.get("cluster")?.trim();
  const cluster = clusterRaw && clusterRaw.length <= 120 ? clusterRaw : undefined;

  try {
    // RADAR-COHORT: cohort/ledger/alert KHÔNG chạy trong request này nữa.
    // FastAPI gọi POST /api/market/radar/cohort theo nhịp cấu hình, nên tải
    // không phụ thuộc số người mở radar và không nhân lên theo số instance
    // (khoá trong `app_settings` chỉ cho một instance chạy mỗi lượt).
    const snapshot = await getRadarSnapshot({ side, limit, minVolume, sort, excludeSystem, cluster });

    return NextResponse.json({ success: true, data: snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không lấy được dữ liệu Binance";
    console.error("[RADAR] Snapshot failed:", message);
    return NextResponse.json(
      {
        success: false,
        error:
          message.includes("451")
            ? "Binance chặn vùng này (HTTP 451). Dữ liệu radar không khả dụng từ server hiện tại."
            : `Không lấy được dữ liệu Binance: ${message}`,
      },
      { status: 503 }
    );
  }
}
