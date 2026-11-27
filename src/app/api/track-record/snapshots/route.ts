import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { readTrackRecord } from "@/lib/backtest/track-record-read";
import {
  publishClosedDaySnapshot,
  readVerifiedSnapshotChain,
} from "@/lib/backtest/snapshot-store";
import { runtimeGuardResponse } from "@/lib/env/route-guard";
import { getBusinessDate, getYesterdayBusinessDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * SNAPSHOT-02 — bản chụp công khai.
 *
 * GET: các dòng đã chốt + `head` (neo để so với bản đã in ra ngoài) + kết quả
 * băm lại payload của từng dòng. Ai có payload cũng kiểm lại được bằng
 * `snapshotPayloadHash`.
 *
 * POST: chốt payload của một ngày ĐÃ ĐÓNG. Idempotent theo ngày — lượt gọi sau
 * trả dòng đã có với `created: false`, không ghi đè lịch sử đã công bố.
 *
 * Hai lớp chặn trên POST (đây là chỗ ghi vĩnh viễn số công khai):
 *   1. Token scheduler, BẮT BUỘC — dùng chung `SCHEDULER_CATALYST_TOKEN` với
 *      các job nội bộ khác (header `X-Scheduler-Token`, so timing-safe). Chưa
 *      set token → 503 (fail-closed), khác với các endpoint cron cũ cho qua:
 *      không có lý do gì để một endpoint chốt số mở cho người lạ.
 *   2. Chỉ chốt ngày đã đóng và đã qua settlement — xem `evaluateSnapshotDay`:
 *      `day < hôm nay (ICT)` và settlement đã chạy trong/ sau ngày đó. Nếu
 *      không, số hôm nay còn đang thay đổi mà đã ghi vào bảng append-only thì
 *      không sửa lại được nữa.
 */

function tokenMatches(expected: string, got: string | null): boolean {
  if (!got) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(got, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = params.get("limit");
  try {
    // Luôn băm lại payload của từng dòng — đây là phần kiểm được tại chỗ, không
    // có chế độ "chỉ lấy danh sách hash" để khỏi ai đọc `ok: true` mà payload
    // chưa được kiểm.
    const chain = await readVerifiedSnapshotChain(limit ? Number(limit) : undefined);
    return NextResponse.json({
      success: true,
      data: {
        entries: chain.entries,
        head: chain.head,
        verification: chain.verification,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.warn(
      "[SNAPSHOT-02] Không đọc được bản chụp (đã chạy migration 0040 + 0041?):",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { success: false, error: "Không đọc được bản chụp." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // ENV-GUARD-01: endpoint ghi DB production — local/preview không được chốt.
  const blocked = runtimeGuardResponse(request, "scheduler");
  if (blocked) return blocked;

  const expected = process.env.SCHEDULER_CATALYST_TOKEN?.trim();
  if (!expected) {
    console.error(
      "[SNAPSHOT-02] SCHEDULER_CATALYST_TOKEN chưa set — từ chối POST /api/track-record/snapshots (fail-closed)."
    );
    return NextResponse.json(
      { success: false, error: "Scheduler token chưa cấu hình — từ chối chốt bản chụp." },
      { status: 503 }
    );
  }
  if (!tokenMatches(expected, request.headers.get("x-scheduler-token"))) {
    console.warn("[SNAPSHOT-02] rejected: missing/invalid X-Scheduler-Token");
    return NextResponse.json(
      { success: false, error: "Unauthorized — invalid scheduler token." },
      { status: 401 }
    );
  }

  try {
    const { payload } = await readTrackRecord();
    const today = getBusinessDate();
    const picks = payload.summary.totals?.picks ?? 0;
    // Track record rỗng không có `meta.dataAsOf` (chưa pick nào đã chốt → không
    // có ngày dữ liệu), nên khoá theo ngày vừa đóng — cùng quy ước với job
    // auto-snapshot trong `/api/refresh`. Rỗng (0 pick) cũng không có gì để
    // settlement chốt → bỏ cổng settlement, nếu không deployment mới
    // (`lastEvaluatedAt = null`) không bao giờ chốt được ngày đầu tiên.
    const day = payload.meta.dataAsOf ?? getYesterdayBusinessDate();
    // Một cửa duy nhất cho cổng + chốt (dùng chung với /api/refresh và chốt bù).
    const { decision, result } = await publishClosedDaySnapshot({
      payload,
      day,
      today,
      lastEvaluatedAt: payload.summary.lastEvaluatedAt ?? null,
      hasPicks: picks > 0,
      metricsVersion: payload.meta.metricsVersion,
    });

    if (!decision.ok || !result) {
      const error =
        decision.reason === "invalid-day"
          ? "Payload không có ngày hợp lệ để chốt."
          : decision.reason === "day-open"
            ? `Ngày ${decision.day} chưa đóng (hôm nay ${decision.today} theo giờ ICT) — không chốt số còn đang thay đổi.`
            : `Settlement chưa chạy trong/sau ngày ${decision.day} (lần chốt gần nhất: ${decision.settlementDay ?? "chưa có"}) — chưa chốt.`;
      console.warn(
        `[SNAPSHOT-02] refused day=${decision.day} reason=${decision.reason} today=${decision.today} settlementDay=${decision.settlementDay ?? "-"}`
      );
      return NextResponse.json(
        {
          success: false,
          error,
          data: {
            reason: decision.reason,
            day: decision.day,
            today: decision.today,
            settlementDay: decision.settlementDay,
          },
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.warn(
      "[SNAPSHOT-02] Không chốt được bản chụp:",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { success: false, error: "Không chốt được bản chụp." },
      { status: 500 }
    );
  }
}
