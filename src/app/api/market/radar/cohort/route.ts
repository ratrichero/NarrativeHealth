import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { cohortIntervalMinutes, recordAllRadarCohorts } from "@/lib/market/track-record";
import { readRadarRuntimeConfig } from "@/lib/settings/radar-config";
import { runtimeGuardResponse } from "@/lib/env/route-guard";

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
// Auth giống /api/catalyst/sync và /api/square/movers: chỉ scheduler nội bộ gọi,
// token chung opt-in SCHEDULER_CATALYST_TOKEN (header X-Scheduler-Token,
// timing-safe). Chưa set token → cho qua kèm warning để cron không vỡ sau deploy.
//
// Không query param, không demo: gọi tay cũng dùng đúng đường này (kèm token).

function tokenMatches(expected: string, got: string | null): boolean {
  if (!got) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(got, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  // ENV-GUARD-01: job scheduler ghi DB production — local mặc định read-only.
  const blocked = runtimeGuardResponse(request, "scheduler");
  if (blocked) return blocked;

  const expected = process.env.SCHEDULER_CATALYST_TOKEN?.trim();
  if (expected && expected.length > 0) {
    const got = request.headers.get("x-scheduler-token");
    if (!tokenMatches(expected, got)) {
      console.warn("[RADAR-COHORT] rejected: missing/invalid X-Scheduler-Token");
      return NextResponse.json(
        { success: false, error: "Unauthorized — invalid scheduler token." },
        { status: 401 }
      );
    }
  } else {
    console.warn(
      "[RADAR-COHORT] SCHEDULER_CATALYST_TOKEN chưa set — POST /api/market/radar/cohort chưa được xác thực."
    );
  }

  const body = (await request.json().catch(() => ({}))) as { intervalMinutes?: unknown } | null;
  // Không truyền nhịp → đọc cấu hình runtime (DB > env) thay vì hardcode.
  const configured = body?.intervalMinutes;
  const intervalMinutes =
    configured === undefined || configured === null
      ? (await readRadarRuntimeConfig()).config.schedulerCohortMinutes
      : cohortIntervalMinutes(configured);

  try {
    const data = await recordAllRadarCohorts({ intervalMinutes });
    console.log(
      `[RADAR-COHORT] ran=${data.ran} skipped=${data.skipped ?? "-"} signals=${data.signals} ` +
        `clusters=${data.clusterEvents} alerts=${data.alerts} interval=${data.intervalMinutes}m`
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
