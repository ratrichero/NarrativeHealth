import { after, NextRequest, NextResponse } from "next/server";
import { getRadarSnapshot, type RadarSort } from "@/lib/market/radar";
import { recordAllRadarCohorts } from "@/lib/market/track-record";
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

  try {
    const snapshot = await getRadarSnapshot({ side, limit, minVolume, sort, excludeSystem });

    // Track record chỉ ghi tín hiệu thật; demo không được làm bẩn số liệu.
    // Ghi đủ 3 side + cohort neutral sau response, không phụ thuộc tab đang xem
    // và không làm chậm request hiện tại.
    if (!snapshot.demo) {
      after(async () => {
        await recordAllRadarCohorts().catch(() => undefined);
      });
    }

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
