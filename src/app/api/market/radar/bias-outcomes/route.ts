import { NextRequest, NextResponse } from "next/server";
import { recordBiasOutcomes } from "@/lib/market/bias-log";
import { runtimeGuardResponse } from "@/lib/env/route-guard";
import {
  authorizeSchedulerRequest,
  schedulerUnauthorized,
  SCHEDULER_CATALYST_TOKEN_VAR,
} from "@/lib/env/scheduler-token";

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
// Auth giống /api/market/radar/cohort và /api/refresh: X-Scheduler-Token khớp
// SCHEDULER_CATALYST_TOKEN, hoặc admin session, hoặc APP_ENV=development.
// Chưa set token → 401 (fail-closed); guard không đủ vì nó tin header Host.

export async function POST(request: NextRequest) {
  // ENV-GUARD-01: job scheduler ghi DB production — local mặc định read-only.
  const blocked = runtimeGuardResponse(request, "scheduler");
  if (blocked) return blocked;

  const auth = await authorizeSchedulerRequest(request, SCHEDULER_CATALYST_TOKEN_VAR);
  if (!auth.ok) {
    console.warn("[RADAR-BIAS-LOG] rejected: missing/invalid scheduler credentials");
    return schedulerUnauthorized(auth);
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
