import { NextResponse } from "next/server";
import { readBiasReview } from "@/lib/market/bias-review";

export const dynamic = "force-dynamic";

// RADAR-BIAS-REVIEW — bảng tổng hợp nhãn từ `radar_bias_log` + outcome (win-rate,
// return theo chiều nhãn) và ma trận chuyển nhãn trong 4h. Admin session do proxy
// AUTH-01 chặn, giống `/api/admin/radar/metrics`.
export async function GET(request: Request) {
  const days = new URL(request.url).searchParams.get("days") ?? undefined;
  try {
    return NextResponse.json({ success: true, data: await readBiasReview({ days }) });
  } catch (error) {
    console.warn(
      "[RADAR-BIAS-REVIEW] Không đọc được radar_bias_log:",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { success: false, error: "Không đọc được radar_bias_log." },
      { status: 500 }
    );
  }
}
