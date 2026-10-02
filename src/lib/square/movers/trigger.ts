// Dùng chung cho POST /api/square/movers (scheduler) và
// POST /api/admin/square/movers (admin card) — tránh nhân đôi log/response shape.
import { NextResponse } from "next/server";

export interface MoversTriggerOptions {
  dryRun: boolean;
  trigger: "SCHEDULED" | "MANUAL";
}

export async function triggerMoversPipeline({
  dryRun,
  trigger,
}: MoversTriggerOptions): Promise<NextResponse> {
  try {
    const { runMoversPipeline } = await import("./pipeline");
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
