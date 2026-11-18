import { NextResponse } from "next/server";
import { readCatalystCoverageReport } from "@/lib/catalyst/coverage";
import { demoCatalystCoverage } from "@/lib/catalyst/demo-coverage";

export const dynamic = "force-dynamic";

// RADAR-06-COVERAGE — GET /api/admin/catalyst/coverage
// Độ phủ catalyst của outlier radar, đọc từ signal ledger + catalyst_events.
// Không gọi Binance/RSS/LLM: toàn bộ là dữ liệu đã lưu trong DB.
export async function GET() {
  try {
    // Demo mode: ledger demo + facts mẫu, không đọc DB.
    const report =
      process.env.RADAR_DEMO === "1" ? demoCatalystCoverage() : await readCatalystCoverageReport();
    return NextResponse.json({ success: true, data: report });
  } catch (error) {
    console.error("[GET /api/admin/catalyst/coverage]", error);
    return NextResponse.json(
      { success: false, error: "Không dựng được báo cáo độ phủ catalyst." },
      { status: 500 }
    );
  }
}
