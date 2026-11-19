import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { recordBiasOutcomes } from "@/lib/market/bias-log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// RADAR-BIAS-LOG — POST /api/market/radar/bias-outcomes (SCHEDULER ONLY)
//
// Job riêng, tách khỏi cohort: tính outcome 1h/4h/24h/3d/7d cho các row của
// `radar_bias_log` đã đủ tuổi. Mỗi row chỉ được fetch klines khi có horizon tới
// hạn mà `radar_bias_outcome` chưa có dòng, nên chạy 10 phút/lần không lặp tải
// vô ích. Insert idempotent theo (log_id, horizon) → nhiều instance cùng gọi
// không nhân bản dữ liệu (chỉ tốn thêm request Binance).
//
// Auth giống /api/market/radar/cohort: token chung SCHEDULER_CATALYST_TOKEN
// (header X-Scheduler-Token, timing-safe). Chưa set token → cho qua kèm warning
// để cron không vỡ sau deploy.

function tokenMatches(expected: string, got: string | null): boolean {
  if (!got) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(got, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const expected = process.env.SCHEDULER_CATALYST_TOKEN?.trim();
  if (expected && expected.length > 0) {
    const got = request.headers.get("x-scheduler-token");
    if (!tokenMatches(expected, got)) {
      console.warn("[RADAR-BIAS-LOG] rejected: missing/invalid X-Scheduler-Token");
      return NextResponse.json(
        { success: false, error: "Unauthorized — invalid scheduler token." },
        { status: 401 }
      );
    }
  } else {
    console.warn(
      "[RADAR-BIAS-LOG] SCHEDULER_CATALYST_TOKEN chưa set — POST /api/market/radar/bias-outcomes chưa được xác thực."
    );
  }

  try {
    const data = await recordBiasOutcomes();
    console.log(
      `[RADAR-BIAS-LOG] outcomes candidates=${data.candidates} symbols=${data.symbols} ` +
        `computed=${data.computed} inserted=${data.inserted}`
    );
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[RADAR-BIAS-LOG] POST /api/market/radar/bias-outcomes", error);
    return NextResponse.json(
      { success: false, error: "Không tính được outcome bias radar." },
      { status: 500 }
    );
  }
}
