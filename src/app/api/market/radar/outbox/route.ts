import { NextRequest, NextResponse } from "next/server";
import { runtimeGuardResponse } from "@/lib/env/route-guard";
import {
  authorizeSchedulerRequest,
  schedulerUnauthorized,
  SCHEDULER_CATALYST_TOKEN_VAR,
} from "@/lib/env/scheduler-token";
import { drainRadarAlertOutbox } from "@/lib/market/alert-outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// RADAR-TG P2 — POST /api/market/radar/outbox (SCHEDULER ONLY)
//
// FastAPI gọi endpoint này mỗi phút. Mỗi dòng outbox là một (alert, kênh, đích)
// đã ghi PENDING trước khi gửi; drain sẽ:
//   * gửi dòng tới hạn, tôn trọng `retry_after` khi Telegram trả 429,
//   * retry theo backoff 30s → 2m → 10m, tối đa 4 lần rồi FAILED,
//   * chuyển SUPPRESSED khi kênh đã đạt cap ngày (`RADAR_ALERT_DAILY_CAP`).
//
// pHi idempotent: chỉ đụng dòng PENDING tới hạn; chạy trùng không gửi lặp vì
// dòng đã SENT không còn được chọn. Auth giống cohort/bias-outcomes.
export async function POST(request: NextRequest) {
  // ENV-GUARD-01: job scheduler ghi DB production — local mặc định read-only.
  const blocked = runtimeGuardResponse(request, "scheduler");
  if (blocked) return blocked;

  const auth = await authorizeSchedulerRequest(request, SCHEDULER_CATALYST_TOKEN_VAR);
  if (!auth.ok) {
    console.warn("[RADAR-OUTBOX] POST rejected: missing/invalid scheduler credentials");
    return schedulerUnauthorized(auth);
  }

  try {
    const data = await drainRadarAlertOutbox();
    console.log(
      `[RADAR-OUTBOX] due=${data.due} sent=${data.sent} retried=${data.retried} ` +
        `failed=${data.failed} suppressed=${data.suppressed}`
    );
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[RADAR-OUTBOX] POST /api/market/radar/outbox", error);
    return NextResponse.json(
      { success: false, error: "Không chạy được outbox alert radar." },
      { status: 500 }
    );
  }
}
