import { NextResponse } from "next/server";
import { readRadarBacktest } from "@/lib/market/radar-backtest-read";

export const dynamic = "force-dynamic";

// RADAR-BACKTEST — so pipeline radar với basket equal-weight và chọn ngẫu nhiên
// cùng số pick/ngày ở một horizon. Proxy AUTH-01 chặn quyền admin.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    return NextResponse.json({
      success: true,
      data: await readRadarBacktest({
        days: params.get("days") ?? undefined,
        horizon: params.get("horizon") ?? undefined,
      }),
    });
  } catch (error) {
    console.warn(
      "[RADAR-BACKTEST] Không đọc được log/outcome:",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { success: false, error: "Không đọc được dữ liệu backtest radar." },
      { status: 500 }
    );
  }
}
