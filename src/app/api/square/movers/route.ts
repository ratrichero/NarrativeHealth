import { NextRequest, NextResponse } from "next/server";
import { triggerMoversPipeline } from "@/lib/square/movers/trigger";
import { runtimeGuardResponse } from "@/lib/env/route-guard";
import {
  authorizeSchedulerRequest,
  schedulerUnauthorized,
  SCHEDULER_MOVERS_TOKEN_VAR,
} from "@/lib/env/scheduler-token";

export const dynamic = "force-dynamic";
export const maxDuration = 800; // 6 bài × stagger 90s cần runtime dài

// SQ-MOVERS — POST /api/square/movers (SCHEDULER ONLY)
// Được gọi bởi FastAPI scheduler 07:15 hàng ngày (POST không param, như
// /api/refresh). Toàn bộ thao tác thủ công (dry-run / trigger tay / status)
// đã chuyển sang /api/admin/square/movers — được middleware AUTH-01 guard
// (admin session fail-closed), nên không còn endpoint status/macro mở.
//
// 2 lớp chặn trên endpoint này:
//   1. Reject query params dryRun/trigger → manual bắt buộc qua /api/admin/….
//      (khóa spam dry-run làm burn LLM quota từ bên ngoài)
//   2. SCHEDULER-AUTH: X-Scheduler-Token khớp SCHEDULER_MOVERS_TOKEN (FastAPI
//      gửi khi settings.scheduler_movers_token được set), hoặc admin session.
//      Chưa set token → 401 (fail-closed) thay vì chạy như trước, vì
//      `Host: localhost` do client tự đặt nên guard không đủ chặn.
//
// Response luôn 200 với `ok` boolean — scheduler log đọc result từ body.

export async function POST(request: NextRequest) {
  // ENV-GUARD-01: endpoint này đăng bài thật lên Binance Square. Chặn trước
  // cả token check để dev/preview không bao giờ publish dù .env ghi production.
  const blocked = runtimeGuardResponse(request, "publish");
  if (blocked) return blocked;

  const searchParams = request.nextUrl.searchParams;

  // Lớp 1 — manual/dry-run không đi qua endpoint scheduler.
  if (searchParams.has("dryRun") || searchParams.has("trigger")) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Manual/dry-run runs must use POST /api/admin/square/movers (admin session required).",
      },
      { status: 400 }
    );
  }

  // Lớp 2 — SCHEDULER-AUTH (fail-closed ngoài development).
  const auth = await authorizeSchedulerRequest(request, SCHEDULER_MOVERS_TOKEN_VAR);
  if (!auth.ok) {
    console.warn("[SQ-MOVERS] POST rejected: missing/invalid scheduler credentials");
    return schedulerUnauthorized(auth);
  }

  return triggerMoversPipeline({ dryRun: false, trigger: "SCHEDULED" });
}
