import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { triggerMoversPipeline } from "@/lib/square/movers/trigger";

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
//   2. Token chung SCHEDULER_MOVERS_TOKEN (opt-in): nếu set ở Next thì yêu cầu
//      header X-Scheduler-Token khớp (timing-safe). FastAPI gửi header này khi
//      settings.scheduler_movers_token được set. Chưa set → cho qua với warning
//      (cùng posture với /api/refresh) để cron không bị vỡ sau deploy.
//
// Response luôn 200 với `ok` boolean — scheduler log đọc result từ body.

function tokenMatches(expected: string, got: string | null): boolean {
  if (!got) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(got, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
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

  // Lớp 2 — token chung (opt-in). Chưa config thì vẫn chạy như cũ nhưng cảnh báo.
  const expected = process.env.SCHEDULER_MOVERS_TOKEN?.trim();
  if (expected && expected.length > 0) {
    const got = request.headers.get("x-scheduler-token");
    if (!tokenMatches(expected, got)) {
      console.warn("[SQ-MOVERS] POST rejected: missing/invalid X-Scheduler-Token");
      return NextResponse.json(
        { success: false, error: "Unauthorized — invalid scheduler token." },
        { status: 401 }
      );
    }
  } else {
    console.warn(
      "[SQ-MOVERS] SCHEDULER_MOVERS_TOKEN chưa set — POST /api/square/movers chưa được xác thực. Đặt token ở cả .env Next và FastAPI (scheduler_movers_token) để khóa endpoint."
    );
  }

  return triggerMoversPipeline({ dryRun: false, trigger: "SCHEDULED" });
}
