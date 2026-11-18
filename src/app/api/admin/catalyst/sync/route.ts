/**
 * RADAR-06 — Admin: đồng bộ catalyst từ Binance announcement, RSS news và unlock
 * (đọc event_risks). Mỗi nguồn hỏng độc lập; endpoint không throw vì một nguồn lỗi.
 *
 * Chạy tay/backfill dùng endpoint này (admin session). Scheduler chạy tự động
 * qua POST /api/catalyst/sync cùng scope nhưng không cần cookie admin.
 *
 * Scope (mặc định "all"):
 *   POST /api/admin/catalyst/sync?scope=announcements
 *   POST /api/admin/catalyst/sync  { "scope": "news" }
 *   POST /api/admin/catalyst/sync  { "scope": "unlocks" }
 *
 * GET trả trạng thái cho card admin: raw `status` theo scope, `info` đã hợp scope
 * (never_synced/synced/sources_failed), `sources` — lần chạy gần nhất + số fact
 * upsert trong lần đó + lỗi của từng nguồn — và `live` (tổng fact còn hạn trong
 * catalyst_events, gộp theo source), để ops thấy feed chết **và** kho dữ liệu
 * thực sự còn phục vụ panel được bao nhiêu, không cần query SQL.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  catalystSourceStatuses,
  catalystSyncInfo,
  parseCatalystSyncScope,
  readCatalystSyncStatus,
  syncCatalysts,
} from "@/lib/catalyst/sync";
import { catalystSourceLabel, catalystSyncSourceLabel } from "@/lib/catalyst/summarize";
import { catalystStaleness } from "@/lib/catalyst/health";
import { countLiveCatalystFacts } from "@/lib/catalyst/store";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const rawScope =
    (body as { scope?: unknown })?.scope ?? request.nextUrl.searchParams.get("scope");
  const scope = parseCatalystSyncScope(rawScope);

  try {
    const summary = await syncCatalysts(Date.now(), scope);
    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    console.error("[POST /api/admin/catalyst/sync]", error);
    return NextResponse.json(
      { success: false, error: "Failed to sync catalyst sources." },
      { status: 500 }
    );
  }
}

export async function GET() {
  const status = await readCatalystSyncStatus();
  const info = catalystSyncInfo(status);
  const statuses = catalystSourceStatuses(status);
  // RADAR-06-STALE: quá hạn theo nhịp scope HOẶC 2 lượt liền 0 fact. Tính ở
  // server để card và webhook dùng cùng một định nghĩa.
  const staleness = new Map(
    catalystStaleness(statuses).map((row) => [row.name, row] as const)
  );
  const sources = statuses.map((row) => {
    const stale = staleness.get(row.name);
    return {
      ...row,
      label: catalystSyncSourceLabel(row.name),
      stale: stale?.stale ?? false,
      staleReasons: stale?.reasons ?? [],
      minutesLate: stale?.minutesLate ?? null,
      minutesSince: stale?.minutesSince ?? null,
    };
  });
  const staleCount = sources.filter((row) => row.stale).length;

  // Fact còn hạn theo source (không phải số upsert của lần chạy cuối). Lỗi DB
  // không được làm hỏng cả card — trả 0 kèm cờ để UI biết số này không đọc được.
  let live: {
    total: number;
    bySource: Array<{ source: string; label: string; live: number }>;
    error?: string;
  } = { total: 0, bySource: [] };

  try {
    const counts = await countLiveCatalystFacts();
    live = {
      total: counts.reduce((sum, row) => sum + row.live, 0),
      bySource: counts.map((row) => ({
        source: row.source,
        label: catalystSourceLabel(row.source),
        live: row.live,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[CATALYST] Không đếm được fact còn hạn:", message);
    live.error = message;
  }

  return NextResponse.json({
    success: true,
    data: { status, info, sources, live, staleCount },
  });
}
