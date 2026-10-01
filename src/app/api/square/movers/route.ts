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

export const dynamic = "force-dynamic";
export const maxDuration = 800; // 6 bài × stagger 90s cần runtime dài

// SQ-MOVERS: POST /api/square/movers
// Được gọi bởi FastAPI scheduler 07:15 hàng ngày (như /api/refresh) hoặc
// trigger tay từ admin (Admin → Analytics → card Top Movers Pipeline).
// Không public exposure — Next chỉ bind localhost qua pm2, nginx không route
// path này ra ngoài.
//
// Query params (chỉ dùng khi trigger tay):
//   ?dryRun=1         → chỉ collect + sinh content, KHÔNG đăng thật
//   ?trigger=manual   → ghi execution với MOVERS_MANUAL (mặc định MOVERS_CRON)
//
// Response luôn 200 với `ok` boolean — scheduler log đọc result từ body.

export async function POST(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const trigger =
    request.nextUrl.searchParams.get("trigger") === "manual" ? "MANUAL" : "SCHEDULED";

  try {
    const { runMoversPipeline } = await import("@/lib/square/movers/pipeline");
    const result = await runMoversPipeline({ dryRun, trigger });

    console.log(
      `[SQ-MOVERS] Pipeline${dryRun ? " (dry-run)" : ""}: published=${result.postsPublished} failed=${result.postsFailed} deduped=${result.postsDeduped} quotaBlocked=${result.postsQuotaBlocked}` +
        (result.skipped ? ` skipped=${result.skipped}` : "")
    );
    if (result.errors.length > 0) {
      console.warn("[SQ-MOVERS] errors:", result.errors);
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("[SQ-MOVERS] Pipeline crashed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Movers pipeline failed",
      },
      { status: 500 }
    );
  }
}

// GET /api/square/movers — status cho card "Top Movers Pipeline" (admin):
//   * lastExecution: lần chạy cuối từ square_pipeline_executions (trigger MOVERS_*)
//   * today: các bài movers đã persist hôm nay + trạng thái publication
//   * quota: quota post Square hiện tại (hard cap 100/ngày)
//   * scheduler: cấu hình cron movers đang đọc từ env (đồng bộ backend/config.py)

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
        scheduler: {
          enabled: process.env.SCHEDULER_MOVERS_ENABLED !== "false",
          hour: Number(process.env.SCHEDULER_MOVERS_HOUR ?? 7),
          minute: Number(process.env.SCHEDULER_MOVERS_MINUTE ?? 15),
        },
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
