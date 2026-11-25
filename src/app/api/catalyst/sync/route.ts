import { NextRequest, NextResponse } from "next/server";
import { parseCatalystSyncScope, syncCatalysts } from "@/lib/catalyst/sync";
import { readRadarRuntimeConfig } from "@/lib/settings/radar-config";
import { runtimeGuardResponse } from "@/lib/env/route-guard";
import {
  authorizeSchedulerRequest,
  schedulerUnauthorized,
  SCHEDULER_CATALYST_TOKEN_VAR,
} from "@/lib/env/scheduler-token";

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
//   * SCHEDULER-AUTH giống /api/refresh: header X-Scheduler-Token khớp
//     SCHEDULER_CATALYST_TOKEN, hoặc admin session, hoặc APP_ENV=development.
//     Chưa set token → 401 (fail-closed) thay vì chạy; guard không đủ vì nó
//     tin header Host do client gửi.
//
// Không query param, không dry-run: mọi thao tác tay đi qua
// POST /api/admin/catalyst/sync. Response 200 với summary từng nguồn để
// scheduler log đọc được nguồn nào lỗi.

export async function POST(request: NextRequest) {
  // ENV-GUARD-01: job scheduler ghi DB production — local mặc định read-only.
  const blocked = runtimeGuardResponse(request, "scheduler");
  if (blocked) return blocked;

  const auth = await authorizeSchedulerRequest(request, SCHEDULER_CATALYST_TOKEN_VAR);
  if (!auth.ok) {
    console.warn("[CATALYST] POST /api/catalyst/sync rejected: missing/invalid scheduler credentials");
    return schedulerUnauthorized(auth);
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
