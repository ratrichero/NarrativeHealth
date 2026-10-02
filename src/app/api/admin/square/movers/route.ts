import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  squareOpportunities,
  squarePublications,
  squarePipelineExecutions,
} from "@/db/schema";
import { and, eq, or, desc } from "drizzle-orm";
import { getBusinessDate } from "@/lib/utils";
import { getQuotaStatus } from "@/lib/square/publisher";
import { triggerMoversPipeline } from "@/lib/square/movers/trigger";

export const dynamic = "force-dynamic";
export const maxDuration = 800; // 6 bài × stagger 90s cần runtime dài

// SQ-MOVERS Phase 4 — /api/admin/square/movers (ADMIN ONLY)
// Nằm dưới /api/admin/* nên middleware AUTH-01 yêu cầu admin session
// (fail-closed) — mọi thao tác thủ công của card "Top Movers Pipeline"
// (Admin → Analytics) đều đi qua đây:
//   GET  → status: lastExecution / bài hôm nay / quota / scheduler config
//   POST → ?dryRun=1 (chạy thử) hoặc không param (đăng thật), trigger=MANUAL
// FastAPI scheduler 07:15 vẫn gọi POST /api/square/movers (endpoint riêng).

// ── Scheduler config đọc đồng bộ với backend/config.py (pydantic-settings
//    case-insensitive → nhận cả SCHEDULER_MOVERS_X lẫn scheduler_movers_x). ──

function envVar(...names: string[]): string | undefined {
  for (const name of names) {
    const v = process.env[name];
    if (v != null && v.trim() !== "") return v.trim();
  }
  return undefined;
}

function envBool(raw: string | undefined, dflt: boolean): boolean {
  if (raw == null) return dflt;
  return !["false", "0", "no", "off", "disabled"].includes(raw.toLowerCase());
}

function envInt(raw: string | undefined, dflt: number, min: number, max: number): number {
  if (raw == null) return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function readSchedulerConfig(): { enabled: boolean; hour: number; minute: number } {
  return {
    enabled: envBool(
      envVar("SCHEDULER_MOVERS_ENABLED", "scheduler_movers_enabled"),
      true
    ),
    hour: envInt(envVar("SCHEDULER_MOVERS_HOUR", "scheduler_movers_hour"), 7, 0, 23),
    minute: envInt(envVar("SCHEDULER_MOVERS_MINUTE", "scheduler_movers_minute"), 15, 0, 59),
  };
}

// ── GET — status cho card "Top Movers Pipeline" ──
//   * lastExecution: lần chạy cuối từ square_pipeline_executions (trigger MOVERS_*)
//   * today: các bài movers đã persist hôm nay + trạng thái publication
//   * quota: quota post Square hiện tại (hard cap 100/ngày)
//   * scheduler: cấu hình cron movers (env, đồng bộ backend/config.py)

function kindFromRationale(rationale: unknown): "GAINER" | "LOSER" {
  const first = Array.isArray(rationale) ? String(rationale[0] ?? "") : String(rationale ?? "");
  return first.startsWith("Top gainer") ? "GAINER" : "LOSER";
}

export async function GET() {
  try {
    const [lastExecution] = await db
      .select()
      .from(squarePipelineExecutions)
      .where(
        or(
          eq(squarePipelineExecutions.triggerType, "MOVERS_CRON"),
          eq(squarePipelineExecutions.triggerType, "MOVERS_MANUAL")
        )
      )
      .orderBy(desc(squarePipelineExecutions.startedAt))
      .limit(1);

    const today = getBusinessDate();
    const todayRows = await db
      .select({
        id: squarePublications.id,
        symbol: squareOpportunities.coinSymbol,
        status: squarePublications.status,
        llmUsed: squarePublications.llmUsed,
        publishedAt: squarePublications.publishedAt,
        externalPostId: squarePublications.externalPostId,
        errorCode: squarePublications.errorCode,
        rationale: squareOpportunities.rationale,
      })
      .from(squarePublications)
      .innerJoin(squareOpportunities, eq(squarePublications.opportunityId, squareOpportunities.id))
      .where(and(eq(squareOpportunities.type, "MOVERS_SETUP"), eq(squareOpportunities.dataAsOf, today)))
      .orderBy(desc(squarePublications.id));

    const quota = await getQuotaStatus();

    return NextResponse.json({
      success: true,
      data: {
        lastExecution: lastExecution ?? null,
        today: {
          date: today,
          publishedCount: todayRows.filter((r) => r.status === "PUBLISHED").length,
          failedCount: todayRows.filter((r) => r.status === "FAILED").length,
          posts: todayRows.map((r) => ({
            id: r.id,
            symbol: r.symbol,
            kind: kindFromRationale(r.rationale),
            status: r.status,
            llmUsed: r.llmUsed,
            publishedAt: r.publishedAt,
            externalPostId: r.externalPostId,
            errorCode: r.errorCode,
          })),
        },
        quota,
        scheduler: readSchedulerConfig(),
      },
    });
  } catch (error) {
    console.error("[SQ-MOVERS] Status failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Movers status failed",
      },
      { status: 500 }
    );
  }
}

// ── POST — trigger tay từ admin card ──
//   ?dryRun=1 → chỉ collect + sinh content xem trước, không đăng/persist
//   trigger=forced SCHEDULED (hiếm) — mặc định MANUAL để ghi MOVERS_MANUAL

export async function POST(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const trigger =
    request.nextUrl.searchParams.get("trigger") === "scheduled" ? "SCHEDULED" : "MANUAL";
  return triggerMoversPipeline({ dryRun, trigger });
}
