import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 800; // 6 bài × stagger 90s cần runtime dài

// SQ-MOVERS: POST /api/square/movers
// Được gọi bởi FastAPI scheduler 07:15 hàng ngày (như /api/refresh) hoặc
// trigger tay từ admin. Không public exposure — Next chỉ bind localhost qua
// pm2, nginx không route path này ra ngoài.
//
// Response luôn 200 với `ok` boolean — scheduler log đọc result từ body.

export async function POST(_request: NextRequest) {
  try {
    const { runMoversPipeline } = await import("@/lib/square/movers/pipeline");
    const result = await runMoversPipeline();

    console.log(
      `[SQ-MOVERS] Pipeline: published=${result.postsPublished} failed=${result.postsFailed} deduped=${result.postsDeduped} quotaBlocked=${result.postsQuotaBlocked}` +
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
