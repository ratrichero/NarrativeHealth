import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { parseCatalystSyncScope, syncCatalysts } from "@/lib/catalyst/sync";
import { readRadarRuntimeConfig } from "@/lib/settings/radar-config";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// RADAR-06-SCHED — POST /api/catalyst/sync (SCHEDULER ONLY)
//
// FastAPI APScheduler gọi endpoint này theo 3 nhịp (mặc định 5 / 15 / 60 phút):
//   {"scope":"announcements"} → Binance CMS 48/161/49
//   {"scope":"news"}          → 4 feed RSS
//   {"scope":"unlocks"}       → đọc event_risks (không gọi Apify)
//   {"scope":"all"}           → cả ba (dùng cho lần chạy tay/backfill)
//
// Vì sao không dùng /api/admin/catalyst/sync: middleware AUTH-01 chặn
// /api/admin/* bằng admin session fail-closed, scheduler không có cookie.
// Endpoint này giữ posture giống /api/square/movers và /api/refresh:
//   * chỉ localhost gọi (Next bind qua pm2, nginx không expose path này),
//   * token chung opt-in SCHEDULER_CATALYST_TOKEN: set ở Next thì bắt buộc
//     header X-Scheduler-Token khớp (timing-safe); chưa set → cho qua kèm
//     warning để cron không vỡ ngay sau deploy.
//
// Không query param, không dry-run: mọi thao tác tay đi qua
// POST /api/admin/catalyst/sync. Response 200 với summary từng nguồn để
// scheduler log đọc được nguồn nào lỗi.

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
      console.warn("[CATALYST] POST /api/catalyst/sync rejected: missing/invalid X-Scheduler-Token");
      return NextResponse.json(
        { success: false, error: "Unauthorized — invalid scheduler token." },
        { status: 401 }
      );
    }
  } else {
    console.warn(
      "[CATALYST] SCHEDULER_CATALYST_TOKEN chưa set — POST /api/catalyst/sync chưa được xác thực. Đặt token ở cả .env Next và FastAPI (scheduler_catalyst_token)."
    );
  }

  const body = await request.json().catch(() => ({}));
  const scope = parseCatalystSyncScope((body as { scope?: unknown })?.scope);

  try {
    // Làm mới config runtime trước khi sync (STALE cooldown/LLM quota nằm trong DB).
    await readRadarRuntimeConfig();
    const summary = await syncCatalysts(Date.now(), scope);
    console.log(
      `[CATALYST] sync scope=${summary.scope} sources=${summary.sources.length} stored=${summary.totals.stored} failed=${summary.totals.failedSources} purged=${summary.purged}`
    );
    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    console.error("[CATALYST] POST /api/catalyst/sync", error);
    return NextResponse.json(
      { success: false, error: "Failed to sync catalyst sources." },
      { status: 500 }
    );
  }
}
