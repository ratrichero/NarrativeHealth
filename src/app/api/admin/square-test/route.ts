import { NextRequest, NextResponse } from "next/server";
import { runSquarePipeline, getLastPipelineSummary } from "@/lib/square/production";
import { getQuotaStatus } from "@/lib/square/publisher";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/square-test
 *
 * SQ-OPERATE-02 — Controlled manual trigger
 *
 * Runs the full Square pipeline with all quality gates, dedup, and quota.
 * Publishes 0..N posts depending on available opportunities and quota.
 *
 * Query params:
 *   ?dryRun=true  — evaluate and generate content but do NOT publish
 *   ?summary=true — return only the last pipeline summary (GET)
 *
 * ⚠️ This creates REAL posts on Binance Square when not in dry-run mode
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    console.log(`[SQ-OPERATE-02] Manual trigger${dryRun ? " (DRY RUN)" : ""}`);

    // Check quota first
    const quota = await getQuotaStatus();

    if (dryRun) {
      // Dry run: just check what would happen
      return NextResponse.json({
        mode: "DRY_RUN",
        quota: {
          postsPublished: quota.postsPublished,
          postsRemaining: quota.postsRemaining,
          dailyHardCap: quota.dailyHardCap,
          warning: quota.warningThreshold,
        },
        message: "Dry run — no posts were published. Set dryRun=false to publish.",
      });
    }

    // Full pipeline execution
    const result = await runSquarePipeline();
    const summary = getLastPipelineSummary();

    return NextResponse.json({
      success: result.errors.length === 0,
      pipeline: {
        evaluated: result.evaluated,
        opportunities: result.opportunities,
        published: result.published,
        suppressed: result.suppressed,
        errors: result.errors,
      },
      summary: summary
        ? {
            executedAt: summary.executedAt,
            durationMs: summary.durationMs,
            qualified: summary.qualified,
            published: summary.published,
            failed: summary.failed,
            deduplicated: summary.deduplicated,
            retryPending: summary.retryPending,
            quotaBlocked: summary.quotaBlocked,
            quotaRemaining: summary.quotaRemaining,
            quotaWarning: summary.quotaWarning,
            llmUsedCount: summary.llmUsedCount,
            llmFallbackCount: summary.llmFallbackCount,
            details: summary.details,
          }
        : null,
      quota: {
        postsPublished: quota.postsPublished,
        postsRemaining: quota.postsRemaining,
        dailyHardCap: quota.dailyHardCap,
        warning: quota.warningThreshold,
      },
    });
  } catch (error) {
    console.error("[SQ-OPERATE-02] Manual trigger error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/square-test
 *
 * Returns the last pipeline execution summary without triggering a new execution.
 */
export async function GET() {
  const summary = getLastPipelineSummary();
  const quota = await getQuotaStatus();

  return NextResponse.json({
    lastExecution: summary,
    quota: {
      postsPublished: quota.postsPublished,
      postsRemaining: quota.postsRemaining,
      dailyHardCap: quota.dailyHardCap,
      warning: quota.warningThreshold,
    },
  });
}
