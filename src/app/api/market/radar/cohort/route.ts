import { NextRequest, NextResponse } from "next/server";
import { cohortIntervalMinutes, recordAllRadarCohorts } from "@/lib/market/track-record";
import {
  FAST_LANE_INTERVAL_MINUTES,
  fastCohortIntervalMinutes,
  normalizeCohortMode,
} from "@/lib/market/fast-lane";
import { readRadarRuntimeConfig } from "@/lib/settings/radar-config";
import { runtimeGuardResponse } from "@/lib/env/route-guard";
import {
  authorizeSchedulerRequest,
  schedulerUnauthorized,
  SCHEDULER_CATALYST_TOKEN_VAR,
} from "@/lib/env/scheduler-token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// RADAR-COHORT — POST /api/market/radar/cohort (SCHEDULER ONLY)
//
// Trước đây cohort/ledger/alert chạy trong `after()` của GET /api/market/movers,
// nên tải tỉ lệ với số người mở radar và mỗi instance tự chạy một lượt. Nay
// FastAPI APScheduler gọi endpoint này theo nhịp `schedulerCohortMinutes`
// (Admin → Radar & Catalyst, fallback env SCHEDULER_RADAR_COHORT_MINUTES):
//
//   body { intervalMinutes?: number }  → nhịp hiện hành, dùng làm khoảng cách
//                                        tối thiểu và thời gian giữ khoá.
//
// `recordAllRadarCohorts` tự giành khoá trong `app_settings`, nên nhiều instance
// cùng nhận tick chỉ một instance chạy; instance còn lại trả `skipped: "locked"`.
//
// Auth giống /api/catalyst/sync và /api/refresh: X-Scheduler-Token khớp
// SCHEDULER_CATALYST_TOKEN, hoặc admin session, hoặc APP_ENV=development.
// Chưa set token → 401 (fail-closed); guard không đủ vì nó tin header Host.
//
// Không query param, không demo: gọi tay cũng dùng đúng đường này (kèm token).

export async function POST(request: NextRequest) {
  // ENV-GUARD-01: job scheduler ghi DB production — local mặc định read-only.
  const blocked = runtimeGuardResponse(request, "scheduler");
  if (blocked) return blocked;

  const auth = await authorizeSchedulerRequest(request, SCHEDULER_CATALYST_TOKEN_VAR);
  if (!auth.ok) {
    console.warn("[RADAR-COHORT] rejected: missing/invalid scheduler credentials");
    return schedulerUnauthorized(auth);
  }

  const body = (await request.json().catch(() => ({}))) as {
    intervalMinutes?: unknown;
    mode?: unknown;
  } | null;
  // RADAR-TG P3: `mode="fast"` = làn 3 phút, universe ~30 symbol, chỉ URGENT.
  const mode = normalizeCohortMode(body?.mode);
  const fast = mode === "fast";
  const configured = body?.intervalMinutes;
  // Không truyền nhịp → đọc cấu hình runtime (DB > env) thay vì hardcode;
  // fast lane mặc định 3 phút thay vì nhịp cohort đầy đủ.
  const intervalMinutes = fast
    ? fastCohortIntervalMinutes(configured ?? FAST_LANE_INTERVAL_MINUTES)
    : configured === undefined || configured === null
      ? (await readRadarRuntimeConfig()).config.schedulerCohortMinutes
      : cohortIntervalMinutes(configured);

  try {
    const data = await recordAllRadarCohorts({ intervalMinutes, mode });
    console.log(
      `[RADAR-COHORT] mode=${data.mode} ran=${data.ran} skipped=${data.skipped ?? "-"} ` +
        `signals=${data.signals} clusters=${data.clusterEvents} alerts=${data.alerts} ` +
        `interval=${data.intervalMinutes}m`
    );
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[RADAR-COHORT] POST /api/market/radar/cohort", error);
    return NextResponse.json(
      { success: false, error: "Không chạy được cohort radar." },
      { status: 500 }
    );
  }
}
